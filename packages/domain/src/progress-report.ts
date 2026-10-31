import type { ReportRecord } from "./report-templates";

/**
 * Section progress report (1.5.2, docs/design/constructor-de-reportes.md §4): what a section has covered of its plan,
 * how its students attend and how far they have read, from the section's own records. Pure: the Worker reads the rows,
 * this turns them into the document's fields (`avance.*`) and tables (`unidades`, `estudiantes`).
 */
export type ClassStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type AttendanceStatus = "present" | "late" | "absent" | "excused";
export interface ProgressInput {
  learners: { id: string; name: string }[];
  classes: { id: string; status: ClassStatus }[];
  attendance: { sessionId: string; learnerId: string; status: AttendanceStatus }[];
  /** The section's plan in order: each unit with the lessons it shows to this section. */
  units: { id: string; name: string; lessons: string[] }[];
  /** Lessons taught in the section's completed classes. */
  taught: string[];
  /** Required readings of the plan for this section, by unit. */
  readings: { id: string; unitId: string }[];
  readingMarks: { readingId: string; learnerId: string }[];
}
export interface LearnerProgress { id: string; name: string; present: number; late: number; absent: number; excused: number; attendance: number | null; read: number }
export interface ProgressSummary {
  classes: { completed: number; scheduled: number; cancelled: number };
  coverage: { taught: number; total: number };
  attendance: number | null;
  readings: { required: number; rate: number | null };
  units: { name: string; total: number; taught: number; readings: number }[];
  learners: LearnerProgress[];
}

/** Attendance counts present and late over every mark that is not excused; no marks means no rate, not zero. */
const rate = (part: number, whole: number) => whole ? part / whole : null;

export function progressSummary(input: ProgressInput): ProgressSummary {
  const counted = new Set(input.classes.filter(item => item.status !== "cancelled").map(item => item.id));
  const taught = new Set(input.taught);
  const required = new Set(input.readings.map(item => item.id));
  const learners = input.learners.map(learner => {
    const marks = input.attendance.filter(mark => mark.learnerId === learner.id && counted.has(mark.sessionId));
    const count = (status: AttendanceStatus) => marks.filter(mark => mark.status === status).length;
    const present = count("present"), late = count("late"), absent = count("absent"), excused = count("excused");
    const read = new Set(input.readingMarks.filter(mark => mark.learnerId === learner.id && required.has(mark.readingId)).map(mark => mark.readingId)).size;
    return { id: learner.id, name: learner.name, present, late, absent, excused, attendance: rate(present + late, present + late + absent), read };
  });
  const attended = learners.reduce((sum, item) => sum + item.present + item.late, 0), marked = learners.reduce((sum, item) => sum + item.present + item.late + item.absent, 0);
  const planned = input.units.flatMap(unit => unit.lessons);
  return {
    classes: { completed: input.classes.filter(item => item.status === "completed").length, scheduled: counted.size, cancelled: input.classes.length - counted.size },
    coverage: { taught: planned.filter(id => taught.has(id)).length, total: planned.length },
    attendance: rate(attended, marked),
    readings: { required: required.size, rate: rate(learners.reduce((sum, item) => sum + item.read, 0), required.size * learners.length) },
    units: input.units.map(unit => ({ name: unit.name, total: unit.lessons.length, taught: unit.lessons.filter(id => taught.has(id)).length, readings: input.readings.filter(item => item.unitId === unit.id).length })),
    learners,
  };
}

const percent = (value: number | null) => value === null ? "Sin datos" : `${Math.round(value * 100)} %`;

/** The progress fields and tables of a section's report; the common fields (organization, section…) come from the caller. */
export function progressRecord(summary: ProgressSummary): ReportRecord {
  const { classes, coverage, readings } = summary;
  return {
    fields: {
      "avance.clases": `${classes.completed} de ${classes.scheduled} ${classes.scheduled === 1 ? "clase dada" : "clases dadas"}${classes.cancelled ? ` (${classes.cancelled} ${classes.cancelled === 1 ? "cancelada" : "canceladas"})` : ""}`,
      "avance.cobertura": coverage.total ? `${coverage.taught} de ${coverage.total} lecciones (${percent(rate(coverage.taught, coverage.total))})` : "Sin lecciones en el plan",
      "avance.asistencia": percent(summary.attendance),
      "avance.lecturas": readings.required ? `${percent(readings.rate)} de ${readings.required} ${readings.required === 1 ? "lectura obligatoria" : "lecturas obligatorias"}` : "Sin lecturas obligatorias",
      "avance.estudiantes": String(summary.learners.length),
    },
    datasets: {
      unidades: summary.units.map(unit => ({ unidad: unit.name, lecciones: String(unit.total), dadas: String(unit.taught), cobertura: unit.total ? percent(unit.taught / unit.total) : "—", lecturas: String(unit.readings) })),
      estudiantes: summary.learners.map(item => ({
        estudiante: item.name, asistencia: percent(item.attendance), presentes: String(item.present + item.late), ausencias: String(item.absent), justificadas: String(item.excused),
        lecturas: readings.required ? `${item.read} de ${readings.required}` : "—",
      })),
    },
  };
}
