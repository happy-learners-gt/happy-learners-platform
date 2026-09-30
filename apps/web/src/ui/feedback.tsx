import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icons";

type ToastInput = { tone?: "success" | "error" | "info"; message: string; action?: { label: string; onSelect: () => void } };
type ToastItem = ToastInput & { id: number };
type ConfirmInput = { title: string; body?: ReactNode; confirm: string; cancel?: string; danger?: boolean };
type Feedback = { toast: (input: ToastInput) => void; confirm: (input: ConfirmInput) => Promise<boolean> };
const Context = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<(ConfirmInput & { resolve: (value: boolean) => void }) | null>(null);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setToasts(list => list.filter(item => item.id !== id)), []);
  const toast = useCallback((input: ToastInput) => {
    const id = ++counter.current;
    setToasts(list => [...list.slice(-2), { tone: "success", ...input, id }]);
    // Errors stay until dismissed so the recovery instructions can be read.
    if (input.tone !== "error") setTimeout(() => dismiss(id), input.action ? 8000 : 5000);
  }, [dismiss]);
  const confirm = useCallback((input: ConfirmInput) => new Promise<boolean>(resolve => setDialog({ ...input, resolve })), []);
  return <Context.Provider value={{ toast, confirm }}>
    {children}
    <div className="toast-region" role="region" aria-label="Notificaciones">
      {toasts.map(item => <div key={item.id} className={`toast ${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
        <Icon name={item.tone === "error" ? "alert" : item.tone === "info" ? "info" : "check"}/>
        <p>{item.message}</p>
        {item.action && <button type="button" className="toast-action" onClick={() => { item.action!.onSelect(); dismiss(item.id); }}>{item.action.label}</button>}
        <button type="button" className="icon-button" aria-label="Cerrar notificación" onClick={() => dismiss(item.id)}><Icon name="close" size={16}/></button>
      </div>)}
    </div>
    {dialog && <ConfirmDialog {...dialog} onClose={value => { dialog.resolve(value); setDialog(null); }}/>}
  </Context.Provider>;
}

export function useFeedback() {
  const value = useContext(Context);
  if (!value) throw new Error("FeedbackProvider is required");
  return value;
}

/** Modal built on the native dialog element: focus is contained, Escape cancels and focus returns afterwards. */
export function Modal({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const element = ref.current, previous = document.activeElement as HTMLElement | null;
    if (element && typeof element.showModal === "function" && !element.open) element.showModal();
    else element?.setAttribute("open", "");
    // showModal() focuses the first control (the close button); prefer the intended target or the first field.
    element?.querySelector<HTMLElement>("[data-autofocus], .modal-body input:not([type=hidden]), .modal-body select, .modal-body textarea")?.focus();
    return () => { previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`modal${wide ? " wide" : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}><Icon name="close"/></button></div>
    <div className="modal-body">{children}</div>
    {footer && <div className="modal-footer">{footer}</div>}
  </dialog>;
}

export function ConfirmDialog({ title, body, confirm, cancel = "Cancelar", danger, onClose }: ConfirmInput & { onClose: (value: boolean) => void }) {
  return <Modal title={title} onClose={() => onClose(false)} footer={<>
    {/* Destructive confirmations start on the safe choice. */}
    <button type="button" className="button secondary" data-autofocus={danger || undefined} onClick={() => onClose(false)}>{cancel}</button>
    <button type="button" className={`button ${danger ? "danger" : "primary"}`} data-autofocus={!danger || undefined} onClick={() => onClose(true)}>{confirm}</button>
  </>}>{body && <div className="confirm-body">{body}</div>}</Modal>;
}
