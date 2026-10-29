import type { AcademicProfile, Course, CourseFormat, CourseSettings, EducationLevel, EducationType, Modality, ModuleLabel, Pacing, SequenceTemplate, StudyProgram } from "@happy-learners/contracts";
import { cleanText, record } from "./courses";
import { defaultThresholds, gradeAverages, gradeScales, isGradeAverage, isGradeScale, isLetterThresholds, isPassingGrade, passingChoices, thresholdPresets, thresholdsText } from "./gradebook";
import { sequenceOf, sequenceTemplates } from "./sequences";

/**
 * Academic model. A course is described with standard dimensions instead of free labels:
 * type and level of education (UNESCO ISCED 2011, «CINE» in Spanish), field of knowledge (ISCED-F 2013),
 * format, modality and pacing. Those dimensions decide what the course does (its settings), which a study
 * program can share with its courses and, where it wants, fix for them.
 */
export const educationTypes: { value: EducationType; label: string; hint: string }[] = [
  { value: "formal", label: "Formal", hint: "Forma parte de un sistema educativo o conduce a una certificación reconocida." },
  { value: "non-formal", label: "No formal", hint: "Formación abierta, continua o complementaria: cursos libres, talleres, idiomas." },
];
export const educationLevels: { value: EducationLevel; code: string; label: string; hint: string }[] = [
  { value: "early-childhood", code: "CINE 01", label: "Desarrollo de la primera infancia", hint: "Nursery o guardería, de 0 a 2 años." },
  { value: "pre-primary", code: "CINE 02", label: "Educación preprimaria", hint: "Preescolar o kínder, de 3 años al ingreso a primaria." },
  { value: "primary", code: "CINE 1", label: "Educación primaria", hint: "Primary o elementary school." },
  { value: "lower-secondary", code: "CINE 2", label: "Secundaria baja", hint: "Middle school; secundaria o ciclo básico." },
  { value: "upper-secondary", code: "CINE 3", label: "Secundaria alta", hint: "High school; bachillerato o ciclo diversificado." },
  { value: "post-secondary", code: "CINE 4", label: "Postsecundaria no terciaria", hint: "Formación técnica después de la secundaria." },
  { value: "short-tertiary", code: "CINE 5", label: "Terciaria de ciclo corto", hint: "Técnico superior." },
  { value: "bachelor", code: "CINE 6", label: "Grado o licenciatura", hint: "Bachelor." },
  { value: "master", code: "CINE 7", label: "Maestría", hint: "Master." },
  { value: "doctoral", code: "CINE 8", label: "Doctorado", hint: "Doctorate." },
  { value: "unspecified", code: "—", label: "Sin nivel", hint: "Formación continua o abierta a cualquier nivel. Solo en educación no formal." },
];
/** ISCED-F 2013: broad fields (2 digits) and their narrow fields (3 digits). Either can describe a course. */
export const knowledgeAreas: { code: string; label: string; fields: { code: string; label: string }[] }[] = [
  { code: "00", label: "Programas y certificaciones genéricos", fields: [{ code: "001", label: "Programas y certificaciones básicos" }, { code: "002", label: "Alfabetización y aritmética elemental" }, { code: "003", label: "Competencias personales y desarrollo" }] },
  { code: "01", label: "Educación", fields: [{ code: "011", label: "Educación" }] },
  { code: "02", label: "Artes y humanidades", fields: [{ code: "021", label: "Artes" }, { code: "022", label: "Humanidades (excepto idiomas)" }, { code: "023", label: "Idiomas" }] },
  { code: "03", label: "Ciencias sociales, periodismo e información", fields: [{ code: "031", label: "Ciencias sociales y del comportamiento" }, { code: "032", label: "Periodismo e información" }] },
  { code: "04", label: "Administración de empresas y derecho", fields: [{ code: "041", label: "Educación comercial y administración" }, { code: "042", label: "Derecho" }] },
  { code: "05", label: "Ciencias naturales, matemáticas y estadística", fields: [{ code: "051", label: "Ciencias biológicas y afines" }, { code: "052", label: "Medio ambiente" }, { code: "053", label: "Ciencias físicas" }, { code: "054", label: "Matemáticas y estadística" }] },
  { code: "06", label: "Tecnologías de la información y la comunicación", fields: [{ code: "061", label: "Tecnologías de la información y la comunicación" }] },
  { code: "07", label: "Ingeniería, industria y construcción", fields: [{ code: "071", label: "Ingeniería y profesiones afines" }, { code: "072", label: "Industria y producción" }, { code: "073", label: "Arquitectura y construcción" }] },
  { code: "08", label: "Agricultura, silvicultura, pesca y veterinaria", fields: [{ code: "081", label: "Agricultura" }, { code: "082", label: "Silvicultura" }, { code: "083", label: "Pesca" }, { code: "084", label: "Veterinaria" }] },
  { code: "09", label: "Salud y bienestar", fields: [{ code: "091", label: "Salud" }, { code: "092", label: "Bienestar" }] },
  { code: "10", label: "Servicios", fields: [{ code: "101", label: "Servicios personales" }, { code: "102", label: "Servicios de higiene y salud ocupacional" }, { code: "103", label: "Servicios de seguridad" }, { code: "104", label: "Servicios de transporte" }] },
];
export function areaLabel(code?: string) {
  if (!code) return "";
  const broad = knowledgeAreas.find(area => area.code === code.slice(0, 2));
  const narrow = broad?.fields.find(field => field.code === code);
  return narrow ? narrow.label : broad?.label || "";
}
export const courseFormats: { value: CourseFormat; label: string; hint: string }[] = [
  { value: "subject", label: "Asignatura", hint: "Materia de un programa o plan de estudios." },
  { value: "open-course", label: "Curso libre", hint: "Curso independiente, abierto a cualquier interesado." },
  { value: "workshop", label: "Taller", hint: "Práctico y breve: se aprende haciendo." },
  { value: "laboratory", label: "Laboratorio", hint: "Prácticas e indagación con procedimientos." },
  { value: "seminar", label: "Seminario", hint: "Discusión y análisis guiado de temas." },
];
export const modalities: { value: Modality; label: string }[] = [{ value: "in-person", label: "Presencial" }, { value: "online", label: "En línea" }, { value: "hybrid", label: "Híbrida" }];
export const pacings: { value: Pacing; label: string; hint: string }[] = [
  { value: "scheduled", label: "Con calendario", hint: "Cada sección avanza junta: sigue un horario y sus clases se planifican y registran en un cronograma." },
  { value: "self-paced", label: "A tu ritmo", hint: "Sin horario ni clases: cada estudiante recorre las lecciones publicadas en orden, cuando quiere, y su sección sigue su avance." },
];

