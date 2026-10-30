import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import type { Course, MyPanel, SectionSummary, StudyProgram } from "@happy-learners/contracts";
import { fictional } from "@happy-learners/domain";
import { api, message } from "../api";
import { Link, useNavigation } from "../navigation";
import { roleLabel, useSession } from "../session";
import { useWorkspace } from "../workspace";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import type { Hue } from "../model";
import { useTableLabels } from "./responsiveTables";
import { Menu } from "./Menu";
import { Bell } from "./Bell";
import { Modal, useFeedback } from "./feedback";
import { Field } from "./primitives";
import { courseConfiguration } from "../pages/course/context";
import { AgreementBanner } from "../pages/legal";
import { ContractBanner } from "../pages/my-contracts";

export function Brand() {
  return <Link href="/inicio" className="brand" aria-label="Happy Learners, ir a Inicio"><span className="brand-mark" aria-hidden="true">hl</span><span className="brand-name">Happy Learners</span></Link>;
}

/** One navigation system, mounted once for every page: a menu in levels that opens where you are; below 1024 px it is a drawer. */
export function AppShell({ children }: { children: ReactNode }) {
  const { url } = useNavigation();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null), main = useRef<HTMLElement>(null);
  useTableLabels(main);
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
      <aside id="app-sidebar" ref={panel} className="sidebar"><Sidebar/></aside>
      {open && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setOpen(false)}/>}
      <main id="main" ref={main} tabIndex={-1} className="main"><ContractBanner/><AgreementBanner/>{children}</main>
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
      <Bell/>
      <Link href="/ayuda" className="icon-button" aria-label="Ayuda"><Icon name="help"/></Link>
      <Menu label={`Perfil de ${member.displayName || member.username}`} icon="user" text={member.displayName || member.username} items={[
        { label: `${roleLabel(member)}${organization?.name ? ` · ${organization.name}` : ""}`, icon: "shield", onSelect: () => {}, disabled: true },
        { label: "Mi cuenta", icon: "user", onSelect: () => navigate("/mi-cuenta/perfil") },
        { label: "Ver mi perfil público", icon: "eye", onSelect: () => navigate(`/equipo/${member.id}`) },
        { label: "Ayuda", icon: "help", onSelect: () => navigate("/ayuda") },
        "separator",
        { label: "Cerrar sesión", icon: "logout", onSelect: logout },
      ]}/>
    </div>
  </header>;
}

type Page = { href: string; label: string; icon: IconName; hue: Hue; active: boolean };
const openKey = "hl-menu-tree";
/** Opening a course or a section closes its siblings: one course and one section open at a time. */
const accordion = (key: string) => key.startsWith("course:") ? "course:" : key.startsWith("section:") ? "section:" : null;
function reveal(open: ReadonlySet<string>, keys: string[]) {
  const next = new Set(open);
  for (const key of keys) {
    const group = accordion(key);
    if (group) for (const other of next) if (other.startsWith(group) && other !== key) next.delete(other);
    next.add(key);
  }
  return next;
}
/** What is open in the menu, for this tab only; the way to the current page always opens. */
function useTree(trail: string[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    try { return reveal(new Set(JSON.parse(sessionStorage.getItem(openKey) || '["courses"]') as string[]), trail); } catch { return reveal(new Set(["courses"]), trail); }
  });
  const path = trail.join("|");
  useEffect(() => { setOpen(value => trail.every(key => value.has(key)) ? value : reveal(value, trail)); }, [path]);
  useEffect(() => { try { sessionStorage.setItem(openKey, JSON.stringify([...open])); } catch { /* Private mode: the menu opens where you are. */ } }, [open]);
  const toggle = (key: string) => setOpen(value => { if (!value.has(key)) return reveal(value, [key]); const next = new Set(value); next.delete(key); return next; });
  const expand = (key: string) => setOpen(value => value.has(key) ? value : reveal(value, [key]));
  return [open, toggle, expand] as const;
}

const byName = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

