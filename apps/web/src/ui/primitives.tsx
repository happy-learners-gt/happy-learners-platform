import { cloneElement, useId } from "react";
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
import { Link } from "../navigation";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { fullDate, timeAgo } from "../model";
import type { Hue } from "../model";

export type Crumb = { label: string; href?: string };
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return <nav className="breadcrumbs" aria-label="Ubicación"><ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>
    {item.href && index < items.length - 1 ? <Link href={item.href}>{item.label}</Link> : <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>}
  </li>)}</ol></nav>;
}

/** Title row for every page: at most one primary action, secondary actions to its left. */
export function PageHeader({ title, description, crumbs, meta, actions, primary }: { title: ReactNode; description?: ReactNode; crumbs?: Crumb[]; meta?: ReactNode; actions?: ReactNode; primary?: ReactNode }) {
  return <header className="page-header">
    {crumbs && <Breadcrumbs items={crumbs}/>}
    <div className="page-header-row">
      <div className="page-header-text"><h1>{title}</h1>{description && <p className="page-description">{description}</p>}{meta && <div className="page-meta">{meta}</div>}</div>
      {(actions || primary) && <div className="page-actions">{actions}{primary}</div>}
    </div>
  </header>;
}

type ActionProps = { icon?: IconName; href?: string; children: ReactNode; busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>;
/** The single most important action on a screen. Renders a link when given href. */
export function PrimaryAction({ icon, href, children, busy, className = "", ...props }: ActionProps) {
  const content = <>{icon && <Icon name={icon} size={18}/>}<span>{children}</span></>;
  if (href) return <Link href={href} className={`button primary ${className}`}>{content}</Link>;
  return <button type="button" className={`button primary ${className}`} aria-busy={busy || undefined} {...props}>{content}</button>;
}
export function Button({ icon, href, children, busy, className = "", variant = "secondary", ...props }: ActionProps & { variant?: "secondary" | "ghost" | "danger" }) {
  const content = <>{icon && <Icon name={icon} size={18}/>}<span>{children}</span></>;
  if (href) return <Link href={href} className={`button ${variant} ${className}`}>{content}</Link>;
  return <button type="button" className={`button ${variant} ${className}`} aria-busy={busy || undefined} {...props}>{content}</button>;
}

export function EmptyState({ icon = "spark", title, children, action, compact, level = 2 }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean; level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return <div className={`empty-state${compact ? " compact" : ""}`}><span className="empty-icon"><Icon name={icon} size={compact ? 20 : 24}/></span><Heading>{title}</Heading>{children && <p>{children}</p>}{action && <div className="empty-action">{action}</div>}</div>;
}

export type Tone = "neutral" | "success" | "warning" | "info" | "danger";
export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Skeleton({ lines = 3, card }: { lines?: number; card?: boolean }) {
  return <div className={card ? "skeleton-card" : "skeleton-block"} aria-hidden="true">{Array.from({ length: lines }, (_, i) => <span key={i} className="skeleton-line" style={{ width: `${[72, 94, 58, 86, 40][i % 5]}%` }}/>)}</div>;
}
export function Loading({ label, cards = 0, lines = 4 }: { label: string; cards?: number; lines?: number }) {
  return <div className="loading-region"><p className="sr-only" role="status">{label}</p>{cards ? <div className="card-grid">{Array.from({ length: cards }, (_, i) => <Skeleton key={i} card lines={3}/>)}</div> : <Skeleton lines={lines}/>}</div>;
}

export function ErrorState({ title = "No pudimos cargar esta sección", error, retry }: { title?: string; error: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><Icon name="alert"/><div><strong>{title}</strong><p>{error}</p>{retry && <button type="button" className="button secondary small" onClick={retry}>Volver a intentar</button>}</div></div>;
}

export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string; optional?: boolean; children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }> }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return <div className="field"><label htmlFor={id}>{label}{optional && <span className="optional"> (opcional)</span>}</label>
    {cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
    {hint && <small id={`${id}-hint`} className="hint">{hint}</small>}
    {error && <small id={`${id}-error`} className="field-error">{error}</small>}
  </div>;
}

export function Updated({ value, prefix = "Actualizado" }: { value?: string; prefix?: string }) {
  return value ? <time className="updated" dateTime={value} title={fullDate(value)}>{prefix} {timeAgo(value)}</time> : null;
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max ? Math.round((value / max) * 100) : 0;
  return <div className="progress"><div className="progress-text"><span>{label}</span><span>{max ? `${value} de ${max}` : "Sin lecciones"}</span></div><div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max || 1} aria-valuenow={value} aria-valuetext={max ? `${value} de ${max}` : "Sin lecciones"}><span style={{ width: `${percent}%` }}/></div></div>;
}

export type Stat = { label: string; value: number | string; icon: IconName; hue: Hue };
/** Coloured counters: the icon chip carries the hue; label and value stay high-contrast text. */
export function StatTiles({ items, className = "" }: { items: Stat[]; className?: string }) {
  return <dl className={`stat-tiles ${className}`}>{items.map(item => <div key={item.label} className={`stat-tile tone-${item.hue}`}>
    <span className="stat-icon" aria-hidden="true"><Icon name={item.icon} size={18}/></span>
    <dt>{item.label}</dt><dd>{item.value}</dd>
  </div>)}</dl>;
}

export function Section({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return <section className={`panel ${className}`} aria-labelledby={id}><div className="panel-header"><h2 id={id}>{title}</h2>{action}</div>{children}</section>;
}
