import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GradingScheme, LearningUnit, Lesson } from "@happy-learners/contracts";
import { assessmentPeriodStatus, freedomPolicyLabel } from "@happy-learners/domain";
import type { EffectiveActivity, EffectiveLesson, FreedomPolicy } from "@happy-learners/domain";
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
import { sectionCrumbs, useSection } from "./context";

type Coverage = { lessons: { total: number; taught: number; planned: number; unplanned: number; unplannedIds: string[] }; outcomes: { total: number; covered: number; withoutLessons: number; withoutLessonIds: string[] }; behind: boolean };
type Detail = { status: string; published: boolean; duration: number };
type Plan = {
  policy: FreedomPolicy; policyLabel: string; canEdit: boolean;
  lessons: EffectiveLesson[]; hiddenLessons: EffectiveLesson[];
  activities: EffectiveActivity[]; hiddenActivities: EffectiveActivity[];
  coverage: Coverage; details: Record<string, Detail>;
};
type AssessmentPayload = { scheme: GradingScheme; explanation: string[]; periods: Period[]; team: { id: string; name: string }[] };

const noop = async () => false;
const actions: OutlineActions = {
  renameUnit: noop, editUnit: () => undefined, moveUnit: () => undefined, archiveUnit: () => undefined,
  createLesson: noop, renameLesson: noop, moveLesson: () => undefined, archiveLesson: () => undefined,
  duplicateLesson: () => undefined, previewLesson: () => undefined, openLesson: () => undefined,
};

function asLesson(item: EffectiveLesson, detail?: Detail): Lesson {
  return { id: item.id, title: item.title, courseUnitId: item.unitId, position: item.position, activities: [], duration: detail?.duration || 0, program: "", objective: "", materials: [], reflection: "", publishedAt: "", status: detail?.published ? "published" : detail?.status === "archived" ? "archived" : "draft" };
}

/** Sección › Plan de la sección: the effective content and evaluation, only when the course is not «igual». */
export function SectionPlan() {
  const { course, units, curriculum, settings, noun, sources, program } = useCourse();
  const { section, base } = useSection();
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const [plan, setPlan] = useState<Plan | null>(null), [error, setError] = useState(""), [coverageOpen, setCoverageOpen] = useState(false), [creating, setCreating] = useState(false), [expanded, setExpanded] = useState<Set<string>>(() => new Set(units.map(unit => unit.id)));
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
    primary={plan?.canEdit && view === "contenido" ? <PrimaryAction icon="plus" onClick={() => setCreating(true)}>Crear lección propia</PrimaryAction> : undefined}/>;
  if (error && !plan) return <>{header}<ErrorState error={error} retry={() => void load()}/></>;
  if (!plan) return <>{header}<Loading label="Abriendo el plan de la sección…" lines={6}/></>;
  const lessons = plan.lessons.map(item => asLesson(item, plan.details[item.id]));
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
    moveLesson: (lesson, to) => {
      const siblings = lessons.filter(item => item.courseUnitId === lesson.courseUnitId);
      const ids = moveItem(siblings.map(item => item.id), siblings.findIndex(item => item.id === lesson.id), to);
      void (async () => {
        for (const [index, id] of ids.entries()) await api(`/sections/${section.id}/content-overrides`, "PUT", { itemType: "lesson", itemId: id, position: index, hidden: false, replaces: null });
        await load();
      })().catch(cause => toast({ tone: "error", message: message(cause) }));
    },
  };
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
      {view === "contenido" ? <LessonOutline courseId={course.id} noun={noun} units={units.filter(unit => unit.status === "active")} lessons={lessons} writable={plan.canEdit} organize={plan.canEdit} showArchived={false} actions={sectionActions} expanded={expanded} setExpanded={setExpanded}
        sectionPlan={{
          chip: chipOf,
          hidden: hiddenOf,
          show: lesson => void override({ itemType: "lesson", itemId: lesson.id, position: lesson.position ?? null, hidden: false, replaces: null }, `«${lesson.title}» vuelve a mostrarse.`),
          lessonItems: lesson => {
            const item = plan.lessons.find(row => row.id === lesson.id);
            if (!plan.canEdit || !item || item.core || item.origin === "section") return [];
            return [{ label: "Ocultar en esta sección", onSelect: () => void override({ itemType: "lesson", itemId: lesson.id, position: null, hidden: true, replaces: null }, `«${lesson.title}» quedó oculta en esta sección.`) }];
          },
        }}/> : <SectionEvaluation plan={plan} assessment={assessment} periodId={periodId} onPeriod={setPeriodId} canEdit={plan.canEdit} policy={plan.policy} onAdd={setAdding} onHide={activity => void override({ itemType: "activity", itemId: activity.id, position: null, hidden: true, replaces: null }, `«${activity.title}» quedó oculta en esta sección.`)}/>}
    </Tabs>
    {creating && <OwnLessonDialog units={units.filter(unit => unit.status === "active")} onClose={() => setCreating(false)} onCreate={async (unitId, title, objective) => {
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
  </>;
}

function SectionEvaluation({ plan, assessment, periodId, onPeriod, canEdit, policy, onAdd, onHide }: {
  plan: Plan; assessment: AssessmentPayload | null; periodId: string; onPeriod: (id: string) => void; canEdit: boolean; policy: FreedomPolicy;
  onAdd: (value: { categoryId: string; replaces?: EffectiveActivity }) => void; onHide: (activity: EffectiveActivity) => void;
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
          {canEdit && <Menu label={`Acciones de ${activity.title}`} items={[
            ...(!activity.core && activity.origin === "course" ? [{ label: "Ocultar en esta sección", onSelect: () => onHide(activity) }] : []),
            ...(policy === "free" && activity.core && activity.origin === "course" ? [{ label: "Reemplazar en esta sección", onSelect: () => onAdd({ categoryId: category.id, replaces: activity }) }] : []),
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