/** What the parts of a course are called on screen. "Módulo" is the canonical name; others are allowed. */
export const moduleLabels: { value: ModuleLabel; one: string; many: string; feminine: boolean }[] = [
  { value: "modules", one: "módulo", many: "módulos", feminine: false },
  { value: "units", one: "unidad", many: "unidades", feminine: true },
  { value: "weeks", one: "semana", many: "semanas", feminine: true },
  { value: "sessions", one: "sesión", many: "sesiones", feminine: true },
  { value: "topics", one: "tema", many: "temas", feminine: false },
  { value: "blocks", one: "bloque", many: "bloques", feminine: false },
];
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Grammatical forms of the module name, so every sentence agrees in gender and number. */
export function moduleNoun(value: ModuleLabel = "modules") {
  const label = moduleLabels.find(item => item.value === value) || moduleLabels[0];
  const f = label.feminine;
  return {
    one: label.one, many: label.many, One: cap(label.one), Many: cap(label.many),
    a: `${f ? "una" : "un"} ${label.one}`, A: `${f ? "Una" : "Un"} ${label.one}`, it: f ? "la" : "lo", theMany: `${f ? "las" : "los"} ${label.many}`, the: `${f ? "la" : "el"} ${label.one}`, The: `${f ? "La" : "El"} ${label.one}`, ofThe: `${f ? "de la" : "del"} ${label.one}`,
    this: `${f ? "esta" : "este"} ${label.one}`, This: `${f ? "Esta" : "Este"} ${label.one}`, New: `${f ? "Nueva" : "Nuevo"} ${label.one}`,
    none: `${f ? "ninguna" : "ningún"} ${label.one}`, archived: f ? "archivada" : "archivado", archivedMany: f ? "archivadas" : "archivados", created: f ? "creada" : "creado", renamed: f ? "renombrada" : "renombrado", saved: f ? "guardada" : "guardado",
  };
}
export type ModuleNoun = ReturnType<typeof moduleNoun>;

