import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Course, StudyProgram } from "@happy-learners/contracts";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { roleLabel, useSession } from "../session";
import { useWorkspace } from "../workspace";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import type { Hue } from "../model";
import { Menu } from "./Menu";
import { Modal, useFeedback } from "./feedback";
import { Field } from "./primitives";
import { courseConfiguration } from "../pages/course/context";

export type NavItem = { href: string; label: string; icon: IconName; active: boolean; hue: Hue };
/** The section or course being worked on: its pages open under it in the menu. Title and detail name it while the lists load. */
export type NavContext = { kind: "section" | "course"; id: string; title?: string; detail?: string; pages: NavItem[] };

export function Brand() {
  return <Link href="/inicio" className="brand" aria-label="Happy Learners, ir a Inicio"><span className="brand-mark" aria-hidden="true">hl</span><span className="brand-name">Happy Learners</span></Link>;
}

/** One navigation system: a menu in levels (area, section or course, page) that opens where you are; below 1024 px it is a drawer. */
export function AppShell({ context, children }: { context?: NavContext; children: ReactNode }) {
  const { url } = useNavigation();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [url.pathname]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("[aria-current=page], a, button")?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [open]);
  return <div className={`app-shell${open ? " drawer-open" : ""}`}>
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <TopBar menuButton={<button ref={toggle} type="button" className="icon-button menu-toggle" aria-label="Menú" aria-expanded={open} aria-controls="app-sidebar" onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"}/></button>}/>
    <div className="app-body">
      <aside id="app-sidebar" ref={panel} className="sidebar"><Sidebar context={context}/></aside>
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
      <Menu label={`Perfil de ${member.displayName || member.username}`} icon="user" text={member.displayName || member.username} items={[
        { label: `${roleLabel(member)}${organization?.name ? ` · ${organization.name}` : ""}`, icon: "shield", onSelect: () => {}, disabled: true },
        "separator",
        { label: "Cerrar sesión", icon: "logout", onSelect: logout },
      ]}/>
    </div>
  </header>;
}

type Category = "sections" | "courses";
const openKey = "hl-menu-open";
/** Which areas of the menu are open, for this tab only; the area of the current section or course always opens. */
function useOpenAreas(current?: Category) {
  const [open, setOpen] = useState<Record<Category, boolean>>(() => {
    try { return { sections: true, courses: true, ...JSON.parse(sessionStorage.getItem(openKey) || "{}") }; } catch { return { sections: true, courses: true }; }
  });
  useEffect(() => { if (current && !open[current]) setOpen(value => ({ ...value, [current]: true })); }, [current]);
  useEffect(() => { try { sessionStorage.setItem(openKey, JSON.stringify(open)); } catch { /* Private mode: the menu just opens as it was by default. */ } }, [open]);
  return [open, (area: Category) => setOpen(value => ({ ...value, [area]: !value[area] }))] as const;
}

