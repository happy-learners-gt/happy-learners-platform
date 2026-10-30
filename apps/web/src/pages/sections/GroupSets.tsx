import { useEffect, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import type { GroupLearner, WorkGroup } from "@happy-learners/contracts";
import { groupRulesInput, type GroupRules, type UnmetConstraint } from "@happy-learners/domain";
import { api, message } from "../../api";
import { plural, sessionDay } from "../../model";
import { Modal, useFeedback } from "../../ui/feedback";
import { Icon } from "../../ui/icons";
import { Menu } from "../../ui/Menu";
import { Button, EmptyState, Field, Section } from "../../ui/primitives";

type Formed = { name: string; learnerIds: string[] };
type StoredGroup = Formed & { id: string };
type UsedIn = { kind: "lesson" | "assessment"; activityId: string; title: string };
export type GroupActivityRow = UsedIn & { lessonId?: string; detail: string; setId: string | null; workGroupIds: string[]; grouping?: string; own?: boolean };
type GroupSet = {
  id: string; name: string; sessionId: string | null; graded?: boolean; rules: GroupRules;
  groups: StoredGroup[]; unmet?: UnmetConstraint[]; usedIn?: UsedIn[];
};
type Session = { id: string; sessionDate: string; groupId: string };
type Preview = { groups: Formed[]; unmet: UnmetConstraint[] };

/**
 * Reusable splits of a section (lote 3b). The teacher previews who is together, then keeps the set, moves a student
 * and archives it. A set that already has grades explains why it cannot be formed again.
 */
export function GroupSets({ sectionId, courseId, learners, workGroups, writable, forming, onForming, onToast, onNewGroup, revision = 0, onActivities, onSets }: {
  sectionId: string; courseId: string; learners: GroupLearner[]; workGroups: WorkGroup[]; writable: boolean;
  forming: boolean; onForming: (open: boolean) => void; onToast: (message: string, error?: boolean) => void;
  onNewGroup?: () => void; revision?: number; onActivities?: (activities: GroupActivityRow[]) => void; onSets?: (sets: { id: string; name: string }[]) => void;
}) {
  const { confirm } = useFeedback();
  const [sets, setSets] = useState<GroupSet[] | null>(null), [error, setError] = useState("");
  const [renaming, setRenaming] = useState<GroupSet | null>(null), [regenerating, setRegenerating] = useState<GroupSet | null>(null);
  const names = new Map(learners.map(learner => [learner.id, learner.displayName]));
  const path = `/sections/${sectionId}/group-sets`;
  async function load() {
    try {
      const payload = await api<{ sets: GroupSet[]; activities?: GroupActivityRow[] }>(path);
      setSets(payload.sets); setError(""); onActivities?.(payload.activities || []); onSets?.(payload.sets.map(item => ({ id: item.id, name: item.name })));
    }
    catch (cause) { setError(message(cause)); }
  }
  useEffect(() => { void load(); }, [sectionId, revision]);
  async function move(set: GroupSet, learnerId: string, toId: string) {
    const groups = set.groups.map(group => ({
      id: group.id, name: group.name,
      learnerIds: group.id === toId ? [...group.learnerIds, learnerId] : group.learnerIds.filter(id => id !== learnerId),
    }));
    try { await api(`${path}/${set.id}`, "PUT", { groups }); await load(); onToast(`${names.get(learnerId)} pasó de grupo.`); }
    catch (cause) { onToast(message(cause), true); }
  }
  async function archive(set: GroupSet) {
    if (!await confirm({ title: `¿Archivar «${set.name}»?`, body: <p>Deja de ofrecerse para actividades nuevas. Las notas que ya usó este conjunto se conservan.</p>, confirm: "Archivar conjunto" })) return;
    try { await api(`${path}/${set.id}`, "DELETE"); await load(); onToast(`«${set.name}» se archivó.`); }
    catch (cause) { onToast(message(cause), true); }
  }
  return <Section title={`Conjuntos de grupos${sets ? ` (${sets.length})` : ""}`}>
    {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
    {!sets ? <p className="muted">Cargando conjuntos…</p>
      : !sets.length ? <EmptyState compact icon="team" title="Aún no hay conjuntos">{writable ? "Forma un conjunto para calificar una actividad en grupos." : "Cuando se forme un conjunto, sus grupos aparecen aquí."}</EmptyState>
      : <div className="set-board">{sets.map(set => <article key={set.id} className="set-card lit" aria-labelledby={`set-${set.id}`}>
        <header>
          <div><h3 id={`set-${set.id}`}>{set.name}</h3><p className="muted small">{plural(set.groups.length, "grupo", "grupos")} · {set.sessionId ? "de una clase" : "de toda la lista"}</p></div>
          <div className="set-card-actions">
          {writable && set.name === "Grupos de la sección" && onNewGroup && <Button icon="plus" className="small" onClick={onNewGroup}>Nuevo grupo</Button>}
          {writable && <Menu label={`Acciones del conjunto ${set.name}`} items={[
            { label: "Renombrar", icon: "edit", onSelect: () => setRenaming(set) },
            { label: set.graded ? "Regenerar: este conjunto ya tiene notas" : "Regenerar", icon: "undo", onSelect: () => setRegenerating(set) },
            "separator",
            { label: "Archivar", icon: "archive", danger: true, onSelect: () => void archive(set) },
          ]}/>}
          </div>
        </header>
        <p className="muted small">Se usa en {set.usedIn?.length ? set.usedIn.map(item => item.title).join(", ") : "ninguna actividad"}.</p>
        <div className="set-groups">{set.groups.map(group => <div key={group.id} className="set-group" data-set-group={group.id}>
          <h4>{group.name}</h4>
          <ul className="set-members" aria-label={`Integrantes de ${group.name}`}>
            {group.learnerIds.map(id => <Member key={id} name={names.get(id) || id} movable={writable && set.groups.length > 1 && !set.graded} others={set.groups.filter(item => item.id !== group.id)} onMove={to => void move(set, id, to)}/>)}
          </ul>
          {!group.learnerIds.length && <p className="muted small">Sin integrantes.</p>}
        </div>)}</div>
      </article>)}</div>}
    {forming && <FormationDialog path={path} courseId={courseId} sectionId={sectionId} learners={learners} workGroups={workGroups} onClose={() => onForming(false)} onCreated={async name => { onForming(false); await load(); onToast(`«${name}» quedó formado.`); }}/>}
    {renaming && <RenameDialog set={renaming} path={path} onClose={() => setRenaming(null)} onSaved={async name => { setRenaming(null); await load(); onToast(`El conjunto ahora se llama «${name}».`); }}/>}
    {regenerating && <RegenerateDialog set={regenerating} path={path} onClose={() => setRegenerating(null)} onSaved={async () => { setRegenerating(null); await load(); onToast(`«${regenerating.name}» se volvió a formar.`); }}/>}
  </Section>;
}

function Member({ name, movable, others, onMove }: { name: string; movable: boolean; others: StoredGroup[]; onMove: (groupId: string) => void }) {
  function down(event: PointerEvent<HTMLButtonElement>) {
    if (!movable || (event.pointerType === "mouse" && event.button !== 0)) return;
    const item = event.currentTarget.closest("li");
    if (!item) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    item.classList.add("is-dragging");
  }
  function end(event: PointerEvent<HTMLButtonElement>, drop: boolean) {
    const item = event.currentTarget.closest("li");
    item?.classList.remove("is-dragging");
    document.querySelectorAll<HTMLElement>("[data-drop]").forEach(node => delete node.dataset.drop);
    if (!drop) return;
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-set-group]");
    const target = under?.dataset.setGroup;
    const home = item?.closest<HTMLElement>("[data-set-group]")?.dataset.setGroup;
    if (target && target !== home) onMove(target);
  }
  function over(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    document.querySelectorAll<HTMLElement>("[data-drop]").forEach(node => delete node.dataset.drop);
    const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-set-group]");
    const home = event.currentTarget.closest<HTMLElement>("[data-set-group]")?.dataset.setGroup;
    if (under && under.dataset.setGroup !== home) under.dataset.drop = "into";
  }
  return <li className="set-member">
    {movable && <button type="button" className="drag-handle" aria-label={`Arrastrar a ${name} a otro grupo`} title="Arrastra a otro grupo, o usa Mover a…"
      onPointerDown={down} onPointerMove={over} onPointerUp={event => end(event, true)} onPointerCancel={event => end(event, false)}><Icon name="reorder" size={16}/></button>}
    <span>{name}</span>
    {movable && <Menu label={`Mover a ${name}`} items={others.map(group => ({ label: `Mover a ${group.name}`, onSelect: () => onMove(group.id) }))}/>}
  </li>;
}

