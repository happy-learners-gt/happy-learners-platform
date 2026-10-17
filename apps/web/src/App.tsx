import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Member, Organization, PendingDocument } from "@happy-learners/contracts";
import { api, ApiError, consentRequired, message, sessionExpired, sessionRestored } from "./api";
import { NavigationProvider, useNavigation } from "./navigation";
import { SessionContext } from "./session";
import type { Session } from "./session";
import { FeedbackProvider, useFeedback } from "./ui/feedback";
import { AppShell } from "./ui/Shell";
import { ChangePassword, Login, SessionExpiredDialog } from "./pages/Login";
import { Home } from "./pages/Home";
import { CourseList, CreateCourse } from "./pages/Courses";
import { CourseRoute } from "./pages/course/CourseRoute";
import { SectionRoute } from "./pages/sections/SectionRoute";
import { Agenda } from "./pages/sections/SectionList";
import { Library } from "./pages/Library";
import { Search } from "./pages/Search";
import { Help, NotFound } from "./pages/Help";
import { StyleGuide } from "./pages/StyleGuide";
import { Members, OrganizationSettings, AcademicSettings } from "./pages/admin";
import { AcceptInvitation } from "./pages/invitations";
import { AccessPage } from "./pages/access";
import { NotificationsAdmin } from "./pages/notifications";
import { ConsentGate, PrivacyPage } from "./pages/legal";
import { MyProfile } from "./pages/profile";
import { HoursPage } from "./pages/hours";
import { OnboardingWizard } from "./pages/onboarding";
import { AccountPage, ConfirmEmail } from "./pages/account";
const StudentLesson = lazy(() => import("./pages/StudentLesson").then(module => ({ default: module.StudentLesson })));
const StudentSpace = lazy(() => import("./pages/StudentSpace").then(module => ({ default: module.StudentSpace })));

export function App() { return <NavigationProvider><FeedbackProvider><Application/></FeedbackProvider></NavigationProvider>; }

