import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Member, Organization } from "@happy-learners/contracts";
import { Workspace, PublicLesson } from "./Workspace";
import { Courses, Taxonomies } from "./Courses";
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
  const legacyLocation = url.searchParams.has("biblioteca") || url.pathname === "/biblioteca" || url.pathname.startsWith("/contenido");
  const path = legacyLocation ? "/cursos" : url.pathname;
  const home = path === "/" || path === "/inicio";
  const [member, setMember] = useState<Member | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("educador-demo");
  const [password, setPassword] = useState("");
  async function refresh() {
    const session = await api<{ member: Member }>("/session");
    const org = await api<{ organization: Organization }>("/organization");
    setMember(session.member); setOrganization(org.organization);
  }
  useEffect(() => { refresh().catch(e => { if (!(e instanceof ApiError && e.status === 401)) setError(e.message); }).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (legacyLocation) navigate("/cursos", true); }, [legacyLocation]);
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
      if (e instanceof ApiError && e.status === 401) { setMember(null); setOrganization(null); }
      setError(e instanceof Error ? e.message : "Vuelve a intentar.");
    } finally { setBusy(false); }
  }
  function login(event: FormEvent) {
    event.preventDefault(); void action(async () => { await api("/login", "POST", { username, password }); setPassword(""); await refresh(); });
  }
  function logout() {
    if (!navigate("/inicio?salir=1")) return;
    void action(async () => { await api("/logout", "POST"); setMember(null); setOrganization(null); navigate("/inicio", true); setNotice("Sesión cerrada de forma segura."); });
  }
  if (loading) return <main className="loading"><Mark/><p role="status">Abriendo tu espacio…</p></main>;
  const admin = member?.role === "admin";
  const editor = member?.role === "educator";
  const links = [
    { href: "/inicio", title: "Inicio", icon: "⌂", active: home },
    { href: "/cursos", title: "Cursos", icon: "▤", active: path.startsWith("/cursos") },
    ...(admin ? [{ href: "/organizacion", title: "Organización", icon: "⚙", active: path === "/organizacion" }, { href: "/educadores", title: "Educadores", icon: "♧", active: path === "/educadores" }, { href: "/clasificaciones", title: "Clasificaciones", icon: "▧", active: path === "/clasificaciones" }] : []),
    { href: "/ayuda", title: "Ayuda y privacidad", icon: "?", active: path === "/ayuda" },
  ];
  const section = path === "/educadores" && admin ? "members" : null;
  const known = path.startsWith("/cursos") || (path === "/clasificaciones" && admin) || home || section || path === "/ayuda" || (path === "/organizacion" && admin);
  return <div className={member ? "app-shell" : "login-shell"}>
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <header className="topbar"><Link href="/inicio" className="brand"><Mark/><span>Happy Learners Studio</span></Link><span className="demo-tag">Demo compartida</span>{member && <button className="text-button logout" disabled={busy} onClick={logout}>Cerrar sesión</button>}</header>
    {member && <aside className="sidebar"><span className="eyebrow">Espacio del equipo</span><strong>{organization?.name || "Happy Learners"}</strong><nav aria-label="Navegación principal">{links.map(link => <Link href={link.href} key={link.href} aria-current={link.active ? "page" : undefined}><span aria-hidden="true">{link.icon}</span>{link.title}</Link>)}</nav><div className="member-card"><span className="avatar" aria-hidden="true">{admin ? "A" : "E"}</span><div><strong>{admin ? "Administración" : "Educador"}</strong><small>{member.username}</small></div></div></aside>}
    <main id="main" tabIndex={-1} className={member ? "workspace" : "login-main"}>
      {error && <div className="alert error" role="alert">{error} <button className="text-button" disabled={busy} onClick={() => void action(refresh)}>Volver a intentar</button></div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {!member ? <>
        <section className="welcome"><span className="eyebrow">Un espacio para aprender juntos</span><h1>Una clase bien preparada<br/>empieza aquí.</h1><p>Organiza tus materiales, prepara lecciones y compártelas con un enlace. Los estudiantes no necesitan una cuenta.</p><div className="welcome-example" aria-hidden="true"><span className="eyebrow">Preparar · Compartir · Enseñar</span><h2>Más tiempo para acompañar.</h2><p>El objetivo, las actividades y los recursos en un mismo lugar.</p></div><p className="privacy-note">Sin expedientes ni datos personales de niños.</p></section>
        <section className="login-card"><h2>Iniciar sesión</h2><p>Para educadores y administradores.</p><form onSubmit={login}><label htmlFor="username">Usuario</label><input id="username" autoComplete="username" maxLength={64} value={username} onChange={e => setUsername(e.target.value)} required/><label htmlFor="password">Contraseña</label><input id="password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} required/><button className="primary full" disabled={busy}>{busy ? "Entrando…" : "Entrar a mi espacio"}</button></form><details className="demo-help"><summary>Probar con datos ficticios</summary><p><code>educador-demo</code>: recursos y lecciones. <code>admin-demo</code>: organización y permisos.</p><p>Contraseña de demostración: <code>Aprender-2026!</code></p><p>Cuentas públicas y compartidas. No introduzcas información personal.</p></details></section>
        <form className="code-entry" action="/" method="get"><div><label htmlFor="lesson-code">¿Tienes un código de lección?</label><p>Ábrela sin iniciar sesión.</p></div><input id="lesson-code" name="code" required maxLength={40} placeholder="Código de lección"/><button className="secondary">Abrir con código</button></form>
      </> : <>
        {home && <>
          <div className="page-heading"><div><span className="eyebrow">Tu espacio de trabajo</span><h1>¿Qué vamos a enseñar hoy?</h1><p>Encuentra una lección o continúa preparando contenido.</p></div><Link className="primary" href={editor ? "/cursos/nuevo" : "/educadores"}>{editor ? "Crear curso" : "Administrar educadores"}</Link></div>
          {!organization?.configured && <div className="alert">{admin ? <>Configura el nombre de tu organización. <Link href="/organizacion">Abrir configuración</Link></> : "Administración aún debe configurar la organización. Puedes consultar las lecciones disponibles."}</div>}
          <section className="studio-home"><div><span className="eyebrow">Happy Learners Studio</span><h2>Todo para preparar y dar tu clase, en un solo espacio.</h2><p>Organiza el curso, convierte materiales en actividades y lleva la asistencia desde el mismo flujo de trabajo.</p><Link className="primary" href="/cursos">Abrir mis cursos <span aria-hidden="true">→</span></Link></div><div className="studio-home-art" aria-hidden="true"><span>PREPARAR</span><span>ENSEÑAR</span><span>ACOMPAÑAR</span></div></section>
          <aside className="privacy-strip"><strong>Enseñar sin pedir datos de más</strong><p>Las lecciones se abren sin cuenta. La asistencia queda en una lista privada del curso y no solicita datos de contacto.</p><Link href="/ayuda">Cómo cuidamos la privacidad</Link></aside>
        </>}
        {path.startsWith("/cursos") && <Courses member={member}/>}
        {path === "/clasificaciones" && admin && <Taxonomies/>}
        {section && <Workspace key={path} member={member} section={section}/>}
        {path === "/organizacion" && admin && organization && <OrganizationForm organization={organization} saved={setOrganization}/>}
        {path === "/ayuda" && <Help/>}
        {!known && <section className="empty-state"><h1>No encontramos esta página</h1><p>El enlace puede haber cambiado o no estar disponible para tu cuenta.</p><Link className="primary" href="/inicio">Volver al inicio</Link></section>}
      </>}
    </main><footer className="footer"><span>Happy Learners · Aprendizaje compartido</span><span>Demostración compartida · Sin datos personales de niños</span></footer>
  </div>;
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

function Help() {
  return <section className="help-page"><span className="eyebrow">Acompañamiento</span><h1>Ayuda y privacidad</h1><h2>Prepara e imparte una clase</h2><ol><li>En Cursos, crea un curso y define qué aprenderá el grupo.</li><li>En Preparar, organiza las unidades y crea las lecciones en el orden de enseñanza.</li><li>Guarda materiales de lectura, enlaces y recursos en Materiales.</li><li>En Editar lecciones, redacta cada actividad con formato, vincula materiales y revisa el borrador.</li><li>Publica o republica la lección y comparte su enlace con los estudiantes.</li><li>En Grupos y Asistencia, crea la lista y registra una sesión por fecha.</li></ol><h2>Las publicaciones tienen revisión</h2><p>Los cambios se guardan en borrador. Republicar es una acción explícita que actualiza lo que ve el estudiante.</p><h2>Datos y privacidad</h2><p>La asistencia almacena el nombre o identificador de lista, grupo, fecha y estado. No solicita correo, teléfono, fecha de nacimiento ni notas privadas. Solo educadores del curso pueden consultar esos registros. Usa información ficticia en esta demostración.</p><p>Las lecciones públicas no requieren cuenta. El sistema guarda conteos agregados de finalización, no perfiles de estudiantes ni respuestas individuales. La sesión del equipo dura hasta ocho horas y se revoca al cerrarla.</p><h2>Demostración compartida</h2><p>Las cuentas son públicas y compartidas. No introduzcas información personal real. Administración configura la organización y los permisos; educadores preparan cursos y contenido.</p><h2>Si algo no responde</h2><p>Comprueba la conexión y vuelve a intentar. Si tu sesión terminó, inicia sesión otra vez.</p><Link className="primary" href="/cursos">Ir a cursos</Link></section>;
}
