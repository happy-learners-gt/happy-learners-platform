import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AssessmentKind, GradingScheme, OrganizationGradingScheme, Rubric } from "@happy-learners/contracts";
import { activitySummary, assessmentKinds, assessmentPeriodStatus, assessmentTemplates, schemeExplanation } from "@happy-learners/domain";
import { api, message } from "../../api";
import { plural, sessionDay } from "../../model";
import { useSession } from "../../session";
import { Link } from "../../navigation";
import { Drawer, Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section } from "../../ui/primitives";
import { Tabs } from "../../ui/Tabs";
import { useCourse } from "./context";

type Person = { userId: string; name: string; chair: boolean };
type Activity = {
  id: string; periodId: string; title: string; kind: AssessmentKind; points: number; dueOn: string | null;
  categoryId: string; grading: "points" | "rubric" | "pass-fail" | "level" | "panel"; extra: boolean; retakeOf: string | null;
  rubric?: Rubric; panel?: { combine: "average" | "median" | "majority" | "chair"; chair?: string };
  groupMode: "individual" | "group"; peerMin: number; peerMax: number; graded: boolean; maxScore: number | null; evaluators: Person[];
};
type Period = {
  id: string; name: string; position: number; weight: number;
  status: { state: "complete" | "missing" | "weights"; label: string; points: number; maximum: number | null };
  activities: Activity[];
};
type Payload = {
  scheme: GradingScheme; explanation: string[]; canEdit: boolean;
  year: { id: string; name: string; status: string } | null;
  years: { id: string; name: string; status: string }[];
  team: { id: string; name: string }[];
  periods: Period[];
};
type Draft = {
  title: string; kind: AssessmentKind; categoryId: string; points: string; dueOn: string;
  grading: Activity["grading"]; rubric: Rubric; combine: "average" | "median" | "majority" | "chair";
  evaluators: { userId: string; chair: boolean }[]; groupMode: "individual" | "group";
  peer: boolean; peerMin: string; peerMax: string; extra: boolean; retakeOf: string;
};

