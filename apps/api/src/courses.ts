import type { Competency, Course, CourseFormat, CourseSettings, Curriculum, EducationLevel, LearningOutcome, LearningUnit, Material, Member, StudyProgram, Taxonomy, TaxonomyTerm, Vocabulary } from "@happy-learners/contracts";
import { cleanText, competencyInput, competencyLimit, completeOrder, courseInput, effectiveProfile, materialInput, outcomeInput, outcomeLimit, programInput, record, resolveSettings, validOutcomeIds } from "@happy-learners/domain";
import type { Database } from "./storage";
import { filesFor } from "./files";
import { event, recordEvent, teamsFor, updateTeam } from "./team";
import type { Notifier } from "./notify";
import { courseRequirements, leaveProgram, programPrerequisites } from "./prerequisites";
import { accessTo, forbidden, outsider, reachableCourses } from "./access";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const missing = () => reply({ error: "El elemento no está disponible en tu organización." }, 404);
const conflict = () => reply({ error: "Hay cambios más recientes. Recarga antes de guardar; tu borrador no se ha sobrescrito." }, 409);
type StoredCourse = Course & { legacyProgramId: string };
type Row<T> = Omit<T, "settings" | "area" | "programId" | "locked"> & { settings: string; area: string | null; programId?: string | null; locked?: string };
const courseColumns = "id,title,objective,program_id AS programId,education_type AS educationType,level,format,modality,pacing,area,settings,status,version,updated_at AS updatedAt";
function courseView<T extends Course>(row: Row<T>): T {
  const { programId, area, settings, ...rest } = row;
  return { ...rest, ...(programId ? { programId } : {}), ...(area ? { area } : {}), settings: JSON.parse(settings) as CourseSettings } as unknown as T;
}
export async function coursesFor(db: Database, organization: string): Promise<StoredCourse[]> {
  const rows = (await db.prepare(`SELECT ${courseColumns},legacy_program_id AS legacyProgramId FROM courses WHERE organization_id=? ORDER BY title,id`).bind(organization).all<Row<StoredCourse>>()).results;
  return rows.map(courseView);
}
export async function programsFor(db: Database, organization: string): Promise<StudyProgram[]> {
  const rows = (await db.prepare("SELECT p.id,p.name,p.description,p.education_type AS educationType,p.level,p.format,p.modality,p.pacing,p.area,p.settings,p.locked,p.status,p.version,p.updated_at AS updatedAt,(SELECT count(*) FROM courses c WHERE c.program_id=p.id AND c.status='active') AS courseCount FROM study_programs p WHERE p.organization_id=? ORDER BY p.name,p.id").bind(organization).all<Row<StudyProgram>>()).results;
  return rows.map(({ area, settings, locked, ...rest }) => ({ ...rest, ...(area ? { area } : {}), settings: JSON.parse(settings), locked: JSON.parse(locked || "[]") }) as StudyProgram);
}
/** A course with its program and resolved settings: what the course actually does. */
export async function configurationOf(db: Database, organization: string, courseId: string) {
  const course = (await coursesFor(db, organization)).find(item => item.id === courseId);
  if (!course) return null;
  const program = course.programId ? (await programsFor(db, organization)).find(item => item.id === course.programId) || null : null;
  return { course, program, settings: resolveSettings(course, program).values, pacing: effectiveProfile(course, program).pacing };
}
/** The former profile column is still NOT NULL; keep it coherent for anything that reads history. */
function legacyProfile(format: CourseFormat, level: EducationLevel) {
  if (format === "workshop" || format === "laboratory") return format;
  if (level === "early-childhood" || level === "pre-primary") return "preschool";
  if (["short-tertiary", "bachelor", "master", "doctoral"].includes(level)) return "university";
  return level === "unspecified" ? "free" : "school";
}
export async function unitsFor(db: Database, courseId: string) {
  return (await db.prepare("SELECT id,course_id AS courseId,name,objective,position,status,updated_at AS updatedAt FROM learning_units WHERE course_id=? ORDER BY position,id").bind(courseId).all<LearningUnit>()).results;
}
export async function curriculumFor(db: Database, courseId: string): Promise<Curriculum> {
  const [competencies, outcomes, unitOutcomes] = await db.batch([
    db.prepare("SELECT id,course_id AS courseId,name,description,position,status,updated_at AS updatedAt FROM course_competencies WHERE course_id=? ORDER BY position,id").bind(courseId),
    db.prepare("SELECT id,course_id AS courseId,competency_id AS competencyId,statement,level,evidence,position,status,updated_at AS updatedAt FROM course_outcomes WHERE course_id=? ORDER BY position,id").bind(courseId),
    db.prepare("SELECT unit_id AS unitId,outcome_id AS outcomeId FROM unit_outcomes WHERE course_id=? ORDER BY unit_id,outcome_id").bind(courseId),
  ]);
  return {
    competencies: competencies as unknown as Competency[],
    outcomes: (outcomes as unknown as (LearningOutcome & { competencyId: string | null })[]).map(({ competencyId, ...outcome }) => competencyId ? { ...outcome, competencyId } : outcome),
    unitOutcomes: unitOutcomes as unknown as Curriculum["unitOutcomes"],
  };
}
export async function materialsFor(db: Database, organization: string, courseId?: string): Promise<Material[]> {
  const rows = (await db.prepare("SELECT id,course_id AS courseId,title,description,kind,content,status,version,updated_at AS updatedAt FROM materials WHERE organization_id=?" + (courseId ? " AND course_id=?" : "") + " ORDER BY title,id").bind(organization, ...(courseId ? [courseId] : [])).all<Material>()).results;
  const terms = (await db.prepare("SELECT material_id,term_id FROM material_terms WHERE organization_id=?").bind(organization).all<{ material_id: string; term_id: string }>()).results;
  return rows.map(row => ({ ...row, termIds: terms.filter(t => t.material_id === row.id).map(t => t.term_id) }));
}
export async function taxonomyFor(db: Database, organization: string): Promise<Taxonomy> {
  const [v, t] = await Promise.all([
    db.prepare("SELECT id,name,status,version FROM vocabularies WHERE organization_id=? ORDER BY name,id").bind(organization).all<Vocabulary>(),
    db.prepare("SELECT id,vocabulary_id AS vocabularyId,name,status,version FROM taxonomy_terms WHERE organization_id=? ORDER BY name,id").bind(organization).all<TaxonomyTerm>(),
  ]);
  return { vocabularies: v.results, terms: t.results };
}
async function validTerms(db: Database, organization: string, ids: string[], previous: string[] = []) {
  const tax = await taxonomyFor(db, organization);
  return ids.every(id => tax.terms.some(t => t.id === id && (previous.includes(id) || (t.status === "active" && tax.vocabularies.some(v => v.id === t.vocabularyId && v.status === "active")))));
}

