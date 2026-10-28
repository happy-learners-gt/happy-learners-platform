// Builds 0054_demo_pilot.sql: the school pilot (REL-010) in the demo organization, so every new feature can be shown.
// - Ciclo 2026 (current, four bimestres: the fourth is under way) and Ciclo 2027 as a draft with the same pattern.
// - Scores for bimestres 1 to 3 (closed) and part of the fourth in the primary sections; Ciencias reads in letters.
// - «Matemáticas 6.º primaria»: the CNB package (Dosificación, Matemáticas, Sexto Grado) activated, eight indicators
//   in its plan with two published lessons, the main book (a fictional textbook whose text is already read) that
//   covers every indicator but decimals, and «6.º A» with upcoming classes and no lessons yet.
// The book map and the lesson proposals are left to be done live. Deterministic; every statement only runs when the
// store holds org-demo. The book's PDF also lives in R2: node scripts/seed/pilot.mjs --book <file> writes it.
// Run: node scripts/seed/pilot.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { matematicasPrimaria6 as cnb } from "../../packages/domain/src/cnb/matematicas-primaria-6.ts";
import { pdfFile } from "../../packages/domain/src/pdf.ts";

const ORG = "org-demo", ADMIN = "user-0", LEAD = "seed-user-lucia", SCIENCE = "seed-user-carlos";
const GUARD = `WHERE EXISTS(SELECT 1 FROM organizations WHERE id='${ORG}')`;
const q = value => value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''").replaceAll("\n", "'||char(10)||'")}'`;
// `when` adds conditions: production may already hold rows a person created, and the seed must never collide with them.
const insert = (table, row, when = "", verb = "INSERT") => `${verb} INTO ${table}(${Object.keys(row).join(",")}) SELECT ${Object.values(row).map(q).join(",")} ${GUARD}${when ? ` AND ${when}` : ""};`;
/** A stable UUID-shaped id from a name, so the API's id patterns accept seeded rows. */
const uuid = name => { const h = createHash("sha256").update(`hl-pilot:${name}`).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const doc = text => ({ type: "doc", content: text.split("\n").filter(Boolean).map(line => ({ type: "paragraph", content: [{ type: "text", text: line }] })) });
const shareCode = id => `D-${createHash("sha256").update(id).digest("hex").slice(0, 16).toUpperCase()}`;
function rng(seed) { let a = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 1779033703); return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sql = [], events = [];
const event = (actor, action, targetType, targetId, courseId, summary, occurredAt, groupId = null) =>
  events.push(insert("activity_events", { id: `seed-pilot-event-${String(events.length + 1).padStart(3, "0")}`, organization_id: ORG, actor_id: actor, action, target_type: targetType, target_id: targetId, course_id: courseId, group_id: groupId, summary, occurred_at: occurredAt }));

// --- Ciclo lectivo ------------------------------------------------------------------------------------------------
const Y2026 = `year-${uuid("ciclo-2026")}`, Y2027 = `year-${uuid("ciclo-2027")}`;
const bimestres = [["Primer bimestre", "2026-01-19", "2026-03-27"], ["Segundo bimestre", "2026-04-06", "2026-06-12"], ["Tercer bimestre", "2026-06-22", "2026-08-28"], ["Cuarto bimestre", "2026-09-07", "2026-11-27"]];
const next = day => `${Number(day.slice(0, 4)) + 1}${day.slice(4)}`;
const periods = bimestres.map(([name, from, until], index) => ({ id: `period-${uuid(`2026-${index}`)}`, name, from, until, position: index + 1 }));
const freeYear = name => `NOT EXISTS(SELECT 1 FROM academic_years WHERE organization_id='${ORG}' AND lower(name)=lower('${name}'))`, hasYear = id => `EXISTS(SELECT 1 FROM academic_years WHERE id='${id}')`;
// Only when nobody made a year current or named it «Ciclo 2026» in the meantime.
sql.push(insert("academic_years", { id: Y2026, organization_id: ORG, name: "Ciclo 2026", starts_on: "2026-01-19", ends_on: "2026-11-27", period_kind: "bimester", status: "current", created_by: ADMIN, created_at: "2025-11-20T15:00:00.000Z", updated_at: "2026-01-12T14:00:00.000Z", activated_at: "2026-01-12T14:00:00.000Z" }, `${freeYear("Ciclo 2026")} AND NOT EXISTS(SELECT 1 FROM academic_years WHERE organization_id='${ORG}' AND status='current')`));
periods.forEach(period => sql.push(insert("academic_periods", { id: period.id, organization_id: ORG, year_id: Y2026, position: period.position, name: period.name, starts_on: period.from, ends_on: period.until, weight: 1 }, hasYear(Y2026))));
sql.push(insert("academic_years", { id: Y2027, organization_id: ORG, name: "Ciclo 2027", starts_on: next("2026-01-19"), ends_on: next("2026-11-27"), period_kind: "bimester", status: "draft", created_by: ADMIN, created_at: "2026-10-20T15:00:00.000Z", updated_at: "2026-10-20T15:00:00.000Z" }, freeYear("Ciclo 2027")));
bimestres.forEach(([name, from, until], index) => sql.push(insert("academic_periods", { id: `period-${uuid(`2027-${index}`)}`, organization_id: ORG, year_id: Y2027, position: index + 1, name, starts_on: next(from), ends_on: next(until), weight: 1 }, hasYear(Y2027))));

// --- Matemáticas 6.º primaria ------------------------------------------------------------------------------------
const COURSE = "seed-course-mate6", PROGRAM = "seed-program-primaria", GROUP = "seed-group-mat-6a", CREATED = "2026-08-24T14:00:00.000Z";
sql.push(insert("programs", { id: COURSE, organization_id: ORG, title: "Matemáticas 6.º primaria" }));
sql.push(insert("courses", { id: COURSE, organization_id: ORG, legacy_program_id: COURSE, title: "Matemáticas 6.º primaria", objective: "Resolver problemas de geometría, fracciones y estadística con el razonamiento y los contenidos del CNB de sexto grado.", profile: "school", unit_label: "Unidades", status: "active", version: 6, updated_at: "2026-10-20T16:00:00.000Z", program_id: PROGRAM, education_type: "formal", level: "primary", format: "subject", modality: "in-person", pacing: "scheduled", area: "054", settings: JSON.stringify({ defaultSequence: "start-develop-close" }) }));
sql.push(insert("course_members", { course_id: COURSE, organization_id: ORG, user_id: LEAD, role: "lead", added_at: CREATED }));
sql.push(insert("course_members", { course_id: COURSE, organization_id: ORG, user_id: "user-educator", role: "co-teacher", added_at: CREATED }));
event(ADMIN, "created", "course", COURSE, COURSE, "Creó el curso «Matemáticas 6.º primaria» con Lucía Herrera como responsable", CREATED);

// The CNB package and eight of its indicators in the plan, as the lead picked them.
sql.push(insert("curriculum_package_activations", { organization_id: ORG, package_id: cnb.id, version: cnb.version, activated_by: ADMIN, activated_at: "2026-10-19T15:00:00.000Z" }, "", "INSERT OR IGNORE"));
const picked = ["1.1", "1.2", "1.3", "1.4", "4.4", "4.5", "6.1", "6.4"];
const competencyName = competency => { const full = `${competency.code}. ${competency.statement}`; if (full.length <= 120) return full; const cut = full.slice(0, 117); return `${cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : 117).replace(/[,;:]$/, "")}…`; };
const outcomeId = code => `seed-out-m6-${code.replace(".", "-")}`;
let outcomePosition = 0;
cnb.competencies.filter(competency => competency.indicators.some(indicator => picked.includes(indicator.code))).forEach((competency, position) => {
  const id = `seed-comp-m6-${competency.code}`;
  sql.push(insert("course_competencies", { id, course_id: COURSE, organization_id: ORG, name: competencyName(competency), description: `${competency.statement}\n\nFuente: ${cnb.source.name}, ${cnb.title}, competencia ${competency.code}.`, position, status: "active", updated_at: "2026-10-19T16:00:00.000Z" }));
  sql.push(insert("course_package_links", { course_id: COURSE, organization_id: ORG, package_id: cnb.id, version: cnb.version, kind: "competency", code: competency.code, competency_id: id, outcome_id: null, linked_by: LEAD, linked_at: "2026-10-19T16:00:00.000Z" }));
  for (const indicator of competency.indicators.filter(item => picked.includes(item.code))) {
    sql.push(insert("course_outcomes", { id: outcomeId(indicator.code), course_id: COURSE, organization_id: ORG, competency_id: id, statement: indicator.statement, level: indicator.level, evidence: `${cnb.source.name}, ${cnb.title}, indicador de logro ${indicator.code}.`, position: outcomePosition++, status: "active", updated_at: "2026-10-19T16:00:00.000Z" }));
    sql.push(insert("course_package_links", { course_id: COURSE, organization_id: ORG, package_id: cnb.id, version: cnb.version, kind: "indicator", code: indicator.code, competency_id: null, outcome_id: outcomeId(indicator.code), linked_by: LEAD, linked_at: "2026-10-19T16:00:00.000Z" }));
  }
});
event(LEAD, "created", "outcome", COURSE, COURSE, `Agregó 8 indicadores de «${cnb.title}» al plan curricular`, "2026-10-19T16:00:00.000Z");

const units = [
  { id: "seed-unit-m6-geometria", name: "Unidad 1: Geometría y medida", objective: "Polígonos, perímetro, área y sólidos geométricos.", plan: ["1.1", "1.2", "1.3", "1.4"] },
  { id: "seed-unit-m6-fracciones", name: "Unidad 2: Fracciones y decimales", objective: "Operaciones con fracciones y decimales en problemas cotidianos.", plan: ["4.4", "4.5"] },
  { id: "seed-unit-m6-datos", name: "Unidad 3: Datos y estadística", objective: "Organizar información en tablas y gráficas y calcular medidas de tendencia central.", plan: ["6.1", "6.4"] },
];
units.forEach((unit, position) => {
  sql.push(insert("learning_units", { id: unit.id, course_id: COURSE, legacy_unit_id: null, name: unit.name, objective: unit.objective, position, status: "active", updated_at: "2026-10-19T17:00:00.000Z" }));
  for (const code of unit.plan) sql.push(insert("unit_outcomes", { unit_id: unit.id, outcome_id: outcomeId(code), course_id: COURSE }));
});

// Two published lessons cover 1.1 and 1.2: the rest of the plan is still a gap.
const codes = new Map(picked.map((code, index) => [outcomeId(code), { code: `RA${index + 1}`, statement: cnb.competencies.flatMap(item => item.indicators).find(item => item.code === code).statement }]));
const lessons = [
  { id: "seed-lesson-m6-poligonos", unit: units[0], position: 0, outcome: "1.1", published: "2026-10-21T15:30:00.000Z", title: "Polígonos regulares e irregulares", objective: "Al terminar, cada estudiante distingue polígonos regulares e irregulares y clasifica triángulos por sus ángulos.", activities: [
    ["start", "¿Qué figuras ves en el aula?", 10, "explore", "whole-class", "Busquen en el aula figuras con lados rectos: ventanas, baldosas, señales. Anoten en el pizarrón cuántos lados tiene cada una y si sus lados miden lo mismo."],
    ["develop", "Regulares e irregulares", 20, "practice", "pairs", "Con regla y transportador, midan los lados y los ángulos de las figuras de la página 2 del libro. Clasifiquen cada una como regular o irregular y los triángulos como rectángulo, obtusángulo o acutángulo."],
    ["close", "Comprobamos", 15, "assess", "individual", "Responde y explica tu respuesta con un dibujo.", ["Todos sus lados y ángulos son iguales", "Tiene más de cuatro lados", "Tiene un ángulo recto"], 0, "¿Qué hace que un polígono sea regular?"]] },
  { id: "seed-lesson-m6-perimetro", unit: units[0], position: 1, outcome: "1.2", published: "2026-10-23T15:30:00.000Z", title: "Perímetro de polígonos", objective: "Al terminar, cada estudiante calcula el perímetro de polígonos regulares e irregulares en situaciones de su entorno.", activities: [
    ["start", "¿Cuánto mide el borde?", 10, "explore", "whole-class", "Pregunta cuánta cinta haría falta para rodear el pizarrón. Escuchen estimaciones y midan juntos."],
    ["develop", "Calculamos perímetros", 20, "practice", "pairs", "Resuelvan los ejercicios de la página 4 del libro: perímetro de un rectángulo, de un hexágono regular y de un terreno irregular."],
    ["close", "Comprobamos", 15, "assess", "individual", "Resuelve y comparte tu procedimiento.", ["30 cm", "25 cm", "60 cm"], 0, "¿Cuál es el perímetro de un pentágono regular de 6 cm de lado?"]] },
];
for (const lesson of lessons) {
  const activities = lesson.activities.map(([phase, title, minutes, purpose, grouping, text, options, answer, prompt], index) => ({
    id: `${lesson.id}-a${index + 1}`, position: index, title, minutes, phase, purpose, grouping, instructions: "", outcomeIds: [outcomeId(lesson.outcome)],
    blocks: [{ id: `${lesson.id}-a${index + 1}-b1`, kind: "text", richContent: doc(text) }, ...(options ? [{ id: `${lesson.id}-a${index + 1}-b2`, kind: "question", richContent: doc(prompt), options, answer }] : [])],
  }));
  const content = { id: lesson.id, title: lesson.title, objective: lesson.objective, program: lesson.unit.name, courseId: COURSE, courseUnitId: lesson.unit.id, duration: 45, materials: [], reflection: "¿Qué aprendiste y cómo lo aplicarías?", activities, publishedAt: lesson.published, shareCode: shareCode(lesson.id), sequence: "start-develop-close", outcomeIds: [outcomeId(lesson.outcome)] };
  const published = { ...content, outcomes: [{ id: outcomeId(lesson.outcome), ...codes.get(outcomeId(lesson.outcome)) }], resources: [], revision: 1 };
  sql.push(insert("lessons", { id: lesson.id, program_id: COURSE, status: "published", content: JSON.stringify(content), unit_id: null, position: lesson.position, archived: 0, published_content: JSON.stringify(published), revision: 1, draft_version: 1, published_version: 1, updated_at: lesson.published, course_unit_id: lesson.unit.id }));
  event(LEAD, "published", "lesson", lesson.id, COURSE, `Publicó «${lesson.title}» (publicación 1)`, lesson.published);
}

// The main book: a fictional textbook. Its text is stored as already read; the same pages make the PDF in R2.
export const bookPages = [
  "Matemáticas 6. Libro del estudiante. Edición de demostración para Colegio Horizonte. Este libro acompaña el sexto grado de primaria: cada tema tiene lectura, ejemplos resueltos y ejercicios para practicar en clase y en casa.",
  "Tema 1. Polígonos regulares e irregulares. Un polígono es una figura plana cerrada formada por segmentos. Es regular cuando todos sus lados y todos sus ángulos son iguales, como el cuadrado o el hexágono de un panal; es irregular cuando no lo son. Los triángulos se clasifican por sus ángulos en rectángulo, obtusángulo y acutángulo. Los paralelogramos son rectángulos, cuadrados, romboides y rombos. Ejercicio: traza un rombo y un romboide y escribe en qué se diferencian.",
  "Polígonos en la cultura maya. En los tejidos de Guatemala aparecen rombos, triángulos y hexágonos que se repiten. Observa un güipil: identifica los polígonos regulares e irregulares y las simetrías del diseño. La suma de los ángulos interiores de un pentágono es 540 grados y la de un hexágono es 720 grados.",
  "Tema 2. Perímetro. El perímetro de un polígono es la suma de las longitudes de sus lados. En un polígono regular basta multiplicar la medida de un lado por el número de lados: un pentágono regular de 6 cm de lado tiene 30 cm de perímetro. Ejercicio: mide el perímetro del patio de la escuela y del terreno de la cancha.",
  "Área de triángulos y círculos. El área de un triángulo es base por altura entre dos. La circunferencia mide dos por pi por el radio, y el área del círculo es pi por el radio al cuadrado. Ejercicio: calcula el área de una mesa redonda de 50 cm de radio y el área de un banderín triangular.",
  "Tema 3. Sólidos geométricos. Los prismas y las pirámides tienen caras planas; los conos y los cilindros tienen una superficie curva. Cuenta en cada sólido sus caras, vértices y aristas: un prisma rectangular tiene 6 caras, 8 vértices y 12 aristas. Construye con cartón el desarrollo plano de un prisma, una pirámide, un cono y un cilindro.",
  "Área y volumen. El área total de un prisma es la suma de las áreas de todas sus caras. El volumen de un prisma rectangular es largo por ancho por alto; el de un cilindro es el área de su base por su altura. Ejercicio: calcula cuánta agua cabe en un tinaco cilíndrico y cuánto cartón se necesita para una caja.",
  "Tema 4. El plano cartesiano. Los números positivos y negativos representan temperaturas sobre y bajo cero. Un par ordenado (3, 2) indica una posición en el plano cartesiano: 3 en el eje horizontal y 2 en el vertical. Ejercicio: ubica en el plano los puntos de un mapa del barrio.",
  "Tema 5. Numeración maya y romana. El sistema maya es vigesimal: usa punto, barra y concha, y cada posición vale veinte veces la anterior. Convierte cantidades del sistema decimal al vigesimal y escribe números romanos hasta M.",
  "Tema 6. Fracciones. Para simplificar una fracción se dividen el numerador y el denominador entre el mismo número hasta su mínima expresión. Para sumar y restar fracciones con diferente denominador buscamos un denominador común. Ejercicio: en una receta se usa un medio de taza de azúcar y un tercio de taza de leche; ¿cuánto se usa en total?",
  "Multiplicación y división de fracciones. Para multiplicar fracciones se multiplican los numeradores entre sí y los denominadores entre sí. Para dividir, se multiplica por la fracción inversa del divisor. Ejercicio: si una cinta de tres cuartos de metro se reparte entre tres estudiantes, ¿cuánto recibe cada uno?",
  "Tema 7. Información en porcentajes. La información del contexto, como la población de un municipio o los resultados de un partido, se clasifica en variables cualitativas y cuantitativas. El porcentaje expresa una parte de cien: si 12 de 40 estudiantes prefieren el fútbol, el 30 por ciento lo prefiere. Interpreta los porcentajes de una noticia.",
  "Tablas y gráficas. Una tabla de frecuencias cuenta cuántas veces aparece cada dato. Las gráficas de barras comparan cantidades y las gráficas circulares muestran partes de un todo. Ejercicio: organiza en una tabla y en una gráfica de barras los deportes favoritos del grado.",
  "Tema 8. Promedio, mediana y moda. El promedio aritmético es la suma de los datos entre el número de datos. La moda es el dato que más se repite y la mediana es el dato del centro cuando se ordenan. Ejercicio: calcula el promedio, la moda y la mediana de las notas de un examen de 20 estudiantes.",
  "Tema 9. Regla de tres. La regla de tres simple resuelve problemas de proporcionalidad: si 4 cuadernos cuestan 60 quetzales, 7 cuadernos cuestan 105 quetzales. Ejercicio: calcula cuántos quetzales se necesitan para comprar la refacción de todo el grado.",
  "Proyecto final. Diseña con tu equipo una feria escolar: dibuja el plano del lugar, calcula perímetros y áreas, organiza el presupuesto con fracciones y presenta en una gráfica las preferencias de tus compañeros.",
];
export const bookPdf = () => pdfFile({ title: "Matemáticas 6 · Libro del estudiante (demostración)", header: ["Matemáticas 6 · Libro del estudiante", "Edición de demostración · Material ficticio"], footer: "Colegio Horizonte (demostración)", blocks: bookPages.flatMap((text, index) => [{ text: `Página ${index + 1}`, bold: true, size: 9, space: index ? 9999 : 0 }, { text, size: 12, space: 6 }]) });
// Each block starts on a page of its own (a very large space), so PDF page n holds book page n.
export const BOOK = { id: "seed-file-m6-libro", name: "Matemáticas 6 - Libro del estudiante.pdf", objectKey: `${ORG}/${COURSE}/seed-file-m6-libro` };
const pdf = Buffer.from(bookPdf(), "latin1"), sha256 = createHash("sha256").update(pdf).digest("hex");
sql.push(insert("course_files", { id: BOOK.id, organization_id: ORG, course_id: COURSE, upload_key: uuid("libro-upload"), object_key: BOOK.objectKey, original_name: BOOK.name, extension: "pdf", media_type: "application/pdf", size_bytes: pdf.length, sha256, status: "ready", created_by: LEAD, created_at: "2026-10-19T18:00:00.000Z", updated_at: "2026-10-19T18:00:00.000Z" }));
sql.push(insert("materials", { id: "seed-res-m6-geogebra", course_id: COURSE, organization_id: ORG, title: "Geometría interactiva", description: "Simulador para construir polígonos y medir ángulos y áreas.", kind: "link", content: "https://www.geogebra.org/geometry", status: "published", version: 1, updated_at: "2026-10-19T18:10:00.000Z" }));
sql.push(insert("course_bibliography", { id: `reference-${uuid("libro")}`, organization_id: ORG, course_id: COURSE, material_id: null, file_id: BOOK.id, role: "text", is_primary: 1, citation: "Edición de demostración, Colegio Horizonte, 2026", created_by: LEAD, created_at: "2026-10-19T18:20:00.000Z", updated_at: "2026-10-19T18:20:00.000Z" }));
sql.push(insert("course_bibliography", { id: `reference-${uuid("geogebra")}`, organization_id: ORG, course_id: COURSE, material_id: "seed-res-m6-geogebra", file_id: null, role: "support", is_primary: 0, citation: "", created_by: LEAD, created_at: "2026-10-19T18:25:00.000Z", updated_at: "2026-10-19T18:25:00.000Z" }));
sql.push(insert("book_texts", { file_id: BOOK.id, organization_id: ORG, course_id: COURSE, sha256, status: "ready", pages: bookPages.length, characters: bookPages.reduce((sum, page) => sum + page.length, 0), extracted_by: LEAD, extracted_at: "2026-10-19T18:30:00.000Z" }));
bookPages.forEach((text, index) => sql.push(insert("book_pages", { file_id: BOOK.id, page: index + 1, text })));
event(LEAD, "updated", "resource", BOOK.id, COURSE, "Marcó «Matemáticas 6 - Libro del estudiante» como libro principal del curso", "2026-10-19T18:20:00.000Z");

// 6.º A: Lucía teaches it Monday, Wednesday and Friday; its upcoming classes wait for lessons.
const random = rng(GROUP);
const names = ["Valeria", "Mateo", "Sofía", "Santiago", "Camila", "Sebastián", "Isabella", "Diego", "Mariana", "Emiliano", "Lucía", "Gabriel", "Daniela", "Andrés", "Renata", "Tomás", "Ximena", "Joaquín", "Paula", "Nicolás", "Regina", "Alejandro", "Julieta", "Martín"];
const surnames = ["Ajú", "Batz", "Cux", "Chávez", "Escobar", "García", "Hernández", "Ixcoy", "López", "Méndez", "Pérez", "Quiej", "Ramírez", "Sic", "Tzul", "Xicará", "Yax", "Zapeta"];
const roster = Array.from({ length: 18 }, (_, index) => ({ id: `${GROUP}-l${String(index + 1).padStart(2, "0")}`, name: `${names[index]} ${surnames[Math.floor(random() * surnames.length)]}` }));
const schedule = { weekdays: [1, 3, 5], startsAt: "10:30", duration: 45, from: "2026-10-28", until: "2026-11-27" };
sql.push(insert("course_groups", { id: GROUP, course_id: COURSE, organization_id: ORG, name: "6.º A", status: "active", created_at: CREATED, access_code: null, schedule_weekdays: schedule.weekdays.join(","), schedule_starts_at: schedule.startsAt, schedule_duration: schedule.duration, schedule_from: schedule.from, schedule_until: schedule.until }));
roster.forEach(learner => sql.push(insert("group_learners", { id: learner.id, group_id: GROUP, course_id: COURSE, organization_id: ORG, display_name: learner.name, status: "active", created_at: CREATED })));
sql.push(insert("section_educators", { group_id: GROUP, user_id: LEAD, course_id: COURSE, organization_id: ORG, added_at: CREATED }));
for (let day = new Date(`${schedule.from}T00:00:00Z`), index = 0; day.toISOString().slice(0, 10) <= schedule.until; day.setUTCDate(day.getUTCDate() + 1)) {
  if (!schedule.weekdays.includes(day.getUTCDay())) continue;
  const date = day.toISOString().slice(0, 10);
  sql.push(insert("class_sessions", { id: `${GROUP}-s${String(++index).padStart(2, "0")}`, group_id: GROUP, course_id: COURSE, organization_id: ORG, lesson_id: null, session_date: date, created_at: "2026-10-20T15:00:00.000Z", starts_at: schedule.startsAt, duration_minutes: schedule.duration, status: "planned", origin: "schedule", updated_at: "2026-10-20T15:00:00.000Z", version: 1 }));
}
event(ADMIN, "updated", "group", GROUP, COURSE, "Configuró el horario de «6.º A»: lunes, miércoles y viernes a las 10:30", "2026-10-20T15:00:00.000Z", GROUP);

// --- Notas -------------------------------------------------------------------------------------------------------
// Ciencias reads in letters; the four bimestres weigh the same.
sql.push(`UPDATE courses SET settings=json_set(settings,'$.gradeScale','letters_af') WHERE id='seed-course-ciencias' AND organization_id='${ORG}';`);
// Scores are written in SQL over the existing rosters: deterministic, with a few missing in the
// fourth bimestre. They are inserted before the first three bimestres are locked (the triggers forbid it after).
const sections = [["seed-group-mat-3a", LEAD], ["seed-group-mat-3b", LEAD], ["seed-group-cie-4a", SCIENCE], [GROUP, LEAD]];
// Each student has a steady level (0–30) and each bimestre a variation (0–20): scores between 49 and 100 that look like
// a real class, with a few students below 60.
const level = "((unicode(substr(l.id,-1))*19+unicode(substr(l.id,-2,1))*7+length(l.display_name)*3+unicode(l.display_name)*11)%31)";
const scoreOf = index => `min(100,49+${level}+((unicode(substr(l.id,-1))*${97 + index * 31}+unicode(substr(l.id,-2,1))*${53 + index * 17}+length(l.display_name)*${13 + index * 7}+unicode(substr(l.display_name,2,1))*${5 + index * 3})%21))`;
for (const [group, teacher] of sections) periods.forEach((period, index) => {
  const missing = index === 3 ? ` AND (unicode(substr(l.id,-1))+length(l.display_name))%3<>0` : "";
  sql.push(`INSERT INTO section_grades(id,organization_id,group_id,learner_id,period_id,score,updated_by,updated_at) SELECT 'seed-grade-'||l.id||'-${index + 1}','${ORG}',l.group_id,l.id,'${period.id}',${scoreOf(index)},'${teacher}','${index === 3 ? "2026-10-23" : period.until}T20:00:00.000Z' FROM group_learners l WHERE l.group_id='${group}' AND l.organization_id='${ORG}' AND l.status='active'${missing} AND EXISTS(SELECT 1 FROM organizations WHERE id='${ORG}') AND ${hasYear(Y2026)};`);
});
for (const [group, teacher] of sections) periods.slice(0, 3).forEach(period =>
  sql.push(insert("section_period_locks", { group_id: group, organization_id: ORG, period_id: period.id, locked_by: teacher, locked_at: `${period.until}T22:00:00.000Z` }, hasYear(Y2026))));

const header = [
  "-- Generated by scripts/seed/pilot.mjs. Do not edit by hand.",
  "-- The school pilot (REL-010) in the demo organization: Ciclo 2026 with its bimestres and Ciclo 2027 as a draft,",
  "-- scores in the primary sections (the first three bimestres closed), and «Matemáticas 6.º primaria» with the CNB",
  "-- package, eight indicators in its plan, two published lessons, its main book (text already read) and «6.º A» with",
  "-- upcoming classes. The book map and lesson proposals are left for a live demonstration. Only runs in org-demo.",
];
/** Every name the pilot seed shows (course, units, library, section, lessons): curated demo data, not E2E leftovers. */
export const pilotNames = ["Matemáticas 6.º primaria", ...units.map(unit => unit.name), "Geometría interactiva", BOOK.name.replace(/\.pdf$/, ""), "6.º A", ...lessons.map(lesson => lesson.title)];
/** Ids later demo seeds build on (0056). */
export const pilotIds = { ORG, ADMIN, LEAD, COURSE, GROUP, Y2026, periods, uuid };
/** The migration as it is checked in, and the book's PDF with its fingerprint. */
export const pilotSql = [...header, ...sql, ...events].join("\n") + "\n";
export const book = { pdf, sha256, ...BOOK };
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--book") {
  // The PDF that lives in R2 under BOOK.objectKey: node scripts/seed/pilot.mjs --book <file>
  writeFileSync(process.argv[3], pdf);
  console.log(`${process.argv[3]}: ${pdf.length} bytes, sha256 ${sha256}, object key ${BOOK.objectKey}`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync("database/migrations/0054_demo_pilot.sql", pilotSql);
  console.log(`0054_demo_pilot.sql: ${sql.length + events.length} statements; book ${pdf.length} bytes, sha256 ${sha256}`);
}
