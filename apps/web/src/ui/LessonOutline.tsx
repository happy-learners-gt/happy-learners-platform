import { useEffect, useRef, useState } from "react";
import type { ModuleNoun } from "@happy-learners/domain";
import type { FormEvent } from "react";
import type { LearningUnit, Lesson } from "@happy-learners/contracts";
import { Link } from "../navigation";
import { hueAt, lessonState, lessonStateLabel, plural } from "../model";
import type { LessonState } from "../model";
import { Icon } from "./icons";
import { Menu } from "./Menu";
import { SortHandle } from "./Sortable";
import { StatusBadge } from "./primitives";
import type { Tone } from "./primitives";

export const stateTone: Record<LessonState, Tone> = { draft: "warning", published: "success", changes: "info", archived: "neutral" };
export function LessonBadge({ lesson }: { lesson: Pick<Lesson, "status" | "revision" | "hasDraft" | "review" | "generated"> }) {
  const state = lessonState(lesson);
  return <>
    <StatusBadge tone={stateTone[state]}>{lessonStateLabel[state]}</StatusBadge>
    {lesson.generated && !lesson.revision && state !== "archived" && <StatusBadge tone="info">Propuesta de IA</StatusBadge>}
    {lesson.review && state !== "archived" && <StatusBadge tone={lesson.review.status === "pending" ? "info" : "warning"}>{lesson.review.status === "pending" ? "En revisión" : "Devuelta"}</StatusBadge>}
  </>;
}

/** Short names edit in place: Enter saves, Escape cancels, leaving the field saves. */
export function InlineName({ value, label, onSave, onDone, className = "" }: { value: string; label: string; onSave: (value: string) => Promise<boolean>; onDone: () => void; className?: string }) {
  const [text, setText] = useState(value), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), finished = useRef(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  async function commit() {
    if (finished.current || busy) return;
    const clean = text.trim();
    if (!clean || clean === value) { finished.current = true; onDone(); return; }
    setBusy(true);
    const saved = await onSave(clean);
    setBusy(false);
    if (saved) { finished.current = true; onDone(); } else input.current?.focus();
  }
  return <input ref={input} className={`inline-name ${className}`} aria-label={label} value={text} maxLength={160} disabled={busy} onChange={event => setText(event.target.value)}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void commit(); } if (event.key === "Escape") { event.preventDefault(); finished.current = true; onDone(); } }} onBlur={() => void commit()}/>;
}

export type OutlineActions = {
  renameUnit: (unit: LearningUnit, name: string) => Promise<boolean>;
  editUnit: (unit: LearningUnit) => void;
  /** Moves the item to a position among all of its siblings, archived ones included. */
  moveUnit: (unit: LearningUnit, to: number) => void;
  archiveUnit: (unit: LearningUnit) => void;
  createLesson: (unit: LearningUnit, title: string, objective: string) => Promise<boolean>;
  renameLesson: (lesson: Lesson, title: string) => Promise<boolean>;
  moveLesson: (lesson: Lesson, to: number) => void;
  archiveLesson: (lesson: Lesson) => void;
  duplicateLesson: (lesson: Lesson) => void;
  previewLesson: (lesson: Lesson) => void;
  openLesson: (lesson: Lesson) => void;
  /** Opens «Planificar con IA» with this module chosen for the proposals. */
  proposeForUnit?: (unit: LearningUnit) => void;
};