function Sidebar({ context }: { context?: NavContext }) {
  const { member, organization } = useSession();
  const { url } = useNavigation();
  const path = url.pathname.replace(/\/+$/, "") || "/inicio", admin = member.role === "admin";
  const { sections, courses } = useWorkspace(member.id, context?.id);
  const area: Category | undefined = context?.kind === "section" ? "sections" : context?.kind === "course" ? "courses" : undefined;
  const [open, toggle] = useOpenAreas(area);
  const [creating, setCreating] = useState(false);
  const page = (item: NavItem) => <li key={item.href}><Link href={item.href} className={`tone-${item.hue}`} aria-current={item.active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={20} filled={item.active}/></span><span>{item.label}</span></Link></li>;
  const nested = (label: string, kind: NavContext["kind"], id: string) => context?.kind === kind && context.id === id
    ? <nav aria-label={label}><ul className="nav-pages">{context.pages.map(item => <li key={item.href}><Link href={item.href} className={`tone-${item.hue}`} aria-current={item.active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={16} filled={item.active}/></span><span>{item.label}</span></Link></li>)}</ul></nav>
    : null;
  const byName = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });
  const listedSections = (sections || []).filter(item => item.status === "active" && item.course.status === "active" || context?.kind === "section" && context.id === item.id)
    .sort((a, b) => byName(a.course.title, b.course.title) || byName(a.name, b.name));
  const listedCourses = (courses || []).filter(item => item.status === "active" || context?.kind === "course" && context.id === item.id).sort((a, b) => byName(a.title, b.title));
  const pending = (kind: NavContext["kind"], list: { id: string }[]) => context?.kind === kind && !list.some(item => item.id === context.id)
    ? [{ id: context.id, title: context.title || "Cargando…", detail: context.detail }] : [];
  return <div className="sidebar-inner">
    {organization?.name && <div className="sidebar-context mobile-only"><span className="sidebar-eyebrow">Organización</span><strong>{organization.name}</strong></div>}
    <nav aria-label="Navegación principal"><ul className="nav-tree">
      {page({ href: "/inicio", label: "Inicio", icon: "home", hue: "violet", active: path === "/inicio" })}
      <Area label="Docencia" toggleLabel="Mostrar las secciones" href="/secciones" icon="calendar" hue="coral" active={path === "/secciones"} open={open.sections} onToggle={() => toggle("sections")}
        add={admin ? <button type="button" className="nav-action" aria-label="Agregar una sección" title="Agregar una sección" onClick={() => setCreating(true)}><Icon name="plus" size={16}/></button> : undefined}
        empty={sections && !listedSections.length ? admin ? "Aún no hay secciones activas." : "Aún no tienes secciones asignadas." : undefined} loading={!sections}>
        {[...listedSections.map(item => ({ id: item.id, title: item.name, detail: item.course.title })), ...pending("section", sections ? listedSections : [])].map(item =>
          <Branch key={item.id} href={`/secciones/${item.id}`} title={item.title} detail={item.detail} current={context?.kind === "section" && context.id === item.id}>{nested("Navegación de la sección", "section", item.id)}</Branch>)}
      </Area>
      <Area label="Cursos" toggleLabel="Mostrar los cursos" href="/cursos" icon="courses" hue="sky" active={path === "/cursos" || path === "/cursos/nuevo"} open={open.courses} onToggle={() => toggle("courses")}
        add={admin ? <Link href="/cursos/nuevo" className="nav-action" aria-label="Agregar un curso" title="Agregar un curso"><Icon name="plus" size={16}/></Link> : undefined}
        empty={courses && !listedCourses.length ? admin ? "Aún no hay cursos activos." : "Aún no tienes cursos asignados." : undefined} loading={!courses}>
        {[...listedCourses.map(item => ({ id: item.id, title: item.title, detail: undefined as string | undefined })), ...pending("course", courses ? listedCourses : [])].map(item =>
          <Branch key={item.id} href={`/cursos/${item.id}`} title={item.title} detail={item.detail} current={context?.kind === "course" && context.id === item.id}>{nested("Navegación del curso", "course", item.id)}</Branch>)}
      </Area>
      {page({ href: "/biblioteca", label: "Biblioteca", icon: "library", hue: "teal", active: path === "/biblioteca" })}
      {page({ href: "/ayuda", label: "Ayuda", icon: "help", hue: "amber", active: path === "/ayuda" })}
    </ul></nav>
    {admin && <nav aria-label="Administración" className="sidebar-secondary"><span className="sidebar-eyebrow">Administración</span><ul className="nav-tree">
      {page({ href: "/organizacion", label: "Organización", icon: "settings", hue: "coral", active: path === "/organizacion" })}
      {page({ href: "/educadores", label: "Educadores", icon: "users", hue: "pink", active: path === "/educadores" })}
      {page({ href: "/configuracion-academica", label: "Configuración académica", icon: "grid", hue: "green", active: path === "/configuracion-academica" })}
    </ul></nav>}
    <p className="sidebar-note"><Icon name="shield" size={16}/><span>Demostración con datos ficticios</span></p>
    {creating && <NewSection courses={courses || []} preferred={context?.kind === "course" ? context.id : sections?.find(item => item.id === context?.id)?.courseId} onClose={() => setCreating(false)}/>}
  </div>;
}

