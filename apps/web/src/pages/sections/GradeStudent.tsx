import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GradeChange, Gradebook } from "@happy-learners/contracts";
import { maxCommentLength } from "@happy-learners/domain";
import { api, message } from "../../api";
import { Drawer } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Loading } from "../../ui/primitives";
import { currentRegional } from "../../regional";

const number = (value: number | null) => value === null ? "vacío" : new Intl.NumberFormat(currentRegional().locale, { maximumFractionDigits: 1 }).format(value);
const when = (value: string) => new Intl.DateTimeFormat(currentRegional().locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

/**
 * A student's detail in the gradebook: the comment for the period (saved on its own), the score changes with who made
 * them, and the student's report card.
 */
export function GradeStudentDrawer({ book, learnerId, periodId, editable, onSaved, onReport, onClose }: {
  book: Gradebook; learnerId: string; periodId: string; editable: boolean; onSaved: (book: Gradebook) => void; onReport: () => void; onClose: () => void;
}) {
  const learner = book.learners.find(item => item.id === learnerId)!;
  const period = book.periods.find(item => item.id === periodId);
  const stored = book.comments.find(item => item.learnerId === learnerId && item.periodId === periodId);
  const [comment, setComment] = useState(stored?.body || ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [changes, setChanges] = useState<GradeChange[] | null>(null), [historyError, setHistoryError] = useState("");
  useEffect(() => {
    void api<{ changes: GradeChange[] }>(`/sections/${book.section.id}/grades/history?learner=${learnerId}`).then(result => setChanges(result.changes), cause => setHistoryError(message(cause)));
  }, [book.section.id, learnerId]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ gradebook: Gradebook }>(`/sections/${book.section.id}/grades`, "PUT", { comments: [{ learnerId, periodId, body: comment.trim() }] });
      onSaved(result.gradebook);
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  const periodName = (id: string) => book.periods.find(item => item.id === id)?.name || "Periodo";
  return <Drawer title={learner.name} onClose={onClose}>
    <div className="stack">
      {period && <form className="stack" onSubmit={save} aria-label={`Comentario de ${period.name}`}>
        <h3>Comentario de {period.name}</h3>
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        {editable
          ? <>
            <textarea rows={4} maxLength={maxCommentLength} value={comment} aria-label={`Comentario de ${learner.name} en ${period.name}`} onChange={event => setComment(event.target.value)} placeholder="Logros, aspectos por mejorar o recomendaciones. Aparece en la boleta."/>
            <div className="button-row">
              <button className="button primary" disabled={busy || comment.trim() === (stored?.body || "")}>{busy ? "Guardando…" : comment.trim() ? "Guardar comentario" : "Quitar comentario"}</button>
              <span className="muted small">{comment.length} de {maxCommentLength}</span>
            </div>
          </>
          : <p>{stored?.body || <span className="muted">Sin comentario.</span>}</p>}
        {stored && <p className="muted small">Lo escribió {stored.updatedBy}, {when(stored.updatedAt)}</p>}
      </form>}
      <div className="button-row"><button type="button" className="button secondary" onClick={onReport}><Icon name="download" size={16}/>Descargar su boleta</button></div>
      <h3>Historial de cambios</h3>
      {historyError ? <p className="form-alert" role="alert">{historyError}</p>
        : !changes ? <Loading label="Cargando el historial…" lines={3}/>
        : !changes.length ? <p className="muted">Aún no hay cambios registrados.</p>
        : <ol className="grade-history">{changes.map(change => <li key={change.id}>
          <span><strong>{periodName(change.periodId)}{change.activity ? ` · ${change.activity}` : ""}</strong>: {number(change.before)} → {number(change.after)}</span>
          <span className="muted small">{change.by}, {when(change.at)}</span>
        </li>)}</ol>}
    </div>
  </Drawer>;
}
