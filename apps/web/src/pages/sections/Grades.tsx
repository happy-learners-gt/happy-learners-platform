import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Gradebook, GradeResult } from "@happy-learners/contracts";
import { letterOf, scoreInput, settingText, thresholdsText } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useUnsavedChanges } from "../../navigation";
import { plural, sessionDay } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { EmptyState, ErrorState, Loading, PageHeader, Section, StatusBadge } from "../../ui/primitives";
import { currentRegional } from "../../regional";
import { useCourse } from "../course/context";
import { sectionCrumbs, useSection } from "./context";

const key = (learnerId: string, periodId: string) => `${learnerId}:${periodId}`;
const number = (value: number) => new Intl.NumberFormat(currentRegional().locale, { maximumFractionDigits: 1 }).format(value);

function ResultBadge({ result }: { result?: GradeResult }) {
  if (!result || result.passed === null) return <span className="muted">Sin notas</span>;
  return <StatusBadge tone={result.passed ? "success" : "danger"}>{result.passed ? "Aprueba" : "No aprueba"}{result.complete ? "" : " (parcial)"}</StatusBadge>;
}

/**
 * /secciones/:id/notas — the section's gradebook (libreta): one optional score per student and period of the school
 * year, the average the course's settings ask for and whether it passes. Administration and the section's educators
 * write scores and lock a period; only administration reopens it. A missing score is not a zero.
 */
