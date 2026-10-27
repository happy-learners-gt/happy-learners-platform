import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { CoursePackageView, CurriculumPackageSummary } from "@happy-learners/contracts";
import { api, message } from "../api";
import { plural } from "../model";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { ErrorState, Loading, StatusBadge } from "../ui/primitives";

const sourceLine = (item: Pick<CurriculumPackageSummary, "source" | "version">) => `Fuente: ${item.source.name}, consultada el ${item.source.retrievedOn.split("-").reverse().join("/")} · versión ${item.version}`;

/**
 * «Paquetes curriculares»: official references kept in the platform (each with its source). Administration activates
 * the ones its organization uses; each course's lead then takes indicators from them into the course's plan.
 */
export function CurriculumPackages() {
  const { toast, confirm } = useFeedback();
  const [packages, setPackages] = useState<CurriculumPackageSummary[] | null>(null), [error, setError] = useState("");
  const load = useCallback(() => api<{ packages: CurriculumPackageSummary[] }>("/curriculum-packages").then(result => { setPackages(result.packages); setError(""); }, cause => setError(message(cause))), []);
  useEffect(() => { void load(); }, [load]);
  async function toggle(item: CurriculumPackageSummary) {
    if (item.active && !await confirm({ title: `¿Desactivar «${item.title}»?`, body: <p>Los cursos ya no podrán tomar indicadores nuevos de este paquete. Lo que ya está en sus planes curriculares se conserva.</p>, confirm: "Desactivar" })) return;
    try {
      setPackages((await api<{ packages: CurriculumPackageSummary[] }>(`/curriculum-packages/${item.id}/${item.active ? "deactivate" : "activate"}`, "POST")).packages);
      toast({ message: item.active ? `«${item.title}» se desactivó.` : `«${item.title}» está activo: los cursos pueden tomar sus indicadores.` });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <section className="panel admin-section" aria-labelledby="packages-title">
    <div className="panel-header"><h2 id="packages-title">Paquetes curriculares</h2></div>
    <p className="muted">Referencias curriculares oficiales incluidas en la plataforma, con su fuente. Al activar una, la persona responsable de cada curso puede elegir sus indicadores de logro y agregarlos a su plan curricular.</p>
    {error ? <ErrorState error={error} retry={() => void load()}/> : !packages ? <Loading label="Cargando paquetes…" lines={2}/>
      : <ul className="package-list">{packages.map(item => <li key={item.id}>
        <div>
          <strong>{item.title}</strong>
          <span className="muted small">{item.level} · {plural(item.competencies, "competencia", "competencias")} · {plural(item.indicators, "indicador de logro", "indicadores de logro")}</span>
          <span className="muted small">{sourceLine(item)} · <a href={item.source.url} target="_blank" rel="noopener noreferrer">Ver la fuente</a></span>
          {item.active && item.activatedVersion !== item.version && <span className="muted small">Activado con la versión {item.activatedVersion}; vuelve a activarlo para usar la {item.version}.</span>}
        </div>
        {item.active && <StatusBadge tone="success">Activo</StatusBadge>}
        <button type="button" className={`button small ${item.active ? "ghost" : "secondary"}`} onClick={() => void toggle(item)}>{item.active ? "Desactivar" : "Activar"}</button>
      </li>)}</ul>}
  </section>;
}

/** The active packages a course reads, with what its plan already took from them. */
export function useCoursePackages(courseId: string) {
  const [data, setData] = useState<{ packages: CoursePackageView[]; canLink: boolean } | null>(null);
  const load = useCallback(() => api<{ packages: CoursePackageView[]; canLink: boolean }>(`/courses/${courseId}/curriculum-packages`).then(setData, () => setData({ packages: [], canLink: false })), [courseId]);
  useEffect(() => { void load(); }, [load]);
  return { data, load };
}

/** Picks indicators of an active package for the course's plan; those already in the plan stay checked and fixed. */
export function PackageIndicatorsDialog({ courseId, version, packages, onClose, onAdded }: { courseId: string; version: number; packages: CoursePackageView[]; onClose: () => void; onAdded: (added: number, skipped: number) => Promise<void> }) {
  const [packageId, setPackageId] = useState(packages[0]?.id || ""), [picked, setPicked] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const item = packages.find(entry => entry.id === packageId);
  const toggle = (code: string) => setPicked(current => { const next = new Set(current); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ added: number; skipped: number }>(`/courses/${courseId}/curriculum-packages/${packageId}`, "POST", { codes: [...picked], version });
      await onAdded(result.added, result.skipped);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Agregar indicadores del CNB" onClose={onClose} wide>
    <form className="stack" onSubmit={submit} aria-label="Agregar indicadores de un paquete curricular">
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {packages.length > 1 && <label className="select-inline"><span>Paquete</span><select value={packageId} onChange={event => { setPackageId(event.target.value); setPicked(new Set()); }}>{packages.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>}
      {item && <>
        <p className="muted small">{item.title}. {sourceLine(item)} · <a href={item.source.url} target="_blank" rel="noopener noreferrer">Ver la fuente</a>. Cada indicador que elijas se agrega como resultado de aprendizaje, dentro de su competencia.</p>
        <fieldset disabled={busy} className="stack package-picker">
          <legend className="sr-only">Indicadores de logro</legend>
          {item.competencyList.map(competency => <fieldset key={competency.code} className="package-competency">
            <legend><strong>Competencia {competency.code}.</strong> {competency.statement}</legend>
            {competency.indicators.map(indicator => {
              const inPlan = !!indicator.outcomeId;
              return <label key={indicator.code} className={`package-indicator${inPlan ? " is-linked" : ""}`}>
                <input type="checkbox" checked={inPlan || picked.has(indicator.code)} disabled={inPlan} onChange={() => toggle(indicator.code)}/>
                <span><strong>{indicator.code}</strong> {indicator.statement}{inPlan && <span className="muted small"> · Ya en el plan</span>}
                  <details><summary className="small">{plural(indicator.contents.length, "contenido", "contenidos")}</summary><ul className="small">{indicator.contents.map(content => <li key={content}>{content}</li>)}</ul></details>
                </span>
              </label>;
            })}
          </fieldset>)}
        </fieldset>
      </>}
      <div className="button-row">
        <button className="button primary" disabled={!picked.size || busy}>{busy ? "Agregando…" : picked.size ? `Agregar ${plural(picked.size, "indicador", "indicadores")}` : "Elige indicadores"}</button>
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
      </div>
    </form>
  </Modal>;
}
