import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Lesson, Member, Organization } from "@happy-learners/contracts";
import { Workspace, PublicLesson } from "./Workspace";
import { api, ApiError } from "./api";
import { Link, NavigationProvider, useNavigation, useUnsavedChanges } from "./navigation";

function Mark() { return <span className="brand-mark" aria-hidden="true">h<span>l</span></span>; }
export function App() { return <NavigationProvider><Application/></NavigationProvider>; }
function Application() {
  const { url } = useNavigation();
  const code = url.searchParams.get("code") || (url.pathname.startsWith("/aprender/") ? url.pathname.slice(10) : "");
  return code ? <PublicLesson key={code} code={code}/> : <AuthenticatedApp/>;
}

function AuthenticatedApp() {
  const { url, navigate } = useNavigation();
  const path = url.searchParams.has("biblioteca") ? "/biblioteca" : url.pathname;
  const home = path === "/" || path === "/inicio";
  const content = path.startsWith("/contenido");
  const [member, setMember] = useState<Member | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("educador-demo");
  const [password, setPassword] = useState("");
  async function refresh() {
    const session = await api<{ member: Member }>("/session");
    const [org, catalog] = await Promise.all([api<{ organization: Organization }>("/organization"), api<{ lessons: Lesson[] }>("/lessons")]);
    setMember(session.member); setOrganization(org.organization); setLessons(catalog.lessons);
  }
  useEffect(() => { refresh().catch(e => { if (!(e instanceof ApiError && e.status === 401)) setError(e.message); }).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (member && (home || path === "/contenido/publicadas")) {
      let active = true;
      api<{ lessons: Lesson[] }>("/lessons").then(data => { if (active) setLessons(data.lessons); }).catch(e => { if (active) setError(e.message); });
      return () => { active = false; };
    }
  }, [path, member?.id]);
  useEffect(() => {
    if (loading) return;
    const heading = document.querySelector<HTMLElement>("main h1");
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); document.title = `${heading.textContent} · Happy Learners`; }
    window.scrollTo(0, 0);
  }, [path, member?.id, loading]);
  useEffect(() => { setError(""); setNotice(""); }, [path]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setMember(null); setOrganization(null); setLessons([]); }
      setError(e instanceof Error ? e.message : "Vuelve a intentar.");
    } finally { setBusy(false); }
  }
  function login(event: FormEvent) {
    event.preventDefault(); void action(async () => { await api("/login", "POST", { username, password }); setPassword(""); await refresh(); });
  }
  function logout() {
    if (!navigate("/inicio?salir=1")) return;
    void action(async () => { await api("/logout", "POST"); setMember(null); setOrganization(null); setLessons([]); navigate("/inicio", true); setNotice("Sesión cerrada de forma segura."); });
  }
  if (loading) return <main className="loading"><Mark/><p role="status">Abriendo tu espacio…</p></main>;
  const admin = member?.role === "admin";
  const editor = member?.role === "educator";
  const links = [
    { href: "/inicio", title: "Inicio", icon: "⌂", active: home },
    { href: "/contenido", title: "Contenido", icon: "▤", active: content },
    { href: "/biblioteca", title: "Biblioteca", icon: "▧", active: path === "/biblioteca" },
    ...(admin ? [{ href: "/organizacion", title: "Organización", icon: "⚙", active: path === "/organizacion" }, { href: "/educadores", title: "Educadores", icon: "♧", active: path === "/educadores" }] : []),
    { href: "/ayuda", title: "Ayuda y privacidad", icon: "?", active: path === "/ayuda" },
  ];
  const detailId = path.startsWith("/contenido/publicadas/") ? path.slice("/contenido/publicadas/".length) : "";
  const catalog = path === "/contenido/publicadas" || (path === "/contenido" && admin);
  const section = path === "/biblioteca" ? "resources" : path === "/educadores" && admin ? "members" : path === "/contenido/lecciones" && editor ? "lessons" : path === "/contenido" && editor ? "curriculum" : null;
  const known = home || catalog || detailId || section || path === "/ayuda" || (path === "/organizacion" && admin);
  return <div className={member ? "app-shell" : "login-shell"}>
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <header className="topbar"><Link href="/inicio" className="brand"><Mark/><span>Happy Learners</span></Link><span className="demo-tag">Demo compartida</span>{member && <button className="text-button logout" disabled={busy} onClick={logout}>Cerrar sesión</button>}</header>
    {member && <aside className="sidebar"><span className="eyebrow">Espacio del equipo</span><strong>{organization?.name || "Happy Learners"}</strong><nav aria-label="Navegación principal">{links.map(link => <Link href={link.href} key={link.href} aria-current={link.active ? "page" : undefined}><span aria-hidden="true">{link.icon}</span>{link.title}</Link>)}</nav><div className="member-card"><span className="avatar" aria-hidden="true">{admin ? "A" : "E"}</span><div><strong>{admin ? "Administración" : "Educador"}</strong><small>{member.username}</small></div></div></aside>}
    <main id="main" tabIndex={-1} className={member ? "workspace" : "login-main"}>
      {error && <div className="alert error" role="alert">{error} <button className="text-button" disabled={busy} onClick={() => void action(refresh)}>Volver a intentar</button></div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {!member ? <>
        <section className="welcome"><span className="eyebrow">Inglés para aprender juntos</span><h1>Una clase bien preparada<br/>empieza aquí.</h1><p>Organiza tus materiales, prepara lecciones y compártelas con un enlace. Los estudiantes no necesitan una cuenta.</p><div className="welcome-example" aria-hidden="true"><span className="eyebrow">Preparar · Compartir · Enseñar</span><h2>Más tiempo para acompañar.</h2><p>El objetivo, las actividades y los recursos en un mismo lugar.</p></div><p className="privacy-note">Sin expedientes ni datos personales de niños.</p></section>
        <section className="login-card"><h2>Iniciar sesión</h2><p>Para educadores y administradores.</p><form onSubmit={login}><label htmlFor="username">Usuario</label><input id="username" autoComplete="username" maxLength={64} value={username} onChange={e => setUsername(e.target.value)} required/><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required/><button className="primary full" disabled={busy}>{busy ? "Entrando…" : "Entrar a mi espacio"}</button></form><details className="demo-help"><summary>Probar con datos ficticios</summary><p><code>educador-demo</code>: recursos y lecciones. <code>admin-demo</code>: organización y permisos.</p><p>Contraseña de demostración: <code>Aprender-2026!</code></p><p>Cuentas públicas y compartidas. No introduzcas información personal.</p></details></section>
        <form className="code-entry" action="/" method="get"><div><label htmlFor="lesson-code">¿Tienes un código de lección?</label><p>Ábrela sin iniciar sesión.</p></div><input id="lesson-code" name="code" required maxLength={40} placeholder="Código de lección"/><button className="secondary">Abrir con código</button></form>
      </> : <>
        {home && <>
          <div className="page-heading"><div><span className="eyebrow">Tu espacio de trabajo</span><h1>¿Qué vamos a enseñar hoy?</h1><p>Encuentra una lección o continúa preparando contenido.</p></div><Link className="primary" href={editor ? "/contenido/lecciones" : "/educadores"}>{editor ? "Preparar una lección" : "Administrar educadores"}</Link></div>
          {!organization?.configured && <div className="alert">{admin ? <>Configura el nombre de tu organización. <Link href="/organizacion">Abrir configuración</Link></> : "Administración aún debe configurar la organización. Puedes consultar las lecciones disponibles."}</div>}
          <section className="quick-actions" aria-label="Herramientas para preparar"><Link href="/contenido"><span className="action-icon" aria-hidden="true">▤</span><strong>Organizar contenido</strong><span>{editor ? "Niveles, módulos y lecciones" : "Consultar lecciones publicadas"}</span></Link><Link href="/biblioteca"><span className="action-icon" aria-hidden="true">▧</span><strong>Buscar un recurso</strong><span>Materiales para tus actividades</span></Link></section>
          <section aria-label="Lecciones publicadas"><div className="section-heading"><div><h2>Listo para enseñar</h2><p>Lecciones publicadas que puedes abrir ahora.</p></div><Link href="/contenido/publicadas">Ver todas</Link></div><LessonCards lessons={lessons.slice(0, 3)}/></section>
          <aside className="privacy-strip"><strong>Enseñar sin pedir datos de más</strong><p>Los estudiantes abren una lección sin cuenta. Solo se registra la finalización agregada.</p><Link href="/ayuda">Cómo cuidamos la privacidad</Link></aside>
        </>}
        {content && !detailId && <><div className="page-heading"><div><span className="eyebrow">Preparar y enseñar</span><h1>Contenido</h1><p>{editor ? "Organiza niveles y módulos. Prepara sus lecciones y consulta lo publicado." : "Consulta las lecciones que el equipo ha publicado."}</p></div></div><nav className="content-tabs" aria-label="Secciones de contenido">{editor && <><Link href="/contenido" aria-current={path === "/contenido" ? "page" : undefined}>Niveles y módulos</Link><Link href="/contenido/lecciones" aria-current={path === "/contenido/lecciones" ? "page" : undefined}>Lecciones</Link></>}<Link href="/contenido/publicadas" aria-current={catalog ? "page" : undefined}>Publicadas</Link></nav></>}
        {catalog && <section aria-label="Lecciones publicadas"><LessonCards lessons={lessons}/></section>}
        {section && <Workspace key={path} member={member} section={section}/>}
        {detailId && <PublishedLesson key={detailId} id={detailId}/>}
        {path === "/organizacion" && admin && organization && <OrganizationForm organization={organization} saved={setOrganization}/>}
        {path === "/ayuda" && <Help/>}
        {!known && <section className="empty-state"><h1>No encontramos esta página</h1><p>El enlace puede haber cambiado o no estar disponible para tu cuenta.</p><Link className="primary" href="/inicio">Volver al inicio</Link></section>}
      </>}
    </main><footer className="footer"><span>Happy Learners · San Gaspar</span><span>Demostración compartida · Sin datos personales de niños</span></footer>
  </div>;
}