export function SectionGradesPage() {
  const { section } = useSection();
  const { course } = useCourse();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState<Gradebook | null>(null), [error, setError] = useState(""), [year, setYear] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [formError, setFormError] = useState("");
  const dirty = Object.keys(edits).length > 0;
  useUnsavedChanges(dirty);
  const load = useCallback(() => api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades${year ? `?year=${year}` : ""}`)
    .then(result => { setData(result.gradebook); setError(""); setEdits({}); }, cause => setError(message(cause))), [section.id, year]);
  useEffect(() => { void load(); }, [load]);
  const crumbs = sectionCrumbs(section, { label: "Notas" });
  const header = <PageHeader crumbs={crumbs} title="Notas" description="Una nota opcional por estudiante y periodo del ciclo lectivo. Un periodo sin nota no cuenta como cero."/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Cargando notas…" lines={6}/></>;
  if (!data.year) return <>{header}<EmptyState icon="calendar" title="Aún no hay un ciclo lectivo vigente">Administración define el ciclo y sus periodos en <Link href="/organizacion">Organización</Link>. Cuando lo active, aquí podrás registrar las notas.</EmptyState></>;

  const { policy, periods, learners } = data;
  const letters = policy.scale === "letters_af";
  const stored = new Map(data.grades.map(grade => [key(grade.learnerId, grade.periodId), grade.score]));
  const results = new Map(data.results.map(result => [result.learnerId, result]));
  const valueOf = (learnerId: string, periodId: string) => edits[key(learnerId, periodId)] ?? (stored.has(key(learnerId, periodId)) ? String(stored.get(key(learnerId, periodId))) : "");
  const invalid = Object.values(edits).some(value => scoreInput(value) === undefined);
  function edit(learnerId: string, periodId: string, value: string) {
    const id = key(learnerId, periodId), original = stored.has(id) ? String(stored.get(id)) : "";
    setEdits(current => { const next = { ...current }; if (value.trim() === original) delete next[id]; else next[id] = value; return next; });
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setFormError("");
    try {
      const grades = Object.entries(edits).map(([id, value]) => { const [learnerId, periodId] = id.split(":"); return { learnerId, periodId, score: scoreInput(value) ?? null }; });
      const result = await api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades`, "PUT", { grades });
      setData(result.gradebook); setEdits({});
      toast({ message: `Notas guardadas: ${plural(grades.length, "cambio", "cambios")}.` });
    } catch (cause) { setFormError(message(cause)); }
    finally { setBusy(false); }
  }
  async function lock(period: Gradebook["periods"][number], close: boolean) {
    if (dirty) { toast({ tone: "error", message: "Guarda o descarta tus cambios antes de cerrar o reabrir un periodo." }); return; }
    if (!await confirm(close
      ? { title: `¿Cerrar las notas de «${period.name}»?`, body: <p>Nadie podrá cambiar las notas de este periodo en «{section.name}». Solo administración puede reabrirlas.</p>, confirm: "Cerrar notas" }
      : { title: `¿Reabrir las notas de «${period.name}»?`, body: <p>Quienes imparten la sección podrán cambiarlas de nuevo.</p>, confirm: "Reabrir notas" })) return;
    try {
      const result = await api<{ gradebook: Gradebook }>(`/sections/${section.id}/grades/periods/${period.id}/lock`, close ? "POST" : "DELETE");
      setData(result.gradebook);
      toast({ message: close ? `Las notas de «${period.name}» quedaron cerradas.` : `Las notas de «${period.name}» se reabrieron.` });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const passing = data.results.filter(result => result.passed).length, failing = data.results.filter(result => result.passed === false).length;
  return <>
    {header}
    <Section title={`${data.year.name}${data.year.status === "closed" ? " (cerrado)" : ""}`} action={data.years.length > 1 && <label><span className="sr-only">Ciclo lectivo</span>
      <select value={data.year.id} onChange={event => { if (!dirty) setYear(event.target.value); }} disabled={dirty}>{data.years.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "closed" ? " (cerrado)" : ""}</option>)}</select></label>}>
      <p className="muted small grade-policy">
        {settingText("gradeScale", policy.scale)} · Aprueba con {policy.passingGrade} · {settingText("gradeAverage", policy.average)}{letters ? ` · ${thresholdsText(policy.letterThresholds)}` : ""}.{" "}
        {course.status === "active" && <Link href={`/cursos/${course.id}/configuracion`}>Configuración del curso</Link>}
      </p>
      {data.year.status === "closed" && <p className="notice"><Icon name="info" size={18}/>El ciclo está cerrado: sus notas se consultan, pero ya no cambian.</p>}
      {!periods.length ? <p className="muted">El ciclo no tiene periodos.</p>
        : !learners.length ? <EmptyState compact icon="users" title="La sección aún no tiene estudiantes" action={<Link className="button secondary small" href={`/secciones/${section.id}/estudiantes`}>Ver estudiantes</Link>}>Agrega estudiantes a la lista de la sección para registrar sus notas.</EmptyState>
        : <form onSubmit={save} className="stack">
          {formError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{formError}</p>}
          <div className="coverage-scroll" role="region" aria-label={`Notas de ${section.name}`} tabIndex={0}>
            <table className="coverage-table grades-table">
              <thead><tr>
                <th scope="col">Estudiante</th>
                {periods.map(period => <th scope="col" key={period.id}>
                  <div className="grade-head">
                    <span>{period.name}{policy.average === "weighted" && <span className="muted"> · peso {period.weight}</span>}</span>
                    {period.lockedAt && <span className="grade-lock" title={`Cerró ${period.lockedBy || "administración"} el ${sessionDay(period.lockedAt.slice(0, 10), "short")}`}><Icon name="shield" size={14}/>Cerrado</span>}
                    {((data.canLock && !period.locked) || (data.canUnlock && period.lockedAt)) && <Menu label={`Acciones de ${period.name}`} items={period.locked
                      ? [{ label: "Reabrir notas", icon: "undo", onSelect: () => void lock(period, false) }]
                      : [{ label: "Cerrar notas", icon: "shield", onSelect: () => void lock(period, true) }]}/>}
                  </div>
                </th>)}
                <th scope="col">Promedio</th>
                <th scope="col">Resultado</th>
              </tr></thead>
              <tbody>{learners.map(learner => {
                const result = results.get(learner.id);
                return <tr key={learner.id}>
                  <th scope="row">{learner.name}</th>
                  {periods.map(period => {
                    const value = valueOf(learner.id, period.id), parsed = scoreInput(value), editable = data.canEdit && !period.locked;
                    return <td key={period.id} className="grade-cell">
                      {editable
                        ? <input type="text" inputMode="decimal" className="grade-input" value={value} aria-label={`Nota de ${learner.name} en ${period.name}`} aria-invalid={parsed === undefined} onChange={event => edit(learner.id, period.id, event.target.value)}/>
                        : <span>{value === "" ? <span className="muted">—</span> : number(Number(value))}</span>}
                      {letters && typeof parsed === "number" && <span className="grade-letter" aria-label={`letra ${letterOf(parsed, policy.letterThresholds)}`}>{letterOf(parsed, policy.letterThresholds)}</span>}
                    </td>;
                  })}
                  <td>{result?.average === null || !result ? <span className="muted">—</span> : <strong>{number(result.average)}{result.letter ? ` (${result.letter})` : ""}</strong>}</td>
                  <td><ResultBadge result={result}/></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <p className="muted small">{plural(passing, "estudiante aprueba", "estudiantes aprueban")} y {plural(failing, "no aprueba", "no aprueban")} con las notas registradas.</p>
          {data.canEdit && <div className="button-row">
            <button className="button primary" disabled={!dirty || invalid || busy}>{busy ? "Guardando…" : "Guardar notas"}</button>
            {dirty && <button type="button" className="button ghost" onClick={() => { setEdits({}); setFormError(""); }}>Descartar cambios</button>}
            {invalid && <span className="muted small" role="status">Las notas van de 0 a 100, con un decimal como máximo.</span>}
          </div>}
        </form>}
    </Section>
  </>;
}
