import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import type { AtomicMark, Gradebook, GradebookPeriod, GradeResult, Mark, Rubric } from "@happy-learners/contracts";
import { assessmentKindLabel, csvFile, displayOf, gradeStatistics, learnerResult, letterOf, pastedCells, periodFromPlan, planTotal, pointsInput, scoreInput, settingText, thresholdsText } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation, useUnsavedChanges } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Menu } from "../../ui/Menu";
import { Icon } from "../../ui/icons";
import { Button, EmptyState, ErrorState, Loading, PageHeader, PrimaryAction, Section, StatTiles, StatusBadge } from "../../ui/primitives";
import { Tabs } from "../../ui/Tabs";
import { currentRegional } from "../../regional";
import { useCourse } from "../course/context";
import { sectionCrumbs, useSection } from "./context";
import { GradePlanDialog } from "./GradePlan";
import { GradeStudentDrawer } from "./GradeStudent";
import { factorText, liveFactors, originLabel, resultText } from "./group-grade";

const number = (value: number) => new Intl.NumberFormat(currentRegional().locale, { maximumFractionDigits: 1 }).format(value);
const summary = "resumen";
/** How an activity is graded, as the grid's column header says it. */
const gradingLabels: Record<string, string> = { points: "Puntos", rubric: "Rúbrica", "pass-fail": "Aprobado o no", level: "Nivel", panel: "Tribunal" };
type Column = { id: string; kind: "grade" | "score" | "mark" | "panel" | "group"; grading?: string; title: string; detail: string; max: number; rubric?: Rubric | null; setId?: string | null; peerMin?: number; peerMax?: number };
type PeriodState = "open" | "submitted" | "returned" | "closed";
const stateLabels: Record<PeriodState, string> = { open: "Abierto", submitted: "En revisión", returned: "Devuelto", closed: "Cerrado" };
const stateTones = { open: "neutral", submitted: "info", returned: "warning", closed: "success" } as const;

function ResultBadge({ result }: { result?: Pick<GradeResult, "passed" | "complete"> }) {
  if (!result || result.passed === null) return <span className="muted">Sin notas</span>;
  return <StatusBadge tone={result.passed ? "success" : "danger"}>{result.passed ? "Aprueba" : "No aprueba"}{result.complete ? "" : " (parcial)"}</StatusBadge>;
}

