// Builds 0046_demo_educator_lifecycle.sql: published profiles, credentials, preferences, policies, templates
// and contracts in every phase for the demo organization. Deterministic. Every statement is one line and
// only runs when org-demo exists. Staff-file objects live in R2: this seed does not insert staff_documents.
// Run: node scripts/seed/lifecycle.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ORG = "org-demo";
const ADMIN = "user-0";
const ADMIN_USER = "admin-demo";
const ORG_NAME = "Colegio Horizonte (demostración)";
const ORG_SIGN = "Administración de Colegio Horizonte";
const GUARD = `WHERE EXISTS(SELECT 1 FROM organizations WHERE id='${ORG}')`;
const q = value => value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''").replaceAll("\n", "'||char(10)||'")}'`;
const insert = (table, row, extra = GUARD) => `INSERT INTO ${table}(${Object.keys(row).join(",")}) SELECT ${Object.values(row).map(q).join(",")} ${extra};`;
const json = value => JSON.stringify(value);
const sha = text => createHash("sha256").update(text).digest("hex");
const canonicalJson = value => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
};
const digest = value => sha(canonicalJson(value));
const formatDate = date => new Intl.DateTimeFormat("es", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const visibility = {
  identity: "learners", about: "learners", languages: "learners", teaching: "learners", career: "organization",
  links: "organization", credentials: "learners", availability: "organization", contact: "private",
};
const engagementLabels = { employment: "Relación laboral", services: "Prestación de servicios", volunteer: "Voluntariado ad honorem" };
const locationLabels = { onsite: "Presencial", remote: "En línea", hybrid: "Híbrida" };
const compensationSummary = terms => {
  const pay = terms.compensation;
  if (pay.kind === "none") return "Sin remuneración (ad honorem)";
  const amount = new Intl.NumberFormat("es", { style: "currency", currency: pay.currency, currencyDisplay: "code" }).format(Number(pay.amount));
  return pay.kind === "fixed" ? `${amount} mensual` : pay.kind === "hourly" ? `${amount} por hora` : `${amount} por clase impartida`;
};
const contractValues = (partyName, partyEmail, engagement, terms, startDate, endDate) => ({
  "persona.nombre": partyName, "persona.correo": partyEmail || "—", "organizacion.nombre": ORG_NAME,
  "contrato.tipo": engagementLabels[engagement], "contrato.puesto": terms.role,
  "contrato.inicio": formatDate(startDate), "contrato.fin": endDate ? formatDate(endDate) : "plazo indefinido",
  "contrato.remuneracion": compensationSummary(terms),
  "contrato.horas_semanales": terms.weeklyHours === undefined ? "—" : `${terms.weeklyHours} horas`,
  "contrato.preaviso": terms.noticeDays === undefined ? "—" : `${terms.noticeDays} días`,
  "contrato.periodo_prueba": terms.probationDays === undefined ? "—" : `${terms.probationDays} días`,
  "contrato.modalidad": terms.location ? locationLabels[terms.location] : "—",
});
const fill = (text, values) => text.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (match, key) => key in values ? values[key] : match);
const visit = (node, values) => ({ ...node, ...(typeof node.text === "string" ? { text: fill(node.text, values) } : {}), ...(node.content ? { content: node.content.map(child => visit(child, values)) } : {}) });
const merge = (body, values) => ({ type: "doc", content: body.content.map(node => visit(node, values)) });
const plain = body => {
  const block = node => {
    if (typeof node.text === "string") return node.text;
    if (node.type === "hardBreak") return "\n";
    const children = node.content || [];
    if (node.type === "tableRow") return children.map(block).join("\t");
    if (["bulletList", "orderedList", "table", "blockquote", "listItem"].includes(node.type)) return children.map(block).join("\n");
    return children.map(block).join("");
  };
  return body.content.map(block).map(text => text.trim()).filter(Boolean).join("\n\n");
};
const clauses = lines => ({
  type: "doc",
  content: lines.flatMap(line => line.startsWith("## ")
    ? [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: line.slice(3) }] }]
    : [{ type: "paragraph", content: [{ type: "text", text: line }] }]),
});

