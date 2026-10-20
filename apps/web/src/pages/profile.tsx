import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import type { ExpiringDocuments as Overview, StaffAvailabilitySlot, StaffDocument, StaffFile, StaffProfile } from "@happy-learners/contracts";
import { availabilityDays, maxSpecialties, staffDocumentInput, staffDocumentLabel, staffDocumentTypes, staffProfileInput } from "@happy-learners/domain";
import { api, ApiError, message, sendFile } from "../api";
import { Link, useUnsavedChanges } from "../navigation";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import { Avatar } from "../ui/progress";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Section, StatusBadge } from "../ui/primitives";
import type { Tone } from "../ui/primitives";
import { departureDay } from "./departure";
import { formatInstantDate } from "../regional";

/**
 * ST-149: the profile form of the welcome (ST-122) and the profile administration consults; «Mi perfil» is in professional.tsx (ST-154).
 * ST-150: the staff file (expediente) of each person: administration manages it; the person reads and downloads it.
 */
const dayLabel = (day: number) => availabilityDays.find(item => item.value === day)?.label || "";
const slotText = (slot: StaffAvailabilitySlot) => `${dayLabel(slot.day)} de ${slot.start} a ${slot.end}`;
const photoUrl = (userId: string, version: string) => `/api/members/${userId}/photo?v=${version}`;

/** The person's photo when they uploaded one; otherwise their initials. The name is always next to it. */
export function PersonPhoto({ userId, name, version, size = 40, alt = "" }: { userId: string; name: string; version: string | null; size?: number; alt?: string }) {
  return version ? <img className="profile-photo" src={photoUrl(userId, version)} alt={alt} width={size} height={size}/> : <Avatar name={name} size={size}/>;
}