export type SettingKey = keyof CourseSettings;
/** Settings registry: everything a course's configuration changes in the product, with its meaning. */
export const settingDefinitions: { key: SettingKey; label: string; description: string }[] = [
  { key: "moduleLabel", label: "Nombre de las partes del curso", description: "Cómo se llaman en pantalla los módulos del curso." },
  { key: "defaultSequence", label: "Secuencia didáctica de las lecciones nuevas", description: "Los momentos con que empieza cada lección nueva." },
  { key: "attendance", label: "Secciones y asistencia", description: "Organizar a los estudiantes en secciones con su lista, sus clases y su asistencia." },
  { key: "workGroups", label: "Grupos de trabajo", description: "Formar grupos de estudiantes dentro de cada sección y asignarlos a las actividades en parejas o en equipos. Requiere secciones." },
  { key: "outcomesRequired", label: "Publicar exige resultados de aprendizaje", description: "Una lección solo se publica si trabaja al menos un resultado del curso." },
  { key: "assessmentRequired", label: "Publicar exige comprobar lo aprendido", description: "Una lección solo se publica si incluye una pregunta o una actividad de evaluación." },
  { key: "gradeScale", label: "Escala de las notas", description: "Cómo se leen las notas de la libreta: de 0 a 100 o con letras de la A a la F." },
  { key: "passingGrade", label: "Nota mínima para aprobar", description: "El promedio desde el que una persona aprueba el curso." },
  { key: "letterThresholds", label: "Umbrales de las letras", description: "La nota mínima de la A, la B, la C y la D; por debajo de la D es F. Solo se usan con la escala de letras." },
  { key: "gradeAverage", label: "Promedio de los periodos", description: "Promedio simple o ponderado por el peso de cada periodo del ciclo lectivo. Un periodo sin nota no cuenta como cero." },
  { key: "gradingSchemeId", label: "Esquema de evaluación", description: "La forma configurable de calcular y mostrar los resultados de evaluación." },
];
const sequences: SequenceTemplate[] = ["free", "start-develop-close", "five-e", "ppp", "workshop"];

/** Defaults that follow from the course's dimensions when nobody has set a value. */
export function derivedSettings(profile: AcademicProfile & { format: CourseFormat }): Required<CourseSettings> {
  return {
    moduleLabel: "modules",
    defaultSequence: profile.format === "workshop" ? "workshop" : profile.format === "laboratory" ? "five-e" : "start-develop-close",
    attendance: profile.modality !== "online",
    workGroups: profile.modality !== "online",
    outcomesRequired: profile.educationType === "formal",
    assessmentRequired: profile.educationType === "formal",
    gradeScale: "numeric_100",
    passingGrade: 60,
    letterThresholds: defaultThresholds,
    gradeAverage: "simple",
    gradingSchemeId: null,
  };
}
export type SettingSource = "course" | "program" | "program-locked" | "derived";
export const sourceLabel: Record<SettingSource, string> = { course: "Definido en el curso", program: "Del programa", "program-locked": "Fijado por el programa", derived: "Según el tipo de curso" };

/** A course inside a program takes the program's type, level, modality and pacing. */
export function effectiveProfile(course: Pick<Course, "educationType" | "level" | "modality" | "pacing" | "format">, program?: StudyProgram | null): AcademicProfile & { format: CourseFormat } {
  return program ? { educationType: program.educationType, level: program.level, modality: program.modality, pacing: program.pacing, format: course.format } : course;
}
/**
 * Resolves each setting: a value fixed by the program wins, then the course's own value, then the program's
 * value, then what the course's dimensions imply. Every value says where it comes from.
 */
export function resolveSettings(course: Pick<Course, "educationType" | "level" | "modality" | "pacing" | "format" | "settings">, program?: StudyProgram | null) {
  const derived = derivedSettings(effectiveProfile(course, program));
  const values = {} as Record<SettingKey, unknown>, source = {} as Record<SettingKey, SettingSource>;
  for (const { key } of settingDefinitions) {
    if (program?.locked.includes(key) && program.settings[key] !== undefined) { values[key] = program.settings[key]; source[key] = "program-locked"; }
    else if (course.settings[key] !== undefined) { values[key] = course.settings[key]; source[key] = "course"; }
    else if (program && program.settings[key] !== undefined) { values[key] = program.settings[key]; source[key] = "program"; }
    else { values[key] = derived[key]; source[key] = "derived"; }
  }
  return { values: values as Required<CourseSettings>, source };
}

