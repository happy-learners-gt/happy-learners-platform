import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type { LegalDocument, ProgramScope, OnboardingPerson, OnboardingPersonStatus, OnboardingState, OnboardingStep, StaffProfile } from "@happy-learners/contracts";
import { builtInRoles, onboardingStatusLabels, onboardingStepLabels, permissionCatalog, reachLabels } from "@happy-learners/domain";
import type { BuiltInRole } from "@happy-learners/domain";
import { api, message } from "../api";
import { useSession, roleLabel } from "../session";
import { Icon } from "../ui/icons";
import { ErrorState, Loading, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { ProfileForm } from "./profile";
import { SignDialog } from "./legal";
import { formatInstantDate } from "../regional";

/**
 * ST-122: «Bienvenida», the guided onboarding of a new account. It opens after the own password (ST-093) and the terms
 * and privacy (ST-126, ST-127, ST-153), and its state lives on the server, so closing the tab resumes it where it was.
 */
const scopeText = (scope: ProgramScope) => "all" in scope ? "todos los programas" : `${scope.programs.length} ${scope.programs.length === 1 ? "programa" : "programas"}`;
const day = (value: string) => formatInstantDate(value);
const wizardSteps: OnboardingStep[] = ["welcome", "profile", "agreement", "tour"];
const titles: Partial<Record<OnboardingStep, string>> = { welcome: "Qué puedes hacer", profile: "Completa tu perfil", agreement: "Firma tu acuerdo de voluntariado", tour: "Tus cursos y secciones" };

export function OnboardingWizard({ onDone, onLogout }: { onDone: (href: string) => Promise<void>; onLogout: () => void }) {
  const [state, setState] = useState<OnboardingState | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [actionError, setActionError] = useState("");
  const [viewing, setViewing] = useState<OnboardingStep | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), first = useRef(true);
  // After saving the profile or signing, the step stays on screen with its new state until the person continues.
  const load = (keep?: OnboardingStep) => { setError(""); api<{ onboarding: OnboardingState }>("/onboarding").then(result => { setState(result.onboarding); setViewing(keep || null); }).catch(cause => setError(message(cause))); };
  useEffect(() => load(), []);
  const visible = state ? wizardSteps.filter(key => state.steps.some(step => step.key === key)) : [];
  const current = viewing || (state?.next && visible.includes(state.next) ? state.next : visible[visible.length - 1]);
  // Each step change moves focus to its heading, so keyboard and screen reader users start reading the new step.
  useEffect(() => { if (first.current) { first.current = !state; return; } heading.current?.focus(); }, [current, !!state]);
  async function mark(step: OnboardingStep, then?: string) {
    setBusy(true); setActionError("");
    try {
      const result = await api<{ onboarding: OnboardingState }>(`/onboarding/steps/${step}`, "POST");
      if (then) { await onDone(then); return; }
      setState(result.onboarding); setViewing(null);
    } catch (cause) { setActionError(message(cause)); }
    finally { setBusy(false); }
  }
  const index = current ? visible.indexOf(current) : -1;
  const doneOf = (key: OnboardingStep) => !!state?.steps.find(step => step.key === key)?.done;
  return <div className="login-page">
    <a className="skip-link" href="#main">Saltar al contenido</a>
    <main id="main" className="login-main">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">hl</span><span>Happy Learners</span></div>
      <section className="login-card legal-card onboarding-card" aria-labelledby="onboarding-title">
        <h1 id="onboarding-title">Bienvenida</h1>
        <p>Unos pasos para empezar a trabajar sabiendo qué puedes hacer. Tu avance se guarda: si sales, continúas donde quedaste.</p>
        {error ? <ErrorState error={error} retry={() => load()}/> : !state || !current ? <Loading label="Cargando tu bienvenida…" lines={5}/> : <>
          <ol className="onboarding-steps" aria-label="Pasos de la bienvenida">{visible.map((key, position) => {
            const done = doneOf(key), here = key === current;
            return <li key={key} className={here ? "is-current" : done ? "is-done" : undefined} aria-current={here ? "step" : undefined}>
              <span className="onboarding-marker" aria-hidden="true">{done && !here ? <Icon name="check" size={14}/> : position + 1}</span>
              <span>{titles[key]}<span className="sr-only">{done ? " (completado)" : here ? "" : " (pendiente)"}</span></span>
            </li>;
          })}</ol>
          <h2 ref={heading} tabIndex={-1} className="onboarding-heading">Paso {index + 1} de {visible.length}: {titles[current]}</h2>
          {actionError && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{actionError}</p>}
          {current === "welcome" && <WelcomeStep state={state}/>}
          {current === "profile" && <ProfileStep state={state} onSaved={() => load("profile")}/>}
          {current === "agreement" && <AgreementStep state={state} onSigned={() => load("agreement")}/>}
          {current === "tour" && <TourStep state={state} busy={busy} onOpen={href => void mark("tour", href)}/>}
          <div className="form-actions onboarding-actions">
            <button type="button" className="button ghost" onClick={onLogout}>Cerrar sesión</button>
            {index > 0 && <button type="button" className="button secondary" onClick={() => setViewing(visible[index - 1])}>Anterior</button>}
            {current === "welcome" && (doneOf("welcome") ? <button type="button" className="button primary" onClick={() => setViewing(null)}>Continuar</button>
              : <button type="button" className="button primary" disabled={busy} onClick={() => void mark("welcome")}>{busy ? "Guardando…" : "Entendido, continuar"}</button>)}
            {current === "profile" && <button type="button" className="button primary" disabled={!doneOf("profile")} onClick={() => setViewing(null)}>Continuar</button>}
            {current === "agreement" && !doneOf("agreement") && state.steps.find(step => step.key === "agreement")?.optional
              && <button type="button" className="button secondary" disabled={busy} onClick={() => void mark("agreement")}>Firmar más tarde</button>}
            {current === "agreement" && <button type="button" className="button primary" disabled={!doneOf("agreement")} onClick={() => setViewing(null)}>Continuar</button>}
            {current === "tour" && <button type="button" className="button primary" disabled={busy || state.next !== "tour"} onClick={() => void mark("tour", "/inicio")}>{busy ? "Guardando…" : "Empezar"}</button>}
          </div>
        </>}
      </section>
    </main>
  </div>;
}