function LessonCards({ lessons }: { lessons: Lesson[] }) {
  if (!lessons.length) return <div className="empty-state"><h3>Aún no hay lecciones publicadas</h3><p>Las lecciones aparecerán aquí cuando el equipo las publique.</p><Link href="/contenido">Ir a contenido</Link></div>;
  return <div className="lesson-grid">{lessons.map(item => <article className="lesson-card" key={item.id}><div className="lesson-meta"><span className="published">Publicada</span><span>{item.duration} minutos</span></div><p className="eyebrow">{item.program}</p><h3>{item.title}</h3><p>{item.objective}</p><Link className="secondary" href={`/contenido/publicadas/${encodeURIComponent(item.id)}`}>Abrir lección<span className="sr-only">: {item.title}</span><span aria-hidden="true">→</span></Link></article>)}</div>;
}

function OrganizationForm({ organization, saved }: { organization: Organization; saved: (org: Organization) => void }) {
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useUnsavedChanges(dirty);
  return <><div className="page-heading"><div><span className="eyebrow">Administración</span><h1>Organización</h1><p>Configura el espacio compartido del equipo.</p></div></div><section className="form-card">
    {error && <p className="alert error" role="alert">{error}</p>}{notice && <p className="alert success" role="status">{notice}</p>}
    <form onChange={() => setDirty(true)} onSubmit={event => {
      event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); setBusy(true); setError("");
      api<{ organization: Organization }>("/organization", "PUT", data).then(result => { saved(result.organization); setDirty(false); setNotice("Organización guardada."); }).catch(e => setError(e.message)).finally(() => setBusy(false));
    }}><label htmlFor="org-name">Nombre de la organización</label><input id="org-name" name="name" required minLength={3} maxLength={80} defaultValue={organization.name || ""}/><label htmlFor="timezone">Zona horaria</label><select id="timezone" name="timezone" defaultValue={organization.timezone}><option value="America/Guatemala">Guatemala</option><option value="America/Mexico_City">Ciudad de México</option><option value="America/Bogota">Bogotá</option></select><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar organización"}</button></form><p className="form-note">En la demo usa un nombre ficticio. No se necesitan dirección, teléfono ni información de niños.</p>
  </section></>;
}