export function settingsInput(value: unknown): CourseSettings | null {
  const v = record(value); if (!v) return null;
  const known = new Set(settingDefinitions.map(item => item.key));
  if (Object.keys(v).some(key => !known.has(key as SettingKey))) return null;
  const out: CourseSettings = {};
  if (v.moduleLabel !== undefined) { if (!moduleLabels.some(item => item.value === v.moduleLabel)) return null; out.moduleLabel = v.moduleLabel as ModuleLabel; }
  if (v.defaultSequence !== undefined) { if (!sequences.includes(v.defaultSequence as SequenceTemplate)) return null; out.defaultSequence = v.defaultSequence as SequenceTemplate; }
  for (const key of ["attendance", "workGroups", "outcomesRequired", "assessmentRequired"] as const) {
    if (v[key] !== undefined) { if (typeof v[key] !== "boolean") return null; out[key] = v[key]; }
  }
  if (v.gradeScale !== undefined) { if (!isGradeScale(v.gradeScale)) return null; out.gradeScale = v.gradeScale; }
  if (v.passingGrade !== undefined) { if (!isPassingGrade(v.passingGrade)) return null; out.passingGrade = v.passingGrade; }
  if (v.letterThresholds !== undefined) { if (!isLetterThresholds(v.letterThresholds)) return null; out.letterThresholds = [...v.letterThresholds]; }
  if (v.gradeAverage !== undefined) { if (!isGradeAverage(v.gradeAverage)) return null; out.gradeAverage = v.gradeAverage; }
  if (v.gradingSchemeId !== undefined) {
    if (v.gradingSchemeId !== null && (typeof v.gradingSchemeId !== "string" || !/^scheme-[a-f0-9-]{36}$/.test(v.gradingSchemeId))) return null;
    out.gradingSchemeId = v.gradingSchemeId as string | null;
  }
  return out;
}

/** The options a setting offers in a select, as [value, label]; a current value outside them is kept as an option. */
export function settingChoices(key: SettingKey, current?: unknown): [string, string][] {
  const choices: [string, string][] = key === "moduleLabel" ? moduleLabels.map(item => [item.value, moduleNoun(item.value).Many])
    : key === "defaultSequence" ? sequenceTemplates.map(item => [item.value, item.label])
    : key === "gradeScale" ? gradeScales.map(item => [item.value, item.label])
    : key === "gradeAverage" ? gradeAverages.map(item => [item.value, item.label])
    : key === "passingGrade" ? passingChoices.map(value => [String(value), String(value)])
    : key === "letterThresholds" ? thresholdPresets.map(value => [String(value), thresholdsText(value)])
    : key === "gradingSchemeId" ? []
    : [["true", "Sí"], ["false", "No"]];
  if (current !== undefined && !choices.some(([value]) => value === String(current))) choices.push([String(current), settingText(key, current)]);
  return choices;
}
/** How a setting's value reads. */
export function settingText(key: SettingKey, value: unknown): string {
  if (key === "moduleLabel") return moduleNoun(value as ModuleLabel).Many;
  if (key === "defaultSequence") return sequenceOf(value as SequenceTemplate).label;
  if (key === "gradeScale") return gradeScales.find(item => item.value === value)?.label || String(value);
  if (key === "gradeAverage") return gradeAverages.find(item => item.value === value)?.label || String(value);
  if (key === "passingGrade") return String(value);
  if (key === "letterThresholds") return isLetterThresholds(value) ? thresholdsText(value) : String(value);
  if (key === "gradingSchemeId") return value ? String(value) : "Puntos acumulados";
  return value ? "Sí" : "No";
}
/** A select's text back to the setting's value; undefined for "" (no value of its own). */
export function settingValue(key: SettingKey, text: string): unknown {
  if (text === "") return undefined;
  if (key === "passingGrade") return Number(text);
  if (key === "letterThresholds") return text.split(",").map(Number);
  return text === "true" ? true : text === "false" ? false : text;
}
const areaCodes = new Set(knowledgeAreas.flatMap(area => [area.code, ...area.fields.map(field => field.code)]));
/** Formal education always has a level; "Sin nivel" only describes non-formal education. */
export function profileInput(v: Record<string, unknown>): AcademicProfile | null {
  if (!educationTypes.some(item => item.value === v.educationType) || !educationLevels.some(item => item.value === v.level) || !modalities.some(item => item.value === v.modality) || !pacings.some(item => item.value === v.pacing)) return null;
  if (v.educationType === "formal" && v.level === "unspecified") return null;
  return { educationType: v.educationType as EducationType, level: v.level as EducationLevel, modality: v.modality as Modality, pacing: v.pacing as Pacing };
}
export function courseInput(input: unknown): Pick<Course, "title" | "objective" | "status" | "educationType" | "level" | "format" | "modality" | "pacing" | "area" | "settings"> & { programId: string | null } | null {
  const v = record(input); if (!v) return null;
  const title = cleanText(v.title, 160), objective = cleanText(v.objective ?? "", 1000, false);
  const programId = v.programId === undefined || v.programId === null || v.programId === "" ? null : v.programId;
  const area = v.area === undefined || v.area === null || v.area === "" ? undefined : v.area;
  const profile = profileInput(v), settings = settingsInput(v.settings ?? {});
  if (!title || objective === null || !profile || !settings || !["active", "archived"].includes(String(v.status)) || !courseFormats.some(item => item.value === v.format)) return null;
  if (programId !== null && (typeof programId !== "string" || !/^[a-z0-9-]{1,120}$/.test(programId))) return null;
  if (area !== undefined && (typeof area !== "string" || !areaCodes.has(area))) return null;
  return { title, objective, status: v.status as Course["status"], ...profile, format: v.format as CourseFormat, ...(area ? { area: area as string } : {}), settings, programId };
}
export function programInput(input: unknown): Pick<StudyProgram, "name" | "description" | "educationType" | "level" | "modality" | "pacing" | "format" | "area" | "settings" | "locked" | "status"> | null {
  const v = record(input); if (!v) return null;
  const name = cleanText(v.name, 120), description = cleanText(v.description ?? "", 1000, false);
  const area = v.area === undefined || v.area === null || v.area === "" ? undefined : v.area;
  const profile = profileInput(v), settings = settingsInput(v.settings ?? {});
  const locked = v.locked ?? [];
  if (!name || description === null || !profile || !settings || !["active", "archived"].includes(String(v.status)) || !courseFormats.some(item => item.value === v.format)) return null;
  if (area !== undefined && (typeof area !== "string" || !areaCodes.has(area))) return null;
  // A program can only fix a setting it gives a value to.
  if (!Array.isArray(locked) || new Set(locked).size !== locked.length || locked.some(key => !settingDefinitions.some(item => item.key === key) || settings[key as SettingKey] === undefined)) return null;
  return { name, description, ...profile, format: v.format as CourseFormat, ...(area ? { area: area as string } : {}), settings, locked: locked as SettingKey[], status: v.status as StudyProgram["status"] };
}