function Application() {
  const { url } = useNavigation();
  const code = url.searchParams.get("code") || (url.pathname.startsWith("/aprender/") ? decodeURIComponent(url.pathname.slice(10)) : "");
  useFocusHeading(url.pathname + (code ? "?lesson" : ""));
  if (code) return <Suspense fallback={<main className="splash"><p role="status">Abriendo lección…</p></main>}><StudentLesson key={code} code={code}/></Suspense>;
  if (url.pathname.replace(/\/+$/, "") === "/privacidad") return <PrivacyPage/>;
  // ST-121: the invitation link opens without a session.
  const invitation = /^\/invitacion\/([a-z]_[a-f0-9]{64})\/?$/.exec(url.pathname)?.[1];
  if (invitation || url.pathname.startsWith("/invitacion/")) return <AcceptInvitation key={invitation || "invalid"} token={invitation || "invalid"}/>;
  // ST-158: the link that confirms a new sign-in e-mail opens with or without a session.
  const emailChange = /^\/cuenta\/correo\/([a-z]_[a-f0-9]{64})\/?$/.exec(url.pathname)?.[1];
  if (emailChange || url.pathname.startsWith("/cuenta/correo/")) return <ConfirmEmail key={emailChange || "invalid"} token={emailChange || "invalid"}/>;
  if (url.pathname.replace(/\/+$/, "") === "/estudiante") return <Suspense fallback={<main className="splash"><p role="status">Abriendo tu sección…</p></main>}><StudentSpace/></Suspense>;
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
  const [pending, setPending] = useState<PendingDocument[]>([]);
  // ST-122: a new account goes through the welcome after its password and the terms.
  const [onboarding, setOnboarding] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "offline">("loading");
  const [expired, setExpired] = useState(false);
  const refresh = useCallback(async () => {
    // Sequential on purpose: a 401 from the session check means "show the login", not "offline".
    const session = await api<{ member: Member; pending?: PendingDocument[]; onboarding?: true }>("/session");
    // With a temporary password, nothing else opens until the person chooses their own (ST-093).
    const org = session.member.mustChangePassword ? null : await api<{ organization: Organization }>("/organization");
    setMember(session.member); setOrganization(org?.organization || null); setPending(session.pending || []); setOnboarding(!!session.onboarding);
  }, []);
  const start = useCallback(() => {
    setStatus("loading");
    refresh().then(() => setStatus("ready")).catch(error => setStatus(error instanceof ApiError && error.status === 401 ? "ready" : "offline"));
  }, [refresh]);
  useEffect(start, [start]);
  useEffect(() => {
    const expire = () => setExpired(true);
    // A new version was published, or the person withdrew their consent: ask again before anything else.
    const recheck = () => { refresh().catch(() => undefined); };
    addEventListener(sessionExpired, expire); addEventListener(consentRequired, recheck);
    return () => { removeEventListener(sessionExpired, expire); removeEventListener(consentRequired, recheck); };
  }, []);
  // Locations from v0.2.2 keep working.
  useEffect(() => { if (url.pathname.startsWith("/contenido") || url.searchParams.has("biblioteca")) navigate("/cursos", true); }, [url]);
  if (status === "loading") return <main className="splash"><span className="brand-mark" aria-hidden="true">hl</span><p role="status">Abriendo tu espacio…</p></main>;
  if (status === "offline") return <main className="splash"><span className="brand-mark" aria-hidden="true">hl</span><h1>No pudimos conectar</h1><p>Comprueba tu conexión y vuelve a intentar.</p><button type="button" className="button primary" onClick={start}>Volver a intentar</button></main>;
  if (!member) return <Login onSignedIn={async () => { await refresh(); setExpired(false); }}/>;
  if (member.mustChangePassword) return <ChangePassword member={member} onChanged={async () => { await refresh(); toast({ message: "Contraseña guardada. Ya puedes usar tu espacio." }); }}
    onLeave={() => { api("/logout", "POST").catch(() => undefined).finally(() => setMember(null)); }}/>;
  const logout = () => api("/logout", "POST").catch(() => undefined).finally(() => { setMember(null); setOrganization(null); setPending([]); toast({ tone: "info", message: "Sesión cerrada de forma segura." }); });
  if (pending.length) return <ConsentGate pending={pending} organizationId={member.organizationId} onAccepted={refresh} onLogout={() => void logout()}/>;
  const session: Session = {
    member, organization, setOrganization,
    logout: () => {
      if (!navigate("/inicio")) return;
      void logout();
    },
  };
  return <SessionContext.Provider value={session}>
    {onboarding ? <OnboardingWizard onDone={async href => { await refresh(); navigate(href, true); toast({ message: "Bienvenida completada. Ya puedes empezar." }); }} onLogout={() => void logout()}/> : <Routes/>}
    {expired && <SessionExpiredDialog username={member.username} onRestored={async () => {
      try { await refresh(); setExpired(false); dispatchEvent(new CustomEvent(sessionRestored)); toast({ message: "Sesión renovada. Puedes continuar donde estabas." }); }
      catch (error) { toast({ tone: "error", message: message(error) }); }
    }} onLeave={() => { setExpired(false); setMember(null); }}/>}
  </SessionContext.Provider>;
}

function Routes() {
  const { url } = useNavigation();
  const [, first = "inicio", second, third, fourth] = url.pathname.replace(/\/+$/, "").split("/");
  // The shell stays mounted from page to page: only the content changes, and the menu keeps what is open.
  return <AppShell>{first === "cursos" && second && second !== "nuevo" ? <CourseRoute key={second} id={second} area={third || ""} item={fourth}/>
    : first === "secciones" && second ? <SectionRoute key={second} id={second} area={third || ""} item={fourth}/>
    : page(first || "inicio", second)}</AppShell>;
}

function page(first: string, second?: string) {
  switch (first) {
    case "inicio": return <Home/>;
    case "cursos": return second === "nuevo" ? <CreateCourse/> : <CourseList/>;
    case "agenda": return <Agenda/>;
    case "secciones": return <Redirect to="/agenda"/>;
    case "biblioteca": return <Library/>;
    case "buscar": return <Search/>;
    case "ayuda": return <Help/>;
    case "guia-de-estilo": return <StyleGuide/>;
    case "organizacion": return <OrganizationSettings/>;
    case "educadores": return <Members/>;
    case "perfil": return <MyProfile/>;
    case "cuenta": return <AccountPage/>;
    case "horas": return <HoursPage/>;
    case "configuracion-academica": return <AcademicSettings/>;
    case "roles-y-accesos": return <AccessPage/>;
    case "notificaciones": return <NotificationsAdmin/>;
    case "clasificaciones": return <Redirect to="/configuracion-academica"/>;
    case "contenido": return null;
    default: return <NotFound/>;
  }
}

/** Former locations keep working: replace the address without adding a history entry. */
function Redirect({ to }: { to: string }) {
  const { navigate } = useNavigation();
  useEffect(() => { navigate(to, true); }, [to]);
  return null;
}
