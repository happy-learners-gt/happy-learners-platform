import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AcademicYear, SectionSummary } from "@happy-learners/contracts";
import { api, message } from "../../api";
import { Modal } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Field, Loading } from "../../ui/primitives";

/** «PDF de entrega»: a module's published lessons for one section and period, downloaded as a PDF. */
export function DeliveryDialog({ courseId, units, onClose }: { courseId: string; units: { id: string; name: string }[]; onClose: () => void }) {
  const [sections, setSections] = useState<SectionSummary[] | null>(null), [year, setYear] = useState<AcademicYear | null>(null);
  const [values, setValues] = useState({ unit: units[0]?.id || "", section: "", period: "" }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ sections: SectionSummary[] }>("/sections").then(result => { const own = result.sections.filter(item => item.courseId === courseId); setSections(own); setValues(current => ({ ...current, section: own[0]?.id || "" })); }, cause => setError(message(cause)));
    void api<{ years: AcademicYear[] }>("/academic-years").then(result => setYear(result.years.find(item => item.status === "current") || null), () => setYear(null));
  }, [courseId]);
  async function download(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const query = new URLSearchParams({ section: values.section, ...(values.period ? { period: values.period } : {}) });
    try {
      const response = await fetch(`/api/courses/${courseId}/units/${values.unit}/delivery.pdf?${query}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "No se pudo generar el PDF.");
      const link = document.createElement("a"), href = URL.createObjectURL(await response.blob());
      link.href = href; link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "entrega.pdf"; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      onClose();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  return <Modal title="PDF de entrega" onClose={onClose}>
    <form className="stack" onSubmit={download} aria-label="Descargar el PDF de entrega">
      <p className="muted small">Incluye solo las lecciones publicadas del módulo, nunca los borradores, con el membrete de la organización, la sección, el ciclo y el periodo.</p>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {!sections ? <Loading label="Cargando secciones…" lines={2}/> : !sections.length ? <p className="muted">El curso no tiene secciones que puedas ver.</p> : <fieldset disabled={busy} className="stack">
        <Field label="Módulo"><select value={values.unit} onChange={event => setValues({ ...values, unit: event.target.value })}>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></Field>
        <Field label="Sección"><select value={values.section} onChange={event => setValues({ ...values, section: event.target.value })}>{sections.map(section => <option key={section.id} value={section.id}>{section.name}</option>)}</select></Field>
        <Field label="Periodo" optional hint={year ? `Del ${year.name}. Sin elegir, el periodo de hoy.` : "No hay un ciclo lectivo vigente."}><select value={values.period} disabled={!year} onChange={event => setValues({ ...values, period: event.target.value })}><option value="">El de hoy</option>{year?.periods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></Field>
        <div className="button-row"><button className="button primary" disabled={!values.section || !values.unit}><Icon name="download" size={16}/>{busy ? "Generando…" : "Descargar PDF"}</button><button type="button" className="button ghost" onClick={onClose}>Cancelar</button></div>
      </fieldset>}
    </form>
  </Modal>;
}