/** writable: the team creates, renames and duplicates lessons. organize: the lead also orders and archives modules and lessons. */
export function LessonOutline({ courseId, units, lessons, writable, organize, showArchived, actions, expanded, setExpanded, focusUnit, noun }: {
  courseId: string; noun: ModuleNoun; units: LearningUnit[]; lessons: Lesson[]; writable: boolean; organize: boolean; showArchived: boolean; actions: OutlineActions;
  expanded: Set<string>; setExpanded: (ids: Set<string>) => void; focusUnit?: string;
}) {
  const [renaming, setRenaming] = useState<string | null>(null), [creating, setCreating] = useState<string | null>(null);
  const visibleUnits = units.filter(unit => showArchived || unit.status === "active");
  function toggle(id: string) { const next = new Set(expanded); if (next.has(id)) next.delete(id); else next.add(id); setExpanded(next); }
  return <ol className="outline">{visibleUnits.map((unit, index) => {
    const all = lessons.filter(lesson => lesson.courseUnitId === unit.id);
    const visible = all.filter(lesson => showArchived || lesson.status !== "archived");
    const open = expanded.has(unit.id), archived = unit.status === "archived";
    const position = units.indexOf(unit);
    const published = visible.filter(lesson => ["published", "changes"].includes(lessonState(lesson))).length;
    return <li key={unit.id} className={`outline-unit tone-${hueAt(position)}${archived ? " is-archived" : ""}`} id={`unidad-${unit.id}`} data-focus={focusUnit === unit.id || undefined}>
      <div className="outline-unit-header">
        {organize && <SortHandle id={`unit-${unit.id}`} label={`Reordenar ${noun.one} ${index + 1}: ${unit.name}`} index={index} count={visibleUnits.length} onMove={to => actions.moveUnit(unit, units.indexOf(visibleUnits[to]))}/>}
        <button type="button" className="icon-button disclosure" aria-expanded={open} aria-controls={`lecciones-${unit.id}`} aria-label={`${open ? "Contraer" : "Expandir"} ${unit.name}`} onClick={() => toggle(unit.id)}><Icon name={open ? "chevronDown" : "chevronRight"} size={18}/></button>
        <div className="outline-unit-title">
          <span className="outline-eyebrow"><span className="unit-dot" aria-hidden="true"/>{noun.One} {index + 1}</span>
          {renaming === unit.id ? <InlineName value={unit.name} label={`Nombre ${noun.ofThe} ${index + 1}`} onSave={name => actions.renameUnit(unit, name)} onDone={() => setRenaming(null)} className="unit"/>
            : <h2 onDoubleClick={() => organize && !archived && setRenaming(unit.id)}>{unit.name}</h2>}
          {unit.objective && open && <p>{unit.objective}</p>}
        </div>
        <span className="outline-count">{visible.length ? `${published} de ${plural(visible.length, "lección publicada", "lecciones publicadas")}` : "Sin lecciones"}</span>
        {archived && <StatusBadge>Archivada</StatusBadge>}
        {organize && <Menu label={`Acciones ${noun.ofThe} ${unit.name}`} items={[
          ...(!archived ? [{ label: "Renombrar", icon: "edit" as const, onSelect: () => setRenaming(unit.id) }, { label: "Editar nombre y objetivo", icon: "text" as const, onSelect: () => actions.editUnit(unit) }, { label: "Nueva lección", icon: "plus" as const, onSelect: () => { setExpanded(new Set([...expanded, unit.id])); setCreating(unit.id); } }] : []),
          { label: "Mover arriba", icon: "chevronUp", onSelect: () => actions.moveUnit(unit, position - 1), disabled: position === 0 },
          { label: "Mover abajo", icon: "chevronDown", onSelect: () => actions.moveUnit(unit, position + 1), disabled: position === units.length - 1 },
          ...(!archived && actions.proposeForUnit ? ["separator" as const, { label: "Proponer lecciones con IA", icon: "sparkles" as const, onSelect: () => actions.proposeForUnit!(unit) }] : []),
          "separator",
          { label: archived ? `Restaurar ${noun.one}` : `Archivar ${noun.one}`, icon: "archive", onSelect: () => actions.archiveUnit(unit), danger: !archived },
        ]}/>}
      </div>
      {open && <div id={`lecciones-${unit.id}`} className="outline-lessons">
        {visible.length ? <ol>{visible.map(lesson => {
          const order = all.indexOf(lesson), lessonArchived = lesson.status === "archived";
          const href = `/cursos/${courseId}/lecciones/${lesson.id}`;
          return <li key={lesson.id} className="outline-lesson">
            {organize && <SortHandle id={`lesson-${lesson.id}`} label={`Reordenar la lección ${order + 1}: ${lesson.title}`} index={visible.indexOf(lesson)} count={visible.length} onMove={to => actions.moveLesson(lesson, all.indexOf(visible[to]))}/>}
            <span className="outline-number" aria-hidden="true">{order + 1}</span>
            <div className="outline-lesson-title">
              {renaming === lesson.id ? <InlineName value={lesson.title} label="Título de la lección" onSave={title => actions.renameLesson(lesson, title)} onDone={() => setRenaming(null)}/>
                : <Link href={href} onDoubleClick={event => { if (writable && !lessonArchived) { event.preventDefault(); setRenaming(lesson.id); } }}>{lesson.title}</Link>}
              <small>{plural(lesson.activities.length, "actividad", "actividades")} · {lesson.duration} min</small>
            </div>
            <LessonBadge lesson={lesson}/>
            <Menu label={`Acciones de la lección ${lesson.title}`} items={[
              { label: writable ? "Editar" : "Abrir", icon: "edit", onSelect: () => actions.openLesson(lesson) },
              { label: "Vista previa", icon: "eye", onSelect: () => actions.previewLesson(lesson) },
              ...(writable && !lessonArchived ? [{ label: "Renombrar", icon: "text" as const, onSelect: () => setRenaming(lesson.id) }, { label: "Duplicar", icon: "copy" as const, onSelect: () => actions.duplicateLesson(lesson) }] : []),
              ...(organize ? [
                { label: "Mover arriba", icon: "chevronUp" as const, onSelect: () => actions.moveLesson(lesson, order - 1), disabled: order === 0 },
                { label: "Mover abajo", icon: "chevronDown" as const, onSelect: () => actions.moveLesson(lesson, order + 1), disabled: order === all.length - 1 },
                "separator" as const,
                { label: lessonArchived ? "Restaurar lección" : "Archivar lección", icon: "archive" as const, onSelect: () => actions.archiveLesson(lesson), danger: !lessonArchived },
              ] : []),
            ]}/>
          </li>;
        })}</ol> : <p className="outline-empty">{noun.This} aún no tiene lecciones.</p>}
        {writable && !archived && (creating === unit.id
          ? <NewLessonForm unit={unit} onCancel={() => setCreating(null)} onCreate={async (title, objective) => { const done = await actions.createLesson(unit, title, objective); if (done) setCreating(null); return done; }}/>
          : <button type="button" className="button ghost add-lesson" onClick={() => setCreating(unit.id)}><Icon name="plus" size={18}/><span>Nueva lección<span className="sr-only"> en {unit.name}</span></span></button>)}
      </div>}
    </li>;
  })}</ol>;
}

function NewLessonForm({ unit, onCreate, onCancel }: { unit: LearningUnit; onCreate: (title: string, objective: string) => Promise<boolean>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => { title.current?.focus(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    await onCreate(String(data.get("title")).trim(), String(data.get("objective")).trim());
    setBusy(false);
  }
  return <form className="inline-form" onSubmit={submit} onKeyDown={event => { if (event.key === "Escape") onCancel(); }} aria-label={`Nueva lección en ${unit.name}`}>
    <fieldset disabled={busy}>
      <div className="field"><label htmlFor={`new-lesson-${unit.id}`}>Título de la lección</label><input ref={title} id={`new-lesson-${unit.id}`} name="title" required maxLength={160} placeholder="Ej. Saludos en la mañana"/></div>
      <div className="field"><label htmlFor={`new-lesson-objective-${unit.id}`}>Objetivo</label><input id={`new-lesson-objective-${unit.id}`} name="objective" required maxLength={1000} placeholder="¿Qué podrán hacer al terminar?"/></div>
      <div className="inline-form-actions"><button className="button primary">{busy ? "Creando…" : "Crear y editar"}</button><button type="button" className="button ghost" onClick={onCancel}>Cancelar</button></div>
    </fieldset>
  </form>;
}
