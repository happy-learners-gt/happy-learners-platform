import { useEffect, useRef, useState } from "react";
import { api, message } from "../../api";
import { fullDate } from "../../model";
import { useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Button, ErrorState, Field, Section } from "../../ui/primitives";

type FeedStatus = { active: boolean; createdAt: string | null; url?: string; webcal?: string };

/**
 * «Sincronizar con mi calendario» (ST-125): a private subscription link with the classes of the sections the person
 * teaches. The link is shown once, when it is created; only its fingerprint is kept, so getting it again means
 * regenerating it, which stops the previous one.
 */
export function CalendarSync() {
  const { toast, confirm } = useFeedback();
  const [status, setStatus] = useState<FeedStatus | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function load() {
    setError("");
    try { setStatus(await api<FeedStatus>("/feeds/calendar")); } catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, []);
  async function create(regenerate: boolean) {
    if (regenerate && !await confirm({ title: "¿Regenerar el enlace?", danger: true, confirm: "Regenerar enlace",
      body: "El enlace actual dejará de funcionar y los calendarios suscritos con él ya no se actualizarán. Tendrás que suscribirte de nuevo con el enlace nuevo." })) return;
    setBusy(true);
    try {
      setStatus(await api<FeedStatus>("/feeds/calendar", "POST"));
      toast({ message: regenerate ? "Enlace regenerado. El anterior ya no funciona." : "Enlace creado. Cópialo en tu calendario." });
    } catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!status?.url) return;
    try { await navigator.clipboard.writeText(status.url); toast({ message: "Enlace copiado." }); }
    catch { input.current?.select(); toast({ tone: "info", message: "Selecciona el enlace y cópialo con Ctrl+C (⌘C en Mac)." }); }
  }
  return <Section title="Sincronizar con mi calendario" className="calendar-sync">
    <p className="muted">Suscribe Google Calendar, Outlook o Apple Calendar a las clases de las secciones que impartes. Los cambios, cancelaciones y reprogramaciones aparecen en la siguiente actualización de tu calendario, que suele consultar el enlace cada pocas horas.</p>
    {error ? <ErrorState title="No pudimos consultar tu enlace" error={error} retry={() => void load()}/> : !status ? <p className="muted small" role="status">Cargando…</p> : <>
      {status.url ? <div className="calendar-sync-link">
        <Field label="Enlace de suscripción" hint="Guárdalo ahora: por seguridad no se vuelve a mostrar. Es personal; quien lo tenga ve tus clases.">
          <input ref={input} type="text" readOnly value={status.url} onFocus={event => event.currentTarget.select()}/>
        </Field>
        <div className="calendar-sync-actions">
          <Button icon="copy" onClick={() => void copy()}>Copiar enlace</Button>
          {status.webcal && <a className="button ghost" href={status.webcal}><Icon name="calendar" size={18}/><span>Abrir en la app de calendario</span></a>}
        </div>
      </div> : status.active
        ? <p className="small">Tienes un enlace activo{status.createdAt ? <> desde el <time dateTime={status.createdAt}>{fullDate(status.createdAt)}</time></> : null}. Por seguridad no se muestra de nuevo: si lo necesitas, regenéralo.</p>
        : <p className="small">Aún no tienes un enlace de calendario.</p>}
      <div className="calendar-sync-actions">
        {status.active
          ? <Button icon="redo" busy={busy} disabled={busy} onClick={() => void create(true)}>Regenerar enlace</Button>
          : <Button icon="link" busy={busy} disabled={busy} onClick={() => void create(false)}>Crear enlace</Button>}
      </div>
    </>}
    <details className="calendar-sync-help">
      <summary>Cómo suscribirte</summary>
      <h3>Google Calendar</h3>
      <ol><li>En la web de Google Calendar, junto a «Otros calendarios», elige <strong>+</strong> y luego <strong>Desde URL</strong>.</li><li>Pega el enlace y elige <strong>Añadir calendario</strong>.</li></ol>
      <h3>Outlook</h3>
      <ol><li>En Outlook en la web, abre el calendario y elige <strong>Agregar calendario</strong>.</li><li>Elige <strong>Suscribirse desde la web</strong>, pega el enlace, ponle un nombre e <strong>Importar</strong>.</li></ol>
      <h3>Apple Calendar</h3>
      <ol><li>En Mac, abre Calendario y elige <strong>Archivo › Nueva suscripción a calendario</strong>; en iPhone o iPad, <strong>Ajustes › Calendario › Cuentas › Añadir cuenta › Otra › Añadir calendario suscrito</strong>.</li><li>Pega el enlace y confirma. También puedes usar «Abrir en la app de calendario» al crear el enlace.</li></ol>
    </details>
  </Section>;
}