function WelcomeStep({ state }: { state: OnboardingState }) {
  const { member } = useSession();
  const keys: BuiltInRole[] = member.role === "admin" ? ["admin"] : member.permissions?.coordination ? ["educator", "coordination"] : ["educator"];
  const extra = Object.entries(member.permissions?.grants || {}).filter(([key]) => !keys.some(role => builtInRoles.find(item => item.key === role)?.reach[key as keyof typeof builtInRoles[number]["reach"]]));
  const leads = state.courses.filter(course => course.role === "lead").length, helps = state.courses.length - leads;
  return <div className="stack">
    <p>Entraste como <strong>{roleLabel(member)}</strong>.{member.role === "educator" ? ` ${state.courses.length ? `Eres responsable de ${leads} ${leads === 1 ? "curso" : "cursos"} y colaboras en ${helps}.` : "Todavía no formas parte del equipo de un curso: administración te asignará."}` : ""}</p>
    {keys.map(key => { const role = builtInRoles.find(item => item.key === key)!; return <section key={key} className="onboarding-role" aria-labelledby={`role-${key}`}>
      <h3 id={`role-${key}`}>{role.label}</h3>
      <p className="muted small">{role.description}{key === "coordination" && member.permissions?.coordination ? ` Alcance: ${scopeText(member.permissions.coordination)}.` : ""}</p>
      <ul className="plain-list onboarding-permissions">{permissionCatalog.filter(item => role.reach[item.key]).map(item => <li key={item.key}><strong>{item.label}</strong> <span className="muted small">· {reachLabels[role.reach[item.key]!]}</span></li>)}</ul>
    </section>; })}
    {extra.length > 0 && <section className="onboarding-role" aria-labelledby="role-extra"><h3 id="role-extra">Permisos adicionales de tus grupos</h3>
      <ul className="plain-list onboarding-permissions">{extra.map(([key, scope]) => <li key={key}><strong>{permissionCatalog.find(item => item.key === key)?.label || key}</strong>{scope && <span className="muted small"> · {scopeText(scope)}</span>}</li>)}</ul></section>}
  </div>;
}

function ProfileStep({ state, onSaved }: { state: OnboardingState; onSaved: () => void }) {
  const { member } = useSession();
  const [profile, setProfile] = useState<StaffProfile | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); api<{ profile: StaffProfile }>("/profile").then(result => setProfile(result.profile)).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  return <div className="stack">
    <p>Tu perfil queda completo con un teléfono o un correo de contacto{member.role === "educator" ? " y al menos una especialidad" : ""}. La foto, la formación y la disponibilidad son opcionales.</p>
    {state.profileGaps.length ? <div className="notice warning" role="status"><Icon name="info" size={18}/><p>Falta: {state.profileGaps.join("; ").toLowerCase()}. Guarda tu perfil para continuar.</p></div>
      : <div className="notice" role="status"><Icon name="check" size={18}/><p>Tu perfil está completo.</p></div>}
    {error ? <ErrorState error={error} retry={load}/> : !profile ? <Loading label="Cargando tu perfil…" lines={3}/> : <ProfileForm profile={profile} onSaved={saved => { setProfile(saved); onSaved(); }}/>}
  </div>;
}