/** Starting points that fill every dimension at once; each value can be changed afterwards. */
export const coursePresets: { id: string; label: string; description: string; values: AcademicProfile & { format: CourseFormat } }[] = [
  { id: "open-course", label: "Curso libre", description: "No formal, en línea y a tu ritmo.", values: { educationType: "non-formal", level: "unspecified", format: "open-course", modality: "online", pacing: "self-paced" } },
  { id: "workshop", label: "Taller", description: "No formal, presencial, con sesiones prácticas.", values: { educationType: "non-formal", level: "unspecified", format: "workshop", modality: "in-person", pacing: "scheduled" } },
  { id: "early-childhood", label: "Primera infancia", description: "Preprimaria (CINE 02), presencial.", values: { educationType: "formal", level: "pre-primary", format: "subject", modality: "in-person", pacing: "scheduled" } },
  { id: "primary", label: "Primaria", description: "CINE 1, presencial.", values: { educationType: "formal", level: "primary", format: "subject", modality: "in-person", pacing: "scheduled" } },
  { id: "secondary", label: "Secundaria", description: "Middle o high school (CINE 2 o 3).", values: { educationType: "formal", level: "lower-secondary", format: "subject", modality: "in-person", pacing: "scheduled" } },
  { id: "higher", label: "Educación superior", description: "Grado o licenciatura (CINE 6), híbrida.", values: { educationType: "formal", level: "bachelor", format: "subject", modality: "hybrid", pacing: "scheduled" } },
];

export const labelOf = {
  type: (value: EducationType) => educationTypes.find(item => item.value === value)?.label || value,
  level: (value: EducationLevel) => educationLevels.find(item => item.value === value)?.label || value,
  format: (value: CourseFormat) => courseFormats.find(item => item.value === value)?.label || value,
  modality: (value: Modality) => modalities.find(item => item.value === value)?.label || value,
  pacing: (value: Pacing) => pacings.find(item => item.value === value)?.label || value,
};