export async function taxonomy(path: string, method: string, input: unknown, current: Member, db: Database) {
  if (method === "GET") return reply(await taxonomyFor(db, current.organizationId));
  if (current.role !== "admin") return reply({ error: "Solo administración puede configurar las clasificaciones." }, 403);
  const v = record(input), name = cleanText(v?.name, 80);
  if (!v || !name || !["active", "archived"].includes(String(v.status))) return reply({ error: "Escribe un nombre de hasta 80 caracteres y un estado válido." }, 400);
  const isTerm = path.startsWith("/api/terms"), id = path.split("/")[3];
  const table = isTerm ? "taxonomy_terms" : "vocabularies";
  const data = await taxonomyFor(db, current.organizationId);
  const rows = isTerm ? data.terms : data.vocabularies;
  const old = rows.find(r => r.id === id);
  if (id && !old) return missing();
  const parentId = isTerm ? (old && "vocabularyId" in old ? String(old.vocabularyId) : String(v.vocabularyId || "")) : null;
  if (isTerm && !data.vocabularies.some(r => r.id === parentId && r.status === "active")) return reply({ error: "Selecciona un vocabulario activo de tu organización." }, 400);
  const nameKey = name.toLocaleLowerCase("es");
  if (rows.some(r => r.id !== id && r.name.toLocaleLowerCase("es") === nameKey && (!isTerm || ("vocabularyId" in r && r.vocabularyId === parentId)))) return reply({ error: "Ya existe ese nombre en este vocabulario u organización." }, 409);
  const itemId = id || `${isTerm ? "term" : "vocabulary"}-${crypto.randomUUID()}`;
  if (id) {
    const updated = await db.prepare(`UPDATE OR IGNORE ${table} SET name=?,name_key=?,status=?,version=version+1 WHERE id=? AND organization_id=? AND version=? RETURNING id`).bind(name, nameKey, String(v.status), id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1).first();
    if (!updated) return conflict();
  } else {
    // Conditional insertion prevents duplicate names even when requests race.
    const values = [itemId, current.organizationId, name, nameKey, String(v.status)];
    const created = isTerm
      ? await db.prepare("INSERT INTO taxonomy_terms(id,organization_id,name,name_key,status,vocabulary_id) VALUES (?,?,?,?,?,?) ON CONFLICT(vocabulary_id,name_key) DO NOTHING RETURNING id").bind(...values, parentId).first()
      : await db.prepare("INSERT INTO vocabularies(id,organization_id,name,name_key,status) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,name_key) DO NOTHING RETURNING id").bind(...values).first();
    if (!created) return reply({ error: "Ese nombre ya fue registrado. Actualiza la lista." }, 409);
  }
  return reply({ id: itemId, ...await taxonomyFor(db, current.organizationId) }, id ? 200 : 201);
}