/** Downloads a file from the API, keeping the name the server gives it. */
async function download(path: string, fallback: string) {
  const response = await fetch(`/api${path}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "No se pudo generar el archivo.");
  save(await response.blob(), /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || fallback);
}
function save(blob: Blob, name: string) {
  const link = document.createElement("a"), href = URL.createObjectURL(blob);
  link.href = href; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** The whole year as a spreadsheet: each period's activities and score, the average and the result. */
function gradebookCsv(book: Gradebook) {
  const header = ["Estudiante"], rows = book.learners.map(learner => [learner.name] as (string | number | null)[]);
  for (const period of book.periods) {
    const plan = book.activities.filter(item => item.periodId === period.id);
    for (const activity of plan) {
      header.push(`${period.name} · ${activity.title} (${number(activity.points)})`);
      book.learners.forEach((learner, index) => rows[index].push(book.scores.find(score => score.activityId === activity.id && score.learnerId === learner.id)?.points ?? null));
    }
    header.push(`${period.name} · Nota`, `${period.name} · Comentario`);
    book.learners.forEach((learner, index) => rows[index].push(
      book.grades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score ?? null,
      book.comments.find(comment => comment.learnerId === learner.id && comment.periodId === period.id)?.body ?? null));
  }
  header.push("Promedio", "Resultado");
  book.learners.forEach((learner, index) => {
    const result = book.results.find(item => item.learnerId === learner.id);
    rows[index].push(result?.average ?? null, !result || result.passed === null ? "Sin notas" : `${result.passed ? "Aprueba" : "No aprueba"}${result.complete ? "" : " (parcial)"}`);
  });
  return csvFile([header, ...rows]);
}

/**
 * /secciones/:id/notas — the section's gradebook (libreta). A tab per period of the school year with its grid: the
 * course's assessment plan (activities with points that add up to 100) or a single score per student, the period's
 * statistics, comments and history per student, and the closing review (hand in, return, approve). The summary tab
 * shows each period, the average and the result. Report cards come as a PDF, and the whole year as a CSV.
 */
export function SectionGradesPage() {
  const { section } = useSection();
  const { course } = useCourse();
  const { url, navigate } = useNavigation();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState<Gradebook | null>(null), [error, setError] = useState(""), [year, setYear] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({}), [busy, setBusy] = useState(""), [formError, setFormError] = useState("");
  const [planning, setPlanning] = useState(false), [student, setStudent] = useState(""), [returning, setReturning] = useState(false);
  const [rubricCell, setRubricCell] = useState<{ learnerId: string; learnerName: string; activityId: string; title: string; rubric: Rubric } | null>(null);
  const [groupRubric, setGroupRubric] = useState<{ workGroupId: string; name: string; activityId: string; title: string; rubric: Rubric } | null>(null);
  const [peerTarget, setPeerTarget] = useState<{ activityId: string; workGroupId: string } | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  const dirty = Object.keys(edits).length > 0;
  useUnsavedChanges(dirty);
  const load = useCallback(() => api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades${year ? `?year=${year}` : ""}`)
    .then(result => { setData(result.gradebook); setError(""); setEdits({}); }, cause => setError(message(cause))), [section.id, year]);
  useEffect(() => { void load(); }, [load]);
  const crumbs = sectionCrumbs(section, { label: "Notas" });
  const update = (book: Gradebook) => { setData(book); setEdits({}); setFormError(""); };
  async function saveGroupMark(activityId: string, workGroupId: string, mark: AtomicMark) {
    if (dirty) { toast({ tone: "error", message: "Guarda o descarta tus cambios antes de calificar un grupo." }); return; }
    try {
      update((await api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades/activities/${activityId}/groups`, "PUT", { workGroupId, mark })).gradebook);
      toast({ message: "Nota del grupo guardada." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function exportCsv() {
    if (!data) return;
    save(new Blob([gradebookCsv(data)], { type: "text/csv;charset=utf-8" }), `notas-${slug(`${section.name}-${data.year?.name || ""}`)}.csv`);
  }
  async function reports(learnerId?: string) {
    setBusy("report");
    try { await download(`/sections/${section.id}/grades/report.pdf?${new URLSearchParams({ ...(data?.year ? { year: data.year.id } : {}), ...(learnerId ? { learner: learnerId } : {}) })}`, "boleta.pdf"); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  const ready = !!data?.year && data.learners.length > 0;
  const header = <PageHeader crumbs={crumbs} title="Notas" description="El plan de evaluación de cada periodo, los punteos de cada estudiante, la revisión de cierre y las boletas. Un periodo sin nota no cuenta como cero."
    actions={ready && <>
      <Button icon="download" onClick={() => void exportCsv()}>Exportar CSV</Button>
      <Button icon="file" busy={busy === "report"} disabled={!!busy} onClick={() => void reports()}>{busy === "report" ? "Generando…" : "Boletas en PDF"}</Button>
    </>}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando notas…" lines={6}/></>;
  if (!data.year) return <>{header}<EmptyState icon="calendar" title="Aún no hay un ciclo lectivo vigente">Administración define el ciclo y sus periodos en <Link href="/organizacion">Organización</Link>. Cuando lo active, aquí podrás registrar las notas.</EmptyState></>;

  const { policy, periods, learners } = data;
  const letters = policy.scale === "letters_af";
  const today = new Date().toISOString().slice(0, 10);
  const requested = url.searchParams.get("periodo");
  const view = requested === summary || periods.some(period => period.id === requested) ? requested!
    : (periods.find(period => period.from <= today && today <= period.until && !period.locked) || periods.find(period => !period.locked))?.id || summary;
  const go = (next: string) => {
    if (dirty) { toast({ tone: "error", message: "Guarda o descarta tus cambios antes de cambiar de periodo." }); return; }
    const target = new URL(url); target.searchParams.set("periodo", next); navigate(target.pathname + target.search, true);
  };
  const stateOf = (period: GradebookPeriod): PeriodState => {
    if (period.locked) return "closed";
    const review = data.reviews.find(item => item.periodId === period.id);
    return review?.status === "submitted" ? "submitted" : review?.status === "returned" ? "returned" : "open";
  };
  const tabs = [
    ...periods.map(period => ({ value: period.id, label: period.name, badge: stateOf(period) !== "open" && <span className={`tab-badge state-${stateOf(period)}`}>{stateLabels[stateOf(period)]}</span> })),
    { value: summary, label: "Resumen del ciclo" },
  ];
  return <>
    {header}
    <Section title={`${data.year.name}${data.year.status === "closed" ? " (cerrado)" : ""}`} action={data.years.length > 1 && <label><span className="sr-only">Ciclo lectivo</span>
      <select value={data.year.id} onChange={event => { if (!dirty) { setYear(event.target.value); } }} disabled={dirty}>{data.years.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "closed" ? " (cerrado)" : ""}</option>)}</select></label>}>
      <p className="muted small grade-policy">
        {data.scheme && data.scheme.id !== "points"
          ? <>Esquema «{data.scheme.name}»{data.scheme.passing.min !== undefined ? ` · Aprueba con ${data.scheme.passing.min}` : data.scheme.passing.level ? ` · Aprueba desde ${data.scheme.levels?.find(level => level.id === data.scheme!.passing.level)?.label || data.scheme.passing.level}` : ""}.{" "}</>
          : <>{settingText("gradeScale", policy.scale)} · Aprueba con {policy.passingGrade} · {settingText("gradeAverage", policy.average)}{letters ? ` · ${thresholdsText(policy.letterThresholds)}` : ""}.{" "}</>}
        {course.status === "active" && <Link href={`/cursos/${course.id}/configuracion`}>Configuración del curso</Link>}
      </p>
      {data.year.status === "closed" && <p className="notice"><Icon name="info" size={18}/>El ciclo está cerrado: sus notas se consultan, pero ya no cambian.</p>}
      {!periods.length ? <p className="muted">El ciclo no tiene periodos.</p>
        : !learners.length ? <EmptyState compact icon="users" title="La sección aún no tiene estudiantes" action={<Link className="button secondary small" href={`/secciones/${section.id}/estudiantes`}>Ver estudiantes</Link>}>Agrega estudiantes a la lista de la sección para registrar sus notas.</EmptyState>
        : <Tabs label="Periodos del ciclo" value={view} onChange={go} items={tabs}>
          {view === summary ? <YearSummary book={data} onStudent={setStudent}/> : periodGrid()}
        </Tabs>}
    </Section>
    {planning && view !== summary && <GradePlanDialog book={data} periodId={view} sectionId={section.id} onClose={() => setPlanning(false)} onSaved={book => { update(book); setPlanning(false); toast({ message: "Plan de evaluación guardado." }); }}/>}
    {rubricCell && <RubricDialog cell={rubricCell} current={edits[`mark:${rubricCell.learnerId}:${rubricCell.activityId}`]} onClose={() => setRubricCell(null)} onSave={choices => { setEdits(current => ({ ...current, [`mark:${rubricCell.learnerId}:${rubricCell.activityId}`]: JSON.stringify({ kind: "rubric", choices }) })); setRubricCell(null); }}/>}
    {groupRubric && <RubricDialog cell={{ learnerName: groupRubric.name, title: groupRubric.title, rubric: groupRubric.rubric }} current={(() => { const mark = data.groupMarks?.find(item => item.activityId === groupRubric.activityId && item.workGroupId === groupRubric.workGroupId)?.mark; return mark ? JSON.stringify(mark) : undefined; })()} onClose={() => setGroupRubric(null)} onSave={choices => { const target = groupRubric; setGroupRubric(null); void saveGroupMark(target.activityId, target.workGroupId, { kind: "rubric", choices }); }}/>}
    {peerTarget && <PeerDialog book={data} activityId={peerTarget.activityId} workGroupId={peerTarget.workGroupId} onClose={() => setPeerTarget(null)} onSaved={book => { update(book); setPeerTarget(null); toast({ message: "Coevaluación guardada." }); }}/>}
    {student && <GradeStudentDrawer book={data} learnerId={student} periodId={view === summary ? (periods.find(period => !period.locked) || periods[periods.length - 1]).id : view}
      editable={data.canEdit && view !== summary && ["open", "returned"].includes(stateOf(periods.find(period => period.id === view)!))}
      onSaved={book => { update(book); toast({ message: "Comentario guardado." }); }} onReport={() => void reports(student)} onClose={() => setStudent("")}/>}
    {returning && view !== summary && <ReturnDialog sectionId={section.id} period={periods.find(period => period.id === view)!} onClose={() => setReturning(false)} onSaved={book => { update(book); setReturning(false); toast({ message: "El periodo se devolvió a la sección." }); }}/>}
  </>;

  // Called as a function, not rendered as a component: the grid keeps its inputs (and their focus) between renders.
  function periodGrid() {
    const period = periods.find(item => item.id === view)!;
    const state = stateOf(period), review = data!.reviews.find(item => item.periodId === period.id);
    const plan = data!.activities.filter(item => item.periodId === period.id);
    const planned = plan.length > 0, total = planTotal(plan);
    const editable = data!.canEdit && (state === "open" || state === "returned");
    const columns: Column[] = planned
      ? plan.map(item => {
        const grading = item.grading || "points";
        const grouped = item.groupMode === "group";
        return { id: item.id, kind: grouped ? "group" as const : grading === "points" ? "score" as const : grading === "panel" ? "panel" as const : "mark" as const, grading, title: item.title, detail: `${assessmentKindLabel(item.kind)} · ${grouped ? "En grupos · " : ""}${grading === "points" ? `${number(item.points)} pts` : gradingLabels[grading] || grading}`, max: item.points, rubric: item.rubric, setId: item.workGroupSetId, peerMin: item.peerMin, peerMax: item.peerMax };
      })
      : [{ id: period.id, kind: "grade" as const, title: "Nota del periodo", detail: "De 0 a 100", max: 100 }];
    const key = (learnerId: string, column: Column) => `${column.kind}:${learnerId}:${column.id}`;
    const exemptKey = (learnerId: string, activityId: string) => `exempt:${learnerId}:${activityId}`;
    const storedMark = (learnerId: string, activityId: string) => data!.marks?.find(mark => mark.learnerId === learnerId && mark.activityId === activityId && mark.evaluatorId === null);
    const isExempt = (learnerId: string, activityId: string) => exemptKey(learnerId, activityId) in edits ? edits[exemptKey(learnerId, activityId)] === "exempt" : storedMark(learnerId, activityId)?.mark.kind === "exempt";
    const stored = (learnerId: string, column: Column) => {
      if (column.kind === "mark") { const mark = storedMark(learnerId, column.id); return mark && mark.mark.kind !== "exempt" ? JSON.stringify(mark.mark) : ""; }
      if (column.kind === "group") {
        const score = data!.scores.find(item => item.learnerId === learnerId && item.activityId === column.id)?.points;
        if (score !== undefined) return String(score);
        const mark = storedMark(learnerId, column.id)?.mark;
        return mark?.kind === "points" ? String(mark.value) : "";
      }
      const value = column.kind === "grade" ? data!.grades.find(grade => grade.learnerId === learnerId && grade.periodId === column.id)?.score : data!.scores.find(score => score.learnerId === learnerId && score.activityId === column.id)?.points;
      return value === undefined ? "" : String(value);
    };
    const valueOf = (learnerId: string, column: Column) => edits[key(learnerId, column)] ?? stored(learnerId, column);
    const parse = (value: string, column: Column) => column.kind === "grade" ? scoreInput(value) : pointsInput(value, column.max);
    // The period's score as it would be with the unsaved changes.
    const periodOf = (learnerId: string) => {
      if (!planned) { const value = parse(valueOf(learnerId, columns[0]), columns[0]); return { score: typeof value === "number" ? value : null, graded: 100, complete: typeof value === "number" }; }
      const earned = new Map<string, number>();
      for (const column of columns) { const value = parse(valueOf(learnerId, column), column); if (typeof value === "number") earned.set(column.id, value); }
      return periodFromPlan(plan, earned);
    };
    const scores = learners.map(learner => ({ learnerId: learner.id, ...periodOf(learner.id) }));
    // While the plan is under way, each student is judged by the share of the points graded so far: 42 of 60 is 70.
    const standing = (item: { score: number | null; graded: number; complete: boolean }) => item.score === null ? null : item.complete || !planned || !item.graded ? item.score : Math.round(item.score / item.graded * 1000) / 10;
    // With a scheme other than accumulated points, the period, its statistics and the result all read the scheme's score.
    const custom = !!data!.scheme && data!.scheme.id !== "points";
    const schemed = (learnerId: string) => custom ? schemePeriod(data!, period, plan, learnerId, columns, valueOf, isExempt) : null;
    const partial = !custom && planned && scores.some(item => item.score !== null && !item.complete);
    const stats = gradeStatistics(scores.map(item => ({ learnerId: item.learnerId, score: custom ? schemed(item.learnerId)?.score ?? null : standing(item) })), custom ? data!.scheme!.passing.min ?? policy.passingGrade : policy.passingGrade);
    const invalid = Object.entries(edits).some(([id, value]) => {
      const [kind, , columnId] = id.split(":");
      if (kind !== "score" && kind !== "grade") return false;
      const column = columns.find(item => item.id === columnId && item.kind === kind);
      return !column || parse(value, column) === undefined;
    });
    const changed = Object.keys(edits).length;
    function setExempt(learnerId: string, activityId: string, on: boolean) {
      const id = exemptKey(learnerId, activityId), storedOn = storedMark(learnerId, activityId)?.mark.kind === "exempt";
      setEdits(current => { const next = { ...current }; if (on === storedOn) delete next[id]; else next[id] = on ? "exempt" : ""; return next; });
    }
    function edit(learnerId: string, column: Column, value: string) {
      const id = key(learnerId, column), original = stored(learnerId, column);
      setEdits(current => { const next = { ...current }; if (value.trim() === original) delete next[id]; else next[id] = value.trim() === "" ? "" : value; return next; });
    }
    function focus(row: number, column: number) {
      const target = grid.current?.querySelector<HTMLInputElement>(`[data-cell="${row}:${column}"]`);
      if (target) { target.focus(); target.select(); return true; }
      return false;
    }
    function onKey(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
      const input = event.currentTarget, atStart = input.selectionStart === 0 && input.selectionEnd === 0, atEnd = input.selectionStart === input.value.length;
      const moves: Record<string, [number, number] | null> = {
        ArrowDown: [row + 1, column], ArrowUp: [row - 1, column], Enter: event.shiftKey ? [row - 1, column] : [row + 1, column],
        ArrowRight: atEnd ? [row, column + 1] : null, ArrowLeft: atStart ? [row, column - 1] : null,
      };
      const next = moves[event.key];
      if (next && focus(...next)) event.preventDefault();
      else if (event.key === "Enter") event.preventDefault();
    }
    // Cells copied from a spreadsheet fill the grid from the focused cell, right and down.
    function onPaste(event: ClipboardEvent<HTMLInputElement>, row: number, column: number) {
      const text = event.clipboardData.getData("text");
      if (!/[\t\n]/.test(text.trim())) return;
      event.preventDefault();
      let count = 0;
      pastedCells(text).forEach((cells, i) => cells.forEach((value, j) => {
        const learner = learners[row + i], target = columns[column + j];
        if (learner && target) { edit(learner.id, target, value); count++; }
      }));
      toast({ message: `Se pegaron ${plural(count, "celda", "celdas")}. Revísalas y guarda.` });
    }
    async function submitGrades(event: FormEvent) {
      event.preventDefault(); setBusy("save"); setFormError("");
      try {
        const entries = Object.entries(edits).map(([id, value]) => { const [kind, learnerId, columnId] = id.split(":"); return { kind, learnerId, columnId, value }; });
        const marks = [
          ...entries.filter(entry => entry.kind === "mark" && entry.value).map(entry => ({ learnerId: entry.learnerId, activityId: entry.columnId, mark: JSON.parse(entry.value) as AtomicMark })),
          ...entries.filter(entry => entry.kind === "exempt").map(entry => ({ learnerId: entry.learnerId, activityId: entry.columnId, mark: entry.value === "exempt" ? { kind: "exempt" as const } : null })),
        ];
        const body = {
          grades: entries.filter(entry => entry.kind === "grade").map(entry => ({ learnerId: entry.learnerId, periodId: entry.columnId, score: scoreInput(entry.value) ?? null })),
          scores: entries.filter(entry => entry.kind === "score").map(entry => ({ learnerId: entry.learnerId, activityId: entry.columnId, points: pointsInput(entry.value, 100) ?? null })),
          ...(marks.length ? { marks } : {}),
        };
        const result = await api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades`, "PUT", body);
        update(result.gradebook);
        toast({ message: `Notas guardadas: ${plural(entries.length, "cambio", "cambios")}.` });
      } catch (cause) { setFormError(message(cause)); }
      finally { setBusy(""); }
    }
    async function act(kind: "submit" | "lock" | "unlock") {
      if (dirty) { toast({ tone: "error", message: "Guarda o descarta tus cambios antes de entregar, aprobar o reabrir el periodo." }); return; }
      const missing = scores.filter(item => !item.complete).length;
      const dialogs = {
        submit: { title: `¿Entregar las notas de «${period.name}»?`, body: <p>Coordinación las revisará y las aprobará o te las devolverá con comentarios. Mientras tanto no cambian.{missing ? ` Ojo: ${plural(missing, "estudiante no tiene", "estudiantes no tienen")} todas sus notas.` : ""}</p>, confirm: "Entregar para revisión" },
        lock: { title: `¿Aprobar y cerrar «${period.name}»?`, body: <p>Nadie podrá cambiar las notas de este periodo en «{section.name}». Solo administración puede reabrirlas.{missing ? ` ${plural(missing, "estudiante no tiene", "estudiantes no tienen")} todas sus notas.` : ""}</p>, confirm: "Aprobar y cerrar" },
        unlock: { title: `¿Reabrir las notas de «${period.name}»?`, body: <p>Quienes imparten la sección podrán cambiarlas de nuevo y tendrán que entregarlas otra vez.</p>, confirm: "Reabrir notas" },
      };
      if (!await confirm(dialogs[kind])) return;
      setBusy(kind);
      try {
        const path = `/sections/${section.id}/grades/periods/${period.id}/${kind === "submit" ? "submit" : "lock"}`;
        update((await api<{ gradebook: Gradebook }>(path, kind === "unlock" ? "DELETE" : "POST")).gradebook);
        toast({ message: kind === "submit" ? `«${period.name}» quedó entregado para revisión.` : kind === "lock" ? `«${period.name}» quedó aprobado y cerrado.` : `«${period.name}» se reabrió.` });
      } catch (cause) { toast({ tone: "error", message: message(cause) }); }
      finally { setBusy(""); }
    }
    const resultOf = (item: { score: number | null; graded: number; complete: boolean }) => { const value = standing(item); return { passed: value === null ? null : value >= policy.passingGrade, complete: item.complete }; };
    return <div className="stack">
      <div className="grade-status">
        <StatusBadge tone={stateTones[state]}>{stateLabels[state]}</StatusBadge>
        <span className="muted small">
          {state === "closed" && period.lockedAt && `Aprobó ${period.lockedBy || "administración"} el ${sessionDay(period.lockedAt.slice(0, 10), "short")}.`}
          {state === "submitted" && review && `Entregó ${review.submittedBy} el ${sessionDay(review.submittedAt.slice(0, 10), "short")}. Coordinación lo revisa.`}
          {state === "returned" && review && `Lo devolvió ${review.reviewedBy || "coordinación"}: «${review.note}»`}
          {state === "open" && `${sessionDay(period.from, "short")} – ${sessionDay(period.until, "short")}`}
        </span>
        <div className="grade-status-actions">
          {data!.canSubmit && (state === "open" || state === "returned") && <Button icon="send" disabled={!!busy || ((data!.scheme?.method || "points") === "points" && planned && total !== 100)} title={(data!.scheme?.method || "points") === "points" && planned && total !== 100 ? "El plan debe sumar 100 puntos." : undefined} onClick={() => void act("submit")}>Entregar para revisión</Button>}
          {data!.canLock && state === "submitted" && <Button variant="ghost" icon="undo" disabled={!!busy} onClick={() => setReturning(true)}>Devolver</Button>}
          {data!.canLock && state !== "closed" && <Button icon="shield" disabled={!!busy} onClick={() => void act("lock")}>Aprobar y cerrar</Button>}
          {data!.canUnlock && state === "closed" && period.lockedAt && <Button variant="ghost" icon="undo" disabled={!!busy} onClick={() => void act("unlock")}>Reabrir</Button>}
        </div>
      </div>
      <div className="grade-plan-line">
        <Icon name="list" size={18}/>
        {planned
          ? <span><strong>Plan de evaluación:</strong> {plural(plan.length, "actividad", "actividades")}{(data!.scheme?.method || "points") === "points" && <> · {number(total)} de 100 puntos{total !== 100 && <span className="muted"> (incompleto)</span>}</>}</span>
          : <span className="muted">Sin plan de evaluación: registras una nota de 0 a 100 por estudiante. Con un plan, la nota es la suma de la zona y el examen.</span>}
        {editable && <Button variant="ghost" icon={planned ? "edit" : "plus"} className="small" onClick={() => { if (dirty) toast({ tone: "error", message: "Guarda o descarta tus cambios antes de editar el plan." }); else setPlanning(true); }}>{planned ? "Editar el plan" : "Crear plan de evaluación"}</Button>}
      </div>
      <PeriodStats stats={stats} names={new Map(learners.map(learner => [learner.id, learner.name]))} passing={policy.passingGrade}/>
      {partial && <p className="muted small">Mientras falten actividades, las cifras y el resultado comparan lo ganado con lo evaluado hasta ahora (por ejemplo, 42 de 60 cuenta como 70).</p>}
      <form onSubmit={submitGrades} className="stack">
        {formError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{formError}</p>}
        <div className="coverage-scroll" role="region" aria-label={`Notas de ${section.name} en ${period.name}`} tabIndex={0}>
          <table ref={grid} className="coverage-table grades-table">
            <thead><tr>
              <th scope="col">Estudiante</th>
              {columns.map(column => <th scope="col" key={column.id} className="grade-column"><span className="grade-column-title">{column.title}</span><span className="muted grade-column-detail">{column.detail}</span></th>)}
              <th scope="col">{planned ? "Nota del periodo" : "Resultado"}</th>
              {planned && <th scope="col">Resultado</th>}
              <th scope="col"><span className="sr-only">Detalle</span></th>
            </tr></thead>
            <tbody>{(data!.workGroups || []).filter(group => columns.some(column => column.kind === "group" && column.setId === group.setId)).map(group => <tr key={group.id} className="grade-group-row">
              <th scope="row">{group.name}<span className="muted grade-column-detail">{group.learnerIds.map(id => learners.find(learner => learner.id === id)?.name).filter(Boolean).join(", ")}</span></th>
              {columns.map(column => <td key={column.id} className="grade-cell">{column.kind === "group" && column.setId === group.setId
                ? <GroupMarkCell column={column} groupName={group.name} mark={data!.groupMarks?.find(item => item.activityId === column.id && item.workGroupId === group.id)?.mark} levels={data!.scheme?.levels} editable={editable} onSave={mark => void saveGroupMark(column.id, group.id, mark)} onRubric={() => column.rubric && setGroupRubric({ workGroupId: group.id, name: group.name, activityId: column.id, title: column.title, rubric: column.rubric })} onPeers={() => setPeerTarget({ activityId: column.id, workGroupId: group.id })}/>
                : <span className="muted">—</span>}</td>)}
              {planned && <td/>}<td/><td/>
            </tr>)}{learners.map((learner, row) => {
              const item = scores[row], comment = data!.comments.some(entry => entry.learnerId === learner.id && entry.periodId === period.id);
              return <tr key={learner.id}>
                <th scope="row">{learner.name}</th>
                {columns.map((column, index) => {
                  const value = valueOf(learner.id, column), parsed = column.kind === "score" || column.kind === "grade" ? parse(value, column) : undefined;
                  const changedCell = key(learner.id, column) in edits || (column.kind !== "grade" && exemptKey(learner.id, column.id) in edits);
                  const exempt = column.kind !== "grade" && isExempt(learner.id, column.id);
                  return <td key={column.id} className={`grade-cell${changedCell ? " grade-dirty" : ""}`}>
                    {column.kind === "panel" ? <span className="panel-progress">{panelProgress(data!, learner.id, column.id)}</span>
                      : column.kind === "group" ? <GroupResult book={data!} column={column} learnerId={learner.id}/>
                      : exempt ? <span>Exonerado</span>
                      : column.kind === "mark" ? <MarkCell column={column} learnerName={learner.name} value={value} schemeLevels={data!.scheme?.levels} editable={editable} onChange={next => edit(learner.id, column, next)} onRubric={() => column.rubric && setRubricCell({ learnerId: learner.id, learnerName: learner.name, activityId: column.id, title: column.title, rubric: column.rubric })}/>
                      : editable
                        ? <input type="text" inputMode="decimal" className="grade-input" value={value} data-cell={`${row}:${index}`} aria-label={`${column.title} de ${learner.name}`} aria-invalid={parsed === undefined}
                          onChange={event => edit(learner.id, column, event.target.value)} onKeyDown={event => onKey(event, row, index)} onPaste={event => onPaste(event, row, index)} onFocus={event => event.currentTarget.select()}/>
                        : <span>{value === "" ? <span className="muted">—</span> : number(Number(value))}</span>}
                    {!planned && letters && typeof parsed === "number" && <span className="grade-letter" aria-label={`letra ${letterOf(parsed, policy.letterThresholds)}`}>{letterOf(parsed, policy.letterThresholds)}</span>}
                    {editable && column.kind !== "panel" && column.kind !== "grade" && column.kind !== "group" && <Menu label={`Acciones de ${column.title} de ${learner.name}`} items={[exempt ? { label: "Quitar exoneración", onSelect: () => setExempt(learner.id, column.id, false) } : { label: "Exonerar", onSelect: () => setExempt(learner.id, column.id, true) }]}/>}
                  </td>;
                })}
                {planned && custom && <td className="grade-total">{(() => { const shown = schemed(learner.id); return shown?.score == null ? <span className="muted">—</span> : <><strong>{number(shown.score)}</strong>{!shown.complete && <span className="muted small"> (parcial)</span>}</>; })()}</td>}
                {planned && !custom && <td className="grade-total">{item.score === null ? <span className="muted">—</span> : <><strong>{number(item.score)}{letters ? ` (${letterOf(item.score, policy.letterThresholds)})` : ""}</strong>{!item.complete && <span className="muted small"> de {number(item.graded)}</span>}</>}</td>}
                <td>{schemeResult(data!, period, plan, learner.id, columns, valueOf, isExempt) || <ResultBadge result={resultOf(item)}/>}</td>
                <td><button type="button" className={`icon-button${comment ? " has-comment" : ""}`} aria-label={`Detalle de ${learner.name}${comment ? " (tiene comentario)" : ""}`} onClick={() => setStudent(learner.id)}><Icon name={comment ? "text" : "more"} size={18}/></button></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {editable && <p className="muted small">Flechas e Intro para moverte entre celdas. Puedes pegar varias celdas copiadas de una hoja de cálculo.</p>}
        {editable && <div className="button-row grade-save">
          <PrimaryAction type="submit" icon="check" busy={busy === "save"} disabled={!dirty || invalid || !!busy}>{busy === "save" ? "Guardando…" : dirty ? `Guardar ${plural(changed, "cambio", "cambios")}` : "Guardar notas"}</PrimaryAction>
          {dirty && <button type="button" className="button ghost" onClick={() => { setEdits({}); setFormError(""); }}>Descartar cambios</button>}
          {invalid && <span className="muted small" role="status">{planned ? "Cada punteo va de 0 a los puntos de su actividad, con un decimal como máximo." : "Las notas van de 0 a 100, con un decimal como máximo."}</span>}
        </div>}
      </form>
    </div>;
  }
}

type Stats = ReturnType<typeof gradeStatistics>;
/** The period's figures: average, who passes, the distribution in bands of ten points and who is at risk. */
function PeriodStats({ stats, names, passing }: { stats: Stats; names: Map<string, string>; passing: number }) {
  const widest = Math.max(1, ...stats.bands.map(band => band.count));
  return <div className="grade-stats">
    <StatTiles items={[
      { label: "Promedio", value: stats.average === null ? "—" : number(stats.average), icon: "grid", hue: "violet" },
      { label: "Aprueban", value: stats.passed, icon: "check", hue: "green" },
      { label: "No aprueban", value: stats.failed, icon: "alert", hue: "coral" },
      { label: "Sin nota", value: stats.missing, icon: "clock", hue: "amber" },
    ]}/>
    {stats.count > 0 && <div className="grade-distribution" aria-label="Distribución de notas">
      {stats.bands.map(band => <div key={band.from} className="grade-band">
        <span className="muted small">{band.from === 0 ? `< ${band.until + 0.1}` : `${band.from}–${Math.floor(band.until)}`}</span>
        <span className="grade-band-bar"><span className={band.from < passing ? "below" : ""} style={{ width: `${(band.count / widest) * 100}%` }}/></span>
        <span className="small">{band.count}</span>
      </div>)}
    </div>}
    {stats.atRisk.length > 0 && <details className="grade-risk">
      <summary>{plural(stats.atRisk.length, "estudiante en riesgo", "estudiantes en riesgo")} (debajo de {passing} o a menos de 5 puntos)</summary>
      <ul>{stats.atRisk.map(item => <li key={item.learnerId}>{names.get(item.learnerId)}: <strong>{number(item.score)}</strong>{item.failing ? " · no aprueba" : " · cerca del mínimo"}</li>)}</ul>
    </details>}
  </div>;
}

/** The year at a glance: each period's score, the average and the result, read-only. */
function YearSummary({ book, onStudent }: { book: Gradebook; onStudent: (id: string) => void }) {
  const { policy, periods, learners } = book;
  const results = new Map(book.results.map(result => [result.learnerId, result]));
  const stats = gradeStatistics(book.results.map(result => ({ learnerId: result.learnerId, score: result.average })), policy.passingGrade);
  return <div className="stack">
    <PeriodStats stats={stats} names={new Map(learners.map(learner => [learner.id, learner.name]))} passing={policy.passingGrade}/>
    <div className="coverage-scroll" role="region" aria-label={`Resumen del ciclo de ${book.section.name}`} tabIndex={0}>
      <table className="coverage-table grades-table">
        <thead><tr>
          <th scope="col">Estudiante</th>
          {periods.map(period => <th scope="col" key={period.id}>{period.name}{policy.average === "weighted" && <span className="muted"> · peso {period.weight}</span>}</th>)}
          <th scope="col">Promedio</th><th scope="col">Resultado</th><th scope="col"><span className="sr-only">Detalle</span></th>
        </tr></thead>
        <tbody>{learners.map(learner => {
          const result = results.get(learner.id);
          return <tr key={learner.id}>
            <th scope="row">{learner.name}</th>
            {periods.map(period => { const score = book.grades.find(grade => grade.learnerId === learner.id && grade.periodId === period.id)?.score; return <td key={period.id}>{score === undefined ? <span className="muted">—</span> : <>{number(score)}{policy.scale === "letters_af" && <span className="grade-letter">{letterOf(score, policy.letterThresholds)}</span>}</>}</td>; })}
            <td>{result?.display ? <strong>{result.display}</strong> : !result || result.average === null ? <span className="muted">—</span> : <strong>{number(result.average)}{result.letter ? ` (${result.letter})` : ""}</strong>}</td>
            <td>{result?.reasons?.length ? <ul className="grade-reasons">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <ResultBadge result={result}/>}</td>
            <td><button type="button" className="icon-button" aria-label={`Detalle de ${learner.name}`} onClick={() => onStudent(learner.id)}><Icon name="more" size={18}/></button></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}

function panelProgress(book: Gradebook, learnerId: string, activityId: string) {
  const assigned = (book.evaluators || []).filter(item => item.activityId === activityId);
  const marks = (book.marks || []).filter(item => item.activityId === activityId && item.learnerId === learnerId && item.evaluatorId);
  const done = assigned.length > 0 && assigned.every(item => marks.some(mark => mark.evaluatorId === item.userId));
  return `${marks.length} de ${assigned.length}${done ? " · completo" : ""}`;
}

function GroupResult({ book, column, learnerId }: { book: Gradebook; column: Column; learnerId: string }) {
  const activity = book.activities.find(item => item.id === column.id);
  if (!activity) return <span className="muted">—</span>;
  const text = resultText(book, activity, learnerId, book.scheme?.levels);
  const origin = originLabel(book, activity, learnerId);
  return <span>{text || <span className="muted">—</span>}{origin && <span className="grade-origin">{origin}</span>}</span>;
}

function GroupMarkCell({ column, groupName, mark, levels, editable, onSave, onRubric, onPeers }: {
  column: Column; groupName: string; mark?: AtomicMark; levels?: { id: string; label: string }[]; editable: boolean; onSave: (mark: AtomicMark) => void; onRubric: () => void; onPeers: () => void;
}) {
  const [draft, setDraft] = useState(mark?.kind === "points" ? String(mark.value) : "");
  useEffect(() => { setDraft(mark?.kind === "points" ? String(mark.value) : ""); }, [mark]);
  const label = `Nota de ${groupName} en ${column.title}`;
  const peers = <Button type="button" variant="ghost" className="small" onClick={onPeers}>Coevaluación</Button>;
  if (!editable) return <span>{mark ? markText(mark, column, levels) : <span className="muted">—</span>}{peers}</span>;
  if (column.grading === "rubric" && column.rubric) {
    const total = mark?.kind === "rubric" ? rubricTotal(column.rubric, mark.choices) : null;
    return <span className="grade-group-mark"><button type="button" className="button secondary small" aria-label={`Rúbrica de ${column.title} de ${groupName}`} onClick={onRubric}>{total === null ? "Calificar" : total}</button>{peers}</span>;
  }
  if (column.grading === "pass-fail") return <span className="grade-group-mark"><label className="lock"><input type="checkbox" aria-label={label} checked={mark?.kind === "pass" && mark.value} onChange={event => onSave({ kind: "pass", value: event.target.checked })}/><span>{mark?.kind === "pass" && mark.value ? "Aprobado" : "No aprobado"}</span></label>{peers}</span>;
  if (column.grading === "level") return <span className="grade-group-mark"><select aria-label={label} value={mark?.kind === "level" ? mark.value : ""} onChange={event => event.target.value && onSave({ kind: "level", value: event.target.value })}><option value="">Elegir nivel…</option>{(levels || []).map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select>{peers}</span>;
  return <span className="grade-group-mark"><input type="text" inputMode="decimal" className="grade-input" aria-label={label} value={draft} onChange={event => setDraft(event.target.value)} onBlur={event => { const value = pointsInput(event.target.value, column.max); if (typeof value === "number" && value !== (mark?.kind === "points" ? mark.value : undefined)) onSave({ kind: "points", value }); }}/>{peers}</span>;
}

function PeerDialog({ book, activityId, workGroupId, onClose, onSaved }: { book: Gradebook; activityId: string; workGroupId: string; onClose: () => void; onSaved: (book: Gradebook) => void }) {
  const activity = book.activities.find(item => item.id === activityId)!;
  const group = book.workGroups?.find(item => item.id === workGroupId);
  const members = group?.learnerIds || [];
  const names = new Map(book.learners.map(learner => [learner.id, learner.name]));
  const [ratings, setRatings] = useState(() => (book.peerRatings || []).filter(item => item.activityId === activityId));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const mine = ratings.filter(item => members.includes(item.raterId) && members.includes(item.rateeId));
  const factors = liveFactors(activity, members, mine, book.groupMarks?.find(item => item.activityId === activityId && item.workGroupId === workGroupId)?.mark || null);
  const scoreOf = (raterId: string, rateeId: string) => mine.find(item => item.raterId === raterId && item.rateeId === rateeId)?.score;
  function setScore(raterId: string, rateeId: string, raw: string) {
    const score = pointsInput(raw, 5);
    setRatings(current => {
      const rest = current.filter(item => !(item.raterId === raterId && item.rateeId === rateeId && item.activityId === activityId));
      return typeof score === "number" ? [...rest, { activityId, raterId, rateeId, score }] : rest;
    });
  }
  const received = (id: string) => mine.filter(item => item.rateeId === id).reduce((sum, item) => sum + item.score, 0);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSaved((await api<{ gradebook: Gradebook }>(`/sections/${book.section.id}/grades/activities/${activityId}/peer-ratings`, "PUT", { ratings: ratings.map(({ raterId, rateeId, score }) => ({ raterId, rateeId, score })) })).gradebook); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal wide title={`Coevaluación · ${group?.name || "Grupo"}`} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <p className="muted small">{activity.title}. Cada integrante califica a los demás de 0 a 5. El factor es el promedio recibido dividido por el del grupo, entre {factorText(activity.peerMin ?? 0.5)} y {factorText(activity.peerMax ?? 1.5)}.</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <div className="coverage-scroll" tabIndex={0}><table className="peer-matrix">
        <thead><tr><th scope="col">Quién califica</th>{members.map(id => <th scope="col" key={id}>{names.get(id)}</th>)}<th scope="col">Total recibido</th><th scope="col">Factor</th></tr></thead>
        <tbody>{members.map(raterId => <tr key={raterId}>
          <th scope="row">{names.get(raterId)}</th>
          {members.map(rateeId => <td key={rateeId}>{raterId === rateeId ? <span className="muted">—</span> : <input inputMode="decimal" aria-label={`Calificación de ${names.get(raterId)} a ${names.get(rateeId)}`} defaultValue={scoreOf(raterId, rateeId) ?? ""} onChange={event => setScore(raterId, rateeId, event.target.value)}/>}</td>)}
          <td>{received(raterId)}</td>
          <td>Factor de {names.get(raterId)} ×{factorText(factors.get(raterId) ?? 1)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy} disabled={busy}>Guardar coevaluación</PrimaryAction></div>
    </form>
  </Modal>;
}

function MarkCell({ column, learnerName, value, schemeLevels, editable, onChange, onRubric }: { column: Column; learnerName: string; value: string; schemeLevels?: { id: string; label: string }[]; editable: boolean; onChange: (value: string) => void; onRubric: () => void }) {
  const mark = value ? JSON.parse(value) as AtomicMark : null;
  if (!editable) return <span>{mark ? markText(mark, column, schemeLevels) : <span className="muted">—</span>}</span>;
  if (column.grading === "rubric" && column.rubric) {
    const total = mark?.kind === "rubric" ? rubricTotal(column.rubric, mark.choices) : null;
    return <button type="button" className="button secondary small" aria-label={`Rúbrica de ${column.title} de ${learnerName}`} onClick={onRubric}>{total === null ? "Calificar" : total}</button>;
  }
  if (column.grading === "pass-fail") return <label className="lock"><input type="checkbox" aria-label={`${column.title} de ${learnerName}`} checked={mark?.kind === "pass" && mark.value} onChange={event => onChange(JSON.stringify({ kind: "pass", value: event.target.checked }))}/><span>{mark?.kind === "pass" && mark.value ? "Aprobado" : "No aprobado"}</span></label>;
  return <select aria-label={`Nivel de ${column.title} de ${learnerName}`} value={mark?.kind === "level" ? mark.value : ""} onChange={event => onChange(event.target.value ? JSON.stringify({ kind: "level", value: event.target.value }) : "")}>
    <option value="">Elegir nivel…</option>
    {(schemeLevels || []).map(level => <option key={level.id} value={level.id}>{level.label}</option>)}
  </select>;
}

function markText(mark: AtomicMark, column: Column, levels?: { id: string; label: string }[]) {
  if (mark.kind === "pass") return mark.value ? "Aprobado" : "No aprobado";
  if (mark.kind === "level") return levels?.find(level => level.id === mark.value)?.label || mark.value;
  if (mark.kind === "rubric" && column.rubric) return String(rubricTotal(column.rubric, mark.choices));
  return "—";
}

function rubricTotal(rubric: Rubric, choices: Record<string, string>) {
  const weight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
  return Math.round(rubric.criteria.reduce((sum, criterion) => {
    const level = criterion.levels.find(item => item.id === choices[criterion.id]);
    return sum + (level ? level.points * criterion.weight : 0);
  }, 0) / weight);
}

/** The period's result under the course's scheme, computed with the same engine as the server. */
function schemePeriod(book: Gradebook, period: GradebookPeriod, plan: Gradebook["activities"], learnerId: string, columns: Column[], valueOf: (learnerId: string, column: Column) => string, isExempt: (learnerId: string, activityId: string) => boolean) {
  const scheme = book.scheme;
  if (!scheme || scheme.id === "points") return null;
  const marks = new Map<string, Mark>();
  for (const column of columns) {
    if (isExempt(learnerId, column.id)) { marks.set(column.id, { kind: "exempt" }); continue; }
    if (column.kind === "score" || column.kind === "group") { const value = pointsInput(valueOf(learnerId, column), column.max); if (typeof value === "number") marks.set(column.id, { kind: "points", value }); }
    if (column.kind === "mark" && valueOf(learnerId, column)) marks.set(column.id, JSON.parse(valueOf(learnerId, column)) as AtomicMark);
  }
  try {
    const result = learnerResult(scheme, plan.map(item => ({ id: item.id, periodId: item.periodId, categoryId: item.categoryId || scheme.categories[0]?.id || "general", title: item.title, points: item.points, grading: item.grading || "points", extra: item.extra, ...(item.retakeOf ? { retakeOf: item.retakeOf } : {}), ...(item.rubric ? { rubric: item.rubric } : {}), ...(item.panel ? { panel: item.panel } : {}) })), marks, [{ id: period.id, position: period.position, weight: period.weight }]);
    return result.periods[0] || null;
  } catch { return null; }
}
/** The scheme's result for the period, as the grid shows it (null with the accumulated points of 1.2.3). */
function schemeResult(...args: Parameters<typeof schemePeriod>) {
  const shown = schemePeriod(...args), scheme = args[0].scheme;
  if (!shown || !scheme) return null;
  return <><strong>{shown.display || displayOf(scheme, shown.score) || "—"}</strong>{shown.reasons.map(reason => <p key={reason} className="grade-reasons">{reason}</p>)}</>;
}

function RubricDialog({ cell, current, onClose, onSave }: { cell: { learnerName: string; title: string; rubric: Rubric }; current?: string; onClose: () => void; onSave: (choices: Record<string, string>) => void }) {
  const initial = current ? (JSON.parse(current) as AtomicMark) : null;
  const [choices, setChoices] = useState<Record<string, string>>(initial?.kind === "rubric" ? initial.choices : {});
  const ready = cell.rubric.criteria.every(criterion => criterion.levels.some(level => level.id === choices[criterion.id]));
  return <Modal title={`Rúbrica · ${cell.title}`} onClose={onClose}>
    <form className="stack" onSubmit={event => { event.preventDefault(); if (ready) onSave(choices); }}>
      <p className="muted small">{cell.learnerName}. Elige un nivel por criterio.</p>
      {cell.rubric.criteria.map(criterion => <label key={criterion.id} className="field"><span>{criterion.label}</span>
        <select aria-label={criterion.label} value={choices[criterion.id] || ""} onChange={event => setChoices(currentChoices => ({ ...currentChoices, [criterion.id]: event.target.value }))}>
          <option value="">Elegir nivel…</option>
          {criterion.levels.map(level => <option key={level.id} value={level.id}>{level.label} · {level.points}</option>)}
        </select>
      </label>)}
      <p role="status">Total: {ready ? rubricTotal(cell.rubric, choices) : "—"}</p>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" disabled={!ready}>Guardar rúbrica</PrimaryAction></div>
    </form>
  </Modal>;
}

/** Returns a handed-in period with a note that says what to review. */
function ReturnDialog({ sectionId, period, onSaved, onClose }: { sectionId: string; period: GradebookPeriod; onSaved: (book: Gradebook) => void; onClose: () => void }) {
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function send(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { onSaved((await api<{ gradebook: Gradebook }>(`/sections/${sectionId}/grades/periods/${period.id}/return`, "POST", { note: note.trim() })).gradebook); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title={`Devolver «${period.name}»`} onClose={onClose}>
    <form className="stack" onSubmit={send} aria-label={`Devolver ${period.name}`}>
      <p className="muted small">La sección podrá corregir sus notas y entregarlas de nuevo. Tu nota queda a la vista de quienes la imparten.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <textarea rows={4} maxLength={600} value={note} aria-label="Qué revisar" placeholder="Por ejemplo: faltan los punteos del examen de dos estudiantes." onChange={event => setNote(event.target.value)}/>
      <div className="button-row">
        <PrimaryAction type="submit" icon="undo" busy={busy} disabled={busy || !note.trim()}>Devolver a la sección</PrimaryAction>
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  </Modal>;
}
