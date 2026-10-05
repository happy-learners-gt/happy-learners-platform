export interface HealthResponse { status: "ok" }
export interface VersionResponse { sha: string }
export interface Member { id: string; username: string; displayName?: string; role: "admin" | "educator"; organizationId: string; active?: boolean }
export type CourseRole = "lead" | "co-teacher";
/** Someone on a course's teaching team: the lead or a co-teacher. */
export interface CourseMember { userId: string; username: string; name: string; role: CourseRole }
/**
 * What the signed-in person can do in a course (DEC-023). Administration configures the course, its sections and
 * schedules; the lead decides and publishes the content; co-teachers prepare lessons for review and teach the
 * sections assigned to them.
 */
export interface CourseAccess {
  role: CourseRole | null;
  /** Course settings, team, sections, students, section educators and schedules. */
  configure: boolean;
  /** Lesson drafts and course resources. */
  edit: boolean;
  /** Publishing and archiving lessons, modules, the curriculum plan and reviews. */
  publish: boolean;
  /** Sections whose classes the person plans and teaches. */
  teach: "all" | "assigned" | null;
  /** Sections the person sees. */
  sections: "all" | "assigned";
  /** Sections assigned to the person as educator. */
  assigned: string[];
}
/** A request to publish a lesson, sent by a co-teacher and decided by the lead. */
export interface LessonReview {
  id: string; status: "pending" | "returned" | "approved"; note: string; requestedById: string; requestedByName: string; requestedAt: string;
  decidedByName?: string | null; decidedAt?: string | null; decisionNote: string;
}
/** A review on the home page: what the lead has to decide or what came back to its author. */
export interface ReviewItem extends LessonReview { lessonId: string; lessonTitle: string; courseId: string; courseTitle: string }
/** An audited operation: who did what, on which course, and when. */
export interface ActivityEvent {
  id: string; actorId: string; actorName: string; action: "created" | "updated" | "published" | "archived" | "restored" | "planned" | "recorded" | "uploaded" | "assigned";
  targetType: "course" | "program" | "module" | "lesson" | "resource" | "competency" | "outcome" | "group" | "session" | "team"; targetId: string; courseId?: string | null; summary: string; occurredAt: string;
}
/** How far a course has come: content, curriculum coverage and attendance. */
export interface CourseProgress {
  courseId: string; title: string; team: CourseMember[]; lessons: number; published: number; changes: number;
  outcomes: number; taught: number; assessed: number; sessions: number; attendanceRate: number | null; learners: number; lastActivity: string | null;
}
export interface Organization { id: string; name: string | null; timezone: string; configured: boolean }
export interface Level { id: string; name: string; description: string; position: number; status: "draft" | "active" | "archived"; updatedAt: string }
export interface Unit { id: string; levelId: string; name: string; objective: string; position: number; status: "active" | "archived"; updatedAt: string }
export interface RichTextNode { type: string; text?: string; attrs?: Record<string, string | number | boolean | null>; marks?: { type: string; attrs?: Record<string, string | number | boolean | null> }[]; content?: RichTextNode[] }
export interface RichTextDocument { type: "doc"; content: RichTextNode[] }
/** One piece of an activity. Teacher notes guide the educator and are never published to students. */
export interface ActivityBlock { id: string; kind: "text" | "resource" | "question" | "teacher-note"; instructions?: string; richContent?: RichTextDocument; resourceId?: string; options?: string[]; answer?: number }
export type ActivityPurpose = "explain" | "explore" | "practice" | "assess" | "reflect";
export type ActivityGrouping = "individual" | "pairs" | "teams" | "whole-class";
export type SequenceTemplate = "free" | "start-develop-close" | "five-e" | "ppp" | "workshop";
/**
 * A step of a lesson: what learners do, why (purpose), how (grouping) and in which moment of the sequence.
 * Older activities have a single typed body (type, instructions, richContent, resourceId, options, answer);
 * they are read as one block whose id is the activity id.
 */
