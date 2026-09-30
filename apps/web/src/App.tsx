import { lazy, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Member, Organization } from "@happy-learners/contracts";
import { api, ApiError, message, sessionExpired, sessionRestored } from "./api";
import { NavigationProvider, useNavigation } from "./navigation";
import { SessionContext } from "./session";
import type { Session } from "./session";
import { FeedbackProvider, useFeedback } from "./ui/feedback";
import { AppShell } from "./ui/Shell";
import type { SidebarModel } from "./ui/Shell";
import { Login, SessionExpiredDialog } from "./pages/Login";
import { Home } from "./pages/Home";
import { CourseList, CreateCourse } from "./pages/Courses";
import { CourseRoute } from "./pages/course/CourseRoute";
import { Library } from "./pages/Library";
import { Search } from "./pages/Search";
import { Help, NotFound } from "./pages/Help";
import { Members, OrganizationSettings, Taxonomies } from "./pages/admin";
const StudentLesson = lazy(() => import("./pages/StudentLesson").then(module => ({ default: module.StudentLesson })));

export function App() { return <NavigationProvider><FeedbackProvider><Application/></FeedbackProvider></NavigationProvider>; }

function Application() {
  const { url } = useNavigation();
  const code = url.searchParams.get("code") || (url.pathname.startsWith("/aprender/") ? decodeURIComponent(url.pathname.slice(10)) : "");
  useFocusHeading(url.pathname + (code ? "?lesson" : ""));
  if (code) return <Suspense fallback={<main className="splash"><p role="status">Abriendo lección…</p></main>}><StudentLesson key={code} code={code}/></Suspense>;
  return <AuthenticatedApp/>;
}

/**
 * After each in-app navigation, move focus to the page heading and name the document after it.
 * The first load keeps focus at the start of the document so "Saltar al contenido" comes first.
 */
function useFocusHeading(path: string) {
  const first = useRef(true);
  useEffect(() => {
    let done = false;
    const initial = first.current;
    first.current = false;
    const focus = () => {
      const heading = document.querySelector<HTMLElement>("main h1");
      if (!heading || done) return false;
      done = true; heading.tabIndex = -1;
      if (!initial) heading.focus({ preventScroll: true });
      document.title = `${heading.textContent?.trim()} · Happy Learners`;
      return true;
    };
    window.scrollTo(0, 0);
    if (focus()) return;
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setTimeout(() => observer.disconnect(), 4000);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [path]);
}

function AuthenticatedApp() {
  const { url, navigate } = useNavigation();
  const { toast } = useFeedback();
  const [member, setMember] = useState<Member | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "offline">("loading");
  const [expired, setExpired] = useState(false);
  const refresh = useCallback(async () => {
    // Sequential on purpose: a 401 from the session check means "show the login", not "offline".
    const session = await api<{ member: Member }>("/session");
    const org = await api<{ organization: Organization }>("/organization");
    setMember(session.member); setOrganization(org.organization);
  }, []);
  const start = useCallback(() => {
    setStatus("loading");
    refresh().then(() => setStatus("ready")).catch(error => setStatus(error instanceof ApiError && error.status === 401 ? "ready" : "offline"));
  }, [refresh]);
  useEffect(start, [start]);
  useEffect(() => {
    const expire = () => setExpired(true);
    addEventListener(sessionExpired, expire);
    return () => removeEventListener(sessionExpired, expire);
  }, []);
  // Locations from v0.2.2 keep working.
  useEffect(() => { if (url.pathname.startsWith("/contenido") || url.searchParams.has("biblioteca")) navigate("/cursos", true); }, [url]);
  if (status === "loading") return <main className="splash"><span className="brand-mark" aria-hidden="true">hl</span><p role="status">Abriendo tu espacio…</p></main>;
  if (status === "offline") return <main className="splash"><span className="brand-mark" aria-hidden="true">hl</span><h1>No pudimos conectar</h1><p>Comprueba tu conexión y vuelve a intentar.</p><button type="button" className="button primary" onClick={start}>Volver a intentar</button></main>;
  if (!member) return <Login onSignedIn={async () => { await refresh(); setExpired(false); }}/>;
  const session: Session = {
    member, organization, setOrganization,
    logout: () => {
      if (!navigate("/inicio")) return;
      api("/logout", "POST").catch(() => undefined).finally(() => { setMember(null); setOrganization(null); toast({ tone: "info", message: "Sesión cerrada de forma segura." }); });
    },
  };
  return <SessionContext.Provider value={session}>
    <Routes/>
    {expired && <SessionExpiredDialog username={member.username} onRestored={async () => {
      try { await refresh(); setExpired(false); dispatchEvent(new CustomEvent(sessionRestored)); toast({ message: "Sesión renovada. Puedes continuar donde estabas." }); }
      catch (error) { toast({ tone: "error", message: message(error) }); }
    }} onLeave={() => { setExpired(false); setMember(null); }}/>}
  </SessionContext.Provider>;
}

function Routes() {
  const { url } = useNavigation();
  const [, first = "inicio", second, third, fourth] = url.pathname.replace(/\/+$/, "").split("/");
  if (first === "cursos" && second && second !== "nuevo") return <CourseRoute key={second} id={second} area={third || ""} item={fourth}/>;
  return <GlobalShell>{page(first || "inicio", second)}</GlobalShell>;
}

function page(first: string, second?: string) {
  switch (first) {
    case "inicio": return <Home/>;
    case "cursos": return second === "nuevo" ? <CreateCourse/> : <CourseList/>;
    case "biblioteca": return <Library/>;
    case "buscar": return <Search/>;
    case "ayuda": return <Help/>;
    case "organizacion": return <OrganizationSettings/>;
    case "educadores": return <Members/>;
    case "clasificaciones": return <Taxonomies/>;
    case "contenido": return null;
    default: return <NotFound/>;
  }
}

function GlobalShell({ children }: { children: ReactNode }) {
  const { url } = useNavigation();
  const session = useContext(SessionContext);
  const path = url.pathname, admin = session?.member.role === "admin";
  const sidebar: SidebarModel = {
    label: "Navegación principal",
    items: [
      { href: "/inicio", label: "Inicio", icon: "home", active: path === "/" || path === "/inicio" },
      { href: "/cursos", label: "Cursos", icon: "courses", active: path.startsWith("/cursos") },
      { href: "/biblioteca", label: "Biblioteca", icon: "library", active: path === "/biblioteca" },
      { href: "/ayuda", label: "Ayuda", icon: "help", active: path === "/ayuda" },
    ],
    ...(admin ? { secondary: { label: "Administración", items: [
      { href: "/organizacion", label: "Organización", icon: "settings" as const, active: path === "/organizacion" },
      { href: "/educadores", label: "Educadores", icon: "users" as const, active: path === "/educadores" },
      { href: "/clasificaciones", label: "Clasificaciones", icon: "list" as const, active: path === "/clasificaciones" },
    ] } } : {}),
  };
  return <AppShell sidebar={sidebar}>{children}</AppShell>;
}