function PublishedLesson({ id }: { id: string }) {
  const [lesson, setLesson] = useState<Lesson | null>(null); const [error, setError] = useState(""); const [prepared, setPrepared] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<{ lesson: Lesson }>(`/lessons/${id}`).then(data => { if (active) setLesson(data.lesson); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => { if (lesson) { document.querySelector<HTMLElement>("main h1")?.focus(); document.title = `${lesson.title} · Happy Learners`; } }, [lesson]);
  if (error) return <section className="empty-state"><h1>No se pudo abrir la lección</h1><p role="alert">{error}</p><Link href="/contenido/publicadas">Volver a publicadas</Link></section>;
  if (!lesson) return <p role="status">Abriendo lección…</p>;
  return <article className="lesson-detail"><nav className="breadcrumbs" aria-label="Ubicación"><Link href="/contenido">Contenido</Link><span aria-hidden="true">/</span><Link href="/contenido/publicadas">Publicadas</Link></nav><div className="lesson-meta"><span className="published">Publicada · Solo lectura</span><span>{lesson.duration} minutos</span></div><h1 tabIndex={-1}>{lesson.title}</h1><section className="objective"><h2>Objetivo de la lección</h2><p>{lesson.objective}</p></section>
    {lesson.shareCode && <p><a className="primary" href={`/?code=${encodeURIComponent(lesson.shareCode)}`} target="_blank" rel="noreferrer">Abrir como estudiante</a></p>}
    <div className="lesson-columns"><div><h2>Actividades</h2>{lesson.activities.map((activity, index) => <section className="activity" key={activity.id || index}><span className="step-number" aria-hidden="true">{index + 1}</span><div><span className="duration">{activity.minutes} minutos</span><h3>{activity.title}</h3><p className="preserve-lines">{activity.instructions}</p></div></section>)}{lesson.reflection && <section className="reflection"><h2>Al terminar</h2><p>{lesson.reflection}</p></section>}</div><aside className="materials"><h2>Antes de empezar</h2><p>Marca los materiales que tienes a mano.</p>{lesson.materials.map(material => <label key={material}><input type="checkbox" checked={prepared.includes(material)} onChange={event => setPrepared(event.target.checked ? [...prepared, material] : prepared.filter(x => x !== material))}/><span>{material}</span></label>)}<p role="status">{prepared.length} de {lesson.materials.length} materiales listos</p><small>Esta lista se conserva mientras tengas abierta la lección.</small><button className="secondary full print-button" onClick={() => window.print()}>Imprimir guía</button></aside></div>
  </article>;
}

function Help() {
  return <section className="help-page"><span className="eyebrow">Acompañamiento</span><h1>Ayuda y privacidad</h1><h2>Prepara una clase</h2><ol><li>En Contenido, organiza un nivel y sus módulos.</li><li>Consulta Biblioteca para crear o encontrar recursos.</li><li>Prepara una lección con actividades y guarda el borrador.</li><li>Publica cuando esté lista y comparte su enlace o código.</li></ol><h2>Lo publicado no cambia al editar</h2><p>Los cambios posteriores quedan en borrador. Selecciona Republicar para actualizar lo que ve el estudiante.</p><h2>Datos que utilizamos</h2><p>Guardamos cuentas del equipo, permisos, organización, currículo, recursos, borradores, publicaciones y conteos agregados de finalización. La sesión dura hasta ocho horas y se revoca al cerrarla.</p><p>No guardamos perfiles de niños, fotografías, asistencia ni respuestas individuales. Una cookie evita contar de nuevo la misma finalización en este navegador durante 30 días. No usamos analítica publicitaria ni cookies de terceros.</p><h2>Demostración compartida</h2><p>Las cuentas son públicas: no introduzcas datos personales. Administración configura la organización y los permisos. Educadores preparan el contenido. Los estudiantes abren un enlace o código sin cuenta.</p><h2>Si algo no responde</h2><p>Comprueba la conexión y vuelve a intentar. Si tu sesión terminó, inicia sesión otra vez.</p><Link className="primary" href="/contenido">Ir a contenido</Link></section>;
}
