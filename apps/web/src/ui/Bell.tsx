import { useEffect, useRef, useState } from "react";
import type { Inbox } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { timeAgo } from "../model";
import { formatInstant } from "../regional";
import { Icon } from "./icons";

/** How often an open page asks for new notices; opening the bell always asks. */
const refreshMs = 60_000;

/**
 * ST-161: the «En la aplicación» channel. The bell of the top bar counts unread notices and lists the last 30; opening
 * one marks it read and goes to its page. Asking for the list also lets the store send e-mail that became due.
 */
export function Bell() {
  const { url, navigate } = useNavigation();
  const [inbox, setInbox] = useState<Inbox | null>(null), [open, setOpen] = useState(false), [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const load = () => api<Inbox>("/me/inbox").then(value => { setInbox(value); setError(""); }, cause => setError(message(cause)));
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, refreshMs);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setOpen(false); }, [url.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) { setOpen(false); if (event instanceof KeyboardEvent) button.current?.focus(); }
    };
    addEventListener("mousedown", close); addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [open]);
  async function read(ids?: string[]) {
    try { setInbox(await api<Inbox>("/me/inbox/read", "POST", ids ? { ids } : undefined)); } catch (cause) { setError(message(cause)); }
  }
  const unread = inbox?.unread || 0;
  const label = unread ? `Avisos, ${unread} sin leer` : "Avisos";
  return <div className="bell" ref={box}>
    <button ref={button} type="button" className="icon-button bell-button" aria-label={label} aria-expanded={open} aria-controls="bell-panel" onClick={() => { setOpen(!open); if (!open) void load(); }}>
      <Icon name="bell" filled={open}/>{unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <section id="bell-panel" className="bell-panel" aria-label="Avisos">
      <header className="bell-header">
        <h2>Avisos</h2>
        {unread > 0 && <button type="button" className="link-button" onClick={() => void read()}>Marcar todo como leído</button>}
      </header>
      {error && <p className="form-alert" role="alert">{error}</p>}
      {!inbox ? <p className="muted small" role="status">Cargando avisos…</p> : !inbox.items.length ? <p className="muted bell-empty">No tienes avisos. Aquí aparecerán los cambios que te afectan.</p>
        : <ul className="bell-list">{inbox.items.map(item => <li key={item.id} className={item.readAt ? undefined : "is-unread"}>
          <a href={item.path} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (!item.readAt) void read([item.id]);
            navigate(item.path);
          }}>
            <span className="bell-reason">{item.reason}{item.mandatory && <span className="sr-only"> (aviso obligatorio)</span>}</span>
            <time className="muted small" dateTime={item.createdAt} title={formatInstant(item.createdAt, "long")}>{timeAgo(item.createdAt)}</time>
            {!item.readAt && <span className="sr-only">Sin leer.</span>}
          </a>
        </li>)}</ul>}
      <footer className="bell-footer"><Link href="/preferencias#notificaciones"><Icon name="options" size={16}/>Elegir qué avisos recibo</Link></footer>
    </section>}
  </div>;
}
