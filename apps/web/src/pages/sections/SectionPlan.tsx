import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GradingScheme, LearningUnit, Lesson } from "@happy-learners/contracts";
import { assessmentPeriodStatus, freedomPolicyLabel } from "@happy-learners/domain";
import type { EffectiveActivity, EffectiveLesson, EffectiveUnit, FreedomPolicy } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Link, useNavigation } from "../../navigation";
import { Drawer, useFeedback } from "../../ui/feedback";
import { FreedomChip } from "../../ui/freedom";
import { LessonOutline } from "../../ui/LessonOutline";
import type { OutlineActions } from "../../ui/LessonOutline";
import { Menu } from "../../ui/Menu";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, PrimaryAction, Section } from "../../ui/primitives";
import { moveItem } from "../../ui/Sortable";
import { Tabs } from "../../ui/Tabs";
import { ActivityPanel } from "../course/Assessment";
import type { Activity, Period } from "../course/Assessment";
import { useCourse } from "../course/context";
import { Readings } from "../course/Readings";
import { sectionCrumbs, useSection } from "./context";

type Coverage = { lessons: { total: number; taught: number; planned: number; unplanned: number; unplannedIds: string[] }; outcomes: { total: number; covered: number; withoutLessons: number; withoutLessonIds: string[] }; behind: boolean };
type Detail = { status: string; published: boolean; duration: number; review?: "pending" | "returned" };
type Plan = {
  policy: FreedomPolicy; policyLabel: string; canEdit: boolean;
  lessons: EffectiveLesson[]; hiddenLessons: EffectiveLesson[];
  units: EffectiveUnit[]; hiddenUnits: EffectiveUnit[];
  activities: EffectiveActivity[]; hiddenActivities: EffectiveActivity[];
  coverage: Coverage; details: Record<string, Detail>;
};
type Share = { itemType: "unit" | "lesson" | "activity"; itemId: string; title: string };
type AssessmentPayload = { scheme: GradingScheme; explanation: string[]; periods: Period[]; team: { id: string; name: string }[] };

const noop = async () => false;
const actions: OutlineActions = {
  renameUnit: noop, editUnit: () => undefined, moveUnit: () => undefined, archiveUnit: () => undefined,
  createLesson: noop, renameLesson: noop, moveLesson: () => undefined, archiveLesson: () => undefined,
  duplicateLesson: () => undefined, previewLesson: () => undefined, openLesson: () => undefined,
};

function asLesson(item: EffectiveLesson, detail?: Detail): Lesson {
  return { id: item.id, title: item.title, courseUnitId: item.unitId, position: item.position, activities: [], duration: detail?.duration || 0, program: "", objective: "", materials: [], reflection: "", publishedAt: "", status: detail?.published ? "published" : detail?.status === "archived" ? "archived" : "draft", ...(detail?.review ? { review: { id: item.id, status: detail.review, note: "", requestedById: "", requestedByName: "", requestedAt: "", decisionNote: "" } } : {}) };
}

