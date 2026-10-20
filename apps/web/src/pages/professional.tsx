import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type {
  Credential, CredentialStatus, DirectoryEntry, MyProfessionalProfile, ProfessionalProfile, ProfileReviewItem, ProfileReviewQueue, ProfileSection, ProfileStatus,
  ProfileVisibility, PublicCredential, PublicProfile, StaffAvailabilitySlot, StaffFile,
} from "@happy-learners/contracts";
import {
  audienceLabel, audienceView, availabilityDays, countryCodes, countryName, credentialStatusLabels, credentialTypeLabel, credentialTypes, fieldLabel, formatLabel,
  iscedFields, iscedLevels, languageName, learnerAudiences, levelLabel, linkKindLabel, modalityLabel, proficiencyLabel, proficiencyLevels, profileLimits, profileLinkKinds,
  profileSections, profileStatusLabels, reaches, teachingFormats, teachingModalities, timezoneGroups, visibilityLabels,
} from "@happy-learners/domain";
import { api, ApiError, message, sendFile } from "../api";
import { Link, useUnsavedChanges } from "../navigation";
import { useSession } from "../session";
import { timeAgo } from "../model";
import { Drawer, Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Avatar } from "../ui/progress";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import { StatusSteps } from "../ui/StatusSteps";
import type { StatusStep } from "../ui/StatusSteps";
import type { Tone } from "../ui/primitives";
import { departureDay } from "./departure";
import { PersonPhoto } from "./profile";

/**
 * ST-154 to ST-157 (DEC-045): «Mi perfil» by sections with its completeness and a preview as a student sees it,
 * the team directory and each person's page, and the review queue for profiles and credentials.
 */
type Tab = "identity" | "about" | "languages" | "teaching" | "career" | "credentials" | "links" | "contact";
const tabs: { value: Tab; label: string }[] = [
  { value: "identity", label: "Identidad" }, { value: "about", label: "Sobre mí" }, { value: "languages", label: "Idiomas" }, { value: "teaching", label: "Enseñanza" },
  { value: "career", label: "Trayectoria" }, { value: "credentials", label: "Credenciales" }, { value: "links", label: "Enlaces" }, { value: "contact", label: "Contacto" },
];
/** Which section holds each field of an error path from the API. */
function tabOf(path: string): Tab {
  const key = path.split(".")[0];
  if (["preferredName", "pronouns", "headline", "country", "city", "timezone", "displayName"].includes(key)) return "identity";
  if (["bio", "approach", "videoUrl"].includes(key)) return "about";
  if (key === "languages") return "languages";
  if (["areas", "levels", "modalities", "formats", "audiences", "experienceYears"].includes(key)) return "teaching";
  if (["experience", "education", "educationSummary"].includes(key)) return "career";
  if (key === "links") return "links";
  return "contact";
}
function sectionDone(section: Tab, profile: MyProfessionalProfile) {
  const steps = profile.completeness.steps.filter(step => (step.section === "photo" ? "identity" : step.section) === section);
  return steps.length > 0 && steps.every(step => step.done);
}
function profileSteps(status: ProfileStatus): StatusStep[] {
  const order: ProfileStatus[] = ["draft", "in_review", "published"];
  const current = status === "changes_requested" ? "in_review" : status === "hidden" ? "published" : status;
  const index = order.indexOf(current);
  return [
    { id: "draft", label: "Borrador", state: index > 0 ? "done" : "current" },
    { id: "in_review", label: status === "changes_requested" ? "Cambios solicitados" : "En revisión", state: index > 1 ? "done" : index === 1 ? "current" : "todo" },
    { id: "published", label: status === "hidden" ? "Oculto" : "Publicado", state: index >= 2 ? "done" : "todo" },
  ];
}
export const statusTone: Record<ProfileStatus, Tone> = { draft: "neutral", in_review: "info", changes_requested: "warning", published: "success", hidden: "neutral" };
const credentialTone: Record<CredentialStatus, Tone> = { draft: "neutral", submitted: "info", verified: "success", rejected: "danger", withdrawn: "neutral", expired: "warning" };

/** Languages offered in the list; any other BCP 47 tag can be written. Names come from the browser, in Spanish. */
const commonLanguages = ["es", "en", "pt", "fr", "de", "it", "nl", "ca", "eu", "gl", "zh", "ja", "ko", "ar", "hi", "ru", "tr", "pl", "uk", "ro", "el", "he", "sv", "sw", "id", "vi", "th", "qu", "ay", "gn", "nah", "ht", "ase", "lsm", "yua", "quc", "cak", "mam", "kek"];
const extraNames: Record<string, string> = { ase: "Lengua de señas americana", lsm: "Lengua de señas mexicana", nah: "Náhuatl", yua: "Maya yucateco", quc: "K'iche'", cak: "Kaqchikel", mam: "Mam", kek: "Q'eqchi'" };
export const languageLabel = (code: string) => extraNames[code] || languageName(code);
const countries = () => countryCodes.map(code => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name, "es"));

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={value.length > max ? "field-error" : "muted"}>{value.length.toLocaleString("es")} / {max.toLocaleString("es")}</span>;
}
function CountrySelect({ value, onChange, label, error, optional = true }: { value: string | null; onChange: (value: string | null) => void; label: string; error?: string; optional?: boolean }) {
  const list = useMemo(countries, []);
  return <Field label={label} optional={optional} error={error}><select value={value || ""} onChange={event => onChange(event.target.value || null)}>
    <option value="">Sin indicar</option>{list.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}
  </select></Field>;
}
function ChipChoices<T extends string>({ legend, options, value, onChange, error, hint }: { legend: string; options: { value: T; label: string }[]; value: T[]; onChange: (value: T[]) => void; error?: string; hint?: string }) {
  return <fieldset className="choice-field">
    <legend>{legend}</legend>
    {hint && <p className="muted small">{hint}</p>}
    <div className="chips">{options.map(option => <label key={option.value} className="chip"><input type="checkbox" checked={value.includes(option.value)}
      onChange={event => onChange(event.target.checked ? options.map(item => item.value).filter(item => item === option.value || value.includes(item)) : value.filter(item => item !== option.value))}/><span>{option.label}</span></label>)}</div>
    {error && <small className="field-error">{error}</small>}
  </fieldset>;
}

type Account = { displayName: string; phone: string; contactEmail: string; availability: StaffAvailabilitySlot[]; education: string };
const accountOf = (profile: MyProfessionalProfile): Account => ({ displayName: profile.displayName, phone: profile.contact.phone || "", contactEmail: profile.contact.contactEmail || "", availability: profile.availability, education: profile.education });

/** «Mi perfil» (ST-154, ST-156): the working copy by sections, its completeness, its publication and a preview. */
export function MyProfilePage() {
  const [profile, setProfile] = useState<MyProfessionalProfile | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); api<{ profile: MyProfessionalProfile }>("/me/profile").then(result => setProfile(result.profile)).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  return error ? <><PageHeader title="Mi perfil"/><ErrorState error={error} retry={load}/></>
    : !profile ? <><PageHeader title="Mi perfil"/><Loading label="Cargando tu perfil…"/></>
    : <ProfileEditor key={profile.userId} initial={profile} reload={load}/>;
}

