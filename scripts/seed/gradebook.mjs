// Builds 0056_demo_gradebook.sql: the professional gradebook (1.2.3) in the demo organization, on top of the pilot
// seed (0054). «Matemáticas 6.º primaria» gets the zona-and-exam plan for the fourth bimestre, and «6.º A» the points of
// the zona so far (the exam is still ahead), with a couple of comments. «3.º A» has handed its fourth bimestre in for
// review and «3.º B» got it back with a note. Deterministic; every statement only runs in org-demo and steps aside when
// a person already changed what it would touch.
// Run: node scripts/seed/gradebook.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pilotIds } from "./pilot.mjs";

const { ORG, ADMIN, LEAD, COURSE, GROUP, Y2026, periods, uuid } = pilotIds;
const P4 = periods[3].id, SEEDED = "2026-10-23T20:00:00.000Z";
const q = value => value === null ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const demo = `EXISTS(SELECT 1 FROM organizations WHERE id='${ORG}') AND EXISTS(SELECT 1 FROM academic_years WHERE id='${Y2026}' AND status='current')`;
const open = group => `NOT EXISTS(SELECT 1 FROM section_period_locks WHERE group_id='${group}' AND period_id='${P4}') AND NOT EXISTS(SELECT 1 FROM section_period_reviews WHERE group_id='${group}' AND period_id='${P4}')`;
// «6.º A» still holds exactly the fourth-bimestre scores the pilot seed wrote: nobody typed one since.
const untouched = `NOT EXISTS(SELECT 1 FROM section_grades WHERE group_id='${GROUP}' AND period_id='${P4}' AND (id NOT LIKE 'seed-grade-%' OR updated_at<>'${SEEDED}'))`;
const activities = [
  ["tareas", "Tareas", "task", 20, null], ["proyecto", "Proyecto: la casa maya a escala", "project", 20, "2026-10-16"], ["pruebas", "Pruebas cortas", "quiz", 10, null],
  ["participacion", "Participación", "participation", 10, null], ["examen", "Examen del cuarto bimestre", "exam", 40, "2026-11-20"],
].map(([key, title, kind, points, dueOn], position) => ({ id: `assessment-${uuid(`m6-p4-${key}`)}`, key, title, kind, points, dueOn, position }));
const planned = `EXISTS(SELECT 1 FROM assessment_activities WHERE id='${activities[0].id}')`;
const sql = [];
// The plan, in one statement: all of it or nothing, and only where the course has no plan for the bimestre yet.
sql.push(`INSERT INTO assessment_activities(id,organization_id,course_id,period_id,position,title,kind,points,due_on,created_by,created_at,updated_at) SELECT * FROM (VALUES ${activities.map(item => `(${[item.id, ORG, COURSE, P4, item.position, item.title, item.kind, item.points, item.dueOn, LEAD, "2026-09-07T14:00:00.000Z", "2026-09-07T14:00:00.000Z"].map(q).join(",")})`).join(",")}) WHERE ${demo} AND ${open(GROUP)} AND ${untouched} AND NOT EXISTS(SELECT 1 FROM assessment_activities WHERE course_id='${COURSE}' AND period_id='${P4}');`);
// The pilot's single fourth-bimestre scores give way to the plan's points.
sql.push(`DELETE FROM section_grades WHERE group_id='${GROUP}' AND period_id='${P4}' AND id LIKE 'seed-grade-%' AND updated_at='${SEEDED}' AND ${planned} AND NOT EXISTS(SELECT 1 FROM assessment_scores WHERE activity_id='${activities[0].id}');`);
// Each student keeps a steady level (the same one the pilot seed used) and earns that share of each activity, whole points.
const level = "((unicode(substr(l.id,-1))*19+unicode(substr(l.id,-2,1))*7+length(l.display_name)*3+unicode(l.display_name)*11)%31)";
const share = salt => `min(100,49+${level}+((unicode(substr(l.id,-1))*${97 + salt * 31}+length(l.display_name)*${13 + salt * 7})%21))`;
activities.slice(0, 4).forEach((item, index) => {
  const missing = item.key === "proyecto" ? ` AND (unicode(substr(l.id,-1))+length(l.display_name))%5<>0` : "";
  sql.push(`INSERT INTO assessment_scores(activity_id,organization_id,group_id,learner_id,points,updated_by,updated_at) SELECT '${item.id}','${ORG}',l.group_id,l.id,CAST(round(${item.points}*${share(index)}/100.0) AS INTEGER),'${LEAD}','2026-10-${20 + index}T20:00:00.000Z' FROM group_learners l WHERE l.group_id='${GROUP}' AND l.organization_id='${ORG}' AND l.status='active'${missing} AND ${demo} AND ${planned} AND NOT EXISTS(SELECT 1 FROM assessment_scores s WHERE s.activity_id='${item.id}');`);
});
// The bimestre so far: the points of the zona each student earned.
sql.push(`INSERT INTO section_grades(id,organization_id,group_id,learner_id,period_id,score,updated_by,updated_at) SELECT 'seed-grade-'||s.learner_id||'-4p','${ORG}',s.group_id,s.learner_id,'${P4}',SUM(s.points),'${LEAD}','2026-10-23T20:00:00.000Z' FROM assessment_scores s WHERE s.group_id='${GROUP}' AND s.activity_id IN (${activities.map(item => q(item.id)).join(",")}) AND ${demo} AND NOT EXISTS(SELECT 1 FROM section_grades g WHERE g.learner_id=s.learner_id AND g.period_id='${P4}') GROUP BY s.learner_id,s.group_id;`);
const comments = [["Domina el área y el perímetro; en el proyecto de la casa maya midió con mucho cuidado. Sigue repasando las fracciones equivalentes.", 0], ["Le cuesta convertir unidades de medida. Practica en casa con la guía de la página 41 del libro.", 1]];
comments.forEach(([body, offset]) => sql.push(`INSERT INTO section_grade_comments(learner_id,period_id,group_id,organization_id,body,updated_by,updated_at) SELECT l.id,'${P4}',l.group_id,'${ORG}',${q(body)},'${LEAD}','2026-10-24T15:00:00.000Z' FROM group_learners l WHERE l.group_id='${GROUP}' AND l.status='active' AND ${demo} AND ${planned} AND NOT EXISTS(SELECT 1 FROM section_grade_comments c WHERE c.learner_id=l.id AND c.period_id='${P4}') ORDER BY l.display_name LIMIT 1 OFFSET ${offset};`));
// The closing review: «3.º A» handed the bimestre in; «3.º B» got it back with a note.
sql.push(`INSERT INTO section_period_reviews(group_id,organization_id,period_id,status,note,submitted_by,submitted_at,reviewed_by,reviewed_at) SELECT 'seed-group-mat-3a','${ORG}','${P4}','submitted',NULL,'${LEAD}','2026-10-26T21:00:00.000Z',NULL,NULL WHERE ${demo} AND ${open("seed-group-mat-3a")} AND EXISTS(SELECT 1 FROM course_groups WHERE id='seed-group-mat-3a' AND status='active');`);
sql.push(`INSERT INTO section_period_reviews(group_id,organization_id,period_id,status,note,submitted_by,submitted_at,reviewed_by,reviewed_at) SELECT 'seed-group-mat-3b','${ORG}','${P4}','returned','Faltan notas de algunos estudiantes. Complétalas o explica la ausencia en su comentario antes de entregar de nuevo.','${LEAD}','2026-10-26T21:30:00.000Z','${ADMIN}','2026-10-27T14:00:00.000Z' WHERE ${demo} AND ${open("seed-group-mat-3b")} AND EXISTS(SELECT 1 FROM course_groups WHERE id='seed-group-mat-3b' AND status='active');`);
const events = [
  [LEAD, "updated", "course", COURSE, COURSE, null, "Actualizó el plan de evaluación de «Cuarto bimestre» (5 actividades, 100 puntos)", "2026-09-07T14:00:00.000Z", planned],
  [LEAD, "updated", "group", "seed-group-mat-3a", "seed-course-matematicas", "seed-group-mat-3a", "Entregó las notas de «Cuarto bimestre» en «3.º A» para revisión", "2026-10-26T21:00:00.000Z", `EXISTS(SELECT 1 FROM section_period_reviews WHERE group_id='seed-group-mat-3a' AND period_id='${P4}' AND submitted_at='2026-10-26T21:00:00.000Z')`],
  [ADMIN, "updated", "group", "seed-group-mat-3b", "seed-course-matematicas", "seed-group-mat-3b", "Devolvió las notas de «Cuarto bimestre» en «3.º B» para corregirlas", "2026-10-27T14:00:00.000Z", `EXISTS(SELECT 1 FROM section_period_reviews WHERE group_id='seed-group-mat-3b' AND period_id='${P4}' AND reviewed_at='2026-10-27T14:00:00.000Z')`],
].map(([actor, action, type, target, course, group, summary, at, when], index) => `INSERT INTO activity_events(id,organization_id,actor_id,action,target_type,target_id,course_id,group_id,summary,occurred_at) SELECT ${[`seed-gradebook-event-${index + 1}`, ORG, actor, action, type, target, course, group, summary, at].map(q).join(",")} WHERE ${demo} AND ${when} AND NOT EXISTS(SELECT 1 FROM activity_events WHERE id='seed-gradebook-event-${index + 1}');`);

const header = [
  "-- Generated by scripts/seed/gradebook.mjs. Do not edit by hand.",
  "-- The professional gradebook (1.2.3) in the demo organization: the zona-and-exam plan of «Matemáticas 6.º primaria»",
  "-- for the fourth bimestre with the zona's points in «6.º A», two comments, «3.º A» handed in and «3.º B» returned.",
  "-- Only runs in org-demo, and only where nobody changed those scores, plans or reviews.",
];
export const gradebookSql = [...header, ...sql, ...events].join("\n") + "\n";
export const gradebookActivities = activities;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync("database/migrations/0056_demo_gradebook.sql", gradebookSql);
  console.log(`0056_demo_gradebook.sql: ${sql.length + events.length} statements`);
}
