import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigation } from "../navigation";
import { roleLabel, useSession } from "../session";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import type { Hue } from "../model";
import { Menu } from "./Menu";

export type NavItem = { href: string; label: string; icon: IconName; active: boolean; hue: Hue };
export type SidebarModel = { label: string; back?: { href: string; label: string }; title?: string; subtitle?: string; hue?: Hue; items: NavItem[]; secondary?: { label: string; items: NavItem[] } };

export function Brand() {
  return <Link href="/inicio" className="brand" aria-label="Happy Learners, ir a Inicio"><span className="brand-mark" aria-hidden="true">hl</span><span className="brand-name">Happy Learners</span></Link>;
}

/** One navigation system: the sidebar changes context (global or course); below 1024 px it opens as a drawer. */
export function AppShell({ sidebar, children }: { sidebar: SidebarModel; children: ReactNode }) {
  const { url } = useNavigation();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [url.pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a,button")?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [open]);
  return <div className={`app-shell${open ? " drawer-open" : ""}`}>
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <TopBar menuButton={<button ref={toggle} type="button" className="icon-button menu-toggle" aria-label="Menú" aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"}/></button>}/>
    <div className="app-body">
      <aside id="app-sidebar" ref={panel} className="sidebar"><ContextSidebar model={sidebar}/></aside>
      {open && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setOpen(false)}/>}
      <main id="main" tabIndex={-1} className="main">{children}</main>
    </div>
  </div>;
}

function TopBar({ menuButton }: { menuButton: ReactNode }) {
  const { member, organization, logout } = useSession();
  const { url, navigate } = useNavigation();
  const [query, setQuery] = useState(url.pathname === "/buscar" ? url.searchParams.get("q") || "" : "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !target.closest("input,textarea,select,[contenteditable=true]")) { event.preventDefault(); input.current?.focus(); }
    };
    addEventListener("keydown", shortcut);
    return () => removeEventListener("keydown", shortcut);
  }, []);
  return <header className="topbar">
    {menuButton}
    <Brand/>
    {organization?.name && <span className="org-chip" title="Organización actual"><span className="sr-only">Organización: </span>{organization.name}</span>}
    <form role="search" className="topbar-search" onSubmit={event => { event.preventDefault(); if (query.trim()) navigate(`/buscar?q=${encodeURIComponent(query.trim())}`); }}>
      <label htmlFor="global-search" className="sr-only">Buscar cursos, lecciones y recursos</label>
      <Icon name="search" size={18}/>
      <input ref={input} id="global-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar" autoComplete="off" maxLength={120}/>
      <kbd aria-hidden="true">/</kbd>
    </form>
    <div className="topbar-actions">
      <Link href="/ayuda" className="icon-button" aria-label="Ayuda"><Icon name="help"/></Link>
      <Menu label={`Perfil de ${member.username}`} icon="user" text={member.username} items={[
        { label: `${roleLabel(member)}${organization?.name ? ` · ${organization.name}` : ""}`, icon: "shield", onSelect: () => {}, disabled: true },
        "separator",
        { label: "Cerrar sesión", icon: "logout", onSelect: logout },
      ]}/>
    </div>
  </header>;
}

export function ContextSidebar({ model }: { model: SidebarModel }) {
  const { organization } = useSession();
  return <div className="sidebar-inner">
    {model.title ? <div className={`sidebar-context tone-${model.hue || "violet"}`}><span className="context-avatar" aria-hidden="true">{model.title.trim().charAt(0).toUpperCase()}</span><span><span className="sidebar-eyebrow">{model.subtitle}</span><strong>{model.title}</strong></span></div>
      : organization?.name && <div className="sidebar-context mobile-only"><span className="sidebar-eyebrow">Organización</span><strong>{organization.name}</strong></div>}
    <nav aria-label={model.label}>{model.back && <Link href={model.back.href} className="sidebar-back"><Icon name="back" size={18}/><span>{model.back.label}</span></Link>}<ul>{model.items.map(item => <li key={item.href}><Link href={item.href} className={`tone-${item.hue}`} aria-current={item.active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={20} filled={item.active}/></span><span>{item.label}</span></Link></li>)}</ul></nav>
    {model.secondary && <nav aria-label={model.secondary.label} className="sidebar-secondary"><span className="sidebar-eyebrow">{model.secondary.label}</span><ul>{model.secondary.items.map(item => <li key={item.href}><Link href={item.href} className={`tone-${item.hue}`} aria-current={item.active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={20} filled={item.active}/></span><span>{item.label}</span></Link></li>)}</ul></nav>}
    <p className="sidebar-note"><Icon name="shield" size={16}/><span>Demostración con datos ficticios</span></p>
  </div>;
}