export function ProfileForm({ profile, onSaved }: { profile: StaffProfile; onSaved: (profile: StaffProfile) => void }) {
  const { toast } = useFeedback();
  const [name, setName] = useState(profile.displayName), [phone, setPhone] = useState(profile.contact?.phone || ""), [email, setEmail] = useState(profile.contact?.contactEmail || "");
  const [education, setEducation] = useState(profile.education), [specialties, setSpecialties] = useState(profile.specialties), [availability, setAvailability] = useState<StaffAvailabilitySlot[]>(profile.availability);
  const [specialty, setSpecialty] = useState(""), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [photo, setPhoto] = useState(profile.photoVersion), [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useUnsavedChanges(dirty);
  const touch = () => { setDirty(true); setError(""); };
  function addSpecialty() {
    const text = specialty.trim().replace(/\s+/g, " ");
    if (!text) return;
    if (specialties.some(item => item.toLocaleLowerCase("es") === text.toLocaleLowerCase("es"))) { setError(`«${text}» ya está en tus especialidades.`); return; }
    if (specialties.length >= maxSpecialties) { setError(`Puedes indicar hasta ${maxSpecialties} especialidades.`); return; }
    if (text.length < 2 || text.length > 60) { setError("Cada especialidad tiene de 2 a 60 caracteres."); return; }
    setSpecialties([...specialties, text]); setSpecialty(""); touch();
  }
  const setSlot = (index: number, patch: Partial<StaffAvailabilitySlot>) => { setAvailability(availability.map((slot, i) => i === index ? { ...slot, ...patch } : slot)); touch(); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = { displayName: name, phone, contactEmail: email, education, specialties, availability };
    if (!staffProfileInput(value)) { setError("Revisa el perfil: nombre de 2 a 80 caracteres, teléfono de 7 a 15 dígitos, un correo válido y franjas de disponibilidad con inicio antes del fin que no se crucen el mismo día."); return; }
    setBusy(true); setError("");
    try {
      const result = await api<{ profile: StaffProfile; changed: string[] }>("/profile", "PUT", value);
      setDirty(false); onSaved(result.profile); setAvailability(result.profile.availability);
      toast({ message: result.changed.length ? "Perfil guardado." : "No había cambios que guardar." });
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }
  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { toast({ tone: "error", message: "La foto debe ser una imagen JPG, PNG o WebP de hasta 2 MB." }); return; }
    setPhotoBusy(true);
    try { const result = await sendFile<{ photoVersion: string }>("/profile/photo", "PUT", file, { "Content-Type": file.type }); setPhoto(result.photoVersion); toast({ message: "Foto actualizada." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setPhotoBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function removePhoto() {
    setPhotoBusy(true);
    try { await api("/profile/photo", "DELETE"); setPhoto(null); toast({ message: "Foto quitada." }); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
    finally { setPhotoBusy(false); }
  }
  return <div className="reading stack">
    <section className="panel profile-photo-panel" aria-labelledby="photo-title">
      <div className="panel-header"><h2 id="photo-title">Foto</h2></div>
      <div className="profile-photo-row">
        <PersonPhoto userId={profile.userId} name={name || profile.username} version={photo} size={72} alt={photo ? "Tu foto de perfil" : ""}/>
        <div className="stack">
          <p className="muted small">JPG, PNG o WebP de hasta 2 MB. La ven las personas del equipo de tus cursos y administración.</p>
          <div className="form-actions">
            <label className="button secondary small file-button"><Icon name="upload" size={16}/>{photoBusy ? "Subiendo…" : photo ? "Cambiar foto" : "Subir foto"}
              <input ref={fileRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} onChange={event => void uploadPhoto(event.target.files?.[0])}/></label>
            {photo && <button type="button" className="button ghost small" disabled={photoBusy} onClick={() => void removePhoto()}>Quitar foto</button>}
          </div>
        </div>
      </div>
    </section>
    <form className="form-card" onSubmit={save}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <fieldset className="stack" disabled={busy}>
        <Field label="Nombre" hint="Como aparece en los cursos, las secciones y la actividad."><input value={name} onChange={event => { setName(event.target.value); touch(); }} required minLength={2} maxLength={80} autoComplete="name"/></Field>
        <div className="field-grid">
          <Field label="Teléfono" optional hint="Solo lo ven administración y tú."><input type="tel" value={phone} onChange={event => { setPhone(event.target.value); touch(); }} maxLength={25} autoComplete="tel" placeholder="+502 5555-0000"/></Field>
          <Field label="Correo de contacto" optional hint="Puede ser distinto del correo con que entras. Solo lo ven administración y tú."><input type="email" value={email} onChange={event => { setEmail(event.target.value); touch(); }} maxLength={254} autoComplete="email"/></Field>
        </div>
        <Field label="Formación" optional hint="Títulos, estudios y certificaciones."><textarea value={education} onChange={event => { setEducation(event.target.value); touch(); }} rows={3} maxLength={1000}/></Field>
        <fieldset className="config-section">
          <legend>Especialidades</legend>
          {specialties.length ? <ul className="chips" aria-label="Tus especialidades">{specialties.map(item => <li key={item}><span className="chip-button removable-chip">{item}
            <button type="button" className="chip-remove" aria-label={`Quitar ${item}`} onClick={() => { setSpecialties(specialties.filter(entry => entry !== item)); touch(); }}><Icon name="close" size={14}/></button></span></li>)}</ul>
            : <p className="muted small">Aún no indicas especialidades.</p>}
          <div className="specialty-add">
            <Field label="Nueva especialidad" hint={`Por ejemplo: Matemática, Inglés, Robótica. Hasta ${maxSpecialties}.`}>
              <input value={specialty} maxLength={60} onChange={event => setSpecialty(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); addSpecialty(); } }}/>
            </Field>
            <button type="button" className="button secondary small field-action" onClick={addSpecialty}><Icon name="plus" size={16}/>Agregar especialidad</button>
          </div>
        </fieldset>
        <fieldset className="config-section">
          <legend>Disponibilidad</legend>
          <p className="muted small">Los días y horarios en que puedes impartir clases.</p>
          {availability.length ? <ul className="availability-list">{availability.map((slot, index) => <li key={index} className="availability-row">
            <select aria-label={`Día de la franja ${index + 1}`} value={slot.day} onChange={event => setSlot(index, { day: Number(event.target.value) as StaffAvailabilitySlot["day"] })}>{availabilityDays.map(day => <option key={day.value} value={day.value}>{day.label}</option>)}</select>
            <input type="time" aria-label={`Desde, franja ${index + 1}`} value={slot.start} onChange={event => setSlot(index, { start: event.target.value })} required/>
            <input type="time" aria-label={`Hasta, franja ${index + 1}`} value={slot.end} onChange={event => setSlot(index, { end: event.target.value })} required/>
            <button type="button" className="icon-button" aria-label={`Quitar la franja ${index + 1}`} onClick={() => { setAvailability(availability.filter((_, i) => i !== index)); touch(); }}><Icon name="close" size={16}/></button>
          </li>)}</ul> : <p className="muted small">Sin franjas de disponibilidad.</p>}
          <div><button type="button" className="button secondary small" onClick={() => { setAvailability([...availability, { day: 1, start: "08:00", end: "12:00" }]); touch(); }}><Icon name="plus" size={16}/>Agregar franja</button></div>
        </fieldset>
        <div className="form-actions"><button className="button primary">{busy ? "Guardando…" : "Guardar perfil"}</button></div>
      </fieldset>
    </form>
  </div>;
}

/** What administration (or a teammate, without contact data) sees of a person's profile. */
function ProfileSummary({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<StaffProfile | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); api<{ profile: StaffProfile }>(`/members/${userId}/profile`).then(result => setProfile(result.profile)).catch(cause => setError(message(cause))); };
  useEffect(load, [userId]);
  if (error) return <ErrorState error={error} retry={load}/>;
  if (!profile) return <Loading label="Cargando perfil…" lines={3}/>;
  const none = <span className="muted">Sin indicar</span>;
  return <div className="stack">
    <div className="profile-photo-row"><PersonPhoto userId={profile.userId} name={profile.displayName} version={profile.photoVersion} size={64}/>
      <div><strong>{profile.displayName}</strong><p className="muted small">@{profile.username} · {profile.role === "admin" ? "Administración" : "Educador"}{profile.active ? "" : " · Sin acceso"}</p></div></div>
    <dl className="profile-facts">
      {profile.contact && <><dt>Teléfono</dt><dd>{profile.contact.phone || none}</dd>
        <dt>Correo de contacto</dt><dd>{profile.contact.contactEmail || none}</dd>
        <dt>Correo de acceso</dt><dd>{profile.contact.loginEmail || none}</dd></>}
      <dt>Formación</dt><dd className="pre-line">{profile.education || none}</dd>
      <dt>Especialidades</dt><dd>{profile.specialties.length ? <ul className="chips">{profile.specialties.map(item => <li key={item}><span className="chip-button">{item}</span></li>)}</ul> : none}</dd>
      <dt>Disponibilidad</dt><dd>{profile.availability.length ? <ul className="plain-list">{profile.availability.map(slot => <li key={`${slot.day}-${slot.start}`}>{slotText(slot)}</li>)}</ul> : none}</dd>
    </dl>
    {profile.updatedAt && <p className="muted small">Actualizado el {formatInstantDate(profile.updatedAt, "long")}.</p>}
    <p><Link href={`/equipo/${profile.userId}`}>Ver su perfil profesional</Link> <span className="muted small">(si lo publicó). Lo que envía a revisión está en «Revisión de perfiles».</span></p>
  </div>;
}

const statusTone: Record<StaffDocument["status"], Tone> = { valid: "success", expiring: "warning", expired: "danger" };
const statusLabel: Record<StaffDocument["status"], string> = { valid: "Vigente", expiring: "Por vencer", expired: "Vencido" };
export function DocumentStatus({ document }: { document: Pick<StaffDocument, "status"> & { withdrawnAt?: string | null } }) {
  return document.withdrawnAt ? <StatusBadge>Retirado</StatusBadge> : <StatusBadge tone={statusTone[document.status]}>{statusLabel[document.status]}</StatusBadge>;
}

/** The staff file: administration uploads, downloads and withdraws; the person reads, downloads and may add documents. */
export function StaffFileSection({ userId, title, admin }: { userId: string; title: string; admin: boolean }) {
  const { toast, confirm } = useFeedback();
  const [file, setFile] = useState<StaffFile | null>(null), [error, setError] = useState(""), [adding, setAdding] = useState(false);
  const load = () => { setError(""); api<StaffFile>(`/members/${userId}/files`).then(setFile).catch(cause => setError(message(cause))); };
  useEffect(load, [userId]);
  async function withdraw(document: StaffDocument) {
    if (!await confirm({ title: `¿Retirar «${document.title}»?`, body: "Deja de formar parte del expediente vigente y la persona ya no lo verá. Su registro y el archivo se conservan para administración.", confirm: "Retirar documento", danger: true })) return;
    try { await api(`/members/${userId}/files/${document.id}/withdraw`, "POST"); toast({ message: "Documento retirado del expediente." }); load(); }
    catch (cause) { toast({ tone: "error", message: message(cause) }); }
  }
  const action = file && <button type="button" className="button secondary small" onClick={() => setAdding(true)}><Icon name="upload" size={16}/>Agregar documento</button>;
  return <Section title={title} action={action}>
    <p className="muted small">{admin ? "Documentos laborales privados: solo administración y la propia persona los consultan. Cada carga, consulta y retiro queda en la actividad." : "Tus documentos laborales. Solo administración y tú los consultan; cada carga y consulta queda en la actividad."}</p>
    {error ? <ErrorState error={error} retry={load}/> : !file ? <Loading label="Cargando expediente…" lines={3}/> : !file.documents.length
      ? <EmptyState compact icon="file" title="Sin documentos">{admin ? "Agrega la identificación, la hoja de vida, los antecedentes y las constancias de la persona." : "Administración agrega aquí tus documentos laborales. También puedes agregar los tuyos."}</EmptyState>
      : <div className="table-card" role="region" aria-label={`Documentos de ${title.toLowerCase()}`} tabIndex={0}><table className="staff-file-table">
        <caption className="sr-only">Documentos del expediente con su emisión, vencimiento y estado</caption>
        <thead><tr><th scope="col">Documento</th><th scope="col">Emisión</th><th scope="col">Vencimiento</th><th scope="col">Estado</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{file.documents.map(document => <tr key={document.id} className={document.withdrawnAt ? "is-archived" : undefined}>
          <th scope="row"><span className="document-cell"><strong>{document.title}</strong><span className="muted small">{staffDocumentLabel(document.type)}{document.selfUploaded ? " · agregado por la persona" : ""}</span></span></th>
          <td>{departureDay(document.issuedOn)}</td>
          <td>{document.expiresOn ? departureDay(document.expiresOn) : <span className="muted">Sin vencimiento</span>}</td>
          <td><DocumentStatus document={document}/></td>
          <td className="cell-actions"><span className="row-actions">
            <a className="button ghost small" href={`/api/members/${userId}/files/${document.id}/content`} download aria-label={`Descargar ${document.title}`}><Icon name="download" size={16}/>Descargar</a>
            {admin && !document.withdrawnAt && <button type="button" className="button ghost small" aria-label={`Retirar ${document.title}`} onClick={() => void withdraw(document)}><Icon name="archive" size={16}/>Retirar</button>}
          </span></td>
        </tr>)}</tbody>
      </table></div>}
    {adding && file && <DocumentDialog userId={userId} today={file.today} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast({ message: "Documento agregado al expediente." }); load(); }}/>}
  </Section>;
}

const documentTypes: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
function DocumentDialog({ userId, today, onClose, onDone }: { userId: string; today: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget), upload = form.get("file");
    const meta = staffDocumentInput({ type: form.get("type"), title: form.get("title"), issuedOn: form.get("issuedOn"), expiresOn: form.get("expiresOn") || null }, today);
    if (!meta) { setError("Elige el tipo, una fecha de emisión que no sea futura y, si tiene, un vencimiento posterior a la emisión."); return; }
    if (!(upload instanceof File) || !upload.size) { setError("Elige el archivo del documento."); return; }
    const mediaType = documentTypes[upload.name.split(".").pop()?.toLowerCase() || ""] || upload.type;
    if (!Object.values(documentTypes).includes(mediaType) || upload.size > 10 * 1024 * 1024) { setError("Sube un PDF, JPG o PNG de hasta 10 MB."); return; }
    setBusy(true);
    try {
      await sendFile(`/members/${userId}/files`, "POST", upload, { "Content-Type": mediaType, "X-Document-Type": meta.type, "X-Document-Title": encodeURIComponent(meta.title), "X-Issued-On": meta.issuedOn, ...(meta.expiresOn ? { "X-Expires-On": meta.expiresOn } : {}) });
      onDone();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : message(cause)); setBusy(false); }
  }
  return <Modal title="Agregar documento" onClose={onClose}>
    <form className="stack" onSubmit={submit}><fieldset className="stack" disabled={busy}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Tipo"><select name="type" defaultValue="cv">{staffDocumentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></Field>
      <Field label="Título" optional hint="Si lo dejas vacío, se usa el tipo. No escribas números de documento."><input name="title" maxLength={120} autoComplete="off"/></Field>
      <div className="field-grid">
        <Field label="Fecha de emisión"><input name="issuedOn" type="date" required max={today}/></Field>
        <Field label="Vencimiento" optional hint="Se avisa 30 días antes."><input name="expiresOn" type="date"/></Field>
      </div>
      <Field label="Archivo" hint="PDF, JPG o PNG de hasta 10 MB. Se guarda en almacenamiento privado."><input name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary">{busy ? "Subiendo…" : "Agregar documento"}</button></div>
    </fieldset></form>
  </Modal>;
}

