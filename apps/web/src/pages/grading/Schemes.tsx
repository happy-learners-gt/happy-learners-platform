import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Course, GradingScheme, OrganizationGradingScheme, StudyProgram } from "@happy-learners/contracts";
import { learnerResult, schemeInput, schemeTemplates } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { EmptyState, ErrorState, Field, Loading, PrimaryAction, StatusBadge } from "../../ui/primitives";

const methods = [
  ["points", "Puntos"],
  ["weighted-categories", "Categorías ponderadas"],
  ["pass-fail", "Aprobado o no aprobado"],
  ["levels", "Niveles"],
] as const;
const displays = [
  ["numeric", "Número"],
  ["letters", "Letras"],
  ["gpa", "GPA"],
  ["levels", "Niveles"],
  ["pass-fail", "Aprobado o no aprobado"],
] as const;
const periods = [
  ["simple", "Promedio simple"],
  ["weighted", "Promedio ponderado"],
  ["cumulative", "Acumulado"],
  ["last", "Último periodo"],
  ["none", "Sin nota final"],
] as const;
const retakes = [["replace", "Reemplaza"], ["highest", "La más alta"], ["average", "Promedio"]] as const;
const notes: Record<string, string> = {
  colegio: "Zona y examen, sobre 100.",
  universidad: "Tareas, proyectos y examen final, con GPA y un mínimo en el examen.",
  idiomas: "Niveles del MCER; el resultado es el último nivel.",
  tecnica: "Competencias que se aprueban o no.",
  artes: "Interpretación y recital, con un mínimo en el panel.",
  seminario: "Asistencia y entrega, sin nota final.",
  doctorado: "El dictamen del tribunal decide.",
};
const methodLabel = (method: string) => methods.find(item => item[0] === method)?.[1] || method;
const slug = (value: string, fallback: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;

export function schemeOptions(schemes: OrganizationGradingScheme[], current: unknown): [string, string][] {
  return schemes.filter(item => item.status === "active" || item.id === current).map(item => [item.id, item.status === "archived" ? `${item.name} (archivado)` : item.name]);
}

export function useGradingSchemes() {
  const [schemes, setSchemes] = useState<OrganizationGradingScheme[]>([]);
  useEffect(() => { api<{ schemes?: OrganizationGradingScheme[] }>("/grading-schemes").then(result => setSchemes(Array.isArray(result.schemes) ? result.schemes : [])).catch(() => undefined); }, []);
  return schemes;
}

/** Administration's grading schemes: templates, an editor and a live result for one example student. */
export function GradingSchemes() {
  const { toast } = useFeedback();
  const [schemes, setSchemes] = useState<OrganizationGradingScheme[] | null>(null), [courses, setCourses] = useState<Course[]>([]), [programs, setPrograms] = useState<StudyProgram[]>([]);
  const [error, setError] = useState(""), [editing, setEditing] = useState<GradingScheme | null>(null), [busy, setBusy] = useState("");
  const load = () => Promise.all([
    api<{ schemes?: OrganizationGradingScheme[] }>("/grading-schemes"),
    api<{ courses?: Course[] }>("/courses"),
    api<{ programs?: StudyProgram[] }>("/programs"),
  ]).then(([list, courseList, programList]) => { setSchemes(list.schemes || []); setCourses(courseList.courses || []); setPrograms(programList.programs || []); setError(""); }).catch(cause => setError(message(cause)));
  useEffect(() => { void load(); }, []);
  const usage = (id: string) => courses.filter(item => item.settings.gradingSchemeId === id).length + programs.filter(item => item.settings.gradingSchemeId === id).length;
  async function addTemplate(templateId: string) {
    setBusy(templateId);
    try {
      await api(`/grading-schemes/templates/${templateId}`, "POST", {});
      await load();
      toast({ message: "Esquema agregado desde la plantilla. Puedes editarlo." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  async function save(draft: GradingScheme) {
    const checked = schemeInput(draft);
    if ("error" in checked) { toast({ tone: "error", message: checked.error }); return; }
    const existing = schemes?.find(item => item.id === draft.id);
    try {
      if (existing) await api(`/grading-schemes/${existing.id}`, "PUT", checked);
      else await api("/grading-schemes", "POST", checked);
      setEditing(null); await load();
      toast({ message: existing ? "Esquema actualizado." : "Esquema creado." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function remove(scheme: OrganizationGradingScheme) {
    try {
      const result = await api<{ archived: boolean }>(`/grading-schemes/${scheme.id}`, "DELETE");
      await load();
      toast({ message: result.archived ? `«${scheme.name}» se archivó porque está en uso.` : `«${scheme.name}» se eliminó.` });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <section className="panel admin-section" aria-labelledby="schemes-title">
    <div className="panel-header"><h2 id="schemes-title">Esquemas de evaluación</h2>
      <label className="button secondary small">Agregar desde plantilla
        <select className="sr-only" aria-label="Agregar desde plantilla" value="" disabled={!!busy} onChange={event => { if (event.target.value) void addTemplate(event.target.value); }}>
          <option value="">Elegir plantilla…</option>
          {schemeTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    <p className="muted">Un esquema dice cómo se calculan y se muestran las notas. Los cursos y programas lo eligen en su configuración. Sin esquema, siguen con puntos acumulados.</p>
    <ul className="template-grid">{schemeTemplates.map(item => <li key={item.id} className="panel lit"><strong>{item.name}</strong><p className="muted small">{notes[item.id]}</p><p className="muted small">{methodLabel(item.method)}</p></li>)}</ul>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !schemes ? <Loading label="Cargando esquemas…" lines={3}/> : !schemes.length
      ? <EmptyState compact icon="grid" title="Sin esquemas propios">Agrega uno desde una plantilla y ajústalo. Los cursos siguen con puntos acumulados hasta que elijan un esquema.</EmptyState>
      : <ul className="program-list">{schemes.map(scheme => <li key={scheme.id} className={scheme.status === "archived" ? "is-archived" : undefined}>
        <div className="program-text"><strong>{scheme.name}</strong>{scheme.status === "archived" && <StatusBadge>Archivado</StatusBadge>}<p className="muted small">{methodLabel(scheme.method)} · {usage(scheme.id) ? `En uso en ${usage(scheme.id)}` : "Sin usar"}</p></div>
        <Menu label={`Acciones de ${scheme.name}`} items={[
          { label: "Editar", icon: "edit", onSelect: () => setEditing(scheme) },
          { label: scheme.status === "archived" ? "Eliminar" : "Archivar o eliminar", icon: "archive", danger: true, onSelect: () => void remove(scheme) },
        ]}/>
      </li>)}</ul>}
    {editing && <SchemeDialog scheme={editing} onClose={() => setEditing(null)} onSave={save}/>}
  </section>;
}

type Draft = GradingScheme;

export function SchemeDialog({ scheme, onClose, onSave }: { scheme: Draft; onClose: () => void; onSave: (scheme: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(scheme), [busy, setBusy] = useState(false);
  const checked = schemeInput(draft);
  const preview = useMemo(() => previewOf(draft), [draft]);
  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ("error" in checked) return;
    setBusy(true); await onSave(draft); setBusy(false);
  }
  return <Modal wide title={scheme.name === "Nuevo esquema" ? "Nuevo esquema" : `Editar «${scheme.name}»`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      <div className="field-grid">
        <Field label="Nombre"><input value={draft.name} maxLength={120} required onChange={event => set({ name: event.target.value })}/></Field>
        <Field label="Método"><select aria-label="Método" value={draft.method} onChange={event => set({ method: event.target.value as Draft["method"] })}>{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Cómo se muestra"><select aria-label="Cómo se muestra" value={draft.display.kind} onChange={event => set({ display: displayOfKind(event.target.value) })}>{displays.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Periodos"><select aria-label="Combinación de periodos" value={draft.periods} onChange={event => set({ periods: event.target.value as Draft["periods"] })}>{periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Reposiciones"><select aria-label="Reposiciones" value={draft.retakes} onChange={event => set({ retakes: event.target.value as Draft["retakes"] })}>{retakes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Tope de puntos extra"><input inputMode="decimal" aria-label="Tope de puntos extra" value={draft.extraCreditCap ?? 0} onChange={event => set({ extraCreditCap: Number(event.target.value) || 0 })}/></Field>
        <Field label={draft.passing.level !== undefined ? "Nivel mínimo" : "Nota mínima"}>{draft.passing.level !== undefined
          ? <select aria-label="Nivel mínimo" value={draft.passing.level} onChange={event => set({ passing: { level: event.target.value } })}>{(draft.levels || []).map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select>
          : <input inputMode="decimal" aria-label="Nota mínima" value={draft.passing.min ?? 60} onChange={event => set({ passing: { min: Number(event.target.value) } })}/>}</Field>
      </div>
      <fieldset className="config-section"><legend>Categorías</legend>
        <ul className="stack">{draft.categories.map((category, index) => <li key={category.id} className="field-grid">
          <Field label="Nombre"><input aria-label={`Nombre de la categoría ${index + 1}`} value={category.label} onChange={event => updateCategory(setDraft, index, { label: event.target.value, id: slug(event.target.value, `categoria-${index + 1}`) })}/></Field>
          {draft.method === "weighted-categories" && <Field label="Peso"><input inputMode="decimal" aria-label={`Peso de ${category.label}`} value={category.weight ?? 0} onChange={event => updateCategory(setDraft, index, { weight: Number(event.target.value) })}/></Field>}
          <Field label="Descartar la más baja"><input inputMode="numeric" aria-label={`Descartar la más baja de ${category.label}`} value={category.dropLowest ?? 0} onChange={event => updateCategory(setDraft, index, { dropLowest: Number(event.target.value) || 0 })}/></Field>
          <Field label="Mínimo"><input inputMode="decimal" aria-label={`Mínimo de ${category.label}`} value={category.minimum ?? ""} onChange={event => updateCategory(setDraft, index, { minimum: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field>
          <button type="button" className="button ghost" disabled={draft.categories.length === 1} onClick={() => setDraft(current => ({ ...current, categories: current.categories.filter((_, item) => item !== index) }))}>Quitar</button>
        </li>)}
        </ul>
        <button type="button" className="button secondary small" onClick={() => setDraft(current => ({ ...current, categories: [...current.categories, { id: `categoria-${current.categories.length + 1}`, label: "Nueva categoría", ...(current.method === "weighted-categories" ? { weight: 0 } : {}) }] }))}><Icon name="plus" size={16}/>Agregar categoría</button>
      </fieldset>
      {(draft.method === "levels" || draft.display.kind === "levels" || draft.levels) && <fieldset className="config-section"><legend>Niveles</legend>
        <ul className="stack">{(draft.levels || []).map((level, index) => <li key={level.id} className="field-grid">
          <Field label="Nombre"><input aria-label={`Nombre del nivel ${index + 1}`} value={level.label} onChange={event => updateLevel(setDraft, index, { label: event.target.value, id: slug(event.target.value, `nivel-${index + 1}`) })}/></Field>
          <Field label="Valor"><input inputMode="decimal" aria-label={`Valor de ${level.label}`} value={level.value ?? ""} onChange={event => updateLevel(setDraft, index, { value: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field>
        </li>)}</ul>
      </fieldset>}
      {draft.display.kind === "numeric" && <div className="field-grid">
        <Field label="Máximo"><input inputMode="decimal" aria-label="Máximo" value={draft.display.max} onChange={event => set({ display: { kind: "numeric", max: Number(event.target.value) || 100, decimals: draft.display.kind === "numeric" ? draft.display.decimals : 1 } })}/></Field>
        <Field label="Decimales"><select aria-label="Decimales" value={draft.display.decimals} onChange={event => set({ display: { kind: "numeric", max: draft.display.kind === "numeric" ? draft.display.max : 100, decimals: Number(event.target.value) as 0 | 1 | 2 } })}><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></Field>
      </div>}
      {(draft.display.kind === "letters" || draft.display.kind === "gpa") && <fieldset className="config-section"><legend>Umbrales</legend>
        <ul className="stack">{draft.display.thresholds.map((threshold, index) => <li key={threshold.letter} className="field-grid">
          <Field label="Etiqueta"><input aria-label={`Etiqueta del umbral ${index + 1}`} value={threshold.letter} onChange={event => updateThreshold(setDraft, index, event.target.value, threshold.min)}/></Field>
          <Field label="Mínimo"><input inputMode="decimal" aria-label={`Mínimo de ${threshold.letter}`} value={threshold.min} onChange={event => updateThreshold(setDraft, index, threshold.letter, Number(event.target.value))}/></Field>
          {draft.display.kind === "gpa" && <Field label="Puntos"><input inputMode="decimal" aria-label={`Puntos de ${threshold.letter}`} value={"points" in threshold ? threshold.points : 0} onChange={event => updateGpa(setDraft, index, Number(event.target.value))}/></Field>}
        </li>)}</ul>
      </fieldset>}
      <p className="scheme-preview" role="status" aria-label="Vista previa">Vista previa: <strong>{preview.display ?? "—"}</strong>{preview.score !== null && <span className="muted"> · {preview.score}</span>}{preview.reasons[0] && <span className="muted"> · {preview.reasons[0]}</span>}</p>
      {"error" in checked && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{checked.error}</p>}
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryAction type="submit" busy={busy} disabled={busy || "error" in checked}>Guardar esquema</PrimaryAction></div>
    </form>
  </Modal>;
}

function previewOf(draft: Draft) {
  const samples = [100, 80, 50, 70];
  const activities = draft.categories.map(category => ({ id: category.id, periodId: "vista", categoryId: category.id, title: category.label, points: 100, grading: "points" as const }));
  const marks = new Map(activities.map((activity, index) => [activity.id, { kind: "points" as const, value: samples[index % samples.length] }]));
  try {
    const result = learnerResult(draft, activities, marks, [{ id: "vista", position: 1, weight: 1 }]);
    return { display: result.final.display, score: result.final.score, reasons: result.final.reasons };
  } catch { return { display: null, score: null, reasons: [] as string[] }; }
}
function displayOfKind(kind: string): Draft["display"] {
  if (kind === "numeric") return { kind: "numeric", max: 100, decimals: 1 };
  if (kind === "letters") return { kind: "letters", thresholds: [{ letter: "A", min: 90 }, { letter: "B", min: 80 }, { letter: "C", min: 70 }, { letter: "D", min: 60 }, { letter: "F", min: 0 }] };
  if (kind === "gpa") return { kind: "gpa", thresholds: [{ letter: "A", min: 90, points: 4 }, { letter: "B", min: 80, points: 3 }, { letter: "C", min: 70, points: 2 }, { letter: "D", min: 60, points: 1 }, { letter: "F", min: 0, points: 0 }] };
  if (kind === "levels") return { kind: "levels" };
  return { kind: "pass-fail" };
}
function updateCategory(setDraft: (value: Draft | ((current: Draft) => Draft)) => void, index: number, patch: Partial<Draft["categories"][number]>) {
  setDraft(current => ({ ...current, categories: current.categories.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch, ...(patch.minimum === undefined && "minimum" in patch ? { minimum: undefined } : {}) } : item) }));
}
function updateLevel(setDraft: (value: Draft | ((current: Draft) => Draft)) => void, index: number, patch: { label?: string; id?: string; value?: number }) {
  setDraft(current => ({ ...current, levels: (current.levels || []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch, ...(patch.value === undefined ? { value: undefined } : {}) } : item) }));
}
function updateThreshold(setDraft: (value: Draft | ((current: Draft) => Draft)) => void, index: number, letter: string, min: number) {
  setDraft(current => {
    if (current.display.kind === "letters") return { ...current, display: { kind: "letters", thresholds: current.display.thresholds.map((item, itemIndex) => itemIndex === index ? { letter, min } : { letter: item.letter, min: item.min }) } };
    if (current.display.kind === "gpa") return { ...current, display: { kind: "gpa", thresholds: current.display.thresholds.map((item, itemIndex) => itemIndex === index ? { ...item, letter, min } : item) } };
    return current;
  });
}
function updateGpa(setDraft: (value: Draft | ((current: Draft) => Draft)) => void, index: number, points: number) {
  setDraft(current => current.display.kind !== "gpa" ? current : { ...current, display: { ...current.display, thresholds: current.display.thresholds.map((item, itemIndex) => itemIndex === index ? { ...item, points } : item) } });
}