const people = [
  { id: "seed-user-ana", username: "ana.lopez", name: "Ana López", email: "ana.lopez@horizonte.ejemplo.test", headline: "Docente de inglés para primaria, con énfasis en conversación", bio: "Acompaño a niñas y niños a hablar inglés con confianza: cantamos, jugamos y narramos lo que pasa en el aula.", approach: "Clases cortas con rutinas visibles y mucha práctica oral. Cada estudiante sale con una frase nueva que puede usar en casa.", areas: [{ label: "Inglés", field: "02" }, { label: "Conversación", field: "02" }], levels: ["1", "2"], years: 8, role: "Docente de inglés", institution: "Colegio Horizonte" },
  { id: "seed-user-carlos", username: "carlos.mejia", name: "Carlos Mejía", email: "carlos.mejia@horizonte.ejemplo.test", headline: "Ciencias naturales para primaria, con laboratorio de bajo costo", bio: "Diseño experimentos con materiales de casa para que cada estudiante observe, mida y explique lo que descubre.", approach: "Una pregunta, una evidencia y una bitácora compartida. El error es parte del método.", areas: [{ label: "Ciencias naturales", field: "05" }, { label: "Laboratorio escolar", field: "05" }], levels: ["1", "2"], years: 6, role: "Docente de ciencias", institution: "Colegio Horizonte" },
  { id: "seed-user-diego", username: "diego.ramirez", name: "Diego Ramírez", email: "diego.ramirez@horizonte.ejemplo.test", headline: "Robótica y pensamiento computacional para 9 a 12 años", bio: "Enseño a construir, programar y documentar robots sencillos. El objetivo es que cada equipo explique su diseño.", approach: "Retos semanales en equipos de tres: prototipo, prueba y retrospectiva. En línea usamos simuladores y una bitácora.", areas: [{ label: "Robótica", field: "06" }, { label: "Programación", field: "06" }], levels: ["1", "2", "vocational"], years: 5, role: "Tallerista de robótica", institution: "Colegio Horizonte" },
  { id: "seed-user-lucia", username: "lucia.herrera", name: "Lucía Herrera", email: "lucia.herrera@horizonte.ejemplo.test", headline: "Matemáticas de primaria con material concreto", bio: "Trabajo el valor posicional, las operaciones y los problemas del entorno con bloques, rectas y juegos de mesa.", approach: "Primero manipular, luego representar, al final simbolizar. Cada clase cierra con una explicación en voz alta.", areas: [{ label: "Matemáticas", field: "05" }, { label: "Pensamiento lógico", field: "05" }], levels: ["1"], years: 10, role: "Docente de matemáticas", institution: "Colegio Horizonte" },
  { id: "seed-user-sofia", username: "sofia.castillo", name: "Sofía Castillo", email: "sofia.castillo@horizonte.ejemplo.test", headline: "Arte y primera infancia: explorar, nombrar y crear", bio: "Acompaño a grupos de preprimaria a pintar, cantar y contar historias. El aula es un taller, no una fila de pupitres.", approach: "Rincones de juego y asambleas cortas. Cada obra se presenta al grupo con dos frases del propio estudiante.", areas: [{ label: "Arte", field: "02" }, { label: "Primera infancia", field: "01" }], levels: ["0", "1"], years: 7, role: "Docente de preprimaria", institution: "Colegio Horizonte" },
  { id: "seed-user-tomas", username: "tomas.aguilar", name: "Tomás Aguilar", email: "tomas.aguilar@horizonte.ejemplo.test", headline: "Inglés para jóvenes y adultos, de A1 a B2", bio: "Diseño rutas por niveles del MCER. Cada sesión tiene un objetivo comunicativo y una tarea que se puede usar al día siguiente.", approach: "Presentación, práctica y producción. La corrección va al final, cuando ya se atrevieron a hablar.", areas: [{ label: "Inglés", field: "02" }, { label: "Inglés para adultos", field: "02" }], levels: ["adult", "3"], years: 9, role: "Docente de inglés", institution: "Colegio Horizonte" },
  { id: "user-educator", username: "educador-demo", name: "Educador de la demostración", email: "educador.demo@horizonte.ejemplo.test", headline: "Exploración del entorno para grupos de demostración", bio: "Acompaño el curso de demostración: planifico, imparto y registro lo que ocurre en cada clase para que administración vea el flujo completo.", approach: "Una rutina clara, un material visible y un cierre en el que cada estudiante nombra lo que aprendió.", areas: [{ label: "Exploración del entorno", field: "00" }, { label: "Tutoría", field: "01" }], levels: ["1", "adult"], years: 4, role: "Educador", institution: "Colegio Horizonte" },
];