const gradingChoices = [
  ["points", "Puntos"], ["rubric", "Rúbrica"], ["pass-fail", "Aprobado o no"], ["level", "Nivel"], ["panel", "Tribunal"],
] as const;
const combines = [["average", "Promedio"], ["median", "Mediana"], ["majority", "Mayoría"], ["chair", "Presidencia"]] as const;
const blankRubric = (): Rubric => ({ criteria: [{ id: "criterio-1", label: "Criterio 1", weight: 100, levels: [{ id: "alto", label: "Alto", points: 4 }, { id: "bajo", label: "Bajo", points: 1 }] }] });
const slug = (value: string, fallback: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;

/** Course › Evaluación: how every section of this course is assessed. Sections organize groups and record grades. */
export function Assessment() {
  const { course } = useCourse();
  const { member } = useSession();
  const { toast, confirm } = useFeedback();
  const [data, setData] = useState<Payload | null>(null), [error, setError] = useState(""), [year, setYear] = useState("");
  const [periodId, setPeriodId] = useState(""), [editing, setEditing] = useState<Activity | "new" | null>(null), [categoryId, setCategoryId] = useState("");
  const [schemeOpen, setSchemeOpen] = useState(false), [templateOpen, setTemplateOpen] = useState(false), [copyOpen, setCopyOpen] = useState(false);
  const base = `/cursos/${course.id}`;
  async function load(nextYear = year) {
    setError("");
    try {
      const payload = await api<Payload>(`/courses/${course.id}/assessment${nextYear ? `?year=${nextYear}` : ""}`);
      setData(payload);
      setPeriodId(current => payload.periods.some(period => period.id === current) ? current : payload.periods[0]?.id || "");
      if (!year && payload.year) setYear(payload.year.id);
    } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [course.id]);
  const header = <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Evaluación" }]} title="Evaluación" description="Cómo se evalúa este curso en todas sus secciones."
    primary={data?.canEdit && data.periods.length ? <PrimaryAction icon="plus" onClick={() => { setCategoryId(data.scheme.categories[0]?.id || ""); setEditing("new"); }}>Agregar actividad</PrimaryAction> : undefined}/>;
  if (error) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!data) return <>{header}<Loading label="Abriendo la evaluación…" lines={6}/></>;
  const period = data.periods.find(item => item.id === periodId) || data.periods[0];
  const statusOf = (item: Period) => assessmentPeriodStatus(data.scheme, item.activities);
  const tab = (item: Period) => { const status = statusOf(item); return `${item.name}${status.state === "complete" ? " ✓" : status.tab ? ` · ${status.tab}` : ""}`; };
  async function remove(activity: Activity) {
    if (!await confirm({ title: `¿Quitar «${activity.title}»?`, body: <p>Deja de formar parte de la evaluación. Las notas que ya tiene no se pueden borrar desde aquí.</p>, confirm: "Quitar actividad", danger: true })) return;
    try { await api(`/courses/${course.id}/assessment/activities/${activity.id}`, "DELETE"); await load(); toast({ message: `«${activity.title}» se quitó.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <>
    {header}
    <Section title="Cómo se calcula la nota" action={data.canEdit ? <Button variant="secondary" onClick={() => setSchemeOpen(true)}>Cambiar esquema</Button> : undefined}>
      <h3 className="assessment-scheme">{data.scheme.name}</h3>
      <div className="assessment-explanation">{data.explanation.map(line => <p key={line}>{line}</p>)}</div>
    </Section>
    {!data.periods.length ? <EmptyState icon="table" title="El ciclo no tiene periodos">Cuando el ciclo lectivo tenga periodos, aquí se diseñan sus actividades.</EmptyState> : period && <>
      <div className="assessment-period">
        <Tabs label="Periodos" value={period.id} onChange={setPeriodId} items={data.periods.map(item => ({ value: item.id, label: tab(item) }))}
          aside={data.canEdit ? <Menu label={`Acciones de ${period.name}`} text="Acciones" items={[
            { label: "Usar plantilla", icon: "spark", onSelect: () => setTemplateOpen(true) },
            { label: "Copiar de otro periodo", icon: "copy", onSelect: () => setCopyOpen(true) },
          ]}/> : undefined}>{null}</Tabs>
      </div>
      <p className="assessment-status" role="status">{statusOf(period).line}</p>
      <div className="assessment-categories">{data.scheme.categories.map(category => {
        const rows = period.activities.filter(item => item.categoryId === category.id);
        return <article key={category.id} className="assessment-category" aria-labelledby={`category-${category.id}`}>
          <header>
            <div><h3 id={`category-${category.id}`}>{category.label}{category.weight !== undefined ? ` · ${category.weight} %` : ""}</h3><p className="muted small">{plural(rows.length, "actividad", "actividades")}</p></div>
            {data.canEdit && <Button icon="plus" className="small" onClick={() => { setCategoryId(category.id); setEditing("new"); }}>Agregar</Button>}
          </header>
          {rows.length ? <ul className="assessment-activities">{rows.map(activity => <li key={activity.id}>
            <Icon name={activity.groupMode === "group" ? "team" : "list"} size={18}/>
            <span className="assessment-activity-title">{activity.title}{activity.graded && <span className="assessment-lock" title="Tiene notas">🔒<span className="sr-only"> Tiene notas</span></span>}</span>
            <span className="muted">{activity.points} pts</span>
            <span className="muted">{activity.dueOn ? sessionDay(activity.dueOn, "short") : "Sin fecha"}</span>
            <span>{howGraded(activity)}</span>
            {data.canEdit && <Menu label={`Acciones de ${activity.title}`} items={[
              { label: "Editar", icon: "edit", onSelect: () => { setCategoryId(activity.categoryId); setEditing(activity); } },
              ...(activity.graded ? [{ label: gradedNote(activity.title), disabled: true, onSelect: () => undefined } as const] : []),
              "separator" as const,
              { label: "Quitar", icon: "archive", danger: true, disabled: activity.graded, onSelect: () => void remove(activity) },
            ]}/>}
          </li>)}</ul> : <p className="muted small">Sin actividades.</p>}
        </article>;
      })}</div>
    </>}
    {data.years.length > 1 && <label className="assessment-year">Ciclo<select value={data.year?.id || ""} onChange={event => { setYear(event.target.value); void load(event.target.value); }}>{data.years.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {editing && period && <ActivityPanel courseId={course.id} period={period} categoryId={editing === "new" ? categoryId : editing.categoryId} activity={editing === "new" ? null : editing} scheme={data.scheme} team={data.team} onClose={() => setEditing(null)} onSaved={async title => { setEditing(null); await load(); toast({ message: editing === "new" ? `«${title}» quedó agregada.` : `«${title}» se actualizó.` }); }}/>}
    {schemeOpen && <SchemeDialog courseId={course.id} current={data.scheme.id} admin={member.role === "admin"} onClose={() => setSchemeOpen(false)} onSaved={async () => { setSchemeOpen(false); await load(); toast({ message: "Esquema de evaluación actualizado." }); }}/>}
    {templateOpen && period && <TemplateDialog courseId={course.id} period={period} method={data.scheme.method} onClose={() => setTemplateOpen(false)} onSaved={async () => { setTemplateOpen(false); await load(); toast({ message: "Plantilla aplicada." }); }}/>}
    {copyOpen && period && <CopyDialog courseId={course.id} period={period} periods={data.periods} onClose={() => setCopyOpen(false)} onSaved={async () => { setCopyOpen(false); await load(); toast({ message: "Actividades copiadas." }); }}/>}
  </>;
}

function howGraded(activity: Activity) {
  const grouped = activity.groupMode === "group";
  if (activity.grading === "rubric") return grouped ? "Rúbrica · En grupos" : `Rúbrica (${plural(activity.rubric?.criteria.length || 0, "criterio", "criterios")})`;
  if (activity.grading === "panel") {
    const chair = activity.evaluators.find(person => person.chair);
    return `Tribunal (${activity.evaluators.length}${chair ? `, preside ${shortName(chair.name)}` : ""})`;
  }
  const label = activity.grading === "points" ? "Puntos" : activity.grading === "pass-fail" ? "Aprobado o no" : "Nivel";
  return grouped ? `${label} · En grupos` : label;
}
function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length < 2 ? name : `${parts[0].slice(0, 1)}. ${parts.slice(1).join(" ")}`;
}
const gradedNote = (title: string) => `«${title}» ya tiene notas: puedes cambiar su nombre y su fecha, no su forma de calificar ni sus puntos por debajo de una nota dada.`;

function ActivityPanel({ courseId, period, categoryId, activity, scheme, team, onClose, onSaved }: {
  courseId: string; period: Period; categoryId: string; activity: Activity | null; scheme: GradingScheme; team: { id: string; name: string }[];
  onClose: () => void; onSaved: (title: string) => Promise<void>;
}) {
  const category = scheme.categories.find(item => item.id === (activity?.categoryId || categoryId)) || scheme.categories[0];
  const [draft, setDraft] = useState<Draft>(() => activity ? {
    title: activity.title, kind: activity.kind, categoryId: activity.categoryId, points: String(activity.points), dueOn: activity.dueOn || "",
    grading: activity.grading, rubric: activity.rubric || blankRubric(), combine: activity.panel?.combine || "average", evaluators: activity.evaluators.map(person => ({ userId: person.userId, chair: person.chair })),
    groupMode: activity.groupMode, peer: activity.groupMode === "group", peerMin: String(activity.peerMin), peerMax: String(activity.peerMax),
    extra: activity.extra, retakeOf: activity.retakeOf || "",
  } : {
    title: "", kind: "project", categoryId: category?.id || "", points: String(category?.weight || 10), dueOn: "", grading: "points", rubric: blankRubric(), combine: "average", evaluators: [],
    groupMode: "individual", peer: false, peerMin: "0.5", peerMax: "1.5", extra: false, retakeOf: "",
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const locked = !!activity?.graded;
  const chosen = scheme.categories.find(item => item.id === draft.categoryId);
  const summary = activitySummary({ points: draft.points, category: chosen?.label || "la categoría", ...(chosen?.weight !== undefined ? { weight: chosen.weight } : {}), grading: draft.grading, criteria: draft.rubric.criteria.length, group: draft.groupMode === "group" });
  function set<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function withWeights(criteria: Rubric["criteria"]): Rubric["criteria"] {
    const base = Math.floor(100 / criteria.length);
    let extra = 100 - base * criteria.length;
    return criteria.map(criterion => { const weight = base + (extra > 0 ? 1 : 0); if (extra > 0) extra -= 1; return { ...criterion, weight }; });
  }
  function setLevel(criterionIndex: number, levelIndex: number, patch: Partial<Rubric["criteria"][number]["levels"][number]>) {
    set("rubric", { criteria: draft.rubric.criteria.map((criterion, index) => index === criterionIndex ? { ...criterion, levels: criterion.levels.map((level, itemIndex) => itemIndex === levelIndex ? { ...level, ...patch } : level) } : criterion) });
  }
  function addCriterion() {
    const levels = draft.rubric.criteria[0]?.levels.map(level => ({ id: level.id, label: level.label, points: level.points })) || blankRubric().criteria[0].levels;
    const next = draft.rubric.criteria.length + 1;
    set("rubric", { criteria: withWeights([...draft.rubric.criteria, { id: `criterio-${next}`, label: `Criterio ${next}`, weight: 1, levels }]) });
  }
  function removeCriterion(index: number) {
    if (draft.rubric.criteria.length < 2) return;
    set("rubric", { criteria: withWeights(draft.rubric.criteria.filter((_, itemIndex) => itemIndex !== index)) });
  }
  function addLevel() {
    const next = (draft.rubric.criteria[0]?.levels.length || 0) + 1;
    set("rubric", { criteria: draft.rubric.criteria.map(criterion => ({ ...criterion, levels: [...criterion.levels, { id: `nivel-${next}`, label: `Nivel ${next}`, points: 0 }] })) });
  }
  function removeLevel(index: number) {
    if ((draft.rubric.criteria[0]?.levels.length || 0) < 3) return;
    set("rubric", { criteria: draft.rubric.criteria.map(criterion => ({ ...criterion, levels: criterion.levels.filter((_, itemIndex) => itemIndex !== index) })) });
  }
  function renameLevel(index: number, label: string) {
    const id = slug(label, draft.rubric.criteria[0]?.levels[index]?.id || `nivel-${index + 1}`);
    set("rubric", { criteria: draft.rubric.criteria.map(criterion => ({ ...criterion, levels: criterion.levels.map((level, itemIndex) => itemIndex === index ? { ...level, label, id } : level) })) });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const rubric = draft.grading === "rubric" || (draft.grading === "panel" && draft.rubric.criteria.some(criterion => criterion.levels.some(level => level.description))) ? {
      criteria: draft.rubric.criteria.map(criterion => ({ ...criterion, levels: criterion.levels.map(level => ({ ...level, ...(level.description ? { description: level.description } : {}) })) })),
    } : undefined;
    try {
      await api(`/courses/${courseId}/assessment/activities${activity ? `/${activity.id}` : ""}`, activity ? "PUT" : "POST", {
        periodId: period.id, title: draft.title.trim(), kind: draft.kind, categoryId: draft.categoryId, points: Number(draft.points.replace(",", ".")), dueOn: draft.dueOn || null,
        grading: draft.grading, ...(rubric ? { rubric } : {}), ...(draft.grading === "panel" ? { panel: { combine: draft.combine }, evaluators: draft.evaluators } : {}),
        groupMode: draft.groupMode, ...(draft.groupMode === "group" && draft.peer ? { peerMin: Number(draft.peerMin.replace(",", ".")), peerMax: Number(draft.peerMax.replace(",", ".")) } : {}),
        extra: draft.extra, retakeOf: draft.retakeOf || null,
      });
      await onSaved(draft.title.trim());
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Drawer title={activity ? `Editar ${activity.title}` : `Nueva actividad en ${category?.label || "el periodo"}`} onClose={onClose}>
    <form className="assessment-panel" onSubmit={submit}>
      <div className="assessment-panel-body">
      {locked && <p className="notice" role="status"><Icon name="info" size={18}/>{gradedNote(activity!.title)}</p>}
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <section className="assessment-step" aria-labelledby="activity-step-what">
        <h3 id="activity-step-what">1 Qué es</h3>
        <div className="assessment-what">
          <Field label="Nombre"><input required aria-label="Nombre" value={draft.title} onChange={event => set("title", event.target.value)} data-autofocus/></Field>
          <div className="assessment-what-row">
            <Field label="Tipo"><select aria-label="Tipo" disabled={locked} value={draft.kind} onChange={event => set("kind", event.target.value as AssessmentKind)}>{assessmentKinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Categoría"><select aria-label="Categoría" disabled={locked} value={draft.categoryId} onChange={event => set("categoryId", event.target.value)}>{scheme.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          </div>
          <div className="assessment-what-row">
            <Field label="Puntos"><input inputMode="decimal" aria-label="Puntos" disabled={locked} value={draft.points} onChange={event => set("points", event.target.value)}/></Field>
            <Field label="Fecha" optional><input type="date" aria-label="Fecha" value={draft.dueOn} onChange={event => set("dueOn", event.target.value)}/></Field>
          </div>
        </div>
      </section>
      <section className="assessment-step" aria-labelledby="activity-step-how">
        <h3 id="activity-step-how">2 Cómo se califica</h3>
        <div className="assessment-choices" role="radiogroup" aria-label="Cómo se califica">{gradingChoices.map(([value, label]) => <label key={value} className={draft.grading === value ? "is-selected" : ""}><input type="radio" name="grading" value={value} checked={draft.grading === value} disabled={locked} onChange={() => set("grading", value)}/><span>{label}</span></label>)}</div>
        {draft.grading === "rubric" && <RubricMatrix rubric={draft.rubric} locked={locked} onLevel={setLevel} onCriterion={(index, label) => set("rubric", { criteria: draft.rubric.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, label, id: slug(label, item.id) } : item) })} onWeight={(index, weight) => set("rubric", { criteria: draft.rubric.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, weight } : item) })} onRenameLevel={renameLevel} onAddCriterion={addCriterion} onRemoveCriterion={removeCriterion} onAddLevel={addLevel} onRemoveLevel={removeLevel}/>}
        {draft.grading === "panel" && <div className="stack">
          <Field label="Cómo se combinan"><select aria-label="Cómo se combinan las marcas" disabled={locked} value={draft.combine} onChange={event => set("combine", event.target.value as Draft["combine"])}>{combines.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <ul className="stack">{team.map(person => {
            const chosenPerson = draft.evaluators.find(item => item.userId === person.id);
            return <li key={person.id} className="choice-row"><label className="chip"><input type="checkbox" disabled={locked} checked={!!chosenPerson} onChange={event => {
              const next = event.target.checked ? [...draft.evaluators, { userId: person.id, chair: draft.evaluators.length === 0 }] : draft.evaluators.filter(item => item.userId !== person.id);
              if (next.length && !next.some(item => item.chair)) next[0] = { ...next[0], chair: true };
              set("evaluators", next);
            }}/><span>{person.name}</span></label>{chosenPerson && <label className="lock"><input type="radio" name="chair" disabled={locked} checked={chosenPerson.chair} onChange={() => set("evaluators", draft.evaluators.map(item => ({ ...item, chair: item.userId === person.id })))}/><span>Presidencia</span></label>}</li>;
          })}</ul>
        </div>}
      </section>
      <section className="assessment-step" aria-labelledby="activity-step-who">
        <h3 id="activity-step-who">3 Quién la hace</h3>
        <div className="assessment-choices" role="radiogroup" aria-label="Quién la hace">
          <label className={draft.groupMode === "individual" ? "is-selected" : ""}><input type="radio" name="who" checked={draft.groupMode === "individual"} disabled={locked} onChange={() => set("groupMode", "individual")}/><span>Cada estudiante</span></label>
          <label className={draft.groupMode === "group" ? "is-selected" : ""}><input type="radio" name="who" checked={draft.groupMode === "group"} disabled={locked} onChange={() => set("groupMode", "group")}/><span>En grupos</span></label>
        </div>
        {draft.groupMode === "group" && <p className="muted small">Cada sección elige qué grupos la trabajan, en su página de Grupos.</p>}
        {draft.groupMode === "group" && <label className="lock"><input type="checkbox" disabled={locked} checked={draft.peer} onChange={event => set("peer", event.target.checked)}/><span>Coevaluación</span></label>}
        {draft.groupMode === "group" && draft.peer && <div className="field-grid">
          <Field label="Factor mínimo"><input inputMode="decimal" aria-label="Factor mínimo" disabled={locked} value={draft.peerMin} onChange={event => set("peerMin", event.target.value)}/></Field>
          <Field label="Factor máximo"><input inputMode="decimal" aria-label="Factor máximo" disabled={locked} value={draft.peerMax} onChange={event => set("peerMax", event.target.value)}/></Field>
        </div>}
      </section>
      <section className="assessment-step" aria-labelledby="activity-step-options">
        <h3 id="activity-step-options">4 Opciones</h3>
        <label className="lock"><input type="checkbox" disabled={locked} checked={draft.extra} onChange={event => set("extra", event.target.checked)}/><span>Puntos extra</span></label>
        <Field label="Reposición de"><select aria-label="Reposición de" disabled={locked} value={draft.retakeOf} onChange={event => set("retakeOf", event.target.value)}><option value="">ninguna</option>{period.activities.filter(item => item.id !== activity?.id).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
      </section>
      </div>
      <footer className="assessment-panel-footer">
        <p className="assessment-summary" role="status">{summary}</p>
        <div className="assessment-panel-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy} disabled={busy}>Guardar</PrimaryAction></div>
      </footer>
    </form>
  </Drawer>;
}

function RubricMatrix({ rubric, locked, onLevel, onCriterion, onWeight, onRenameLevel, onAddCriterion, onRemoveCriterion, onAddLevel, onRemoveLevel }: {
  rubric: Rubric; locked: boolean;
  onLevel: (criterion: number, level: number, patch: Partial<Rubric["criteria"][number]["levels"][number]>) => void;
  onCriterion: (index: number, label: string) => void; onWeight: (index: number, weight: number) => void;
  onRenameLevel: (index: number, label: string) => void;
  onAddCriterion: () => void; onRemoveCriterion: (index: number) => void; onAddLevel: () => void; onRemoveLevel: (index: number) => void;
}) {
  const levels = rubric.criteria[0]?.levels || [];
  return <div className="stack">
    <div className="assessment-matrix-scroll">
      <table className="assessment-matrix" aria-label="Rúbrica">
        <thead><tr>
          <th scope="col"><span className="sr-only">Criterio</span></th>
          {levels.map((level, levelIndex) => <th key={level.id} scope="col">
            <input aria-label={`Nivel ${level.label}`} disabled={locked} value={level.label} onChange={event => onRenameLevel(levelIndex, event.target.value)}/>
            <button type="button" className="icon-button" aria-label={`Quitar nivel ${level.label}`} disabled={locked || levels.length < 3} onClick={() => onRemoveLevel(levelIndex)}><Icon name="close" size={16}/></button>
          </th>)}
        </tr></thead>
        <tbody>{rubric.criteria.map((criterion, criterionIndex) => <tr key={criterion.id}>
          <th scope="row">
            <input aria-label={`Criterio ${criterionIndex + 1}`} disabled={locked} value={criterion.label} onChange={event => onCriterion(criterionIndex, event.target.value)}/>
            <label className="assessment-weight">Peso<input inputMode="decimal" aria-label={`Peso de ${criterion.label}`} disabled={locked} value={criterion.weight} onChange={event => onWeight(criterionIndex, Number(event.target.value))}/></label>
            <button type="button" className="icon-button" aria-label={`Quitar ${criterion.label}`} disabled={locked || rubric.criteria.length < 2} onClick={() => onRemoveCriterion(criterionIndex)}><Icon name="close" size={16}/></button>
          </th>
          {levels.map((column, levelIndex) => {
            const level = criterion.levels[levelIndex];
            if (!level) return <td key={column.id}/>;
            return <td key={level.id}><div className="assessment-cell">
              <label>Descriptor<input aria-label={`Descriptor de ${level.label} en ${criterion.label}`} disabled={locked} value={level.description || ""} onChange={event => onLevel(criterionIndex, levelIndex, { description: event.target.value })}/></label>
              <label>Puntos<input inputMode="decimal" aria-label={`Puntos de ${level.label} en ${criterion.label}`} disabled={locked} value={level.points} onChange={event => onLevel(criterionIndex, levelIndex, { points: Number(event.target.value) })}/></label>
            </div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    {!locked && <div className="button-row"><Button type="button" icon="plus" variant="secondary" onClick={onAddCriterion}>Agregar criterio</Button><Button type="button" icon="plus" variant="secondary" onClick={onAddLevel}>Agregar nivel</Button></div>}
  </div>;
}

function SchemeDialog({ courseId, current, admin, onClose, onSaved }: { courseId: string; current: string; admin: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [schemes, setSchemes] = useState<OrganizationGradingScheme[] | null>(null), [chosen, setChosen] = useState(current === "points" ? "" : current), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ schemes: OrganizationGradingScheme[] }>("/grading-schemes").then(result => setSchemes(result.schemes.filter(item => item.status === "active"))).catch(cause => setError(message(cause))); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/courses/${courseId}/assessment/scheme`, "PUT", { gradingSchemeId: chosen || null }); await onSaved(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Cambiar esquema" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!schemes ? <Loading label="Cargando esquemas…" lines={3}/> : <div className="stack" role="radiogroup" aria-label="Esquemas activos">
        <label className="assessment-scheme-option"><input type="radio" name="scheme" checked={chosen === ""} onChange={() => setChosen("")}/><span><strong>Puntos acumulados</strong>{schemeExplanation({ id: "points", name: "Puntos acumulados", method: "points", categories: [{ id: "general", label: "Actividades" }], display: { kind: "numeric", max: 100, decimals: 1 }, passing: { min: 60 }, periods: "simple", retakes: "replace" }).map(line => <span key={line} className="muted small">{line}</span>)}</span></label>
        {schemes.map(scheme => <label key={scheme.id} className="assessment-scheme-option"><input type="radio" name="scheme" checked={chosen === scheme.id} onChange={() => setChosen(scheme.id)}/><span><strong>{scheme.name}</strong>{schemeExplanation(scheme).map(line => <span key={line} className="muted small">{line}</span>)}</span></label>)}
      </div>}
      {admin && <Link href="/configuracion-academica">Administrar esquemas</Link>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy} disabled={busy || !schemes}>Guardar</PrimaryAction></div>
    </form>
  </Modal>;
}

function TemplateDialog({ courseId, period, method, onClose, onSaved }: { courseId: string; period: Period; method: GradingScheme["method"]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [templateId, setTemplateId] = useState(assessmentTemplates[0].id), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/courses/${courseId}/assessment/periods/${period.id}/template`, "POST", method === "points" ? { templateId } : {}); await onSaved(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Usar plantilla en ${period.name}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {method === "points" ? <Field label="Plantilla"><select aria-label="Plantilla" value={templateId} onChange={event => setTemplateId(event.target.value)}>{assessmentTemplates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        : <p>Se agrega una actividad por categoría, con sus puntos.</p>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy}>Usar plantilla</PrimaryAction></div>
    </form>
  </Modal>;
}

function CopyDialog({ courseId, period, periods, onClose, onSaved }: { courseId: string; period: Period; periods: Period[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const others = periods.filter(item => item.id !== period.id);
  const [source, setSource] = useState(others[0]?.id || ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/courses/${courseId}/assessment/periods/${period.id}/copy-from/${source}`, "POST"); await onSaved(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Copiar actividades a ${period.name}`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {others.length ? <Field label="Copiar de"><select aria-label="Copiar de" value={source} onChange={event => setSource(event.target.value)}>{others.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field> : <p>No hay otro periodo en este ciclo.</p>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy} disabled={!source}>Copiar</PrimaryAction></div>
    </form>
  </Modal>;
}