function ProfileEditor({ initial, reload }: { initial: MyProfessionalProfile; reload: () => void }) {
  const { toast, confirm } = useFeedback();
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState<ProfessionalProfile>(initial.draft), [visibility, setVisibility] = useState<ProfileVisibility>(initial.visibility), [account, setAccount] = useState<Account>(accountOf(initial));
  const [visible, setVisible] = useState<Tab>("identity"), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [errors, setErrors] = useState<Record<string, string>>({}), [alert, setAlert] = useState("");
  const [preview, setPreview] = useState(false), [photo, setPhoto] = useState(initial.photoVersion);
  useUnsavedChanges(dirty);
  useEffect(() => {
    const nodes = tabs.map(item => document.getElementById(`profile-${item.value}`)).filter((node): node is HTMLElement => !!node);
    if (!nodes.length) return;
    const observer = new IntersectionObserver(entries => {
      const seen = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const id = seen?.target.id.replace("profile-", "") as Tab | undefined;
      if (id) setVisible(id);
    }, { rootMargin: "-25% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] });
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const accept = (next: MyProfessionalProfile) => { setProfile(next); setDraft(next.draft); setVisibility(next.visibility); setAccount(accountOf(next)); setDirty(false); setErrors({}); setAlert(""); };
  const patch = (value: Partial<ProfessionalProfile>) => { setDraft(current => ({ ...current, ...value })); setDirty(true); };
  const patchAccount = (value: Partial<Account>) => { setAccount(current => ({ ...current, ...value })); setDirty(true); };
  const err = (path: string) => errors[path];
  const go = (section: Tab) => {
    setVisible(section);
    document.getElementById(`profile-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Credentials save on their own: refresh the status, completeness and list without touching unsaved edits.
  const refresh = () => { api<{ profile: MyProfessionalProfile }>("/me/profile").then(result => setProfile(result.profile)).catch(() => reload()); };

  async function save() {
    setBusy(true); setAlert("");
    try {
      const result = await api<{ profile: MyProfessionalProfile; changed: string[] }>("/me/profile", "PUT", {
        draft, visibility, draftVersion: profile.draftVersion, displayName: account.displayName, contact: { phone: account.phone, contactEmail: account.contactEmail }, availability: account.availability, education: account.education,
      });
      accept(result.profile);
      toast({ message: result.changed.length ? "Perfil guardado." : "No había cambios que guardar." });
      return true;
    } catch (cause) {
      const detail = cause instanceof ApiError ? cause.detail.errors as Record<string, string> | undefined : undefined;
      if (detail) { setErrors(detail); go(tabOf(Object.keys(detail)[0])); }
      setAlert(message(cause));
      return false;
    } finally { setBusy(false); }
  }
  async function submit() {
    if (dirty && !await save()) return;
    if (profile.missing.length) { setAlert(`Para enviar tu perfil falta ${profile.missing.join(", ")}.`); return; }
    const direct = !profile.reviewRequired;
    if (!await confirm({ title: direct ? "¿Publicar tu perfil?" : "¿Enviar tu perfil a revisión?", confirm: direct ? "Publicar" : "Enviar a revisión",
      body: direct ? "El equipo y los estudiantes de tus secciones verán esta versión según la privacidad que elegiste." : profile.publication ? "Tu perfil publicado sigue visible tal como está hasta que administración apruebe esta nueva versión." : "Administración revisa tu perfil antes de publicarlo. Te avisamos aquí cuando lo apruebe o te pida cambios." })) return;
    setBusy(true);
    try { const result = await api<{ profile: MyProfessionalProfile }>("/me/profile/submit", "POST"); accept(result.profile); toast({ message: direct ? "Perfil publicado." : "Perfil enviado a revisión." }); }
    catch (cause) { setAlert(message(cause)); }
    finally { setBusy(false); }
  }
  async function visibilityAction(action: "hide" | "show") {
    if (action === "hide" && !await confirm({ title: "¿Ocultar tu perfil?", body: "El equipo y los estudiantes dejan de verlo hasta que lo vuelvas a mostrar. No se pierde nada.", confirm: "Ocultar perfil" })) return;
    try { const result = await api<{ profile: MyProfessionalProfile }>(`/me/profile/${action}`, "POST"); accept(result.profile); toast({ message: action === "hide" ? "Tu perfil está oculto." : "Tu perfil vuelve a estar visible." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }

  const status = profile.status, published = status === "published" || status === "hidden";
  const canSubmit = !profile.submission || profile.submission.status !== "in_review" || profile.hasChanges || dirty;
  const submitLabel = !profile.reviewRequired ? (published ? "Publicar cambios" : "Publicar perfil") : profile.submission?.status === "in_review" ? "Reenviar a revisión" : published ? "Enviar cambios a revisión" : "Enviar a revisión";
  const errorCount = Object.keys(errors).length;
  const tabErrors = (value: Tab) => Object.keys(errors).filter(key => tabOf(key) === value).length;
  const jump = (section: ProfileSection | "photo") => go(section === "photo" ? "identity" : section === "availability" || section === "contact" ? "contact" : section as Tab);
  return <>
    <PageHeader title="Mi perfil" description="Lo que el equipo y los estudiantes de tus secciones conocen de ti."
      meta={<span className="profile-status-line"><StatusBadge tone={statusTone[status]}>{profileStatusLabels[status]}</StatusBadge>
        {profile.submission?.status === "in_review" && published && <StatusBadge tone="info">Cambios en revisión</StatusBadge>}
        {profile.hasChanges && published && profile.submission?.status !== "in_review" && <StatusBadge tone="warning">Cambios sin enviar</StatusBadge>}</span>}
      actions={<>
        <button type="button" className="button secondary" onClick={() => setPreview(true)}><Icon name="eye" size={18}/>Vista previa</button>
        {profile.publication && <Link className="button ghost" href={`/equipo/${profile.userId}`}><Icon name="users" size={18}/>Ver publicado</Link>}
        {status === "published" && <button type="button" className="button ghost" onClick={() => void visibilityAction("hide")}><Icon name="archive" size={16}/>Ocultar perfil</button>}
        {status === "hidden" && profile.hiddenBy !== "admin" && <button type="button" className="button ghost" onClick={() => void visibilityAction("show")}><Icon name="eye" size={16}/>Mostrar perfil</button>}
      </>}
      primary={<button type="button" className="button primary" disabled={busy || !canSubmit} onClick={() => void submit()}><Icon name="send" size={18}/>{submitLabel}</button>}/>
    {profile.submission?.status === "returned" && <div className="message-bar warning" role="status">
      <Icon name="alert" size={18}/>
      <div><strong>Administración te pidió cambios</strong><p className="pre-line">{profile.submission.note}</p>
        <button type="button" className="button secondary small" onClick={() => go("about")}>Ir a Sobre mí</button></div>
    </div>}
    {profile.submission?.status === "in_review" && <div className="message-bar info" role="status">
      <Icon name="info" size={18}/>
      <div><strong>Administración está revisando tu perfil</strong>
        <p>{profile.publication ? `La versión ${profile.submission.version} está en revisión desde ${timeAgo(profile.submission.submittedAt)}; mientras tanto se ve la versión ${profile.publication.version}.` : "Puedes seguir editando; si quieres incluir los cambios, reenvíalo."}</p></div>
    </div>}
    <StatusSteps label="Estado del perfil" steps={profileSteps(status)}/>
    <nav className="profile-anchors" aria-label="Secciones del perfil">
      {tabs.map(item => <button key={item.value} type="button" aria-current={visible === item.value || undefined} onClick={() => go(item.value)}>
        <span>{item.label}{tabErrors(item.value) > 0 && <span className="sr-only">, con errores</span>}</span>
        <span className={`profile-section-mark${tabErrors(item.value) ? " is-error" : sectionDone(item.value, profile) ? " is-done" : ""}`} aria-hidden="true"/>
      </button>)}
    </nav>
    <div className="profile-form">
      <Completeness profile={profile} onGo={jump}/>
      {(alert || errorCount > 0) && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{alert || "Revisa los campos marcados."}{errorCount > 0 && ` (${errorCount === 1 ? "1 campo" : `${errorCount} campos`})`}</p>}
      <fieldset className="profile-sections" disabled={busy}>
        <section id="profile-identity" className="panel" aria-labelledby="profile-identity-title">
          <h2 id="profile-identity-title">Identidad</h2>
          <IdentityTab draft={draft} patch={patch} account={account} patchAccount={patchAccount} err={err} profile={profile} photo={photo} setPhoto={setPhoto}/>
        </section>
        <section id="profile-about" className="panel" aria-labelledby="profile-about-title">
          <h2 id="profile-about-title">Sobre mí</h2>
          <AboutTab draft={draft} patch={patch} err={err}/>
        </section>
        <section id="profile-languages" className="panel" aria-labelledby="profile-languages-title">
          <h2 id="profile-languages-title">Idiomas</h2>
          <LanguagesTab draft={draft} patch={patch} err={err}/>
        </section>
        <section id="profile-teaching" className="panel" aria-labelledby="profile-teaching-title">
          <h2 id="profile-teaching-title">Enseñanza</h2>
          <TeachingTab draft={draft} patch={patch} err={err}/>
        </section>
        <section id="profile-career" className="panel" aria-labelledby="profile-career-title">
          <h2 id="profile-career-title">Trayectoria</h2>
          <CareerTab draft={draft} patch={patch} err={err} education={account.education} setEducation={education => patchAccount({ education })}/>
        </section>
      </fieldset>
      <section id="profile-credentials" className="panel" aria-labelledby="profile-credentials-title">
        <h2 id="profile-credentials-title">Credenciales</h2>
        <CredentialsTab profile={profile} onChange={refresh}/>
      </section>
      <fieldset className="profile-sections" disabled={busy}>
        <section id="profile-links" className="panel" aria-labelledby="profile-links-title">
          <h2 id="profile-links-title">Enlaces</h2>
          <LinksTab draft={draft} patch={patch} err={err}/>
        </section>
        <section id="profile-contact" className="panel" aria-labelledby="profile-contact-title">
          <h2 id="profile-contact-title">Contacto</h2>
          <ContactTab account={account} patchAccount={patchAccount} err={err}/>
          <PrivacyTab visibility={visibility} onChange={value => { setVisibility(value); setDirty(true); }}/>
        </section>
      </fieldset>
      {profile.history.length > 0 && <details className="history"><summary>Historial de versiones publicadas ({profile.history.length})</summary>
        <ol className="plain-list small">{profile.history.map(item => <li key={item.version}>Versión {item.version} · {item.publishedAt ? departureDay(item.publishedAt.slice(0, 10)) : ""}{item.decidedBy ? ` · aprobó ${item.decidedBy}` : ""}{item.status === "published" ? " · vigente" : ""}</li>)}</ol>
      </details>}
      {dirty && <div className="save-bar">
        <span className="muted small" role="status">Tienes cambios sin guardar.</span>
        <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar perfil"}</button>
      </div>}
    </div>
    {preview && <PreviewDialog profile={profile} draft={draft} visibility={visibility} name={account.displayName} photo={photo} onClose={() => setPreview(false)}/>}
  </>;
}

function Completeness({ profile, onGo }: { profile: MyProfessionalProfile; onGo: (section: ProfileSection | "photo") => void }) {
  const { percent, steps } = profile.completeness, missing = steps.filter(step => !step.done);
  const [open, setOpen] = useState(false);
  const radius = 16, circ = 2 * Math.PI * radius, dash = (percent / 100) * circ;
  const nextCount = Math.min(3, missing.length);
  const nextLabel = nextCount === 1 ? "1 paso siguiente" : `${nextCount} pasos siguientes`;
  return <div className="profile-completeness">
    <div className="completeness-ring is-compact">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle className="track" cx="20" cy="20" r={radius}/>
        <circle className="value" cx="20" cy="20" r={radius} strokeDasharray={`${dash} ${circ}`}/>
      </svg>
      <div>
        <p id="completeness-label">Perfil al {percent} %</p>
        {missing.length ? <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>{nextLabel}</button>
          : <p className="muted small"><Icon name="check" size={16}/> Todo lo recomendado está listo.</p>}
      </div>
    </div>
    <div className="meter sr-only" role="progressbar" aria-label={`Perfil completo al ${percent} %`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}/>
    {open && missing.length > 0 && <div className="completeness-panel">
      <p className="muted small">Tus siguientes pasos:</p>
      <ul className="plain-list completeness-steps">{missing.map(step => <li key={step.key}><button type="button" className="link-button" onClick={() => onGo(step.section)}>{step.label}</button></li>)}</ul>
      {profile.missing.length > 0 && <p className="small"><strong>Para enviarlo necesitas</strong> {profile.missing.join(", ")}.</p>}
    </div>}
  </div>;
}

type TabProps = { draft: ProfessionalProfile; patch: (value: Partial<ProfessionalProfile>) => void; err: (path: string) => string | undefined };

function IdentityTab({ draft, patch, account, patchAccount, err, profile, photo, setPhoto }: TabProps & { account: Account; patchAccount: (value: Partial<Account>) => void; profile: MyProfessionalProfile; photo: string | null; setPhoto: (value: string | null) => void }) {
  const { toast } = useFeedback();
  const [photoBusy, setPhotoBusy] = useState(false), fileRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(() => timezoneGroups(draft.timezone), [draft.timezone]);
  async function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { toast({ tone: "error", message: "La foto debe ser una imagen JPG, PNG o WebP de hasta 2 MB." }); return; }
    setPhotoBusy(true);
    try { const result = await sendFile<{ photoVersion: string }>("/profile/photo", "PUT", file, { "Content-Type": file.type }); setPhoto(result.photoVersion); toast({ message: "Foto actualizada." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function remove() {
    setPhotoBusy(true);
    try { await api("/profile/photo", "DELETE"); setPhoto(null); toast({ message: "Foto quitada." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setPhotoBusy(false); }
  }
  return <div className="identity-block">
    <div className="identity-photo">
      <PersonPhoto userId={profile.userId} name={account.displayName || profile.username} version={photo} size={72} alt={photo ? "Tu foto de perfil" : ""}/>
      <div className="form-actions">
        <label className="button secondary small file-button"><Icon name="upload" size={16}/>{photoBusy ? "Subiendo…" : photo ? "Cambiar foto" : "Subir foto"}
          <input ref={fileRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} onChange={event => void upload(event.target.files?.[0])}/></label>
        {photo && <button type="button" className="button ghost small" disabled={photoBusy} onClick={() => void remove()}>Quitar foto</button>}
      </div>
      <p className="muted small">JPG, PNG o WebP de hasta 2 MB. Se aplica de inmediato.</p>
    </div>
    <div className="form-grid-12">
      <div className="form-span-6"><Field label="Nombre" hint="Como aparece en los cursos, las secciones y la actividad. Se aplica de inmediato." error={err("displayName")}><input value={account.displayName} onChange={event => patchAccount({ displayName: event.target.value })} maxLength={80} autoComplete="name" required/></Field></div>
      <div className="form-span-3"><Field label="Nombre preferido" optional hint="Cómo te gusta que te llamen." error={err("preferredName")}><input value={draft.preferredName} onChange={event => patch({ preferredName: event.target.value })} maxLength={profileLimits.preferredName}/></Field></div>
      <div className="form-span-3"><Field label="Pronombres" optional hint="Por ejemplo: ella, él, elle." error={err("pronouns")}><input value={draft.pronouns} onChange={event => patch({ pronouns: event.target.value })} maxLength={profileLimits.pronouns}/></Field></div>
      <div className="form-span-12"><Field label="Titular" hint={<>Una línea sobre lo que enseñas y a quién. <Counter value={draft.headline} max={profileLimits.headline}/></>} error={err("headline")}>
        <input value={draft.headline} onChange={event => patch({ headline: event.target.value })} maxLength={profileLimits.headline} placeholder="Por ejemplo: Docente de ciencias para secundaria, con enfoque en laboratorio"/></Field></div>
      <div className="form-span-4"><CountrySelect label="País" value={draft.country} onChange={country => patch({ country })} error={err("country")}/></div>
      <div className="form-span-4"><Field label="Ciudad" optional error={err("city")}><input value={draft.city} onChange={event => patch({ city: event.target.value })} maxLength={profileLimits.city} autoComplete="address-level2"/></Field></div>
      <div className="form-span-4"><Field label="Zona horaria" optional hint="Para mostrar tus horarios en la hora de cada persona." error={err("timezone")}><select value={draft.timezone || ""} onChange={event => patch({ timezone: event.target.value || null })}>
        <option value="">Sin indicar</option>
        {zones.map(group => <optgroup key={group.region} label={group.region}>{group.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.city} ({zone.offset})</option>)}</optgroup>)}
      </select></Field></div>
    </div>
  </div>;
}

function AboutTab({ draft, patch, err }: TabProps) {
  return <>
    <Field label="Biografía" hint={<>Quién eres, tu experiencia y lo que te apasiona enseñar. <Counter value={draft.bio} max={profileLimits.bio}/></>} error={err("bio")}>
      <textarea value={draft.bio} onChange={event => patch({ bio: event.target.value })} rows={7} maxLength={profileLimits.bio}/></Field>
    <Field label="Enfoque de enseñanza" optional hint={<>Tu metodología: cómo es una clase contigo. <Counter value={draft.approach} max={profileLimits.approach}/></>} error={err("approach")}>
      <textarea value={draft.approach} onChange={event => patch({ approach: event.target.value })} rows={5} maxLength={profileLimits.approach}/></Field>
    <Field label="Video de presentación" optional hint="Enlace de YouTube o Vimeo. El video no se sube a la plataforma: se abre en su sitio." error={err("videoUrl")}>
      <input type="url" inputMode="url" value={draft.videoUrl || ""} onChange={event => patch({ videoUrl: event.target.value || null })} placeholder="https://www.youtube.com/watch?v=…"/></Field>
  </>;
}

function LanguagesTab({ draft, patch, err }: TabProps) {
  const options = useMemo(() => [...new Set([...commonLanguages, ...draft.languages.map(item => item.code)])].map(code => ({ code, name: languageLabel(code) })).sort((a, b) => a.name.localeCompare(b.name, "es")), [draft.languages]);
  const [other, setOther] = useState("");
  const set = (index: number, value: Partial<ProfessionalProfile["languages"][number]>) => patch({ languages: draft.languages.map((item, i) => i === index ? { ...item, ...value } : item) });
  const add = (code: string) => { if (code && !draft.languages.some(item => item.code === code)) patch({ languages: [...draft.languages, { code, proficiency: draft.languages.length ? "B2" : "native", teaches: !draft.languages.length }] }); };
  return <>
    <p className="muted small">Los idiomas que hablas y en cuáles enseñas. El dominio sigue la escala del Marco Común Europeo (MCER); para lenguas sin MCER usa el nivel equivalente que describe cada opción.</p>
    {err("languages") && <p className="field-error">{err("languages")}</p>}
    {draft.languages.length ? <ul className="plain-list entry-list" aria-label="Tus idiomas">{draft.languages.map((item, index) => <li key={item.code} className="language-row">
      <strong>{languageLabel(item.code)} <span className="muted small">({item.code})</span></strong>
      <Field label={`Dominio de ${languageLabel(item.code)}`} error={err(`languages.${index}.proficiency`) || err(`languages.${index}.code`)}><select value={item.proficiency} onChange={event => set(index, { proficiency: event.target.value as typeof item.proficiency })}>
        {proficiencyLevels.map(level => <option key={level.value} value={level.value} title={level.descriptor}>{level.label}</option>)}
      </select></Field>
      <label className="switch"><input type="checkbox" checked={item.teaches} onChange={event => set(index, { teaches: event.target.checked })}/>Enseño en este idioma</label>
      <button type="button" className="icon-button" aria-label={`Quitar ${languageLabel(item.code)}`} onClick={() => patch({ languages: draft.languages.filter((_, i) => i !== index) })}><Icon name="close" size={16}/></button>
    </li>)}</ul> : <p className="muted">Aún no agregas idiomas.</p>}
    {draft.languages.length < profileLimits.languages && <div className="specialty-add">
      <Field label="Agregar idioma"><select value="" onChange={event => add(event.target.value)}>
        <option value="">Elige un idioma…</option>{options.filter(option => !draft.languages.some(item => item.code === option.code)).map(option => <option key={option.code} value={option.code}>{option.name}</option>)}
      </select></Field>
      <Field label="Otro idioma (código)" optional hint="Código BCP 47, por ejemplo tzj, pt-BR o es-419."><input value={other} onChange={event => setOther(event.target.value)} maxLength={12} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(other.trim()); setOther(""); } }}/></Field>
      <button type="button" className="button secondary small field-action" disabled={!other.trim()} onClick={() => { add(other.trim()); setOther(""); }}><Icon name="plus" size={16}/>Agregar código</button>
    </div>}
  </>;
}

function TeachingTab({ draft, patch, err }: TabProps) {
  const [label, setLabel] = useState(""), [field, setField] = useState(""), [local, setLocal] = useState("");
  function add() {
    const text = label.trim().replace(/\s+/g, " ");
    if (!text) return;
    if (draft.areas.some(item => item.label.toLocaleLowerCase("es") === text.toLocaleLowerCase("es"))) { setLocal(`«${text}» ya está en tus áreas.`); return; }
    if (draft.areas.length >= profileLimits.areas) { setLocal(`Puedes indicar hasta ${profileLimits.areas} áreas.`); return; }
    if (text.length < 2 || text.length > profileLimits.areaLabel) { setLocal(`Cada área tiene de 2 a ${profileLimits.areaLabel} caracteres.`); return; }
    patch({ areas: [...draft.areas, { label: text, field: field || null }] }); setLabel(""); setField(""); setLocal("");
  }
  return <>
    <fieldset className="config-section">
      <legend>Áreas de enseñanza</legend>
      <p className="muted small">Cualquier materia o tema. Clasificarla en un campo amplio (CINE-F 2013 de la UNESCO) ayuda a encontrarte en el directorio.</p>
      {draft.areas.length ? <ul className="chips" aria-label="Tus áreas de enseñanza">{draft.areas.map(item => <li key={item.label}><span className="chip-button removable-chip">{item.label}{item.field && <span className="muted small"> · {fieldLabel(item.field)}</span>}
        <button type="button" className="chip-remove" aria-label={`Quitar ${item.label}`} onClick={() => patch({ areas: draft.areas.filter(entry => entry !== item) })}><Icon name="close" size={14}/></button></span></li>)}</ul>
        : <p className="muted small">Aún no indicas áreas.</p>}
      {(local || err("areas")) && <p className="field-error" role="alert">{local || err("areas")}</p>}
      <div className="specialty-add">
        <Field label="Nueva área" hint="Por ejemplo: Álgebra, Lectoescritura, Robótica, Inglés como lengua extranjera."><input value={label} maxLength={profileLimits.areaLabel} onChange={event => setLabel(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}/></Field>
        <Field label="Campo amplio" optional><select value={field} onChange={event => setField(event.target.value)}><option value="">Sin clasificar</option>{iscedFields.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <button type="button" className="button secondary small field-action" onClick={add}><Icon name="plus" size={16}/>Agregar área</button>
      </div>
    </fieldset>
    <ChipChoices legend="Niveles educativos que atiendes" hint="Clasificación Internacional Normalizada de la Educación (CINE 2011)." options={iscedLevels.map(item => ({ value: item.value, label: item.label }))} value={draft.levels} onChange={levels => patch({ levels })} error={err("levels")}/>
    <ChipChoices legend="Modalidades" options={teachingModalities} value={draft.modalities} onChange={modalities => patch({ modalities })} error={err("modalities")}/>
    <ChipChoices legend="Formatos" options={teachingFormats} value={draft.formats} onChange={formats => patch({ formats })} error={err("formats")}/>
    <ChipChoices legend="Públicos" options={learnerAudiences} value={draft.audiences} onChange={audiences => patch({ audiences })} error={err("audiences")}/>
    <Field label="Años de experiencia docente" optional error={err("experienceYears")}><input type="number" inputMode="numeric" min={0} max={profileLimits.experienceYears} value={draft.experienceYears ?? ""} onChange={event => patch({ experienceYears: event.target.value === "" ? null : Number(event.target.value) })} className="input-narrow"/></Field>
  </>;
}

function CareerTab({ draft, patch, err, education, setEducation }: TabProps & { education: string; setEducation: (value: string) => void }) {
  const [editing, setEditing] = useState<{ kind: "experience" | "education"; index: number | "new" } | null>(null);
  const emptyExperience = { role: "", institution: "", country: draft.country, from: "", to: null as string | null, description: "" };
  const emptyStudy = { degree: "", institution: "", country: draft.country, year: null as number | null, field: "" };
  return <>
    <section className="stack" aria-labelledby="experience-title">
      <div className="panel-title-row"><h3 id="experience-title" className="section-title">Experiencia</h3>
        {draft.experience.length < profileLimits.experience && <button type="button" className="button secondary small" onClick={() => setEditing({ kind: "experience", index: "new" })}><Icon name="plus" size={16}/>Agregar experiencia</button>}</div>
      {err("experience") && <p className="field-error">{err("experience")}</p>}
      {draft.experience.length ? <ul className="plain-list stack">{draft.experience.map((item, index) => <li key={index} className="entry-card">
        <div className="entry-card-head"><div><strong>{item.role || "Sin cargo"}</strong><p className="muted small">{item.institution}{item.country ? ` · ${countryName(item.country)}` : ""} · {item.from || "sin fecha"}{item.to ? ` a ${item.to}` : " a la fecha"}</p></div>
          <span className="row-actions">
            <button type="button" className="button ghost small" onClick={() => setEditing({ kind: "experience", index })} aria-label={`Editar experiencia ${index + 1}`}><Icon name="edit" size={16}/>Editar</button>
            <button type="button" className="button ghost small" onClick={() => patch({ experience: draft.experience.filter((_, i) => i !== index) })} aria-label={`Quitar experiencia ${index + 1}`}><Icon name="close" size={16}/>Quitar</button>
          </span>
        </div>
        {item.description && <p className="small pre-line">{item.description}</p>}
      </li>)}</ul> : <EmptyState compact icon="users" title="Sin experiencia">Agrega los cargos que quieres que vean el equipo y los estudiantes.</EmptyState>}
    </section>
    <section className="stack" aria-labelledby="education-title">
      <div className="panel-title-row"><h3 id="education-title" className="section-title">Formación</h3>
        {draft.education.length < profileLimits.education && <button type="button" className="button secondary small" onClick={() => setEditing({ kind: "education", index: "new" })}><Icon name="plus" size={16}/>Agregar estudio</button>}</div>
      {err("education") && <p className="field-error">{err("education")}</p>}
      {draft.education.length ? <ul className="plain-list stack">{draft.education.map((item, index) => <li key={index} className="entry-card">
        <div className="entry-card-head"><div><strong>{item.degree || "Sin título"}</strong><p className="muted small">{item.institution}{item.country ? ` · ${countryName(item.country)}` : ""}{item.year ? ` · ${item.year}` : ""}{item.field ? ` · ${item.field}` : ""}</p></div>
          <span className="row-actions">
            <button type="button" className="button ghost small" onClick={() => setEditing({ kind: "education", index })} aria-label={`Editar estudio ${index + 1}`}><Icon name="edit" size={16}/>Editar</button>
            <button type="button" className="button ghost small" onClick={() => patch({ education: draft.education.filter((_, i) => i !== index) })} aria-label={`Quitar estudio ${index + 1}`}><Icon name="close" size={16}/>Quitar</button>
          </span>
        </div>
      </li>)}</ul> : <EmptyState compact icon="file" title="Sin formación">Agrega tus títulos y programas.</EmptyState>}
      <Field label="Resumen de formación" optional hint="Texto libre de tu perfil anterior. Lo ven administración y tú." error={err("educationSummary")}><textarea rows={3} value={education} maxLength={1000} onChange={event => setEducation(event.target.value)}/></Field>
    </section>
    {editing?.kind === "experience" && <ExperienceDrawer item={editing.index === "new" ? emptyExperience : draft.experience[editing.index]} onClose={() => setEditing(null)}
      onSave={value => { patch({ experience: editing.index === "new" ? [...draft.experience, value] : draft.experience.map((item, i) => i === editing.index ? value : item) }); setEditing(null); }}/>}
    {editing?.kind === "education" && <EducationDrawer item={editing.index === "new" ? emptyStudy : draft.education[editing.index]} onClose={() => setEditing(null)}
      onSave={value => { patch({ education: editing.index === "new" ? [...draft.education, value] : draft.education.map((item, i) => i === editing.index ? value : item) }); setEditing(null); }}/>}
  </>;
}

function ExperienceDrawer({ item, onClose, onSave }: { item: ProfessionalProfile["experience"][number]; onClose: () => void; onSave: (value: ProfessionalProfile["experience"][number]) => void }) {
  const [form, setForm] = useState(item);
  const set = (value: Partial<typeof form>) => setForm(current => ({ ...current, ...value }));
  return <Drawer title={item.role ? "Editar experiencia" : "Agregar experiencia"} onClose={onClose}>
    <form className="stack" onSubmit={event => { event.preventDefault(); onSave(form); }}>
      <div className="form-grid-12">
        <div className="form-span-6"><Field label="Cargo"><input value={form.role} maxLength={profileLimits.role} onChange={event => set({ role: event.target.value })} required/></Field></div>
        <div className="form-span-6"><Field label="Institución"><input value={form.institution} maxLength={profileLimits.institution} onChange={event => set({ institution: event.target.value })} required/></Field></div>
        <div className="form-span-4"><CountrySelect label="País" value={form.country} onChange={country => set({ country })}/></div>
        <div className="form-span-4"><Field label="Desde" hint="Mes y año."><input type="month" value={form.from} onChange={event => set({ from: event.target.value })} required/></Field></div>
        <div className="form-span-4"><Field label="Hasta" optional hint="Vacío si es tu cargo actual."><input type="month" value={form.to || ""} onChange={event => set({ to: event.target.value || null })}/></Field></div>
        <div className="form-span-12"><Field label="Descripción" optional><textarea rows={3} value={form.description} maxLength={profileLimits.description} onChange={event => set({ description: event.target.value })}/></Field></div>
      </div>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">Guardar</button></div>
    </form>
  </Drawer>;
}

function EducationDrawer({ item, onClose, onSave }: { item: ProfessionalProfile["education"][number]; onClose: () => void; onSave: (value: ProfessionalProfile["education"][number]) => void }) {
  const [form, setForm] = useState(item);
  const set = (value: Partial<typeof form>) => setForm(current => ({ ...current, ...value }));
  return <Drawer title={item.degree ? "Editar estudio" : "Agregar estudio"} onClose={onClose}>
    <form className="stack" onSubmit={event => { event.preventDefault(); onSave(form); }}>
      <div className="form-grid-12">
        <div className="form-span-6"><Field label="Título o programa"><input value={form.degree} maxLength={profileLimits.degree} onChange={event => set({ degree: event.target.value })} required/></Field></div>
        <div className="form-span-6"><Field label="Institución"><input value={form.institution} maxLength={profileLimits.institution} onChange={event => set({ institution: event.target.value })} required/></Field></div>
        <div className="form-span-6"><Field label="Campo de estudio" optional><input value={form.field} maxLength={profileLimits.field} onChange={event => set({ field: event.target.value })}/></Field></div>
        <div className="form-span-4"><CountrySelect label="País" value={form.country} onChange={country => set({ country })}/></div>
        <div className="form-span-4"><Field label="Año" optional hint="De graduación o el esperado."><input type="number" inputMode="numeric" min={1940} max={2100} value={form.year ?? ""} onChange={event => set({ year: event.target.value === "" ? null : Number(event.target.value) })}/></Field></div>
      </div>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">Guardar</button></div>
    </form>
  </Drawer>;
}

function LinksTab({ draft, patch, err }: TabProps) {
  const set = (index: number, value: Partial<ProfessionalProfile["links"][number]>) => patch({ links: draft.links.map((item, i) => i === index ? { ...item, ...value } : item) });
  return <>
    <p className="muted small">Tu sitio web, LinkedIn, ORCID u otros enlaces profesionales. Solo direcciones seguras (https).</p>
    {err("links") && <p className="field-error">{err("links")}</p>}
    {draft.links.length ? <ul className="plain-list entry-list">{draft.links.map((item, index) => <li key={index} className="link-row">
      <Field label={`Tipo del enlace ${index + 1}`}><select value={item.kind} onChange={event => set(index, { kind: event.target.value as typeof item.kind })}>{profileLinkKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></Field>
      <Field label={`Dirección del enlace ${index + 1}`} error={err(`links.${index}.url`)}><input type="url" inputMode="url" value={item.url} maxLength={profileLimits.url} onChange={event => set(index, { url: event.target.value })} placeholder={item.kind === "orcid" ? "0000-0000-0000-0000" : "https://"}/></Field>
      <button type="button" className="icon-button" aria-label={`Quitar el enlace ${index + 1}`} onClick={() => patch({ links: draft.links.filter((_, i) => i !== index) })}><Icon name="close" size={16}/></button>
    </li>)}</ul> : <p className="muted">Aún no agregas enlaces.</p>}
    {draft.links.length < profileLimits.links && <div><button type="button" className="button secondary small" onClick={() => patch({ links: [...draft.links, { kind: "website", url: "" }] })}><Icon name="plus" size={16}/>Agregar enlace</button></div>}
  </>;
}

function ContactTab({ account, patchAccount, err }: { account: Account; patchAccount: (value: Partial<Account>) => void; err: (path: string) => string | undefined }) {
  const setSlot = (index: number, value: Partial<StaffAvailabilitySlot>) => patchAccount({ availability: account.availability.map((slot, i) => i === index ? { ...slot, ...value } : slot) });
  return <>
    <p className="muted small">Se aplican de inmediato, sin revisión. Por omisión solo los ven administración y tú; en «Privacidad» puedes compartirlos con el equipo. Nunca llegan a los estudiantes.</p>
    <div className="field-grid">
      <Field label="Teléfono" optional error={err("contact.phone")}><input type="tel" value={account.phone} onChange={event => patchAccount({ phone: event.target.value })} maxLength={25} autoComplete="tel" placeholder="+502 5555-0000"/></Field>
      <Field label="Correo de contacto" optional hint="Puede ser distinto del correo con que entras." error={err("contact.contactEmail")}><input type="email" value={account.contactEmail} onChange={event => patchAccount({ contactEmail: event.target.value })} maxLength={254} autoComplete="email"/></Field>
    </div>
    <fieldset className="config-section">
      <legend>Disponibilidad</legend>
      <p className="muted small">Los días y horarios en que puedes impartir clases. Al asignarte una sección, administración ve si sus clases caen fuera de ellos y debe confirmarlo con un motivo.</p>
      {err("availability") && <p className="field-error">{err("availability")}</p>}
      {account.availability.length ? <ul className="availability-list">{account.availability.map((slot, index) => <li key={index} className="availability-row">
        <select aria-label={`Día de la franja ${index + 1}`} value={slot.day} onChange={event => setSlot(index, { day: Number(event.target.value) as StaffAvailabilitySlot["day"] })}>{availabilityDays.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}</select>
        <input type="time" aria-label={`Desde, franja ${index + 1}`} value={slot.start} onChange={event => setSlot(index, { start: event.target.value })} required/>
        <input type="time" aria-label={`Hasta, franja ${index + 1}`} value={slot.end} onChange={event => setSlot(index, { end: event.target.value })} required/>
        <button type="button" className="icon-button" aria-label={`Quitar la franja ${index + 1}`} onClick={() => patchAccount({ availability: account.availability.filter((_, i) => i !== index) })}><Icon name="close" size={16}/></button>
      </li>)}</ul> : <p className="muted small">Sin franjas de disponibilidad.</p>}
      <div><button type="button" className="button secondary small" onClick={() => patchAccount({ availability: [...account.availability, { day: 1, start: "08:00", end: "12:00" }] })}><Icon name="plus" size={16}/>Agregar franja</button></div>
    </fieldset>
  </>;
}

function PrivacyTab({ visibility, onChange }: { visibility: ProfileVisibility; onChange: (value: ProfileVisibility) => void }) {
  return <>
    <p className="muted small">Quién ve cada sección de tu perfil publicado. Administración siempre lo ve completo. Los cambios de privacidad se aplican al guardar, sin revisión.</p>
    <ul className="plain-list privacy-list">{profileSections.map(section => <li key={section.value} className="privacy-row">
      <Field label={section.label}><select value={visibility[section.value]} onChange={event => onChange({ ...visibility, [section.value]: event.target.value })}>
        {section.levels.map(level => <option key={level} value={level}>{visibilityLabels[level]}</option>)}
      </select></Field>
    </li>)}</ul>
  </>;
}

/** ST-155: the person's credentials, with their verification state; each one is edited in a dialog. */
function CredentialsTab({ profile, onChange }: { profile: MyProfessionalProfile; onChange: () => void }) {
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<Credential | "new" | null>(null);
  const active = profile.credentials.filter(item => item.status !== "withdrawn"), withdrawn = profile.credentials.filter(item => item.status === "withdrawn");
  async function act(credential: Credential, step: "submit" | "withdraw") {
    if (step === "withdraw" && !await confirm({ title: `¿Retirar «${credential.name}»?`, body: "Deja de mostrarse en tu perfil y sale de la verificación. Su registro se conserva.", confirm: "Retirar credencial", danger: true })) return;
    try { await api(`/me/credentials/${credential.id}/${step}`, "POST"); toast({ message: step === "submit" ? "Credencial enviada a verificación." : "Credencial retirada." }); onChange(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <>
    <div className="panel-title-row"><p className="muted small">Títulos, certificaciones, licencias y acreditaciones. Administración las verifica; solo las verificadas se muestran, con la insignia «Verificada».</p>
      <button type="button" className="button secondary small" onClick={() => setEditing("new")}><Icon name="plus" size={16}/>Agregar credencial</button></div>
    {active.length ? <ul className="plain-list credential-list" aria-label="Tus credenciales">{active.map(item => <li key={item.id} className="credential-item">
      <div className="credential-text">
        <strong>{item.name}</strong>
        <span className="muted small">{credentialTypeLabel(item.type)} · {item.issuer}{item.country ? ` · ${countryName(item.country)}` : ""} · {departureDay(item.issuedOn)}{item.expiresOn ? ` · vence el ${departureDay(item.expiresOn)}` : ""}</span>
        {item.documentTitle && <span className="muted small"><Icon name="file" size={14}/> Respaldo: {item.documentTitle}</span>}
        {item.status === "rejected" && item.rejectionReason && <span className="field-error small">Motivo del rechazo: {item.rejectionReason}</span>}
      </div>
      <StatusBadge tone={credentialTone[item.status]}>{credentialStatusLabels[item.status]}</StatusBadge>
      <span className="row-actions">
        <button type="button" className="button ghost small" onClick={() => setEditing(item)} aria-label={`Editar ${item.name}`}><Icon name="edit" size={16}/>Editar</button>
        {item.status === "draft" && <button type="button" className="button secondary small" onClick={() => void act(item, "submit")} aria-label={`Enviar a verificación ${item.name}`}><Icon name="send" size={16}/>Enviar a verificación</button>}
        <button type="button" className="button ghost small" onClick={() => void act(item, "withdraw")} aria-label={`Retirar ${item.name}`}><Icon name="archive" size={16}/>Retirar</button>
      </span>
    </li>)}</ul> : <EmptyState compact icon="shield" title="Sin credenciales">Agrega tus títulos y certificaciones. Puedes adjuntar como respaldo un documento de tu expediente.</EmptyState>}
    {withdrawn.length > 0 && <details className="history"><summary>Credenciales retiradas ({withdrawn.length})</summary><ul className="plain-list small">{withdrawn.map(item => <li key={item.id}>{item.name} · {credentialTypeLabel(item.type)}</li>)}</ul></details>}
    {editing && <CredentialDialog userId={profile.userId} credential={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={text => { setEditing(null); toast({ message: text }); onChange(); }}/>}
  </>;
}

function CredentialDialog({ userId, credential, onClose, onDone }: { userId: string; credential: Credential | null; onClose: () => void; onDone: (message: string) => void }) {
  const [file, setFile] = useState<StaffFile | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ type: credential?.type || "degree", name: credential?.name || "", issuer: credential?.issuer || "", country: credential?.country || null as string | null, issuedOn: credential?.issuedOn || "", expiresOn: credential?.expiresOn || "", credentialCode: credential?.credentialCode || "", verificationUrl: credential?.verificationUrl || "", documentId: credential?.documentId || "" });
  useEffect(() => { api<StaffFile>(`/members/${userId}/files`).then(setFile).catch(() => setFile(null)); }, [userId]);
  const set = (value: Partial<typeof form>) => setForm(current => ({ ...current, ...value }));
  async function save(submit: boolean) {
    setBusy(true); setError(""); setErrors({});
    try {
      const body = { ...form, submit, ...(credential ? { version: credential.version } : {}) };
      await api(credential ? `/me/credentials/${credential.id}` : "/me/credentials", credential ? "PUT" : "POST", body);
      onDone(submit ? "Credencial enviada a verificación." : "Credencial guardada como borrador.");
    } catch (cause) { setError(message(cause)); setErrors((cause instanceof ApiError ? cause.detail.errors : undefined) as Record<string, string> || {}); setBusy(false); }
  }
  const documents = (file?.documents || []).filter(item => !item.withdrawnAt);
  return <Drawer title={credential ? "Editar credencial" : "Agregar credencial"} onClose={onClose}>
    <form className="stack" onSubmit={event => { event.preventDefault(); void save(true); }}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      {credential && (credential.status === "verified" || credential.status === "expired") && <p className="message-bar warning"><Icon name="alert" size={18}/>Si cambias una credencial verificada, vuelve a borrador y necesita una nueva verificación.</p>}
      <div className="field-grid">
        <Field label="Tipo" error={errors.type}><select value={form.type} onChange={event => set({ type: event.target.value as typeof form.type })}>{credentialTypes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Nombre de la credencial" error={errors.name}><input value={form.name} maxLength={160} onChange={event => set({ name: event.target.value })} placeholder="Por ejemplo: Licenciatura en Pedagogía"/></Field>
        <Field label="Emisor" hint="Institución u organismo que la otorgó." error={errors.issuer}><input value={form.issuer} maxLength={160} onChange={event => set({ issuer: event.target.value })}/></Field>
        <CountrySelect label="País del emisor" value={form.country} onChange={country => set({ country })} error={errors.country}/>
        <Field label="Fecha de emisión" error={errors.issuedOn}><input type="date" value={form.issuedOn} onChange={event => set({ issuedOn: event.target.value })}/></Field>
        <Field label="Vencimiento" optional error={errors.expiresOn}><input type="date" value={form.expiresOn} onChange={event => set({ expiresOn: event.target.value })}/></Field>
        <Field label="Identificador de la credencial" optional hint="Número de registro o folio. Solo lo ven administración y tú." error={errors.credentialCode}><input value={form.credentialCode} maxLength={100} onChange={event => set({ credentialCode: event.target.value })}/></Field>
        <Field label="Enlace de verificación" optional hint="Dirección https donde el emisor confirma la credencial." error={errors.verificationUrl}><input type="url" inputMode="url" value={form.verificationUrl} onChange={event => set({ verificationUrl: event.target.value })}/></Field>
      </div>
      <Field label="Documento de respaldo" optional hint="Un documento vigente de tu expediente. Para agregar uno nuevo, súbelo en «Mi expediente»." error={errors.documentId}><select value={form.documentId} onChange={event => set({ documentId: event.target.value })}>
        <option value="">Sin documento</option>{documents.map(item => <option key={item.id} value={item.id}>{item.title} · {departureDay(item.issuedOn)}</option>)}
      </select></Field>
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="button secondary" onClick={() => void save(false)}>Guardar borrador</button>
        <button className="button primary">{busy ? "Guardando…" : "Guardar y enviar a verificación"}</button>
      </div>
    </fieldset></form>
  </Drawer>;
}

function PreviewDialog({ profile, draft, visibility, name, photo, onClose }: { profile: MyProfessionalProfile; draft: ProfessionalProfile; visibility: ProfileVisibility; name: string; photo: string | null; onClose: () => void }) {
  const [audience, setAudience] = useState<"learners" | "organization">("learners");
  const view = audienceView(draft, visibility, audience);
  const credentials: PublicCredential[] = reaches(visibility, "credentials", audience) ? profile.credentials.filter(item => item.status === "verified" || (audience === "organization" && item.status === "expired"))
    .map(item => ({ id: item.id, type: item.type, name: item.name, issuer: item.issuer, country: item.country, issuedOn: item.issuedOn, expiresOn: item.expiresOn, status: item.status as "verified" | "expired" })) : [];
  const preview: PublicProfile = { userId: profile.userId, displayName: name, photoUrl: photo ? `/api/members/${profile.userId}/photo?v=${photo}` : null, role: profile.role, audience, sections: view.sections, content: view.content, credentials,
    ...(audience === "organization" && visibility.availability === "organization" ? { availability: profile.availability } : {}),
    ...(audience === "organization" && visibility.contact === "organization" ? { contact: { phone: profile.contact.phone, contactEmail: profile.contact.contactEmail } } : {}),
    version: profile.publication?.version || 0, publishedAt: profile.publication?.publishedAt || "" };
  return <Modal title={audience === "learners" ? "Así te ve un estudiante" : "Así te ve el equipo"} onClose={onClose} wide>
    <div className="stack">
      <div className="segmented" role="radiogroup" aria-label="Ver como">
        <label><input type="radio" name="audience" checked={audience === "learners"} onChange={() => setAudience("learners")}/><span>Como estudiante</span></label>
        <label><input type="radio" name="audience" checked={audience === "organization"} onChange={() => setAudience("organization")}/><span>Como el equipo</span></label>
      </div>
      <p className="muted small">Vista previa de tu versión actual, con la privacidad que elegiste{profile.hasChanges && profile.publication ? ". Hasta que se publique, el resto ve la versión publicada" : ""}. Solo se muestran las credenciales verificadas.</p>
      <ProfileCard profile={preview} level={3}/>
    </div>
  </Modal>;
}

/** A published profile (or its preview) as an audience sees it: identity first, then each visible section. */
export function ProfileCard({ profile, level = 2, compact }: { profile: PublicProfile; level?: 2 | 3; compact?: boolean }) {
  const { content } = profile, H = level === 2 ? "h2" : "h3", S = level === 2 ? "h3" : "h4";
  const verified = profile.credentials.filter(item => item.status === "verified").length;
  const show = (section: ProfileSection) => profile.sections.includes(section);
  const place = [content.city, countryName(content.country)].filter(Boolean).join(", ");
  const teaching = show("teaching") && (content.areas.length || content.levels.length || content.modalities.length || content.formats.length || content.audiences.length || content.experienceYears !== null);
  return <article className={`profile-card${compact ? " compact" : ""}`} aria-label={`Perfil de ${profile.displayName}`}>
    <header className={`profile-card-header${compact ? "" : " is-hero"}`}>
      {profile.photoUrl ? <img className="profile-photo" src={profile.photoUrl} alt="" width={compact ? 56 : 160} height={compact ? 56 : 160}/> : <Avatar name={profile.displayName} size={compact ? 56 : 160}/>}
      <div className="profile-card-title">
        <H>{profile.displayName}</H>
        {(content.preferredName || content.pronouns) && <p className="muted small">{content.preferredName && <>Prefiere que le llamen {content.preferredName}</>}{content.preferredName && content.pronouns ? " · " : ""}{content.pronouns}</p>}
        {content.headline && <p className="profile-headline">{content.headline}</p>}
        {show("languages") && content.languages.length > 0 && <ul className="chips small-chips" aria-label="Idiomas">{content.languages.map(item => <li key={item.code}><span className="chip-button">{languageLabel(item.code)} · {proficiencyLabel(item.proficiency)}</span></li>)}</ul>}
        {!compact && content.videoUrl && show("about") && <p><a className="button secondary small" href={content.videoUrl} target="_blank" rel="noopener noreferrer"><Icon name="play" size={16}/>Ver video de presentación<span className="sr-only"> (se abre en otra pestaña)</span></a></p>}
        <p className="profile-meta muted small">{place && <span><Icon name="home" size={14}/>{place}</span>}{content.timezone && <span><Icon name="clock" size={14}/>{content.timezone.replaceAll("_", " ")}</span>}
          {verified > 0 && <StatusBadge tone="success">{verified === 1 ? "1 credencial verificada" : `${verified} credenciales verificadas`}</StatusBadge>}</p>
      </div>
    </header>
    {show("about") && (content.bio || content.approach || content.videoUrl) && <section className="profile-card-section"><S>Sobre mí</S>
      {content.bio && <p className="pre-line">{content.bio}</p>}
      {content.approach && <><p className="eyebrow">Enfoque de enseñanza</p><p className="pre-line">{content.approach}</p></>}
      {compact && content.videoUrl && <p><a href={content.videoUrl} target="_blank" rel="noopener noreferrer"><Icon name="play" size={16}/>Ver video de presentación<span className="sr-only"> (se abre en otra pestaña)</span></a></p>}
    </section>}
    {show("languages") && content.languages.length > 0 && <section className="profile-card-section"><S>Idiomas</S>
      <ul className="chips">{content.languages.map(item => <li key={item.code}><span className="chip-button">{languageLabel(item.code)} · {proficiencyLabel(item.proficiency)}{item.teaches ? " · enseña" : ""}</span></li>)}</ul>
    </section>}
    {teaching ? <section className="profile-card-section"><S>Enseñanza</S>
      {content.areas.length > 0 && <ul className="chips" aria-label="Áreas">{content.areas.map(item => <li key={item.label}><span className="chip-button" title={fieldLabel(item.field) || undefined}>{item.label}</span></li>)}</ul>}
      <dl className="profile-facts">
        {content.levels.length > 0 && <><dt>Niveles</dt><dd>{content.levels.map(levelLabel).join(", ")}</dd></>}
        {content.modalities.length > 0 && <><dt>Modalidades</dt><dd>{content.modalities.map(modalityLabel).join(", ")}</dd></>}
        {content.formats.length > 0 && <><dt>Formatos</dt><dd>{content.formats.map(formatLabel).join(", ")}</dd></>}
        {content.audiences.length > 0 && <><dt>Públicos</dt><dd>{content.audiences.map(audienceLabel).join(", ")}</dd></>}
        {content.experienceYears !== null && <><dt>Experiencia</dt><dd>{content.experienceYears === 1 ? "1 año" : `${content.experienceYears} años`}</dd></>}
      </dl>
    </section> : null}
    {show("career") && (content.experience.length > 0 || content.education.length > 0) && <section className="profile-card-section"><S>Trayectoria</S>
      {content.experience.length > 0 && <ul className="plain-list timeline">{content.experience.map((item, index) => <li key={index}><strong>{item.role}</strong> · {item.institution}{item.country ? `, ${countryName(item.country)}` : ""}
        <span className="muted small"> · {item.from}{item.to ? ` a ${item.to}` : " a la fecha"}</span>{item.description && <p className="small pre-line">{item.description}</p>}</li>)}</ul>}
      {content.education.length > 0 && <ul className="plain-list timeline">{content.education.map((item, index) => <li key={index}><strong>{item.degree}</strong> · {item.institution}{item.country ? `, ${countryName(item.country)}` : ""}{item.year ? <span className="muted small"> · {item.year}</span> : null}{item.field && <span className="muted small"> · {item.field}</span>}</li>)}</ul>}
    </section>}
    {profile.credentials.length > 0 && <section className="profile-card-section"><S>Credenciales</S>
      <ul className="plain-list">{profile.credentials.map(item => <li key={item.id} className="credential-public"><StatusBadge tone={item.status === "verified" ? "success" : "warning"}>{item.status === "verified" ? "Verificada" : "Vencida"}</StatusBadge>
        <span><strong>{item.name}</strong> <span className="muted small">· {credentialTypeLabel(item.type)} · {item.issuer} · {item.issuedOn.slice(0, 4)}</span></span></li>)}</ul>
    </section>}
    {show("links") && content.links.length > 0 && <section className="profile-card-section"><S>Enlaces</S>
      <ul className="plain-list">{content.links.map(item => <li key={item.url}><a href={item.url} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16}/>{linkKindLabel(item.kind)}<span className="sr-only"> (se abre en otra pestaña)</span></a></li>)}</ul>
    </section>}
    {profile.availability && profile.availability.length > 0 && <section className="profile-card-section"><S>Disponibilidad</S>
      <ul className="plain-list small">{profile.availability.map(slot => <li key={`${slot.day}-${slot.start}`}>{availabilityDays.find(day => day.value === slot.day)?.label} de {slot.start} a {slot.end}</li>)}</ul>
    </section>}
    {profile.contact && (profile.contact.phone || profile.contact.contactEmail) && <section className="profile-card-section"><S>Contacto</S>
      <dl className="profile-facts">{profile.contact.phone && <><dt>Teléfono</dt><dd>{profile.contact.phone}</dd></>}{profile.contact.contactEmail && <><dt>Correo</dt><dd><a href={`mailto:${profile.contact.contactEmail}`}>{profile.contact.contactEmail}</a></dd></>}</dl>
    </section>}
  </article>;
}

type Facet = { value: string; total: number };
/** ST-157: «Equipo», the directory of published profiles with filters by area, level, language and modality. */
export function TeamDirectory() {
  const [data, setData] = useState<{ entries: DirectoryEntry[]; total: number; facets: { areas: Facet[]; languages: Facet[]; levels: Facet[]; modalities: Facet[] } } | null>(null);
  const [error, setError] = useState(""), [filters, setFilters] = useState({ q: "", area: "", level: "", language: "", modality: "" });
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setFilters(current => ({ ...current, q: query })), 250); return () => clearTimeout(timer); }, [query]);
  const load = () => {
    setError("");
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api<NonNullable<typeof data>>(`/profiles${params.size ? `?${params}` : ""}`).then(setData).catch(cause => setError(message(cause)));
  };
  useEffect(load, [filters]);
  const set = (key: keyof typeof filters) => (value: string) => setFilters(current => ({ ...current, [key]: value }));
  const filtered = Object.entries(filters).some(([key, value]) => key !== "q" && value) || !!filters.q;
  return <>
    <PageHeader title="Equipo" description="Conoce a las personas del equipo: qué enseñan, en qué idiomas y en qué niveles. Solo aparecen los perfiles publicados."/>
    <div className="facet-bar directory-filters" role="search" aria-label="Filtrar el equipo">
      <div className="directory-search"><Field label="Buscar"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, titular o área"/></Field></div>
      <Field label="Área"><select value={filters.area} onChange={event => set("area")(event.target.value)}><option value="">Todas</option>
        {(data?.facets.areas || []).map(item => <option key={item.value} value={item.value}>{item.value} ({item.total})</option>)}
        {iscedFields.map(item => <option key={item.value} value={item.value}>Campo: {item.label}</option>)}</select></Field>
      <Field label="Nivel"><select value={filters.level} onChange={event => set("level")(event.target.value)}><option value="">Todos</option>{iscedLevels.map(item => <option key={item.value} value={item.value}>{item.short}</option>)}</select></Field>
      <Field label="Idioma"><select value={filters.language} onChange={event => set("language")(event.target.value)}><option value="">Todos</option>{(data?.facets.languages || []).map(item => <option key={item.value} value={item.value}>{languageLabel(item.value)} ({item.total})</option>)}</select></Field>
      <Field label="Modalidad"><select value={filters.modality} onChange={event => set("modality")(event.target.value)}><option value="">Todas</option>{teachingModalities.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      {filtered && <button type="button" className="button ghost small directory-clear" onClick={() => { setQuery(""); setFilters({ q: "", area: "", level: "", language: "", modality: "" }); }}>Quitar filtros</button>}
    </div>
    {error ? <ErrorState error={error} retry={load}/> : !data ? <Loading label="Cargando el equipo…" cards={3}/> : !data.entries.length
      ? <EmptyState icon="users" title={data.total ? "Nadie coincide con los filtros" : "Aún no hay perfiles publicados"}>{data.total ? "Prueba con otros filtros." : "Cuando las personas del equipo publiquen su perfil, aparecerán aquí."}</EmptyState>
      : <><p className="toolbar-count" role="status">{data.entries.length === 1 ? "1 persona" : `${data.entries.length} personas`}</p>
        <ul className="directory-grid" aria-label="Personas del equipo">{data.entries.map(entry => {
          const extra = entry.areas.length > 3 ? entry.areas.length - 3 : 0;
          return <li key={entry.userId}><article className="directory-card">
            {entry.photoUrl ? <img className="profile-photo" src={entry.photoUrl} alt="" width={72} height={72}/> : <Avatar name={entry.displayName} size={72}/>}
            <div className="stack-tight">
              <h2 className="directory-name"><Link href={`/equipo/${entry.userId}`}>{entry.displayName}</Link>{entry.verifiedCredentials > 0 && <> <StatusBadge tone="success">Verificada</StatusBadge></>}</h2>
              {entry.headline && <p className="small">{entry.headline}</p>}
              {entry.areas.length > 0 && <ul className="chips small-chips" aria-label="Áreas">{entry.areas.slice(0, 3).map(item => <li key={item.label}><span className="chip-button">{item.label}</span></li>)}{extra > 0 && <li><span className="chip-button">+{extra}</span></li>}</ul>}
              {entry.languages.length > 0 && <p className="muted small">{entry.languages.map(item => languageLabel(item.code)).join(", ")}</p>}
            </div>
          </article></li>;
        })}</ul></>}
  </>;
}

/** ST-157: the team page of one person. */
export function TeamProfilePage({ id }: { id: string }) {
  const { member } = useSession();
  const [state, setState] = useState<{ profile: PublicProfile; status: ProfileStatus; active: boolean } | null>(null), [error, setError] = useState(""), [missing, setMissing] = useState(false);
  const load = () => { setError(""); api<NonNullable<typeof state>>(`/profiles/${id}`).then(setState).catch(cause => cause instanceof ApiError && cause.status === 404 ? setMissing(true) : setError(message(cause))); };
  useEffect(load, [id]);
  const crumbs = [{ label: "Equipo", href: "/equipo" }, { label: state?.profile.displayName || "Perfil" }];
  if (missing) return <><PageHeader title="Perfil no disponible" crumbs={crumbs}/><EmptyState icon="user" title="Este perfil no está publicado">La persona aún no publica su perfil o lo ocultó. <Link href="/equipo">Volver al equipo</Link></EmptyState></>;
  if (error) return <><PageHeader title="Perfil" crumbs={crumbs}/><ErrorState error={error} retry={load}/></>;
  if (!state) return <><PageHeader title="Perfil" crumbs={crumbs}/><Loading label="Cargando el perfil…"/></>;
  return <>
    <PageHeader title={state.profile.displayName} crumbs={crumbs} meta={state.status !== "published" || !state.active ? <StatusBadge tone="neutral">{!state.active ? "Sin acceso" : profileStatusLabels[state.status]}</StatusBadge> : undefined}
      actions={id === member.id ? <Link className="button secondary" href="/mi-cuenta/perfil"><Icon name="edit" size={18}/>Editar mi perfil</Link> : undefined}/>
    {state.status === "hidden" && <p className="message-bar warning reading"><Icon name="alert" size={18}/>Este perfil está oculto: solo lo ven la persona y administración.</p>}
    <div className="reading"><ProfileCard profile={state.profile} level={2}/></div>
    <p className="muted small reading">Versión {state.profile.version}, publicada {timeAgo(state.profile.publishedAt)}. Así lo ve el equipo; los estudiantes ven solo lo que la persona comparte con ellos.</p>
  </>;
}

/** Administration: «Perfiles por revisar» and «Credenciales por verificar», with the organization's review setting. */
export function ProfileReviewsPage() {
  const { member } = useSession();
  const { toast } = useFeedback();
  const [queue, setQueue] = useState<ProfileReviewQueue | null>(null), [error, setError] = useState(""), [open, setOpen] = useState<ProfileReviewItem | null>(null);
  const [rejecting, setRejecting] = useState<{ userId: string; credential: Credential } | null>(null);
  const load = () => { setError(""); api<ProfileReviewQueue>("/profile-reviews").then(setQueue).catch(cause => setError(message(cause))); };
  useEffect(load, []);
  async function setting(required: boolean) {
    try { await api("/organization/profile-review", "PUT", { required }); toast({ message: required ? "Los perfiles se revisan antes de publicarse." : "Los perfiles se publican al enviarlos." }); load(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  async function verify(userId: string, credential: Credential) {
    try { await api(`/members/${userId}/credentials/${credential.id}/verify`, "POST"); toast({ message: `«${credential.name}» verificada.` }); load(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  return <>
    <PageHeader title="Revisión de perfiles" description="Aprueba los perfiles profesionales antes de que el equipo y los estudiantes los vean, y verifica las credenciales que las personas envían."/>
    {error ? <ErrorState error={error} retry={load}/> : !queue ? <Loading label="Cargando la revisión…"/> : <div className="stack-lg">
      {member.role === "admin" && <section className="panel" aria-labelledby="review-setting"><div className="panel-header"><h2 id="review-setting">Publicación de perfiles</h2></div>
        <label className="switch"><input type="checkbox" checked={queue.reviewRequired} onChange={event => void setting(event.target.checked)}/>Los perfiles requieren aprobación de administración antes de publicarse</label>
        <p className="muted small">{queue.reviewRequired ? "Cada nueva versión espera tu aprobación; mientras tanto se sigue viendo la versión publicada." : "Al enviarlo, cada perfil se publica de inmediato. Puedes ocultar cualquier perfil desde su revisión."}</p>
      </section>}
      <Section title={`Perfiles por revisar (${queue.profiles.length})`}>
        {!queue.profiles.length ? <p className="muted">No hay perfiles esperando revisión.</p> : <ul className="plain-list review-list">{queue.profiles.map(item => <li key={item.userId} className="review-item">
          {item.photoUrl ? <img className="profile-photo" src={item.photoUrl} alt="" width={40} height={40}/> : <Avatar name={item.name} size={40}/>}
          <div className="stack-tight"><strong>{item.name}</strong>
            <span className="muted small">Versión {item.version} · enviada {timeAgo(item.submittedAt)} · {item.firstPublication ? "Primera publicación" : `Cambia: ${item.changes.join(", ") || "sin cambios de contenido"}`}</span></div>
          <button type="button" className="button secondary small" onClick={() => setOpen(item)} aria-label={`Revisar el perfil de ${item.name}`}><Icon name="eye" size={16}/>Revisar</button>
        </li>)}</ul>}
      </Section>
      <Section title={`Credenciales por verificar (${queue.credentials.length})`}>
        {!queue.credentials.length ? <p className="muted">No hay credenciales esperando verificación.</p> : <div className="table-card" role="region" aria-label="Credenciales por verificar" tabIndex={0}><table>
          <thead><tr><th scope="col">Persona</th><th scope="col">Credencial</th><th scope="col">Emisión</th><th scope="col">Comprobación</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{queue.credentials.map(({ userId, name, credential }) => <tr key={credential.id}>
            <th scope="row">{name}</th>
            <td><span className="document-cell"><strong>{credential.name}</strong><span className="muted small">{credentialTypeLabel(credential.type)} · {credential.issuer}{credential.country ? ` · ${countryName(credential.country)}` : ""}</span></span></td>
            <td>{departureDay(credential.issuedOn)}{credential.expiresOn && <span className="muted small"><br/>Vence el {departureDay(credential.expiresOn)}</span>}</td>
            <td><span className="document-cell small">{credential.credentialCode && <span>Identificador: {credential.credentialCode}</span>}
              {credential.verificationUrl && <a href={credential.verificationUrl} target="_blank" rel="noopener noreferrer"><Icon name="link" size={14}/>Enlace del emisor<span className="sr-only"> (se abre en otra pestaña)</span></a>}
              {credential.documentId && <a href={`/api/members/${userId}/files/${credential.documentId}/content`} download><Icon name="download" size={14}/>{credential.documentTitle || "Documento de respaldo"}</a>}
              {!credential.credentialCode && !credential.verificationUrl && !credential.documentId && <span className="muted">Sin respaldo adjunto</span>}</span></td>
            <td className="cell-actions"><span className="row-actions">
              {userId === member.id ? <span className="muted small">La verifica otra persona</span> : <>
                <button type="button" className="button secondary small" onClick={() => void verify(userId, credential)} aria-label={`Verificar ${credential.name} de ${name}`}><Icon name="check" size={16}/>Verificar</button>
                <button type="button" className="button ghost small" onClick={() => setRejecting({ userId, credential })} aria-label={`Rechazar ${credential.name} de ${name}`}><Icon name="close" size={16}/>Rechazar</button></>}
            </span></td>
          </tr>)}</tbody>
        </table></div>}
      </Section>
    </div>}
    {open && <ReviewDialog item={open} self={open.userId === member.id} onClose={() => setOpen(null)} onDone={text => { setOpen(null); toast({ message: text }); load(); }}/>}
    {rejecting && <ReasonDialog title={`Rechazar «${rejecting.credential.name}»`} label="Motivo del rechazo" hint="La persona lo ve junto a su credencial para corregirla." confirm="Rechazar credencial"
      onClose={() => setRejecting(null)} onConfirm={async reason => { await api(`/members/${rejecting.userId}/credentials/${rejecting.credential.id}/reject`, "POST", { reason }); setRejecting(null); toast({ message: "Credencial rechazada." }); load(); }}/>}
  </>;
}

function ReviewDialog({ item, self, onClose, onDone }: { item: ProfileReviewItem; self: boolean; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [returning, setReturning] = useState(false);
  const full = profileSections.map(section => section.value);
  const view: PublicProfile = { userId: item.userId, displayName: item.name, photoUrl: item.photoUrl, role: "educator", audience: "organization", sections: full, content: item.content, credentials: [], version: item.version, publishedAt: item.submittedAt };
  async function approve() {
    setBusy(true); setError("");
    try { await api(`/members/${item.userId}/profile/approve`, "POST"); onDone(`Perfil de ${item.name} aprobado y publicado.`); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Perfil de ${item.name}`} onClose={onClose} wide footer={self ? <p className="muted small">Otra persona de administración revisa tu perfil.</p> : <>
    <button type="button" className="button secondary" disabled={busy} onClick={() => setReturning(true)}>Pedir cambios</button>
    <button type="button" className="button primary" disabled={busy || item.missing.length > 0} onClick={() => void approve()}><Icon name="check" size={18}/>Aprobar y publicar</button>
  </>}>
    <div className="stack">
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <p className="message-bar"><Icon name="info" size={18}/><span>{item.firstPublication ? "Primera publicación de este perfil." : `Cambia respecto a la versión publicada: ${item.changes.join(", ") || "sin cambios de contenido"}.`} Revisas la versión {item.version} completa; luego cada audiencia ve solo las secciones que la persona comparte.</span></p>
      {item.missing.length > 0 && <p className="form-alert"><Icon name="alert" size={18}/>Le falta {item.missing.join(", ")}.</p>}
      {/* Focusable so the version can be scrolled and read with the keyboard. */}
      <div role="region" aria-label={`Versión ${item.version} enviada`} tabIndex={0} className="review-version"><ProfileCard profile={view} level={3}/></div>
    </div>
    {returning && <ReasonDialog title="Pedir cambios" label="Qué debe cambiar" hint="La persona ve esta nota en su perfil." confirm="Pedir cambios" onClose={() => setReturning(false)}
      onConfirm={async note => { await api(`/members/${item.userId}/profile/request-changes`, "POST", { note }); onDone(`Pediste cambios en el perfil de ${item.name}.`); }}/>}
  </Modal>;
}

function ReasonDialog({ title, label, hint, confirm, onClose, onConfirm }: { title: string; label: string; hint: string; confirm: string; onClose: () => void; onConfirm: (text: string) => Promise<void> }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim().length < 5) { setError("Escribe al menos 5 caracteres."); return; }
    setBusy(true);
    try { await onConfirm(text); } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={title} onClose={onClose}>
    <form className="stack" onSubmit={event => void submit(event)}><fieldset className="stack" disabled={busy}>
      <Field label={label} hint={hint} error={error}><textarea rows={4} value={text} maxLength={500} onChange={event => setText(event.target.value)}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Enviando…" : confirm}</button></div>
    </fieldset></form>
  </Modal>;
}

/** ST-157: «Tu educador» in the student space. */
export function LearnerEducators({ educators }: { educators: PublicProfile[] }) {
  if (!educators.length) return null;
  return <section aria-labelledby="educators-title" className="stack">
    <h2 id="educators-title">{educators.length === 1 ? "Tu educador" : "Tus educadores"}</h2>
    {educators.map(item => <ProfileCard key={item.userId} profile={item} level={3} compact/>)}
  </section>;
}