function profileOf(person) {
  return {
    preferredName: person.name.split(" ")[0], pronouns: person.id === "seed-user-sofia" ? "ella" : person.id === "seed-user-lucia" ? "ella" : "él",
    headline: person.headline, country: "GT", city: "Guatemala", timezone: "America/Guatemala",
    bio: person.bio, approach: person.approach, videoUrl: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    languages: person.id === "seed-user-ana" || person.id === "seed-user-tomas"
      ? [{ code: "es", proficiency: "native", teaches: true }, { code: "en", proficiency: "C1", teaches: true }, { code: "fr", proficiency: "B1", teaches: false }]
      : [{ code: "es", proficiency: "native", teaches: true }, { code: "en", proficiency: "B2", teaches: false }],
    areas: person.areas, levels: person.levels, modalities: ["in_person", "hybrid"], formats: ["group", "one_to_one"],
    audiences: person.levels.includes("0") ? ["children"] : person.levels.includes("adult") ? ["adolescents", "adults"] : ["children", "adolescents"],
    experienceYears: person.years,
    experience: [
      { role: person.role, institution: person.institution, country: "GT", from: "2021-01", to: null, description: "Diseño e imparto las clases de la demostración y registro el avance de cada grupo." },
      { role: "Docente auxiliar", institution: "Centro comunitario ficticio Los Pinos", country: "GT", from: "2018-02", to: "2020-11", description: "Apoyé talleres de refuerzo por las tardes." },
    ],
    education: [
      { degree: "Licenciatura en Educación", institution: "Universidad ficticia del Valle", country: "GT", year: 2017, field: "Pedagogía" },
      { degree: "Diplomado en mediación pedagógica", institution: "Instituto ficticio de formación docente", country: "GT", year: 2020, field: "Didáctica" },
    ],
    links: [
      { kind: "linkedin", url: `https://www.linkedin.com/in/${person.username.replace(".", "-")}-ficticio` },
      { kind: "website", url: `https://www.horizonte.ejemplo.test/equipo/${person.username}` },
    ],
  };
}

const volunteerTerms = { role: "Educador voluntario", compensation: { kind: "none" }, term: { kind: "indefinite" }, weeklyHours: 6, location: "hybrid", noticeDays: 15 };
const servicesTerms = { role: "Educador por clase", compensation: { kind: "per-session", amount: "150.00", currency: "GTQ" }, term: { kind: "indefinite" }, weeklyHours: 8, location: "onsite", noticeDays: 7 };
const employmentTerms = { role: "Docente de planta", compensation: { kind: "fixed", amount: "4500.00", currency: "GTQ", period: "month" }, term: { kind: "fixed", months: 10 }, weeklyHours: 20, location: "hybrid", noticeDays: 30, probationDays: 60 };
const volunteerBody = clauses([
  "## Objeto",
  "{{persona.nombre}} se incorpora a {{organizacion.nombre}} en una {{contrato.tipo}} como {{contrato.puesto}}, a partir del {{contrato.inicio}}.",
  "La persona dedica su tiempo de forma voluntaria y ad honorem. No existe relación laboral ni remuneración económica: {{contrato.remuneracion}}.",
  "## Dedicación y modalidad",
  "La dedicación prevista es de {{contrato.horas_semanales}} semanales en modalidad {{contrato.modalidad}}. El fin del acuerdo es {{contrato.fin}}.",
  "Cualquiera de las partes puede dar por concluida la colaboración con un preaviso de {{contrato.preaviso}}.",
  "## Compromisos",
  "La persona prepara e imparte las clases asignadas, registra la asistencia y cuida la información de estudiantes y familias.",
  "La organización facilita el espacio, los materiales y el acompañamiento de coordinación académica.",
  "## Protección de datos y imagen",
  "Los datos de contacto de {{persona.correo}} se usan solo para la coordinación interna. Las fotografías del aula requieren autorización previa.",
]);
const servicesBody = clauses([
  "## Objeto",
  "{{persona.nombre}} presta servicios profesionales a {{organizacion.nombre}} como {{contrato.puesto}}, en una {{contrato.tipo}}, desde el {{contrato.inicio}}.",
  "## Remuneración",
  "La contraprestación es {{contrato.remuneracion}}. Se liquida según las clases efectivamente impartidas y registradas en la plataforma.",
  "No se configura una relación laboral. Cada parte cubre sus propias obligaciones fiscales.",
  "## Plazo y modalidad",
  "El acuerdo es por {{contrato.fin}} y se desarrolla en modalidad {{contrato.modalidad}}, con una dedicación de {{contrato.horas_semanales}}.",
  "El preaviso para concluirlo es de {{contrato.preaviso}}.",
  "## Calidad del servicio",
  "La persona entrega el plan de cada clase con 24 horas de antelación y registra el cierre el mismo día.",
  "La organización confirma el cronograma y pone a disposición el aula, el código de la sección y el material acordado.",
]);
const employmentBody = clauses([
  "## Objeto",
  "{{persona.nombre}} se vincula a {{organizacion.nombre}} mediante una {{contrato.tipo}} como {{contrato.puesto}}, desde el {{contrato.inicio}} hasta el {{contrato.fin}}.",
  "## Remuneración y jornada",
  "La remuneración es {{contrato.remuneracion}}. La jornada semanal es de {{contrato.horas_semanales}} en modalidad {{contrato.modalidad}}.",
  "## Periodo de prueba y preaviso",
  "Hay un periodo de prueba de {{contrato.periodo_prueba}}. Transcurrido ese plazo, el preaviso es de {{contrato.preaviso}}.",
  "## Obligaciones",
  "La persona imparte las asignaturas asignadas, participa en las reuniones de coordinación y mantiene al día el expediente de cada sección.",
  "La organización paga en la fecha acordada, cubre los materiales del aula y respeta los días sin clase del calendario institucional.",
  "## Terminación",
  "Al vencer el plazo, el contrato concluye sin necesidad de aviso adicional, salvo que las partes firmen una prórroga o una enmienda.",
]);

