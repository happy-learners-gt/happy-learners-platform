export interface HealthResponse { status: "ok" }
export interface VersionResponse { sha: string }
export interface Member { id: string; username: string; role: "admin" | "educator"; organizationId: string; active?: boolean }
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
}
export type ResourceSkill = "lectura" | "escritura" | "escucha" | "conversación";
export interface Resource { id: string; title: string; description: string; level: string; skill: ResourceSkill; topic: string; tags: string[]; content: string; status: "draft" | "published" | "archived"; kind?: "text" | "link"; updatedAt?: string; }

export type CourseProfile = "free" | "preschool" | "school" | "university" | "workshop" | "laboratory";
export type UnitLabel = "Temas" | "Experiencias" | "Unidades" | "Semanas" | "Módulos" | "Prácticas";
export interface Course {
  id: string; title: string; objective: string; profile: CourseProfile; unitLabel: UnitLabel;
  status: "active" | "archived"; version: number; updatedAt: string; termIds: string[];
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
export interface ClassGroup { id: string; courseId: string; name: string; status: "active" | "archived"; learnerCount: number }
export interface GroupLearner { id: string; groupId: string; displayName: string; status: "active" | "archived" }
export interface ClassSession { id: string; groupId: string; courseId: string; lessonId?: string; sessionDate: string; groupName?: string; attendance?: { learnerId: string; status: "present" | "late" | "absent" | "excused" }[] }