/** An area of the menu that lists sections or courses: its name opens the full list, the chevron shows or hides them here. */
function Area({ label, toggleLabel, href, icon, hue, active, open, onToggle, add, empty, loading, children }: { label: string; toggleLabel: string; href: string; icon: IconName; hue: Hue; active: boolean; open: boolean; onToggle: () => void; add?: ReactNode; empty?: string; loading: boolean; children: ReactNode }) {
  const id = useId();
  return <li className="nav-area">
    <div className="nav-area-row">
      <Link href={href} className={`tone-${hue}`} aria-current={active ? "page" : undefined}><span className="nav-icon"><Icon name={icon} size={20} filled={active}/></span><span>{label}</span></Link>
      {add}
      <button type="button" className="nav-action nav-chevron" aria-label={toggleLabel} title={open ? "Ocultar" : "Mostrar"} aria-expanded={open} aria-controls={id} onClick={onToggle}><Icon name="chevronDown" size={16}/></button>
    </div>
    <ul id={id} className="nav-branches" hidden={!open}>
      {loading ? <li className="nav-placeholder" aria-hidden="true"><span className="skeleton-line"/><span className="skeleton-line"/></li> : empty ? <li className="nav-empty">{empty}</li> : children}
    </ul>
  </li>;
}

/** A section or a course in the menu; the current one shows its pages beneath it. */
function Branch({ href, title, detail, current, children }: { href: string; title: string; detail?: string; current: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (current) ref.current?.scrollIntoView?.({ block: "nearest" }); }, [current]);
  return <li ref={ref} className={`nav-branch${current ? " is-current" : ""}`}>
    <Link href={href} aria-current={current ? "true" : undefined} aria-label={detail ? `${title}, ${detail}` : undefined} title={detail ? `${title} · ${detail}` : title}><span className="nav-branch-text"><span>{title}</span>{detail && <small>{detail}</small>}</span></Link>
    {children}
  </li>;
}

/** Administration creates a section from anywhere: it picks the course, names the section and lands on it. */
export function NewSection({ courses, preferred, onClose }: { courses: Course[]; preferred?: string; onClose: () => void }) {
  const { navigate } = useNavigation();
  const { toast } = useFeedback();
  const [programs, setPrograms] = useState<StudyProgram[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { api<{ programs: StudyProgram[] }>("/programs").then(result => setPrograms(result.programs), () => setPrograms([])); }, []);
  const eligible = programs ? courses.filter(course => course.status === "active" && courseConfiguration(course, programs.find(item => item.id === course.programId) || null).settings.attendance).sort((a, b) => a.title.localeCompare(b.title, "es")) : [];
  const [courseId, setCourseId] = useState("");
  useEffect(() => { if (!courseId && eligible.length) setCourseId(eligible.some(item => item.id === preferred) ? preferred! : eligible.length === 1 ? eligible[0].id : ""); }, [eligible.length]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") || "").trim(), course = eligible.find(item => item.id === courseId);
    if (!course) return;
    setBusy(true); setError("");
    try {
      const { id } = await api<{ id: string }>(`/courses/${course.id}/groups`, "POST", { name });
      const pacing = courseConfiguration(course, programs?.find(item => item.id === course.programId) || null).pacing;
      toast({ message: `Sección «${name}» creada en ${course.title}. Asígnale sus educadores, sus estudiantes${pacing === "self-paced" ? " y su código" : " y su horario"}.` });
      onClose(); navigate(`/secciones/${id}`);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title="Nueva sección" onClose={onClose}>
    {!programs ? <p role="status" className="muted">Cargando cursos…</p> : !eligible.length
      ? <p className="muted">Ningún curso activo tiene las secciones activadas. Actívalas en la configuración del curso o de su programa.</p>
      : <form className="stack" onSubmit={create} aria-label="Nueva sección">
        {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
        <fieldset disabled={busy} className="stack">
          <Field label="Curso" hint="La sección imparte el plan y el contenido de este curso."><select value={courseId} onChange={event => setCourseId(event.target.value)} required><option value="">Elige un curso…</option>{eligible.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></Field>
          <Field label="Nombre de la sección"><input name="name" required maxLength={100} placeholder="Ej. 3.º A, sección de los martes" data-autofocus={courseId ? true : undefined}/></Field>
          <div className="button-row modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" disabled={!courseId}>{busy ? "Creando…" : "Crear sección"}</button></div>
        </fieldset>
      </form>}
  </Modal>;
}