const templates = [
  { id: "ct-volunteer-docente", versionId: "ctv-volunteer-docente-1", name: "Voluntariado docente ad honorem", engagement: "volunteer", description: "Actividad docente sin remuneración económica.", body: volunteerBody, defaults: volunteerTerms, editable: ["role", "term", "weeklyHours", "noticeDays", "location", "notes"] },
  { id: "ct-servicios-clase", versionId: "ctv-servicios-clase-1", name: "Prestación de servicios por clase impartida", engagement: "services", description: "Honorarios en quetzales por cada clase registrada.", body: servicesBody, defaults: servicesTerms, editable: ["role", "compensation", "term", "weeklyHours", "location", "notes"] },
  { id: "ct-laboral-docente", versionId: "ctv-laboral-docente-1", name: "Relación laboral docente", engagement: "employment", description: "Contrato laboral mensual a plazo fijo de diez meses.", body: employmentBody, defaults: employmentTerms, editable: ["role", "compensation", "term", "weeklyHours", "noticeDays", "probationDays", "location", "notes"] },
];

function prepared(template, person, terms, startDate, endDate) {
  const values = contractValues(person.name, person.email, template.engagement, terms, startDate, endDate);
  const body = merge(template.body, values);
  return { title: template.name, body, bodyText: plain(body), terms, startDate, endDate, partyName: person.name, partyEmail: person.email };
}

function fingerprints(id, template, prepared, sentAt, member) {
  const documentSha256 = digest({
    id, organizationId: ORG, templateVersionId: template.versionId, engagement: template.engagement, title: prepared.title,
    bodyText: prepared.bodyText, terms: prepared.terms, partyName: prepared.partyName, partyEmail: prepared.partyEmail ?? "",
    startDate: prepared.startDate, endDate: prepared.endDate ?? "indefinite",
  });
  const orgSignature = digest({
    contractId: id, organizationId: ORG, party: "organization", userId: ADMIN, username: ADMIN_USER,
    signedName: ORG_SIGN, documentSha256, signedAt: sentAt,
  });
  const memberSignature = member ? digest({
    contractId: id, organizationId: ORG, party: "member", userId: member.id, username: member.username,
    signedName: member.name, documentSha256, signedAt: member.signedAt,
  }) : null;
  return { documentSha256, orgSignature, memberSignature };
}

const invitee = { id: null, username: null, name: "Paula Gómez", email: "paula.gomez@ejemplo.test" };
const byUsername = Object.fromEntries(people.map(item => [item.username, item]));
const volunteer = templates[0], services = templates[1], employment = templates[2];
const contracts = [
  { id: "contract-ana-volunteer", person: byUsername["ana.lopez"], template: volunteer, terms: volunteerTerms, start: "2026-02-01", end: null, status: "active", sentAt: "2026-01-20T15:00:00.000Z", signedAt: "2026-01-21T14:10:00.000Z" },
  { id: "contract-lucia-services", person: byUsername["lucia.herrera"], template: services, terms: servicesTerms, start: "2026-03-01", end: null, status: "active", sentAt: "2026-02-18T16:00:00.000Z", signedAt: "2026-02-19T09:20:00.000Z" },
  { id: "contract-sofia-original", person: byUsername["sofia.castillo"], template: employment, terms: employmentTerms, start: "2025-03-01", end: "2026-01-14", status: "superseded", sentAt: "2025-02-10T14:00:00.000Z", signedAt: "2025-02-11T11:00:00.000Z", closedAt: "2026-01-14T18:00:00.000Z", closeReason: "Reemplazado por una enmienda firmada" },
  { id: "contract-sofia-amendment", person: byUsername["sofia.castillo"], template: employment, terms: employmentTerms, start: "2026-01-15", end: "2026-11-14", status: "active", sentAt: "2026-01-08T15:00:00.000Z", signedAt: "2026-01-09T10:30:00.000Z", supersedesId: "contract-sofia-original" },
  { id: "contract-educador-volunteer", person: byUsername["educador-demo"], template: volunteer, terms: volunteerTerms, start: "2026-01-10", end: null, status: "active", sentAt: "2026-01-05T13:00:00.000Z", signedAt: "2026-01-06T09:00:00.000Z" },
  { id: "contract-carlos-scheduled", person: byUsername["carlos.mejia"], template: volunteer, terms: volunteerTerms, start: "2026-11-01", end: null, status: "active", sentAt: "2026-10-10T15:00:00.000Z", signedAt: "2026-10-11T12:00:00.000Z" },
  { id: "contract-tomas-pending", person: byUsername["tomas.aguilar"], template: services, terms: servicesTerms, start: "2026-10-01", end: null, status: "sent", sentAt: "2026-10-12T16:30:00.000Z" },
  { id: "contract-diego-expired", person: byUsername["diego.ramirez"], template: volunteer, terms: { ...volunteerTerms, term: { kind: "fixed", months: 12 } }, start: "2025-10-01", end: "2026-09-30", status: "active", sentAt: "2025-09-20T14:00:00.000Z", signedAt: "2025-09-21T10:00:00.000Z" },
  { id: "contract-lucia-terminated", person: byUsername["lucia.herrera"], template: volunteer, terms: volunteerTerms, start: "2025-08-01", end: "2026-07-31", status: "terminated", sentAt: "2025-07-20T15:00:00.000Z", signedAt: "2025-07-21T09:00:00.000Z", closedAt: "2026-07-15T17:00:00.000Z", closeReason: "Cierre anticipado por cambio de dedicación a servicios por clase.", terminationDate: "2026-07-15" },
  { id: "contract-diego-declined", person: byUsername["diego.ramirez"], template: employment, terms: employmentTerms, start: "2026-08-01", end: "2027-05-31", status: "declined", sentAt: "2026-07-20T14:00:00.000Z", closedAt: "2026-07-22T11:15:00.000Z", closeReason: "Prefiere continuar como voluntario y no firmar una relación laboral." },
  { id: "contract-invite-paula", person: invitee, template: volunteer, terms: volunteerTerms, start: "2026-11-03", end: null, status: "sent", sentAt: "2026-10-18T15:40:00.000Z", invitationId: "inv-lifecycle-paula" },
];