function FormationDialog({ path, courseId, sectionId, learners, workGroups, onClose, onCreated }: {
  path: string; courseId: string; sectionId: string; learners: GroupLearner[]; workGroups: WorkGroup[];
  onClose: () => void; onCreated: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("Conjunto");
  const [who, setWho] = useState<"all" | "class">("all"), [sessionId, setSessionId] = useState("");
  const [by, setBy] = useState<"size" | "count">("size"), [amount, setAmount] = useState("3");
  const [how, setHow] = useState<GroupRules["how"]>("random"), [periodId, setPeriodId] = useState("");
  const [minimum, setMinimum] = useState(""), [maximum, setMaximum] = useState("");
  const [together, setTogether] = useState<[string, string][]>([]);
  const [apart, setApart] = useState<[string, string][]>([]);
  const [left, setLeft] = useState(learners[0]?.id || ""), [right, setRight] = useState(learners[1]?.id || "");
  const [seed, setSeed] = useState("clase");
  const [sessions, setSessions] = useState<Session[]>([]), [periods, setPeriods] = useState<{ id: string; name: string }[]>([]), [grades, setGrades] = useState<{ learnerId: string; periodId: string; score: number }[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  const names = new Map(learners.map(learner => [learner.id, learner.displayName]));
  useEffect(() => {
    api<{ sessions?: Session[] }>(`/courses/${courseId}/sessions?section=${encodeURIComponent(sectionId)}`).then(result => setSessions((result.sessions || []).filter(item => item.groupId === sectionId)), () => undefined);
    api<{ gradebook?: { periods: { id: string; name: string }[]; grades: { learnerId: string; periodId: string; score: number }[] } }>(`/sections/${sectionId}/grades`).then(result => { setPeriods(result.gradebook?.periods || []); setGrades(result.gradebook?.grades || []); }, () => undefined);
  }, [courseId, sectionId]);
  function rules(): GroupRules | { error: string } {
    const count = Number(amount);
    const bounds = {
      ...(minimum.trim() ? { minimum: Number(minimum) } : {}),
      ...(maximum.trim() ? { maximum: Number(maximum) } : {}),
    };
    const attributes: Record<string, string> = {};
    if (how === "mixed") for (const learner of learners) {
      const group = workGroups.find(item => item.learnerIds.includes(learner.id));
      if (group) attributes[learner.id] = group.name;
    }
    const scores: Record<string, number> = {};
    if (how === "balanced") for (const grade of grades) if (grade.periodId === periodId) scores[grade.learnerId] = grade.score;
    return groupRulesInput({
      by, how, seed, ...(by === "size" ? { size: count } : { count }), ...bounds,
      ...(together.length ? { together } : {}), ...(apart.length ? { apart } : {}),
      ...(how === "mixed" && Object.keys(attributes).length ? { attributes } : {}),
      ...(how === "balanced" && Object.keys(scores).length ? { scores } : {}),
    });
  }
  function body() {
    if (who === "class" && !sessionId) return "Elige la clase de la que tomas los presentes.";
    if (how === "balanced" && !periodId) return "Elige el periodo con el que equilibras los grupos.";
    const built = rules();
    if ("error" in built) return built.error;
    return { name: name.trim(), rules: built, ...(who === "class" ? { sessionId } : {}) };
  }
  async function runPreview(nextSeed = seed) {
    setSeed(nextSeed);
    const payload = body();
    if (typeof payload === "string") { setError(payload); return; }
    if (nextSeed !== seed) payload.rules = { ...payload.rules, seed: nextSeed };
    setBusy("preview"); setError("");
    try { const result = await api<Preview & { unmet: UnmetConstraint[] }>(`${path}?preview=1`, "POST", payload); setPreview({ groups: result.groups || [], unmet: result.unmet || [] }); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(""); }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    const payload = body();
    if (typeof payload === "string") { setError(payload); return; }
    setBusy("create"); setError("");
    try { await api(path, "POST", payload); await onCreated(payload.name); }
    catch (cause) { setError(message(cause)); setBusy(""); }
  }
  const addPair = (kind: "together" | "apart") => {
    if (!left || !right || left === right) return;
    const pair: [string, string] = [left, right];
    if (kind === "together") setTogether(current => [...current, pair]);
    else setApart(current => [...current, pair]);
  };
  return <Modal wide title="Formar grupos" onClose={onClose}>
    <form className="stack set-wizard" onSubmit={create}>
      {error && <p className="form-alert" role="alert"><Icon name="alert" size={18}/>{error}</p>}
      <Field label="Nombre del conjunto"><input value={name} maxLength={80} required onChange={event => setName(event.target.value)}/></Field>
      <fieldset className="stack"><legend>Quiénes</legend>
        <label className="lock"><input type="radio" name="who" checked={who === "all"} onChange={() => setWho("all")}/><span>Toda la lista</span></label>
        <label className="lock"><input type="radio" name="who" checked={who === "class"} onChange={() => setWho("class")}/><span>Los presentes de una clase</span></label>
        {who === "class" && <Field label="Clase"><select aria-label="Clase" value={sessionId} onChange={event => setSessionId(event.target.value)}><option value="">Elegir clase…</option>{sessions.map(session => <option key={session.id} value={session.id}>{sessionDay(session.sessionDate, "short")}{"startsAt" in session && session.startsAt ? `, ${session.startsAt}` : ""}</option>)}</select></Field>}
      </fieldset>
      <fieldset className="stack"><legend>Cuántos</legend>
        <label className="lock"><input type="radio" name="by" checked={by === "size"} onChange={() => setBy("size")}/><span>Por tamaño</span></label>
        <label className="lock"><input type="radio" name="by" checked={by === "count"} onChange={() => setBy("count")}/><span>Por cantidad</span></label>
        <Field label={by === "size" ? "Tamaño de cada grupo" : "Cantidad de grupos"}><input inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)}/></Field>
        <div className="field-grid">
          <Field label="Mínimo"><input inputMode="numeric" value={minimum} aria-label="Mínimo" onChange={event => setMinimum(event.target.value)}/></Field>
          <Field label="Máximo"><input inputMode="numeric" value={maximum} aria-label="Máximo" onChange={event => setMaximum(event.target.value)}/></Field>
        </div>
      </fieldset>
      <fieldset className="stack"><legend>Cómo</legend>
        <label className="lock"><input type="radio" name="how" checked={how === "random"} onChange={() => setHow("random")}/><span>Al azar</span></label>
        <label className="lock"><input type="radio" name="how" checked={how === "balanced"} onChange={() => setHow("balanced")}/><span>Equilibrado por la nota de un periodo</span></label>
        <label className="lock"><input type="radio" name="how" checked={how === "mixed"} onChange={() => setHow("mixed")}/><span>Mixto, para no repetir compañeros</span></label>
        {how === "balanced" && <Field label="Periodo"><select aria-label="Periodo para equilibrar" value={periodId} onChange={event => setPeriodId(event.target.value)}><option value="">Elegir periodo…</option>{periods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></Field>}
      </fieldset>
      <fieldset className="stack"><legend>Parejas</legend>
        <div className="field-grid">
          <Field label="Estudiante"><select aria-label="Primer estudiante de la pareja" value={left} onChange={event => setLeft(event.target.value)}>{learners.map(learner => <option key={learner.id} value={learner.id}>{learner.displayName}</option>)}</select></Field>
          <Field label="Y"><select aria-label="Segundo estudiante de la pareja" value={right} onChange={event => setRight(event.target.value)}>{learners.map(learner => <option key={learner.id} value={learner.id}>{learner.displayName}</option>)}</select></Field>
        </div>
        <div className="button-row">
          <Button type="button" onClick={() => addPair("together")}>Juntos</Button>
          <Button type="button" onClick={() => addPair("apart")}>Separados</Button>
        </div>
        {!!together.length && <p>Juntos: {together.map(pair => `${names.get(pair[0])} y ${names.get(pair[1])}`).join("; ")}.</p>}
        {!!apart.length && <p>Separados: {apart.map(pair => `${names.get(pair[0])} y ${names.get(pair[1])}`).join("; ")}.</p>}
      </fieldset>
      <div className="button-row">
        <Button type="button" icon="search" busy={busy === "preview"} onClick={() => void runPreview()}>{busy === "preview" ? "Preparando…" : "Vista previa"}</Button>
        {preview && <Button type="button" icon="undo" onClick={() => void runPreview(`otra-${crypto.randomUUID().slice(0, 8)}`)}>Otra combinación</Button>}
      </div>
      {preview && <div className="set-preview" role="region" aria-label="Vista previa de los grupos">
        <div className="set-groups">{preview.groups.map(group => <article key={group.name} className="set-group"><h4>{group.name}</h4><ul className="set-members">{group.learnerIds.map(id => <li key={id} className="set-member"><span>{names.get(id) || id}</span></li>)}</ul></article>)}</div>
        {!!preview.unmet.length && <ul className="set-unmet" role="list">{preview.unmet.map(item => <li key={`${item.kind}:${item.learners.join()}`} className="notice" role="status"><Icon name="alert" size={18}/>{item.message}</li>)}</ul>}
      </div>}
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>Cancelar</button>
        <button className="button primary" disabled={!preview || busy === "create"}>{busy === "create" ? "Creando…" : "Crear conjunto"}</button>
      </div>
    </form>
  </Modal>;
}

function RenameDialog({ set, path, onClose, onSaved }: { set: GroupSet; path: string; onClose: () => void; onSaved: (name: string) => Promise<void> }) {
  const [name, setName] = useState(set.name), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`${path}/${set.id}`, "PUT", { name: name.trim() }); await onSaved(name.trim()); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Renombrar «${set.name}»`} onClose={onClose}>
    <form className="stack" onSubmit={submit}>
      {error && <p className="form-alert" role="alert">{error}</p>}
      <Field label="Nombre del conjunto"><input value={name} maxLength={80} required autoFocus onChange={event => setName(event.target.value)}/></Field>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Guardando…" : "Guardar nombre"}</button></div>
    </form>
  </Modal>;
}

function RegenerateDialog({ set, path, onClose, onSaved }: { set: GroupSet; path: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [seed, setSeed] = useState("otra"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`${path}/${set.id}/regenerate`, "POST", { seed: seed.trim() }); await onSaved(); }
    catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <Modal title={`Regenerar «${set.name}»`} onClose={onClose}>
    {set.graded ? <div className="stack"><p>Este conjunto ya tiene notas: no puedes volver a formarlo ni cambiar sus miembros.</p><div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Entendido</button></div></div>
      : <form className="stack" onSubmit={submit}>
        {error && <p className="form-alert" role="alert">{error}</p>}
        <p className="muted small">Una semilla distinta da otra combinación con las mismas reglas y la misma lista.</p>
        <Field label="Semilla"><input value={seed} maxLength={80} required onChange={event => setSeed(event.target.value)}/></Field>
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><button className="button primary" disabled={busy}>{busy ? "Formando…" : "Volver a formar"}</button></div>
      </form>}
  </Modal>;
}