function Sidebar() {
  const { member, organization } = useSession();
  const { url } = useNavigation();
  const path = url.pathname.replace(/\/+$/, "") || "/inicio", admin = member.role === "admin";
  const [, first, second, third] = path.split("/");
  const courseRoute = first === "cursos" && second && second !== "nuevo" ? second : undefined;
  const sectionRoute = first === "secciones" && second ? second : undefined;
  const { sections, courses, programs } = useWorkspace(member.id, courseRoute || sectionRoute);
  const current = sectionRoute ? sections?.find(item => item.id === sectionRoute) : undefined;
  const currentCourse = courseRoute || current?.courseId;
  const trail = ["courses", ...currentCourse ? [`course:${currentCourse}`] : [], ...current || courseRoute && third === "secciones" ? [`sections:${currentCourse}`] : [], ...current ? [`section:${current.id}`] : []];
  const [open, toggle, expand] = useTree(trail);
  const [creating, setCreating] = useState<string | null>(null);
  const [panels, setPanels] = useState<MyPanel[]>([]);
  useEffect(() => { api<{ panels?: MyPanel[] }>("/me/panels").then(result => setPanels(Array.isArray(result.panels) ? result.panels : [])).catch(() => setPanels([])); }, [member.id]);
  const page = (item: Page, size = 20) => <li key={item.href}><Link href={item.href} className={`tree-link tone-${item.hue}`} aria-current={item.active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={size} filled={item.active}/></span><span className="tree-label">{item.label}</span></Link></li>;
  // On its own page, choosing a level shows or hides it, every time; from anywhere else it opens it and goes there.
  const select = (key: string, href: string) => (event: MouseEvent<HTMLAnchorElement>) => { if (path === href) { event.preventDefault(); toggle(key); } else expand(key); };
  const listedCourses = (courses || []).filter(item => item.status === "active" || item.id === currentCourse).sort((a, b) => byName(a.title, b.title));
  const sectionsOf = (courseId: string) => (sections || []).filter(item => item.courseId === courseId && (item.status === "active" || item.id === current?.id)).sort((a, b) => byName(a.name, b.name));
  const settingsOf = (course: Course | undefined) => course && programs ? courseConfiguration(course, programs.find(item => item.id === course.programId) || null).settings : null;
  const coursePages = (course: Course) => {
    const base = `/cursos/${course.id}`, area = course.id === courseRoute ? third === "lecciones" ? "contenido" : third || "" : undefined;
    const attendance = !!settingsOf(course)?.attendance;
    const listed = sectionsOf(course.id), key = `sections:${course.id}`, href = `${base}/secciones`;
    return <>
      {page({ href: base, label: "Resumen", icon: "overview", hue: "violet", active: area === "" }, 16)}
      {page({ href: `${base}/contenido`, label: "Contenido", icon: "content", hue: "sky", active: area === "contenido" }, 16)}
      {page({ href: `${base}/plan`, label: "Plan curricular", icon: "spark", hue: "green", active: area === "plan" }, 16)}
      {page({ href: `${base}/evaluacion`, label: "Evaluación", icon: "table", hue: "amber", active: area === "evaluacion" }, 16)}
      {page({ href: `${base}/asistente`, label: "Planificar con IA", icon: "sparkles", hue: "violet", active: area === "asistente" }, 16)}
      {page({ href: `${base}/biblioteca`, label: "Biblioteca del curso", icon: "library", hue: "teal", active: area === "biblioteca" }, 16)}
      {(attendance || listed.length > 0) && <Node id={key} href={href} label="Secciones" icon="users" hue="pink" size={16} open={open.has(key)} active={path === href} current={course.id === current?.courseId}
        toggleLabel={`Mostrar las secciones de ${course.title}`} onToggle={() => toggle(key)} onSelect={select(key, href)}
        add={admin && attendance && course.status === "active" ? <button type="button" className="nav-action" aria-label={`Agregar una sección a ${course.title}`} title="Agregar una sección" onClick={() => setCreating(course.id)}><Icon name="plus" size={16}/></button> : undefined}>
        {!sections ? <Placeholder/> : listed.length ? listed.map(sectionNode)
          : <li className="nav-empty">{admin ? "Aún no tiene secciones." : "No impartes secciones de este curso."}</li>}
      </Node>}
      {page({ href: `${base}/configuracion`, label: "Configuración", icon: "settings", hue: "amber", active: area === "configuracion" }, 16)}
    </>;
  };
  const sectionNode = (section: SectionSummary) => {
    const base = `/secciones/${section.id}`, key = `section:${section.id}`, here = section.id === current?.id, area = here ? third || "" : undefined;
    const settings = settingsOf(courses?.find(item => item.id === section.courseId));
    const plan: Page[] = settings?.sectionFreedom && settings.sectionFreedom !== "shared" ? [{ href: `${base}/plan`, label: "Plan de la sección", icon: "content", hue: "sky", active: area === "plan" }] : [];
    const pages: Page[] = section.pacing === "self-paced" ? [
      { href: base, label: "Resumen", icon: "overview", hue: "violet", active: area === "" },
      ...plan,
      { href: `${base}/avance`, label: "Avance", icon: "check", hue: "green", active: area === "avance" },
      { href: `${base}/estudiantes`, label: "Estudiantes", icon: "users", hue: "pink", active: area === "estudiantes" },
    ] : [
      { href: base, label: "Resumen", icon: "overview", hue: "violet", active: area === "" },
      { href: `${base}/clases`, label: "Cronograma", icon: "calendar", hue: "coral", active: area === "clases" },
      ...plan,
      { href: `${base}/horario`, label: "Horario", icon: "clock", hue: "violet", active: area === "horario" },
      { href: `${base}/estudiantes`, label: "Estudiantes", icon: "users", hue: "pink", active: area === "estudiantes" },
    ];
    pages.push({ href: `${base}/notas`, label: "Notas", icon: "table", hue: "amber", active: area === "notas" });
    if (section.workGroups ?? (settings?.attendance && settings.workGroups)) pages.push({ href: `${base}/grupos`, label: "Grupos", icon: "team", hue: "teal", active: area === "grupos" });
    return <Node key={section.id} id={key} href={base} label={section.name} detail={section.status === "archived" ? "Cerrada" : undefined} open={open.has(key)} current={here} region={here ? "Navegación de la sección" : undefined}
      toggleLabel={`Mostrar las páginas de ${section.name}`} onToggle={() => toggle(key)} onSelect={select(key, base)}>
      {pages.map(item => page(item, 16))}
    </Node>;
  };
  return <div className="sidebar-inner">
    {organization?.name && <div className="sidebar-context mobile-only"><span className="sidebar-eyebrow">Organización</span><strong>{organization.name}</strong></div>}
    <nav aria-label="Navegación principal"><ul className="nav-tree">
      {page({ href: "/inicio", label: "Inicio", icon: "home", hue: "violet", active: path === "/inicio" })}
      {page({ href: "/agenda", label: "Agenda", icon: "calendar", hue: "coral", active: path === "/agenda" })}
      {page({ href: "/horas", label: admin ? "Horas efectivas" : "Mis horas", icon: "clock", hue: "green", active: path === "/horas" })}
      <Node id="courses" href="/cursos" label="Cursos" icon="courses" hue="sky" open={open.has("courses")} active={path === "/cursos" || path === "/cursos/nuevo"}
        toggleLabel="Mostrar los cursos" onToggle={() => toggle("courses")} onSelect={select("courses", "/cursos")}
        add={admin ? <Link href="/cursos/nuevo" className="nav-action" aria-label="Agregar un curso" title="Agregar un curso"><Icon name="plus" size={16}/></Link> : undefined}>
        {!courses ? <Placeholder/> : listedCourses.length ? listedCourses.map(course => {
          const key = `course:${course.id}`, href = `/cursos/${course.id}`;
          return <Node key={course.id} id={key} href={href} label={course.title} detail={course.status === "archived" ? "Archivado" : undefined} open={open.has(key)} current={course.id === currentCourse}
            region={course.id === courseRoute ? "Navegación del curso" : undefined} toggleLabel={`Mostrar las páginas de ${course.title}`} onToggle={() => toggle(key)} onSelect={select(key, href)}>
            {coursePages(course)}
          </Node>;
        }) : <li className="nav-empty">{admin ? "Aún no hay cursos activos." : "Aún no tienes cursos asignados."}</li>}
      </Node>
      {panels.length > 0 && page({ href: "/tribunales", label: "Mis tribunales", icon: "team", hue: "violet", active: path === "/tribunales" })}
      {page({ href: "/biblioteca", label: "Biblioteca", icon: "library", hue: "teal", active: path === "/biblioteca" })}
      {page({ href: "/equipo", label: "Equipo", icon: "team", hue: "pink", active: path === "/equipo" || path.startsWith("/equipo/") })}
      {page({ href: "/ayuda", label: "Ayuda", icon: "help", hue: "amber", active: path === "/ayuda" })}
    </ul></nav>
    {admin && <nav aria-label="Administración" className="sidebar-secondary"><span className="sidebar-eyebrow">Administración</span><ul className="nav-tree">
      {page({ href: "/organizacion", label: "Organización", icon: "settings", hue: "coral", active: path === "/organizacion" })}
      {page({ href: "/organizacion/calendario", label: "Calendario institucional", icon: "calendar", hue: "amber", active: path === "/organizacion/calendario" })}
      {page({ href: "/educadores", label: "Educadores", icon: "users", hue: "pink", active: path === "/educadores" })}
      {page({ href: "/contratos", label: "Contratos y políticas", icon: "file", hue: "violet", active: path === "/contratos" })}
      {page({ href: "/perfiles", label: "Revisión de perfiles", icon: "check", hue: "sky", active: path === "/perfiles" })}
      {page({ href: "/configuracion-academica", label: "Configuración académica", icon: "grid", hue: "green", active: path === "/configuracion-academica" })}
      {page({ href: "/roles-y-accesos", label: "Roles y accesos", icon: "shield", hue: "violet", active: path === "/roles-y-accesos" })}
      {page({ href: "/notificaciones", label: "Notificaciones", icon: "send", hue: "teal", active: path === "/notificaciones" })}
    </ul></nav>}
    {fictional(member.organizationId) && <p className="sidebar-note"><Icon name="shield" size={16}/><span>Demostración con datos ficticios</span></p>}
    {creating && <NewSection courses={courses || []} preferred={creating} onClose={() => setCreating(null)}/>}
  </div>;
}

function Placeholder() {
  return <li className="nav-placeholder" aria-hidden="true"><span className="skeleton-line"/><span className="skeleton-line"/></li>;
}

/**
 * A level of the menu that opens like an accordion: its name goes to its page, the chevron shows or hides what is under it.
 * Its contents stay mounted, so opening and closing only animates their height.
 */
function Node({ id, href, label, detail, icon, hue = "violet", size = 20, open, active = false, current = false, region, toggleLabel, onToggle, onSelect, add, children }: {
  id: string; href: string; label: string; detail?: string; icon?: IconName; hue?: Hue; size?: number; open: boolean; active?: boolean; current?: boolean; region?: string;
  toggleLabel: string; onToggle: () => void; onSelect: (event: MouseEvent<HTMLAnchorElement>) => void; add?: ReactNode; children: ReactNode;
}) {
  const group = `tree-${useId()}`, row = useRef<HTMLLIElement>(null);
  // Only the sidebar scrolls: scrollIntoView would also shift the clipped groups sideways.
  useEffect(() => {
    const item = row.current, sidebar = item?.closest(".sidebar");
    if (!region || !item || !sidebar) return;
    const top = item.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    if (top < 0 || top > sidebar.clientHeight - 80) sidebar.scrollTop += top - 8;
  }, [region]);
  return <li ref={row} className={`tree-node${current ? " is-current" : ""}${open ? " is-open" : ""}`}>
    <div className="tree-row">
      <Link href={href} className={`tree-link tone-${hue}`} aria-current={active ? "page" : current ? "true" : undefined} aria-label={detail ? `${label}, ${detail}` : undefined} title={label} onClick={onSelect}>
        {icon && <span className="nav-icon"><Icon name={icon} size={size} filled={active}/></span>}
        <span className="tree-label">{label}{detail && <small>{detail}</small>}</span>
      </Link>
      {add}
      <button type="button" className="nav-action nav-chevron" aria-label={toggleLabel} title={open ? "Ocultar" : "Mostrar"} aria-expanded={open} aria-controls={group} onClick={onToggle}><Icon name="chevronDown" size={16}/></button>
    </div>
    <div id={group} className="tree-group" role={region ? "navigation" : undefined} aria-label={region}><ul>{children}</ul></div>
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