export function build() {
  const sql = [
    "-- Generated by scripts/seed/lifecycle.mjs. Do not edit by hand.",
    "-- Demo educator lifecycle for org-demo: published profiles, credentials, preferences, policies, templates and",
    "-- contracts in every phase. Staff-file documents need objects in R2: this migration does not insert staff_documents.",
    `-- All demo accounts keep the password Aprender-2026!. Hashes use contractCanonical / contractSignatureCanonical.`,
  ];
  const hasUser = id => `${GUARD} AND EXISTS(SELECT 1 FROM users WHERE id=${q(id)})`;
  sql.push(`UPDATE organizations SET contract_required=1 WHERE id=${q(ORG)} ${GUARD.replace("WHERE ", "AND ")};`);

  for (const person of people) {
    sql.push(`UPDATE users SET email=COALESCE(email,${q(person.email)}),display_name=COALESCE(display_name,${q(person.name)}) WHERE id=${q(person.id)} ${hasUser(person.id).replace("WHERE ", "AND ")};`);
  }

  const termsText = "Estos términos ficticios de Colegio Horizonte describen el uso de la plataforma de demostración: cada cuenta pertenece a una persona del equipo, los estudiantes entran con un código de sección y los datos se usan solo para enseñar y coordinar. Al publicarse una versión nueva, cada persona la acepta en su siguiente ingreso.";
  const privacyText = "Esta política ficticia explica que Colegio Horizonte trata el nombre, el correo y la actividad de cada cuenta para operar la demostración. No se venden datos. Las personas pueden exportar o pedir el cierre de su cuenta. El consentimiento informado se registra con cada versión publicada.";
  const termsJson = clauses(["## Uso de la plataforma", termsText, "## Cuentas y estudiantes", "Las cuentas son individuales. Los estudiantes no necesitan una: entran con el código de su sección."]);
  const privacyJson = clauses(["## Datos que se tratan", privacyText, "## Derechos", "Puedes exportar tus datos o pedir el cierre de la cuenta. Administración atiende la solicitud."]);
  sql.push(`INSERT INTO legal_documents(id,organization_id,kind,status,version,title,body,body_json,effective_at,updated_by,updated_at,published_by,published_at) SELECT 'legal-demo-terms-1',${q(ORG)},'terms','published',COALESCE((SELECT max(version) FROM legal_documents WHERE organization_id=${q(ORG)} AND kind='terms'),0)+1,${q("Términos y condiciones de la demostración")},${q(termsText)},${q(json(termsJson))},'2026-10-01',${q(ADMIN)},'2026-10-01T12:00:00.000Z',${q(ADMIN)},'2026-10-01T12:00:00.000Z' ${GUARD} AND NOT EXISTS(SELECT 1 FROM legal_documents WHERE id='legal-demo-terms-1');`);
  sql.push(`INSERT INTO legal_documents(id,organization_id,kind,status,version,title,body,consent,body_json,effective_at,updated_by,updated_at,published_by,published_at) SELECT 'legal-demo-privacy-1',${q(ORG)},'privacy','published',COALESCE((SELECT max(version) FROM legal_documents WHERE organization_id=${q(ORG)} AND kind='privacy'),0)+1,${q("Política de privacidad de la demostración")},${q(privacyText)},${q("Doy mi consentimiento informado para el tratamiento de mis datos según esta política de demostración.")},${q(json(privacyJson))},'2026-10-01',${q(ADMIN)},'2026-10-01T12:00:00.000Z',${q(ADMIN)},'2026-10-01T12:00:00.000Z' ${GUARD} AND NOT EXISTS(SELECT 1 FROM legal_documents WHERE id='legal-demo-privacy-1');`);
  sql.push(`INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) SELECT 'acc-terms-'||m.user_id,${q(ORG)},'legal-demo-terms-1',m.user_id,'2026-10-02T14:00:00.000Z' FROM memberships m WHERE m.organization_id=${q(ORG)} AND EXISTS(SELECT 1 FROM legal_documents WHERE id='legal-demo-terms-1') AND NOT EXISTS(SELECT 1 FROM legal_acceptances WHERE document_id='legal-demo-terms-1' AND user_id=m.user_id AND withdrawn_at IS NULL);`);
  sql.push(`INSERT INTO legal_acceptances(id,organization_id,document_id,user_id,accepted_at) SELECT 'acc-privacy-'||m.user_id,${q(ORG)},'legal-demo-privacy-1',m.user_id,'2026-10-02T14:00:00.000Z' FROM memberships m WHERE m.organization_id=${q(ORG)} AND EXISTS(SELECT 1 FROM legal_documents WHERE id='legal-demo-privacy-1') AND NOT EXISTS(SELECT 1 FROM legal_acceptances WHERE document_id='legal-demo-privacy-1' AND user_id=m.user_id AND withdrawn_at IS NULL);`);

  for (const person of people) {
    const content = profileOf(person);
    const status = person.username === "carlos.mejia" ? "in_review" : person.username === "diego.ramirez" ? "changes_requested" : "published";
    const draft = person.username === "diego.ramirez" ? { ...content, approach: `${content.approach} En línea aún debo concretar los materiales de casa.` } : content;
    const published = person.username === "carlos.mejia" ? null : content;
    sql.push(`INSERT INTO staff_profiles(user_id,organization_id,phone,contact_email,education,specialties,availability,updated_at,draft,visibility,status,draft_version,status_changed_at) SELECT ${[person.id, ORG, "+502 5555-0100", person.email, "Licenciatura en Educación. Diplomado en mediación pedagógica.", json(content.areas.map(item => item.label)), json([{ day: 1, start: "08:00", end: "12:00" }, { day: 3, start: "14:00", end: "17:00" }]), "2026-10-15T12:00:00.000Z", json(draft), json(visibility), status, person.username === "diego.ramirez" ? 2 : 1, "2026-10-15T12:00:00.000Z"].map(q).join(",")} ${hasUser(person.id)} ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,contact_email=excluded.contact_email,education=excluded.education,specialties=excluded.specialties,availability=excluded.availability,updated_at=excluded.updated_at,draft=excluded.draft,visibility=excluded.visibility,status=excluded.status,draft_version=excluded.draft_version,status_changed_at=excluded.status_changed_at;`);
    if (published) {
      sql.push(insert("staff_profile_versions", {
        id: `spv-${person.id}-1`, organization_id: ORG, user_id: person.id, version: 1, draft_version: 1, content: json(published),
        status: "published", submitted_by: person.id, submitted_at: "2026-09-20T15:00:00.000Z", decided_by: ADMIN, decided_at: "2026-09-21T10:00:00.000Z", published_at: "2026-09-21T10:00:00.000Z",
      }, `${hasUser(person.id)} AND NOT EXISTS(SELECT 1 FROM staff_profile_versions WHERE id='spv-${person.id}-1')`));
    }
    if (person.username === "carlos.mejia") {
      sql.push(insert("staff_profile_versions", {
        id: "spv-seed-user-carlos-1", organization_id: ORG, user_id: person.id, version: 1, draft_version: 1, content: json(content),
        status: "in_review", submitted_by: person.id, submitted_at: "2026-10-16T14:00:00.000Z",
      }, `${hasUser(person.id)} AND NOT EXISTS(SELECT 1 FROM staff_profile_versions WHERE id='spv-seed-user-carlos-1')`));
    }
    if (person.username === "diego.ramirez") {
      sql.push(insert("staff_profile_versions", {
        id: "spv-seed-user-diego-2", organization_id: ORG, user_id: person.id, version: 2, draft_version: 2, content: json(draft),
        status: "returned", submitted_by: person.id, submitted_at: "2026-10-14T16:00:00.000Z", decided_by: ADMIN, decided_at: "2026-10-15T11:30:00.000Z",
        decision_note: "Agrega un video de presentación y concreta cómo trabajas en línea con materiales de casa.",
      }, `${hasUser(person.id)} AND NOT EXISTS(SELECT 1 FROM staff_profile_versions WHERE id='spv-seed-user-diego-2')`));
    }
  }

  const credentials = [
    { id: "cred-ana-degree", user: "seed-user-ana", type: "degree", name: "Licenciatura en Lengua y Literatura", issuer: "Universidad ficticia del Valle", issued: "2016-11-20", expires: null, status: "verified", reason: null },
    { id: "cred-lucia-license", user: "seed-user-lucia", type: "teaching_license", name: "Colegiatura docente ficticia", issuer: "Ministerio ficticio de Educación", issued: "2018-03-01", expires: null, status: "verified", reason: null },
    { id: "cred-carlos-cert", user: "seed-user-carlos", type: "certification", name: "Certificación en indagación científica escolar", issuer: "Red ficticia de ciencias", issued: "2023-05-12", expires: "2028-05-12", status: "submitted", reason: null },
    { id: "cred-diego-rejected", user: "seed-user-diego", type: "other", name: "Constancia de taller de robótica", issuer: "Club ficticio de makers", issued: "2024-02-02", expires: null, status: "rejected", reason: "El documento no identifica a la persona ni el número de horas. Pide una constancia con nombre completo." },
    { id: "cred-sofia-expired", user: "seed-user-sofia", type: "language_certificate", name: "Acreditación de español como lengua de instrucción", issuer: "Instituto ficticio de lenguas", issued: "2019-08-01", expires: "2025-08-01", status: "verified", reason: null },
    { id: "cred-tomas-lang", user: "seed-user-tomas", type: "language_certificate", name: "Certificado ficticio de inglés C1", issuer: "Centro ficticio de idiomas", issued: "2021-06-15", expires: "2027-06-15", status: "verified", reason: null },
    { id: "cred-educador-degree", user: "user-educator", type: "degree", name: "Profesorado de educación primaria", issuer: "Escuela ficticia de formación docente", issued: "2019-10-30", expires: null, status: "verified", reason: null },
  ];
  for (const item of credentials) {
    const decided = item.status === "verified" || item.status === "rejected";
    sql.push(insert("staff_credentials", {
      id: item.id, organization_id: ORG, user_id: item.user, type: item.type, name: item.name, issuer: item.issuer, country: "GT",
      issued_on: item.issued, expires_on: item.expires, status: item.status, rejection_reason: item.reason,
      submitted_at: "2026-09-10T15:00:00.000Z", decided_by: decided ? ADMIN : null, decided_at: decided ? "2026-09-12T10:00:00.000Z" : null,
      version: 1, created_at: "2026-09-10T15:00:00.000Z", updated_at: decided ? "2026-09-12T10:00:00.000Z" : "2026-09-10T15:00:00.000Z",
    }, `${hasUser(item.user)} AND NOT EXISTS(SELECT 1 FROM staff_credentials WHERE id=${q(item.id)})`));
  }

  sql.push(insert("user_preferences", {
    user_id: "seed-user-sofia", organization_id: ORG, language: "es", locale: "es-GT", timezone: "America/Guatemala",
    week_start: 1, hour_cycle: "h12", home_page: "inicio", theme: "dark", text_scale: 100, high_contrast: 0, motion: "system", density: "comfortable", updated_at: "2026-10-08T09:00:00.000Z",
  }, `${hasUser("seed-user-sofia")} ON CONFLICT(user_id) DO UPDATE SET theme='dark',hour_cycle='h12',updated_at=excluded.updated_at`));
  sql.push(insert("user_preferences", {
    user_id: "seed-user-lucia", organization_id: ORG, language: "es", locale: "es-GT", timezone: "America/Guatemala",
    week_start: 1, hour_cycle: "h23", home_page: "inicio", theme: "system", text_scale: 125, high_contrast: 0, motion: "system", density: "comfortable", updated_at: "2026-10-08T09:00:00.000Z",
  }, `${hasUser("seed-user-lucia")} ON CONFLICT(user_id) DO UPDATE SET text_scale=125,updated_at=excluded.updated_at`));
  sql.push(insert("notification_inbox", { id: "inbox-ana-review", organization_id: ORG, user_id: "seed-user-ana", type: "review_approved", reason: "Administración aprobó tu perfil profesional.", path: "/mi-cuenta/perfil", mandatory: 0, created_at: "2026-09-21T10:05:00.000Z" }, `${hasUser("seed-user-ana")} AND NOT EXISTS(SELECT 1 FROM notification_inbox WHERE id='inbox-ana-review')`));
  sql.push(insert("notification_inbox", { id: "inbox-carlos-review", organization_id: ORG, user_id: "seed-user-carlos", type: "review_submitted", reason: "Tu perfil está en revisión.", path: "/mi-cuenta/perfil", mandatory: 0, created_at: "2026-10-16T14:01:00.000Z" }, `${hasUser("seed-user-carlos")} AND NOT EXISTS(SELECT 1 FROM notification_inbox WHERE id='inbox-carlos-review')`));
  sql.push(insert("notification_inbox", { id: "inbox-diego-changes", organization_id: ORG, user_id: "seed-user-diego", type: "review_returned", reason: "Administración te pidió cambios en tu perfil.", path: "/mi-cuenta/perfil", mandatory: 0, created_at: "2026-10-15T11:31:00.000Z" }, `${hasUser("seed-user-diego")} AND NOT EXISTS(SELECT 1 FROM notification_inbox WHERE id='inbox-diego-changes')`));
  sql.push(insert("notification_inbox", { id: "inbox-tomas-contract", organization_id: ORG, user_id: "seed-user-tomas", type: "account_security", reason: "Tienes un contrato pendiente de firma.", path: "/mi-cuenta/contratos", mandatory: 0, created_at: "2026-10-12T16:31:00.000Z" }, `${hasUser("seed-user-tomas")} AND NOT EXISTS(SELECT 1 FROM notification_inbox WHERE id='inbox-tomas-contract')`));

  const now = "2026-10-01T12:00:00.000Z";
  for (const template of templates) {
    sql.push(insert("contract_templates", {
      id: template.id, organization_id: ORG, name: template.name, engagement: template.engagement, description: template.description,
      status: "active", created_by: ADMIN, created_at: now, updated_at: now,
    }, `${GUARD} AND NOT EXISTS(SELECT 1 FROM contract_templates WHERE id=${q(template.id)})`));
    sql.push(insert("contract_template_versions", {
      id: template.versionId, organization_id: ORG, template_id: template.id, status: "published", version: 1, title: template.name,
      body_json: json(template.body), body_text: plain(template.body), defaults_json: json(template.defaults), editable_json: json(template.editable),
      effective_from: "2026-01-01", updated_by: ADMIN, updated_at: now, published_by: ADMIN, published_at: now,
    }, `${GUARD} AND NOT EXISTS(SELECT 1 FROM contract_template_versions WHERE id=${q(template.versionId)})`));
  }

  sql.push(insert("invitations", {
    id: "inv-lifecycle-paula", organization_id: ORG, email: invitee.email, display_name: invitee.name, role: "educator",
    token_hash: sha("hl-invite-lifecycle-paula"), expires_at: "2026-11-20T23:59:59.000Z", status: "pending",
    invited_by: ADMIN, created_at: "2026-10-18T15:40:00.000Z",
  }, `${GUARD} AND NOT EXISTS(SELECT 1 FROM invitations WHERE id='inv-lifecycle-paula')`));

  for (const item of contracts) {
    const ready = prepared(item.template, item.person, item.terms, item.start, item.end);
    const member = item.signedAt && item.person.id ? { id: item.person.id, username: item.person.username, name: item.person.name, signedAt: item.signedAt } : null;
    const marks = fingerprints(item.id, item.template, ready, item.sentAt, member);
    const personGuard = item.person.id ? hasUser(item.person.id) : `${GUARD} AND EXISTS(SELECT 1 FROM invitations WHERE id='inv-lifecycle-paula')`;
    sql.push(insert("contracts", {
      id: item.id, organization_id: ORG, template_version_id: item.template.versionId, origin: "contract", engagement: item.template.engagement,
      title: ready.title, body_json: json(ready.body), body_text: ready.bodyText, terms_json: json(ready.terms),
      party_name: ready.partyName, party_email: ready.partyEmail, user_id: item.person.id, invitation_id: item.invitationId || null,
      start_date: item.start, end_date: item.end, status: item.status, supersedes_id: item.supersedesId || null,
      document_sha256: marks.documentSha256, created_by: ADMIN, created_at: item.sentAt, updated_at: item.closedAt || item.signedAt || item.sentAt,
      sent_at: item.sentAt, org_signer_id: ADMIN, org_signed_name: ORG_SIGN, org_signed_at: item.sentAt, org_signature_sha256: marks.orgSignature,
      member_signed_name: member ? member.name : null, member_signed_at: member ? member.signedAt : null, member_signature_sha256: marks.memberSignature,
      closed_at: item.closedAt || null, closed_by: item.closedAt ? ADMIN : null, close_reason: item.closeReason || null, termination_date: item.terminationDate || null,
    }, `${personGuard} AND NOT EXISTS(SELECT 1 FROM contracts WHERE id=${q(item.id)})`));
  }

  sql.push(insert("account_closures", {
    id: "closure-sofia-demo", organization_id: ORG, user_id: "seed-user-sofia", status: "requested",
    reason: "Cierro la cuenta de demostración al terminar el ciclo para probar el flujo de salida.",
    requested_at: "2026-10-17T18:20:00.000Z",
  }, `${hasUser("seed-user-sofia")} AND NOT EXISTS(SELECT 1 FROM account_closures WHERE id='closure-sofia-demo')`));
  return sql.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = build();
  writeFileSync(new URL("../../database/migrations/0046_demo_educator_lifecycle.sql", import.meta.url), sql);
  console.log(`0046_demo_educator_lifecycle.sql: ${sql.split("\n").length} lines, ${(sql.length / 1024).toFixed(0)} KB`);
}