export interface Activity {
  id?: string; position?: number; title: string; minutes: number;
  phase?: string; purpose?: ActivityPurpose; grouping?: ActivityGrouping; blocks?: ActivityBlock[];
  /** Learning outcomes this activity works on; when empty it works on those of its lesson. */
  outcomeIds?: string[];
  type?: "text" | "resource" | "question"; instructions: string; richContent?: RichTextDocument; resourceId?: string; options?: string[]; answer?: number;
}
export interface Lesson {
  id: string; title: string; program: string; duration: number; objective: string;
  materials: string[]; activities: Activity[];
  reflection: string; publishedAt: string;
  unitId?: string; position?: number; status?: "draft" | "published" | "archived";
  revision?: number; draftVersion?: number; hasDraft?: boolean; updatedAt?: string; shareCode?: string; completions?: number;
  resources?: (Resource | Material)[];
  courseId?: string; courseUnitId?: string;
  sequence?: SequenceTemplate;
  /** Course learning outcomes the lesson develops. */
  outcomeIds?: string[];
  /** Published lessons carry the wording students see, frozen at publication. */
  outcomes?: { id: string; code: string; statement: string }[];
  /** The latest open review: pending, or returned to its author. */
  review?: LessonReview | null;
}
export type ResourceSkill = "lectura" | "escritura" | "escucha" | "conversación";
export interface Resource { id: string; title: string; description: string; level: string; skill: ResourceSkill; topic: string; tags: string[]; content: string; status: "draft" | "published" | "archived"; kind?: "text" | "link"; updatedAt?: string; }