/** Administration's view of one person: profile and staff file, as tabs. */
export function PersonDetail({ person, onClose }: { person: { id: string; name: string }; onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "file">("profile");
  const base = useId(), tabs: [typeof tab, string][] = [["profile", "Perfil"], ["file", "Expediente"]];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    setTab(tabs[next][0]); refs.current[next]?.focus();
  }
  let panel: ReactNode = null;
  if (tab === "profile") panel = <ProfileSummary userId={person.id}/>;
  else panel = <StaffFileSection userId={person.id} title="Expediente" admin/>;
  return <Modal title={person.name} onClose={onClose} wide>
    <div role="tablist" aria-label={`Datos de ${person.name}`} className="tabs">
      {tabs.map(([value, label], index) => <button key={value} ref={element => { refs.current[index] = element; }} type="button" role="tab" id={`${base}-${value}`} aria-controls={`${base}-panel`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className="tab" onClick={() => setTab(value)} onKeyDown={event => onKey(event, index)}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className="tab-panel">{panel}</div>
  </Modal>;
}

/** Administration: active people with expired documents or documents that expire within 30 days. */
export function ExpiringDocuments({ onOpen, revision = 0 }: { onOpen: (person: { id: string; name: string }) => void; revision?: number }) {
  const [overview, setOverview] = useState<Overview | null>(null), [error, setError] = useState("");
  const load = () => { setError(""); api<Overview>("/expiring-documents").then(setOverview).catch(cause => setError(message(cause))); };
  useEffect(load, [revision]);
  return <Section title="Documentos vencidos o por vencer">
    {error ? <ErrorState error={error} retry={load}/> : !overview ? <Loading label="Revisando vencimientos…" lines={2}/> : !overview.people.length
      ? <p className="muted">Ningún expediente tiene documentos vencidos ni que venzan en los próximos 30 días.</p>
      : <ul className="expiring-list">{overview.people.map(person => <li key={person.id}>
        <button type="button" className="link-button" onClick={() => onOpen(person)}>{person.name}</button>
        <ul className="plain-list">{person.documents.map(document => <li key={document.id}><DocumentStatus document={document}/> <span>{document.title} · {staffDocumentLabel(document.type)}</span> <span className="muted small">{document.status === "expired" ? "venció" : "vence"} el {departureDay(document.expiresOn!)}</span></li>)}</ul>
      </li>)}</ul>}
  </Section>;
}