/** Sección › Plan de la sección: the effective content and evaluation, only when the course is not «igual». */
export function SectionPlan() {
  const { course, units, curriculum, settings, noun, sources, program } = useCourse();
  const { section, base } = useSection();
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const [plan, setPlan] = useState<Plan | null>(null), [error, setError] = useState(""), [coverageOpen, setCoverageOpen] = useState(false), [creating, setCreating] = useState(false), [ownUnit, setOwnUnit] = useState(false), [share, setShare] = useState<Share | null>(null), [expanded, setExpanded] = useState<Set<string>>(() => new Set(units.map(unit => unit.id)));
  const [assessment, setAssessment] = useState<AssessmentPayload | null>(null), [periodId, setPeriodId] = useState(""), [adding, setAdding] = useState<{ categoryId: string; replaces?: EffectiveActivity } | null>(null);
  const view = url.searchParams.get("vista") === "evaluacion" ? "evaluacion" : "contenido";
  const setView = (next: string) => { const target = new URL(url); if (next === "contenido") target.searchParams.delete("vista"); else target.searchParams.set("vista", next); navigate(target.pathname + target.search, true); };
  async function load() {
    setError("");
    try { setPlan(await api<Plan>(`/sections/${section.id}/plan`)); }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [section.id]);
  useEffect(() => {
    if (view !== "evaluacion" || assessment) return;
    api<AssessmentPayload>(`/courses/${course.id}/assessment`).then(payload => { setAssessment(payload); setPeriodId(payload.periods[0]?.id || ""); }).catch(cause => setError(message(cause)));
  }, [view, course.id]);
  const locked = sources.sectionFreedom === "program-locked" && program ? ` (fijado por el programa «${program.name}»)` : "";
  const header = <PageHeader crumbs={sectionCrumbs(section, { label: "Plan de la sección" })} title="Plan de la sección" description={`${course.title} · ${section.name}${plan ? ` · ${freedomPolicyLabel[plan.policy]}${locked}` : ""}`}
    actions={plan?.canEdit && view === "contenido" ? <Menu label="Acciones del plan" items={[{ label: "Crear unidad propia", onSelect: () => setOwnUnit(true) }]}/> : undefined}
    primary={plan?.canEdit && view === "contenido" ? <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Crear lección propia</PrimaryAction> : undefined}/>;
  if (error && !plan) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!plan) return <>{header}<Loading label="Abriendo el plan de la sección…" lines={6}/></>;
  const lessons = plan.lessons.map(item => asLesson(item, plan.details[item.id]));
  const planUnits = plan.units || [];
  const outlineUnits: LearningUnit[] = (planUnits.length ? planUnits : units.filter(unit => unit.status === "active").map(unit => ({ id: unit.id, position: unit.position, groupId: null, title: unit.name, core: false, origin: "course" as const, hidden: false }))).map(unit => ({ id: unit.id, courseId: course.id, name: unit.title, objective: "", position: unit.position, status: "active" as const, updatedAt: "" }));
  const ownIds = new Set(planUnits.filter(unit => unit.origin === "section").map(unit => unit.id));
  const hiddenOf = (unitId: string) => plan.hiddenLessons.filter(item => item.unitId === unitId).map(item => asLesson(item, plan.details[item.id]));
  const chipOf = (lesson: Lesson) => {
    const item = plan.lessons.find(row => row.id === lesson.id);
    if (!item) return null;
    if (item.origin === "section") return <FreedomChip mark="own"/>;
    if (item.core) return <FreedomChip mark="core"/>;
    return null;
  };
  async function override(body: Record<string, unknown>, done: string) {
    try { await api(`/sections/${section.id}/content-overrides`, "PUT", body); await load(); toast({ message: done }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const sectionActions: OutlineActions = {
    ...actions,
    openLesson: lesson => navigate(`/cursos/${course.id}/lecciones/${lesson.id}`),
    moveUnit: (unit, to) => {
      const ids = moveItem(outlineUnits.map(item => item.id), outlineUnits.findIndex(item => item.id === unit.id), to);
      void (async () => {
        for (const [index, id] of ids.entries()) await api(`/sections/${section.id}/content-overrides`, "PUT", { itemType: "unit", itemId: id, position: index, hidden: false, replaces: null });
        await load();
      })().catch(cause => toast({ tone: "error", message: message(cause) }));
    },
    moveLesson: (lesson, to) => {
      const siblings = lessons.filter(item => item.courseUnitId === lesson.courseUnitId);
      const ids = moveItem(siblings.map(item => item.id), siblings.findIndex(item => item.id === lesson.id), to);
      void (async () => {
        for (const [index, id] of ids.entries()) await api(`/sections/${section.id}/content-overrides`, "PUT", { itemType: "lesson", itemId: id, position: index, hidden: false, replaces: null });
        await load();
      })().catch(cause => toast({ tone: "error", message: message(cause) }));
    },
  };
  async function propose(itemType: Share["itemType"], itemId: string, title: string) {
    try { await api(`/sections/${section.id}/proposals`, "POST", { itemType, itemId }); toast({ message: `«${title}» quedó propuesta al curso.` }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const coverage = plan.coverage;
  const unplanned = plan.lessons.filter(item => coverage.lessons.unplannedIds.includes(item.id));
  const missingOutcomes = curriculum.outcomes.filter(item => coverage.outcomes.withoutLessonIds.includes(item.id));
  return <>
    {header}
    <button type="button" className="freedom-coverage" onClick={() => setCoverageOpen(true)}>
      <span><strong>Lecciones del núcleo</strong> {coverage.lessons.total} · {coverage.lessons.taught} impartidas · {coverage.lessons.planned} planificadas · {coverage.lessons.unplanned} sin planificar →</span>
      <span><strong>Resultados del núcleo</strong> {coverage.outcomes.total} · {coverage.outcomes.covered} cubiertos · {coverage.outcomes.withoutLessons} sin lecciones planificadas →</span>
    </button>
    <Tabs label="Plan de la sección" value={view} onChange={setView} items={[{ value: "contenido", label: "Contenido" }, { value: "evaluacion", label: "Evaluación" }]}>
      {view === "contenido" ? <>
        <LessonOutline courseId={course.id} noun={noun} units={outlineUnits} lessons={lessons} writable={plan.canEdit} organize={plan.canEdit} showArchived={false} actions={sectionActions} expanded={expanded} setExpanded={setExpanded}
          sectionPlan={{
            chip: chipOf,
            hidden: hiddenOf,
            show: lesson => void override({ itemType: "lesson", itemId: lesson.id, position: lesson.position ?? null, hidden: false, replaces: null }, `«${lesson.title}» vuelve a mostrarse.`),
            unitChip: unit => ownIds.has(unit.id) ? <FreedomChip mark="own"/> : null,
            unitItems: unit => {
              if (!plan.canEdit) return [];
              const own = ownIds.has(unit.id);
              const shareItems = own ? [{ label: "Copiar a otra sección", onSelect: () => setShare({ itemType: "unit" as const, itemId: unit.id, title: unit.name }) }, { label: "Proponer al curso", onSelect: () => void propose("unit", unit.id, unit.name) }] : [];
              return own ? shareItems : [{ label: "Ocultar en esta sección", onSelect: () => void override({ itemType: "unit", itemId: unit.id, position: null, hidden: true, replaces: null }, `«${unit.name}» quedó oculta en esta sección.`) }, ...shareItems];
            },
            lessonItems: lesson => {
              const item = plan.lessons.find(row => row.id === lesson.id);
              if (!plan.canEdit || !item) return [];
              const shareItems = item.origin === "section" ? [{ label: "Copiar a otra sección", onSelect: () => setShare({ itemType: "lesson" as const, itemId: lesson.id, title: lesson.title }) }, { label: "Proponer al curso", onSelect: () => void propose("lesson", lesson.id, lesson.title) }] : [];
              if (item.core || item.origin === "section") return shareItems;
              return [{ label: "Ocultar en esta sección", onSelect: () => void override({ itemType: "lesson", itemId: lesson.id, position: null, hidden: true, replaces: null }, `«${lesson.title}» quedó oculta en esta sección.`) }, ...shareItems];
            },
          }}/>
        {(plan.hiddenUnits || []).length > 0 && <details className="freedom-hidden"><summary>Unidades ocultas en esta sección ({plan.hiddenUnits.length})</summary><ul className="freedom-list">{plan.hiddenUnits.map(unit => <li key={unit.id} className="freedom-row"><span className="freedom-title">{unit.title}</span><FreedomChip mark="hidden"/>{plan.canEdit && <button type="button" className="button ghost small" onClick={() => void override({ itemType: "unit", itemId: unit.id, position: null, hidden: false, replaces: null }, `«${unit.title}» vuelve a mostrarse.`)}>Mostrar</button>}</li>)}</ul></details>}
        <Readings courseId={course.id} units={outlineUnits} sectionId={section.id} canEdit={plan.canEdit}/>
      </> : <SectionEvaluation plan={plan} assessment={assessment} periodId={periodId} onPeriod={setPeriodId} canEdit={plan.canEdit} policy={plan.policy} onAdd={setAdding} onHide={activity => void override({ itemType: "activity", itemId: activity.id, position: null, hidden: true, replaces: null }, `«${activity.title}» quedó oculta en esta sección.`)} onShare={activity => setShare({ itemType: "activity", itemId: activity.id, title: activity.title })} onPropose={activity => void propose("activity", activity.id, activity.title)}/>}
    </Tabs>
    {creating && <OwnLessonDialog units={outlineUnits} onClose={() => setCreating(false)} onCreate={async (unitId, title, objective) => {
      const { lesson } = await api<{ lesson: { id: string } }>(`/sections/${section.id}/lessons`, "POST", { title, objective, courseId: course.id, courseUnitId: unitId, duration: 20, instructions: "", sequence: settings.defaultSequence });
      navigate(`/cursos/${course.id}/lecciones/${lesson.id}`);
    }}/>}
    {coverageOpen && <Drawer title="Cobertura del núcleo" onClose={() => setCoverageOpen(false)}>
      <h3>Lecciones sin planificar</h3>
      {unplanned.length ? <ul className="freedom-list">{unplanned.map(item => <li key={item.id} className="freedom-row"><span className="freedom-title">{item.title}</span><Link href={`${base}/clases`}>Planificar en el cronograma</Link></li>)}</ul> : <p className="muted">Todas las lecciones del núcleo están impartidas o planificadas.</p>}
      <h3>Resultados sin lecciones</h3>
      {missingOutcomes.length ? <ul className="freedom-list">{missingOutcomes.map(item => <li key={item.id}>{item.statement}</li>)}</ul> : <p className="muted">Los resultados del núcleo tienen lecciones planificadas.</p>}
    </Drawer>}
    {adding && assessment && assessment.periods.length > 0 && <ActivityPanel courseId={course.id} period={(assessment.periods.find(item => item.id === periodId) || assessment.periods[0])} categoryId={adding.categoryId} activity={adding.replaces ? { id: "nueva", periodId, title: `Reemplazo de ${adding.replaces.title}`, kind: "project", points: adding.replaces.points, dueOn: null, categoryId: adding.replaces.categoryId, grading: "points", extra: false, retakeOf: null, groupMode: "individual", peerMin: 0.5, peerMax: 1.5, graded: false, maxScore: null, evaluators: [] } : null} scheme={assessment.scheme} team={assessment.team} note={adding.replaces ? `Reemplaza a «${adding.replaces.title}». La categoría y los puntos quedan iguales.` : "Solo la ve esta sección."} fixed={adding.replaces ? { category: true, points: true } : undefined} onClose={() => setAdding(null)} onSaved={async title => { setAdding(null); await load(); toast({ message: `«${title}» quedó en el plan de la sección.` }); }}
      persist={async body => { await api(`/sections/${section.id}/activities`, "POST", { ...body, ...(adding.replaces ? { replaces: adding.replaces.id, categoryId: adding.replaces.categoryId, points: adding.replaces.points } : {}) }); }}/>}
    {ownUnit && <OwnUnitDialog onClose={() => setOwnUnit(false)} onCreate={async (name, objective) => { await api(`/sections/${section.id}/units`, "POST", { name, objective }); setOwnUnit(false); await load(); toast({ message: `«${name}» quedó en el plan de la sección.` }); }}/>}
    {share && <CopyDialog courseId={course.id} sectionId={section.id} item={share} onClose={() => setShare(null)} onCopied={async count => { setShare(null); toast({ message: count === 1 ? "La copia quedó en la otra sección." : `Quedaron ${count} copias independientes.` }); }}/>}
  </>;
}

function SectionEvaluation({ plan, assessment, periodId, onPeriod, canEdit, policy, onAdd, onHide, onShare, onPropose }: {
  plan: Plan; assessment: AssessmentPayload | null; periodId: string; onPeriod: (id: string) => void; canEdit: boolean; policy: FreedomPolicy;
  onAdd: (value: { categoryId: string; replaces?: EffectiveActivity }) => void; onHide: (activity: EffectiveActivity) => void;
  onShare: (activity: EffectiveActivity) => void; onPropose: (activity: EffectiveActivity) => void;
}) {
  if (!assessment) return <Loading label="Abriendo la evaluación…" lines={4}/>;
  const period = assessment.periods.find(item => item.id === periodId) || assessment.periods[0];
  if (!period) return <EmptyState icon="table" title="El ciclo no tiene periodos">Cuando el ciclo lectivo tenga periodos, la sección adapta su evaluación.</EmptyState>;
  const rows = plan.activities.filter(item => item.periodId === period.id);
  const status = assessmentPeriodStatus(assessment.scheme, rows.map(item => ({ categoryId: item.categoryId, points: item.points, extra: false, retakeOf: null })));
  return <>
    <Section title="Cómo se calcula la nota">
      <h3>{assessment.scheme.name}</h3>
      <div>{assessment.explanation.map(line => <p key={line}>{line}</p>)}</div>
    </Section>
    <Tabs label="Periodos" value={period.id} onChange={onPeriod} items={assessment.periods.map(item => ({ value: item.id, label: item.name }))}>{null}</Tabs>
    <p role="status">{status.line}</p>
    {assessment.scheme.categories.map(category => {
      const own = rows.filter(item => item.categoryId === category.id);
      return <article key={category.id} className="freedom-category">
        <header className="freedom-row"><h3 className="freedom-title">{category.label}</h3>{canEdit && <Button icon="plus" className="small" onClick={() => onAdd({ categoryId: category.id })}>Agregar actividad propia</Button>}</header>
        {own.length ? <ul className="freedom-list">{own.map(activity => <li key={activity.id} className="freedom-row">
          <span className="freedom-title">{activity.title}</span>
          <span className="muted">{activity.points} pts</span>
          {activity.replaces ? <FreedomChip mark="replaces" replaced={activity.replacedTitle}/> : activity.origin === "section" ? <FreedomChip mark="own"/> : activity.core ? <FreedomChip mark="core"/> : null}
          {activity.review && <span className="status-badge">En revisión</span>}
          {canEdit && <Menu label={`Acciones de ${activity.title}`} items={[
            ...(!activity.core && activity.origin === "course" ? [{ label: "Ocultar en esta sección", onSelect: () => onHide(activity) }] : []),
            ...(policy === "free" && activity.core && activity.origin === "course" ? [{ label: "Reemplazar en esta sección", onSelect: () => onAdd({ categoryId: category.id, replaces: activity }) }] : []),
            ...(activity.origin === "section" ? [{ label: "Copiar a otra sección", onSelect: () => onShare(activity) }, { label: "Proponer al curso", onSelect: () => onPropose(activity) }] : []),
          ]}/>}
        </li>)}</ul> : <p className="muted">Sin actividades</p>}
      </article>;
    })}
    {plan.hiddenActivities.filter(item => item.periodId === period.id).length > 0 && <details className="freedom-hidden"><summary>Ocultas en esta sección ({plan.hiddenActivities.filter(item => item.periodId === period.id).length})</summary></details>}
  </>;
}

function OwnLessonDialog({ units, onClose, onCreate }: { units: LearningUnit[]; onClose: () => void; onCreate: (unitId: string, title: string, objective: string) => Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try { await onCreate(String(data.get("unit")), String(data.get("title")).trim(), String(data.get("objective")).trim()); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  return <Drawer title="Crear lección propia" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="freedom-note">Solo la ve esta sección.</p>
      <fieldset className="stack" disabled={busy}>
        <Field label="Unidad"><select name="unit" required>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
        <Field label="Título"><input name="title" required maxLength={160} data-autofocus/></Field>
        <Field label="Objetivo"><textarea name="objective" required maxLength={1000} rows={3}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Creando…" : "Crear y abrir"}</button></div>
      </fieldset>
    </form>
  </Drawer>;
}

function OwnUnitDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, objective: string) => Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try { await onCreate(String(data.get("name")).trim(), String(data.get("objective")).trim()); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  return <Drawer title="Crear unidad propia" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="freedom-note">Solo la ve esta sección. Sus lecciones también son de la sección.</p>
      <fieldset className="stack" disabled={busy}>
        <Field label="Nombre"><input name="name" required maxLength={160} data-autofocus/></Field>
        <Field label="Objetivo" optional><textarea name="objective" maxLength={1000} rows={3}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Creando…" : "Crear unidad"}</button></div>
      </fieldset>
    </form>
  </Drawer>;
}

function CopyDialog({ courseId, sectionId, item, onClose, onCopied }: { courseId: string; sectionId: string; item: Share; onClose: () => void; onCopied: (count: number) => Promise<void> }) {
  const { toast } = useFeedback();
  const [sections, setSections] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ sections: { id: string; name: string; courseId: string; status: string }[] }>("/sections").then(result => setSections(result.sections.filter(row => row.courseId === courseId && row.id !== sectionId && row.status === "active"))).catch(cause => toast({ tone: "error", message: message(cause) })); }, [courseId, sectionId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosen = [...new FormData(event.currentTarget).getAll("section")].map(String);
    if (!chosen.length) { toast({ tone: "error", message: "Elige al menos una sección." }); return; }
    setBusy(true);
    try {
      const result = await api<{ copies: string[] }>(`/sections/${sectionId}/copies`, "POST", { itemType: item.itemType, itemId: item.itemId, sectionIds: chosen });
      await onCopied(result.copies.length);
    } catch (cause) { toast({ tone: "error", message: message(cause) }); setBusy(false); }
  }
  return <Drawer title="Copiar a otra sección" onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <p className="freedom-note">«{item.title}» se copia aparte. Cambiar una copia no cambia las demás. Si la sección de destino pide revisión, la copia queda en revisión.</p>
      {!sections ? <Loading label="Buscando secciones…" lines={2}/> : sections.length ? <fieldset className="stack" disabled={busy}>
        {sections.map(row => <label key={row.id} className="freedom-review"><input type="checkbox" name="section" value={row.id}/>{row.name}</label>)}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Copiando…" : "Copiar"}</button></div>
      </fieldset> : <p className="muted">No hay otra sección de este curso a la que puedas copiar.</p>}
    </form>
  </Drawer>;
}