export async function courses(path: string, method: string, input: unknown, current: Member, db: Database, notifier?: Notifier) {
  const [, , , id, area, itemId] = path.split("/");
  const list = await coursesFor(db, current.organizationId);
  const course = list.find(c => c.id === id);
  if (id && !course) return missing();
  const access = id ? await accessTo(db, current, id) : null;
  if (id && !access) return outsider();
  if (method === "GET") {
    const teams = await teamsFor(db, current.organizationId);
    if (!id) {
      const reachable = await reachableCourses(db, current);
      return reply({ courses: list.filter(c => !reachable || reachable.has(c.id)).map(({ legacyProgramId: _, ...c }) => ({ ...c, team: teams.get(c.id) || [] })) });
    }
    if (area === "materials") return reply({ materials: [...await materialsFor(db, current.organizationId, id), ...await filesFor(db, current.organizationId, id)] });
    const { legacyProgramId: _, ...view } = course!;
    return reply({ course: { ...view, team: teams.get(view.id) || [], access }, units: await unitsFor(db, id), curriculum: await curriculumFor(db, id), requirements: await courseRequirements(db, current.organizationId, view.id, view.programId) });
  }
  // The team decides who reaches the course's sections, classes and attendance: administration changes it, and
  // coordination in its scope (DEC-041).
  if (area === "team") {
    if (!access!.team) return forbidden("Solo administración y la coordinación académica del programa cambian el equipo de un curso.");
    const v = record(input);
    if (!v) return reply({ error: "Completa los datos." }, 400);
    if (course?.status === "archived") return reply({ error: "Restaura el curso antes de modificarlo. Sus enlaces publicados se conservan." }, 409);
    return updateTeam(id, Number.isInteger(v.version) ? Number(v.version) : -1, v, current, db, notifier);
  }
  if (!area && current.role !== "admin") return forbidden("Solo administración crea cursos y cambia su configuración.");
  if (area === "materials" && !access!.edit) return forbidden("Solo el equipo docente del curso prepara sus recursos.");
  if (area && area !== "materials" && !access!.publish) return forbidden("Solo la persona responsable del curso organiza sus módulos y su plan curricular.");
  const v = record(input);
  if (!v) return reply({ error: "Completa los datos." }, 400);
  const now = new Date().toISOString();
  const guard = () => db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status='active' RETURNING id").bind(now, id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1);
  if (area && course?.status === "archived") return reply({ error: "Restaura el curso antes de modificarlo. Sus enlaces publicados se conservan." }, 409);
  if (!area) {
    const data = courseInput(v);
    if (!data) return reply({ error: "Revisa el nombre, el objetivo y la configuración académica del curso: la educación formal necesita un nivel." }, 400);
    // Every active course has a lead: the person who decides and publishes its content.
    const leadId = course ? null : typeof v.leadId === "string" ? v.leadId : "";
    if (leadId !== null && !await db.prepare("SELECT 1 AS ok FROM memberships WHERE user_id=? AND organization_id=? AND active=1").bind(leadId, current.organizationId).first()) return reply({ error: "Elige a la persona responsable del curso entre las personas activas de tu organización." }, 400);
    // Inside a program the course takes its type, level, modality and pacing, and cannot change fixed settings.
    if (data.programId) {
      const program = (await programsFor(db, current.organizationId)).find(item => item.id === data.programId);
      if (!program || (program.status !== "active" && program.id !== course?.programId)) return reply({ error: "Elige un programa activo de tu organización." }, 400);
      Object.assign(data, { educationType: program.educationType, level: program.level, modality: program.modality, pacing: program.pacing });
      for (const key of program.locked) delete data.settings[key];
    }
    const cid = id || `course-${crypto.randomUUID()}`;
    const values = [data.title, data.objective, legacyProfile(data.format, data.level), data.programId, data.educationType, data.level, data.format, data.modality, data.pacing, data.area || null, JSON.stringify(data.settings), data.status, now] as const;
    if (course) {
      const updated = await db.prepare("UPDATE courses SET title=?,objective=?,profile=?,program_id=?,education_type=?,level=?,format=?,modality=?,pacing=?,area=?,settings=?,status=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=? RETURNING id").bind(...values, cid, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1).first();
      if (!updated) return conflict();
      if ((course.programId || null) !== data.programId) await leaveProgram(db, cid).run();
    } else {
      await db.batch([
        db.prepare("INSERT INTO programs(id,organization_id,title) VALUES (?,?,?)").bind(cid, current.organizationId, data.title),
        db.prepare("INSERT INTO courses(title,objective,profile,program_id,education_type,level,format,modality,pacing,area,settings,status,updated_at,id,organization_id,legacy_program_id,unit_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Módulos')").bind(...values, cid, current.organizationId, cid),
        db.prepare("INSERT INTO course_members(course_id,organization_id,user_id,role,added_at) VALUES (?,?,?,'lead',?)").bind(cid, current.organizationId, leadId!, now),
        event(db, current, { action: "created", targetType: "course", targetId: cid, courseId: cid, summary: `Creó el curso «${data.title}»` }),
      ]);
      return reply({ id: cid }, 201);
    }
    const statusChanged = course.status !== data.status;
    await recordEvent(db, current, { action: statusChanged ? (data.status === "archived" ? "archived" : "restored") : "updated", targetType: "course", targetId: cid, courseId: cid, summary: statusChanged ? `${data.status === "archived" ? "Archivó" : "Restauró"} el curso «${data.title}»` : `Actualizó la configuración de «${data.title}»` });
    return reply({ id: cid }, 200);
  }
  if (area === "competencies") {
    const { competencies } = await curriculumFor(db, id);
    if (itemId && !competencies.some(c => c.id === itemId)) return missing();
    const data = competencyInput(v);
    if (!data) return reply({ error: "Escribe el nombre de la competencia (hasta 120 caracteres) y, si quieres, una descripción de hasta 600." }, 400);
    if (!itemId && competencies.length >= competencyLimit) return reply({ error: `Un curso admite hasta ${competencyLimit} competencias.` }, 400);
    if (competencies.some(c => c.id !== itemId && c.name.toLocaleLowerCase("es") === data.name.toLocaleLowerCase("es"))) return reply({ error: "Ya hay una competencia con ese nombre en este curso." }, 409);
    const cid = itemId || `competency-${crypto.randomUUID()}`;
    const statement = itemId
      ? db.prepare("UPDATE course_competencies SET name=?,description=?,status=?,updated_at=? WHERE id=? AND course_id=?").bind(data.name, data.description, data.status, now, cid, id)
      : db.prepare("INSERT INTO course_competencies(id,course_id,organization_id,name,description,position,status,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(cid, id, current.organizationId, data.name, data.description, competencies.length, data.status, now);
    if (!await db.guardedBatch(guard(), [statement, event(db, current, { action: itemId ? (data.status === "archived" ? "archived" : "updated") : "created", targetType: "competency", targetId: cid, courseId: id, summary: `${itemId ? "Actualizó" : "Agregó"} la competencia «${data.name}»` })])) return conflict();
    return reply({ id: cid }, itemId ? 200 : 201);
  }
  if (area === "outcomes") {
    const { competencies, outcomes } = await curriculumFor(db, id);
    if (itemId === "order") {
      if (!completeOrder(v.ids, outcomes.map(o => o.id))) return reply({ error: "Incluye todos los resultados una sola vez, también los archivados." }, 400);
      if (!await db.guardedBatch(guard(), v.ids.map((oid, position) => db.prepare("UPDATE course_outcomes SET position=?,updated_at=? WHERE id=? AND course_id=?").bind(position, now, oid, id)))) return conflict();
      return reply({ ok: true });
    }
    const old = outcomes.find(o => o.id === itemId);
    if (itemId && !old) return missing();
    const data = outcomeInput(v);
    if (!data) return reply({ error: "Escribe el resultado (hasta 400 caracteres), su nivel y, si quieres, cómo se evidencia." }, 400);
    if (data.competencyId && !competencies.some(c => c.id === data.competencyId && (c.status === "active" || c.id === old?.competencyId))) return reply({ error: "Elige una competencia activa de este curso." }, 400);
    if (!itemId && outcomes.length >= outcomeLimit) return reply({ error: `Un curso admite hasta ${outcomeLimit} resultados de aprendizaje.` }, 400);
    const oid = itemId || `outcome-${crypto.randomUUID()}`;
    const statement = itemId
      ? db.prepare("UPDATE course_outcomes SET competency_id=?,statement=?,level=?,evidence=?,status=?,updated_at=? WHERE id=? AND course_id=?").bind(data.competencyId, data.statement, data.level, data.evidence, data.status, now, oid, id)
      : db.prepare("INSERT INTO course_outcomes(id,course_id,organization_id,competency_id,statement,level,evidence,position,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(oid, id, current.organizationId, data.competencyId, data.statement, data.level, data.evidence, outcomes.length, data.status, now);
    if (!await db.guardedBatch(guard(), [statement, event(db, current, { action: itemId ? (data.status === "archived" ? "archived" : "updated") : "created", targetType: "outcome", targetId: oid, courseId: id, summary: `${itemId ? "Actualizó" : "Definió"} el resultado «${data.statement.slice(0, 120)}»` })])) return conflict();
    return reply({ id: oid }, itemId ? 200 : 201);
  }
  if (area === "units" && itemId && path.split("/")[6] === "outcomes") {
    const [units, { outcomes, unitOutcomes }] = await Promise.all([unitsFor(db, id), curriculumFor(db, id)]);
    if (!units.some(u => u.id === itemId)) return missing();
    const previous = unitOutcomes.filter(link => link.unitId === itemId).map(link => link.outcomeId);
    if (!validOutcomeIds(v.outcomeIds) || v.outcomeIds.some(oid => !outcomes.some(o => o.id === oid && (o.status === "active" || previous.includes(oid))))) return reply({ error: "Elige resultados de aprendizaje activos de este curso." }, 400);
    const changes = [db.prepare("DELETE FROM unit_outcomes WHERE unit_id=? AND course_id=?").bind(itemId, id), ...v.outcomeIds.map(oid => db.prepare("INSERT INTO unit_outcomes(unit_id,outcome_id,course_id) VALUES (?,?,?)").bind(itemId, oid, id))];
    const unitName = units.find(u => u.id === itemId)!.name;
    if (!await db.guardedBatch(guard(), [...changes, event(db, current, { action: "planned", targetType: "module", targetId: itemId, courseId: id, summary: `Planificó ${v.outcomeIds.length} ${v.outcomeIds.length === 1 ? "resultado" : "resultados"} en «${unitName}»` })])) return conflict();
    return reply({ ok: true });
  }
  if (area === "units") {
    const units = await unitsFor(db, id);
    if (itemId === "order") {
      if (!completeOrder(v.ids, units.map(u => u.id))) return reply({ error: "Incluye todas las unidades una sola vez, también las archivadas." }, 400);
      const changes = v.ids.map((uid, position) => db.prepare("UPDATE learning_units SET position=?,updated_at=? WHERE id=? AND course_id=?").bind(position, now, uid, id));
      if (!await db.guardedBatch(guard(), [...changes, db.prepare("SELECT id FROM courses WHERE id=?").bind(id)])) return conflict();
      return reply({ ok: true });
    }
    if (itemId && !units.some(u => u.id === itemId)) return missing();
    const name = cleanText(v.name, 100), objective = cleanText(v.objective, 1000, false);
    if (!name || objective === null || !["active", "archived"].includes(String(v.status))) return reply({ error: "Revisa el nombre, objetivo y estado de la unidad." }, 400);
    const uid = itemId || `learning-unit-${crypto.randomUUID()}`;
    const statement = itemId
      ? db.prepare("UPDATE learning_units SET name=?,objective=?,status=?,updated_at=? WHERE id=? AND course_id=?").bind(name, objective, String(v.status), now, uid, id)
      : db.prepare("INSERT INTO learning_units(id,course_id,name,objective,position,status,updated_at) VALUES (?,?,?,?,?,?,?)").bind(uid, id, name, objective, units.length, String(v.status), now);
    if (!await db.guardedBatch(guard(), [statement, event(db, current, { action: itemId ? (String(v.status) === "archived" ? "archived" : "updated") : "created", targetType: "module", targetId: uid, courseId: id, summary: `${itemId ? "Actualizó" : "Creó"} «${name}»` })])) return conflict();
    return reply({ id: uid }, itemId ? 200 : 201);
  }
  if (area === "materials") {
    const list = await materialsFor(db, current.organizationId, id);
    const old = list.find(m => m.id === itemId);
    if (itemId && !old) return missing();
    const data = materialInput(v);
    if (!data) return reply({ error: "Completa título, descripción y contenido. Los enlaces deben ser http(s), sin credenciales. La clasificación es opcional." }, 400);
    if (data.kind === "link") {
      try { const url = new URL(data.content); if (!url.hostname || url.username || url.password) throw new Error(); }
      catch { return reply({ error: "La dirección del material no es válida." }, 400); }
    }
    if (!await validTerms(db, current.organizationId, data.termIds, old?.termIds)) return reply({ error: "Selecciona clasificaciones activas de tu organización." }, 400);
    const mid = itemId || `material-${crypto.randomUUID()}`;
    const relationships = [
      db.prepare("DELETE FROM material_terms WHERE material_id=? AND organization_id=?").bind(mid, current.organizationId),
      ...data.termIds.map(term => db.prepare("INSERT INTO material_terms VALUES (?,?,?)").bind(mid, term, current.organizationId)),
    ];
    if (old) {
      const updated = await db.guardedBatch(db.prepare("UPDATE materials SET title=?,description=?,content=?,kind=?,status=?,version=version+1,updated_at=? WHERE id=? AND course_id=? AND organization_id=? AND version=? RETURNING id").bind(data.title, data.description, data.content, data.kind, data.status, now, mid, id, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1), relationships);
      if (!updated) return conflict();
    } else {
      await db.batch([db.prepare("INSERT INTO materials(id,course_id,organization_id,title,description,content,kind,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(mid, id, current.organizationId, data.title, data.description, data.content, data.kind, data.status, now), ...relationships]);
    }
    await recordEvent(db, current, { action: itemId ? (data.status === "archived" ? "archived" : "updated") : "created", targetType: "resource", targetId: mid, courseId: id, summary: `${itemId ? "Actualizó" : "Agregó"} el recurso «${data.title}»` });
    return reply({ material: (await materialsFor(db, current.organizationId, id)).find(m => m.id === mid) }, itemId ? 200 : 201);
  }
  return missing();
}

/** Study programs: shared configuration for a set of courses. Everyone reads them; administration manages them. */
export async function programs(path: string, method: string, input: unknown, current: Member, db: Database) {
  const [, , , id, area] = path.split("/");
  const list = await programsFor(db, current.organizationId);
  const old = list.find(item => item.id === id);
  if (id && !old) return missing();
  if (area === "prerequisites") return programPrerequisites(method, input, current, db, old!);
  if (method === "GET") return reply(id ? { program: old } : { programs: list });
  if (current.role !== "admin") return reply({ error: "Solo administración puede configurar programas." }, 403);
  const v = record(input);
  const data = programInput(v);
  if (!v || !data) return reply({ error: "Revisa el nombre y la configuración del programa: la educación formal necesita un nivel y solo se fijan ajustes con valor." }, 400);
  const nameKey = data.name.toLocaleLowerCase("es");
  if (list.some(item => item.id !== id && item.name.toLocaleLowerCase("es") === nameKey)) return reply({ error: "Ya existe un programa con ese nombre." }, 409);
  const now = new Date().toISOString(), pid = id || `program-${crypto.randomUUID()}`;
  const values = [data.name, nameKey, data.description, data.educationType, data.level, data.format, data.modality, data.pacing, data.area || null, JSON.stringify(data.settings), JSON.stringify(data.locked), data.status, now] as const;
  if (old) {
    // Courses of the program follow its type, level, modality and pacing.
    const ok = await db.guardedBatch(
      db.prepare("UPDATE study_programs SET name=?,name_key=?,description=?,education_type=?,level=?,format=?,modality=?,pacing=?,area=?,settings=?,locked=?,status=?,updated_at=?,version=version+1 WHERE id=? AND organization_id=? AND version=? RETURNING id").bind(...values, pid, current.organizationId, Number.isInteger(v.version) ? Number(v.version) : -1),
      [db.prepare("UPDATE courses SET education_type=?,level=?,modality=?,pacing=?,version=version+1,updated_at=? WHERE program_id=? AND organization_id=?").bind(data.educationType, data.level, data.modality, data.pacing, now, pid, current.organizationId)]);
    if (!ok) return conflict();
  } else {
    const created = await db.prepare("INSERT INTO study_programs(name,name_key,description,education_type,level,format,modality,pacing,area,settings,locked,status,updated_at,id,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,name_key) DO NOTHING RETURNING id").bind(...values, pid, current.organizationId).first();
    if (!created) return reply({ error: "Ese nombre ya fue registrado. Actualiza la lista." }, 409);
  }
  await recordEvent(db, current, { action: old ? (data.status !== old.status ? (data.status === "archived" ? "archived" : "restored") : "updated") : "created", targetType: "program", targetId: pid, summary: `${old ? "Actualizó" : "Creó"} el programa «${data.name}»` });
  return reply({ id: pid, programs: await programsFor(db, current.organizationId) }, id ? 200 : 201);
}