function AgreementStep({ state, onSigned }: { state: OnboardingState; onSigned: () => void }) {
  const [document, setDocument] = useState<LegalDocument | null>(null), [signing, setSigning] = useState(false);
  const step = state.steps.find(item => item.key === "agreement");
  useEffect(() => { if (state.agreement) api<{ documents: LegalDocument[] }>("/legal").then(result => setDocument(result.documents.find(item => item.id === state.agreement?.id) || null)).catch(() => undefined); }, [state.agreement?.id]);
  if (step?.done) return <p role="status">{step.skipped ? "Elegiste firmarlo más tarde. Lo verás como aviso hasta que lo firmes; sin él no puedes impartir clases." : "Ya firmaste el acuerdo de voluntariado vigente."}</p>;
  return <div className="stack">
    <p>Tu organización publicó la versión {state.agreement?.version} del acuerdo de voluntariado ad honorem: deja constancia de que tu actividad es voluntaria y sin remuneración económica. Se firma con tu nombre completo y tu contraseña.</p>
    <p className="muted small">{step?.optional ? "Puedes firmarlo más tarde, pero no podrás iniciar clases, pasar lista ni completarlas hasta firmarlo." : "Ya tienes secciones asignadas, así que necesitas firmarlo para continuar."}</p>
    <div><button type="button" className="button primary" disabled={!document} onClick={() => setSigning(true)}><Icon name="shield" size={16}/>Leer y firmar el acuerdo</button></div>
    {signing && document && <SignDialog document={document} onClose={() => { setSigning(false); onSigned(); }} onSigned={() => undefined}/>}
  </div>;
}

function TourStep({ state, busy, onOpen }: { state: OnboardingState; busy: boolean; onOpen: (href: string) => void }) {
  const { member } = useSession();
  const open = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); if (!busy && state.next === "tour") onOpen(href); };
  return <div className="stack">
    <p>{member.role === "admin" ? "En Cursos ves todos los cursos de la organización y en la Agenda todas sus secciones." : "En Cursos ves los cursos de tu equipo y en la Agenda las secciones que impartes, con sus próximas clases."}</p>
    <section aria-labelledby="tour-courses"><h3 id="tour-courses">Mis cursos</h3>
      {state.courses.length ? <ul className="plain-list onboarding-links">{state.courses.map(course => <li key={course.id}><a href={`/cursos/${course.id}`} onClick={open(`/cursos/${course.id}`)}>{course.title}</a> <span className="muted small">· {course.role === "lead" ? "responsable" : "colaboras"}</span></li>)}</ul>
        : <p className="muted small">Aún no formas parte del equipo de ningún curso. Cuando administración te asigne, aparecerá en <strong>Cursos</strong>.</p>}
    </section>
    <section aria-labelledby="tour-sections"><h3 id="tour-sections">Mis secciones</h3>
      {state.sections.length ? <ul className="plain-list onboarding-links">{state.sections.map(section => <li key={section.id}><a href={`/secciones/${section.id}`} onClick={open(`/secciones/${section.id}`)}>{section.name}</a> <span className="muted small">· {section.courseTitle}</span></li>)}</ul>
        : <p className="muted small">Todavía no impartes secciones. Las que te asignen aparecerán en la <strong>Agenda</strong>.</p>}
    </section>
    <div className="notice" role="note"><Icon name="calendar" size={18}/><p>Consejo: en la <strong>Agenda</strong>, <em>Sincronizar con mi calendario</em> crea un enlace privado para ver tus clases en Google Calendar, Outlook o Apple Calendar.</p></div>
    <p className="muted small">Al elegir <strong>Empezar</strong> llegas a Inicio. Puedes volver a leer cómo funciona todo en <strong>Ayuda</strong> y editar tu perfil en <strong>Mi perfil</strong>.</p>
  </div>;
}

/** Administration: each person's onboarding, for the «Incorporación» column of Educadores. */
const statusTone: Record<OnboardingPersonStatus, Tone> = { pending: "warning", in_progress: "info", complete: "success" };
export function useOnboardingPeople(revision: number) {
  const [people, setPeople] = useState<Map<string, OnboardingPerson> | null>(null);
  useEffect(() => { api<{ people: OnboardingPerson[] }>("/onboarding/people").then(result => setPeople(new Map(result.people.map(person => [person.userId, person])))).catch(() => setPeople(new Map())); }, [revision]);
  return people;
}
export function OnboardingBadge({ person, compact }: { person: OnboardingPerson | undefined; compact?: boolean }) {
  if (!person) return <span className="muted">—</span>;
  const missing = person.missing.map(step => onboardingStepLabels[step].toLowerCase());
  const detail = person.status === "complete" ? person.completedAt ? `el ${day(person.completedAt)}` : "" : `${person.startedAt ? `desde el ${day(person.startedAt)}` : ""}${missing.length ? ` · falta: ${missing.join(", ")}` : ""}`;
  return <span className="onboarding-cell"><StatusBadge tone={statusTone[person.status]}>{onboardingStatusLabels[person.status]}</StatusBadge>
    {!compact && detail && <span className="muted small">{detail}</span>}</span>;
}
export function OnboardingFilter({ value, onChange }: { value: OnboardingPersonStatus | ""; onChange: (value: OnboardingPersonStatus | "") => void }) {
  return <label className="onboarding-filter"><span>Incorporación</span>
    <select value={value} onChange={event => onChange(event.target.value as OnboardingPersonStatus | "")}>
      <option value="">Todas</option>{(Object.keys(onboardingStatusLabels) as OnboardingPersonStatus[]).map(key => <option key={key} value={key}>{onboardingStatusLabels[key]}</option>)}
    </select></label>;
}