/** Type of education (UNESCO ISCED 2011, «CINE»). */
export type EducationType = "formal" | "non-formal";
/** ISCED 2011 level; "unspecified" is only for non-formal education. */
export type EducationLevel = "early-childhood" | "pre-primary" | "primary" | "lower-secondary" | "upper-secondary" | "post-secondary" | "short-tertiary" | "bachelor" | "master" | "doctoral" | "unspecified";
export type CourseFormat = "subject" | "open-course" | "workshop" | "laboratory" | "seminar";
export type Modality = "in-person" | "online" | "hybrid";
export type Pacing = "scheduled" | "self-paced";
export type ModuleLabel = "modules" | "units" | "weeks" | "sessions" | "topics" | "blocks";
export interface AcademicProfile { educationType: EducationType; level: EducationLevel; modality: Modality; pacing: Pacing }
/** Behaviour a course's configuration controls. Missing values are inherited or derived. */
export interface CourseSettings { moduleLabel?: ModuleLabel; defaultSequence?: SequenceTemplate; attendance?: boolean; outcomesRequired?: boolean; assessmentRequired?: boolean }
/** A set of courses that share a configuration; it can fix settings for all of them. */
export interface StudyProgram extends AcademicProfile {
  id: string; name: string; description: string; format: CourseFormat; area?: string;
  settings: CourseSettings; locked: (keyof CourseSettings)[]; status: "active" | "archived"; version: number; updatedAt: string; courseCount?: number;
}
export interface Course extends AcademicProfile {
  id: string; title: string; objective: string; programId?: string; format: CourseFormat;
  /** ISCED-F 2013 field: a broad field (2 digits) or a narrow field (3 digits). */
  area?: string; settings: CourseSettings;
  status: "active" | "archived"; version: number; updatedAt: string;
  /** Teaching team, lead first. */
  team?: CourseMember[];
  /** Present on the course detail. */
  access?: CourseAccess;
}
export interface LearningUnit {
  id: string; courseId: string; name: string; objective: string; position: number;
  status: "active" | "archived"; updatedAt: string;
}
export interface Vocabulary { id: string; name: string; status: "active" | "archived"; version: number }
export interface TaxonomyTerm extends Vocabulary { vocabularyId: string }
export interface Taxonomy { vocabularies: Vocabulary[]; terms: TaxonomyTerm[] }
export interface Material {
  id: string; courseId: string; title: string; description: string; kind: "text" | "link" | "file";
  content: string; status: "draft" | "published" | "archived"; version: number; updatedAt: string; termIds: string[];
  fileId?: string; fileName?: string; mediaType?: string; sizeBytes?: number; sha256?: string;
}
/** A weekly class time of a section and the period it applies to; days use 0 for Sunday (ST-099). */
export interface SectionSchedule { weekdays: number[]; startsAt: string; durationMinutes: number; from: string; until: string }
/** A section of a course: the students assigned to it, its access code and its schedule (ST-026, ST-099). */
export interface ClassGroup { id: string; courseId: string; name: string; status: "active" | "archived"; learnerCount: number; accessCode?: string | null; schedule?: SectionSchedule | null; educators: SectionEducator[] }
/** An educator who teaches a section's classes (DEC-023). */
export interface SectionEducator { userId: string; name: string; username: string }
export interface GroupLearner { id: string; groupId: string; displayName: string; status: "active" | "archived" }
/** A published lesson next to the current one in its module, reachable by its share code. */
export interface LessonLink { title: string; shareCode: string }
/** Where a published lesson sits in its module, counting only published lessons (ST-032). */
export interface LessonNavigation { moduleName: string; position: number; total: number; previous: LessonLink | null; next: LessonLink | null }
export type ClassStatus = "planned" | "in_progress" | "completed" | "cancelled";
/** A lesson planned for a class, in the order it is worked on. */
export interface ClassLesson {
  id: string; title: string; position: number; unitTitle?: string | null;
  /** False when the lesson has no current publication students can open: it needs replacing (ST-029). */
  available: boolean;
  /** Publication the class was taught with, once it started (ST-071). */
  revision?: number | null;
}
/** A class of a section: generated by its schedule or added by hand, planned with its lessons, then taught with attendance (ST-035, ST-097, ST-101). */
export interface ClassSession {
  id: string; groupId: string; courseId: string; sessionDate: string; groupName?: string;
  startsAt?: string | null; durationMinutes?: number | null; status: ClassStatus; notes?: string; version: number;
  origin?: "manual" | "schedule"; courseTitle?: string;
  lessons: ClassLesson[];
  taughtByName?: string | null; startedAt?: string | null; completedAt?: string | null;
  /** Attendance totals: learners on the roster, learners marked, and present or late among them. */
  learnerCount?: number; marked?: number; attended?: number;
}
/** What a planned lesson brings to the schedule of classes: its activities and the library resources they use. */
export interface ClassLessonPlan { activities: { title: string; minutes: number }[]; resources: { id: string; title: string; kind: "text" | "link" | "file" }[] }
/** A resource as a class shows it: enough to open it, without editorial fields. */
export interface ClassResource { id: string; courseId?: string; title: string; description: string; kind: "text" | "link" | "file"; content?: string; fileName?: string; available: boolean }
/** What a learner sees after entering a section code: the section's classes, their lessons and resources, and nothing else. */
export interface StudentSpace {
  group: { name: string }; course: { title: string }; organization: string; today: string;
  next: StudentClass | null; upcoming: StudentClass[]; recent: StudentClass[];
  lessons: { title: string; shareCode: string }[];
}
export interface StudentClass {
  id: string; sessionDate: string; startsAt?: string | null; durationMinutes?: number | null; status: ClassStatus;
  /** The published lessons of the class, in order; resources are those of these lessons. */
  lessons: { title: string; shareCode: string }[]; resources: ClassResource[];
}

/** What a course develops over time; groups learning outcomes. */
export interface Competency { id: string; courseId: string; name: string; description: string; position: number; status: "active" | "archived"; updatedAt: string }
export type CognitiveLevel = "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create";
/** What learners will be able to show at the end of the course, and how it is evidenced. */
export interface LearningOutcome {
  id: string; courseId: string; competencyId?: string; statement: string; level: CognitiveLevel; evidence: string;
  position: number; status: "active" | "archived"; updatedAt: string;
}
export interface Curriculum { competencies: Competency[]; outcomes: LearningOutcome[]; unitOutcomes: { unitId: string; outcomeId: string }[] }
