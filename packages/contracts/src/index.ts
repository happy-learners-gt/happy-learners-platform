export interface HealthResponse { status: "ok" }
export interface VersionResponse { sha: string }
/** `mustChangePassword` is present (true) only while the account still signs in with a temporary password (ST-093).
 * `email` is set once someone joins by invitation (ST-121) and only administration's list of people shows it. */
export interface Member { id: string; username: string; displayName?: string; role: "admin" | "educator"; organizationId: string; active?: boolean; mustChangePassword?: true; email?: string | null; permissions?: EffectivePermissions; coordination?: ProgramScope | null }
/**
 * Roles and access (ST-128, ST-135, DEC-041). Permissions come from a fixed catalog grouped by area. Grantable ones reach
 * a person through the academic coordination profile or a security group, always within a program scope; the
 * administration ones belong to the administration role only.
 */
export type GrantablePermission = "courses.view" | "lessons.review" | "teams.assign" | "sections.assign" | "classes.view" | "activity.view";
export type AdministrationPermission = "organization.configure" | "accounts.manage" | "access.manage" | "backup.manage" | "legal.manage" | "profiles.review";
export type PermissionKey = GrantablePermission | AdministrationPermission;
export type PermissionArea = "content" | "team" | "classes" | "reports" | "administration";
/** Every program of the organization, or a list of them; courses without a program are only in `all`. */
export type ProgramScope = { all: true } | { programs: string[] };
/** What the signed-in person may do beyond their course teams; computed again on every request. */
export interface EffectivePermissions { admin: boolean; coordination: ProgramScope | null; grants: Partial<Record<PermissionKey, ProgramScope>> }
export interface PermissionGrant { permission: GrantablePermission; scope: ProgramScope }
export interface SecurityGroup {
  id: string; name: string; description: string; version: number; updatedAt: string;
  grants: PermissionGrant[]; members: { userId: string; name: string; username: string }[];
}
export interface AccessEvent { id: string; actorName: string; action: string; subjectType: "group" | "coordination"; subjectId: string; summary: string; occurredAt: string }
/** An invitation by e-mail (ST-121). `delivery` is the state of its latest message; the token is never listed. */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type DeliveryStatus = "queued" | "sent" | "failed" | "not_configured" | "deferred";
export interface Invitation {
  id: string; email: string; displayName: string; role: "admin" | "educator"; status: InvitationStatus; expiresAt: string; createdAt: string;
  invitedBy: string; acceptedAt: string | null; delivery: DeliveryStatus | null; deliveryError: string | null; sentAt: string | null;
}
/** What the public acceptance page shows before the person chooses a username and password. */
export interface InvitationPreview { organization: string; displayName: string; email: string; role: "admin" | "educator"; expiresAt: string }
export type CourseRole = "lead" | "co-teacher";
/** Someone on a course's teaching team: the lead or a co-teacher. */
export interface CourseMember { userId: string; username: string; name: string; role: CourseRole }
/**
 * What the signed-in person can do in a course (DEC-023, DEC-024). Administration configures the course, its
 * sections and schedules; the lead decides and publishes the content; co-teachers prepare lessons for review.
 * Each educator, the lead included, sees and teaches only the sections assigned to them.
 */
export interface CourseAccess {
  role: CourseRole | null;
  /** Course settings, team, sections, students, section educators and schedules. */
  configure: boolean;
  /** Lesson drafts and course resources. */
  edit: boolean;
  /** Publishing and archiving lessons, modules, the curriculum plan and reviews. */
  publish: boolean;
  /** Lessons the person publishes and reviews (returns with observations): the lead, and coordination in its scope (DEC-041). */
  review?: boolean;
  /** Choosing the lead and co-teachers: administration, and coordination in its scope. */
  team?: boolean;
  /** Choosing who teaches each section among the team: administration, and coordination in its scope. */
  educators?: boolean;
  /** Sections the person sees: every one for administration and coordination in its scope, otherwise those assigned. */
  sections: "all" | "assigned";
  /** Sections assigned to the person as educator; they plan and teach their classes. */
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
  id: string; actorId: string; actorName: string; action: "created" | "updated" | "published" | "archived" | "restored" | "planned" | "recorded" | "uploaded" | "assigned" | "reset" | "accepted" | "withdrawn" | "resent" | "revoked" | "submitted" | "approved" | "returned" | "hidden" | "verified" | "rejected";
  targetType: "course" | "program" | "module" | "lesson" | "resource" | "competency" | "outcome" | "group" | "session" | "team" | "account" | "legal" | "invitation" | "profile" | "credential"; targetId: string; courseId?: string | null; summary: string; occurredAt: string;
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
export interface CourseSettings { moduleLabel?: ModuleLabel; defaultSequence?: SequenceTemplate; attendance?: boolean; workGroups?: boolean; outcomesRequired?: boolean; assessmentRequired?: boolean }
/** A set of courses that share a configuration; it can fix settings for all of them. */
export interface StudyProgram extends AcademicProfile {
  id: string; name: string; description: string; format: CourseFormat; area?: string;
  settings: CourseSettings; locked: (keyof CourseSettings)[]; status: "active" | "archived"; version: number; updatedAt: string; courseCount?: number;
}
/** A program read as a path (DEC-029): its courses, which ones each requires, and the stages they form. */
export interface ProgramPath { courses: { id: string; title: string; status: "active" | "archived" }[]; requirements: { courseId: string; requiredId: string }[]; stages: string[][] }
/** What a course of a program requires and what requires it. */
export interface CourseRequirements { requires: { id: string; title: string; status: "active" | "archived" }[]; unlocks: { id: string; title: string; status: "active" | "archived" }[] }
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
/** How far a section has come with its course, from its own records only (DEC-024). */
export interface SectionIndicators {
  learners: number;
  /** Classes of the section that are not cancelled, and how many were taught, are coming or were not recorded. */
  classes: number; taught: number; upcoming: number; unrecorded: number;
  attendanceRate: number | null;
  /** Published lessons of the course, and how many of them the section taught or has planned. */
  lessonsPublished: number; lessonsTaught: number; lessonsPlanned: number;
  /** Times the section's students opened one of its lessons with the section code. */
  openings: number;
  /** A tu ritmo (DEC-027): students who began the course, those who completed every published lesson, and the average share completed. */
  started: number; finished: number; pathAverage: number | null;
}
/** A section as an instance of its course: who teaches it, its students, its schedule and its own progress (DEC-024). */
export interface SectionSummary extends ClassGroup {
  course: { id: string; title: string; status: "active" | "archived" };
  /** The course's effective pacing: with a calendar, the section has a schedule and classes; at their own pace, it follows each student. */
  pacing: Pacing;
  indicators: SectionIndicators;
  next: { id: string; sessionDate: string; startsAt?: string | null; status: ClassStatus } | null;
  /** Whether the signed-in person teaches it. */
  teaches: boolean;
  /** Whether the course's configuration enables work groups inside its sections (only when reading one section). */
  workGroups?: boolean;
}
/** An educator who teaches a section's classes (DEC-023). */
export interface SectionEducator { userId: string; name: string; username: string; conflicts?: EducatorConflict[] }
/** Classes of a section that overlap with another section the same educator teaches; confirmed ones carry who allowed them. */
export interface EducatorConflict {
  groupId: string; userId: string; name: string; otherGroupId: string; otherGroup: string; otherCourseId: string; otherCourse: string;
  overlaps: number; firstDate: string; startsAt: string; otherStartsAt: string;
  confirmation: { reason: string; confirmedAt: string; confirmedBy: string } | null;
}
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
  /** What the class covered of it, confirmed when it finishes (DEC-026); only "completed" counts as taught. */
  outcome?: LessonOutcome | null;
}
export type LessonOutcome = "completed" | "partial" | "not_reached";
/** Days without class: for the whole organization (groupId null) or for one section, from one day to several weeks (DEC-026). */
export interface CalendarBreak { id: string; groupId: string | null; title: string; from: string; until: string }
/** What happens to the plan of a cancelled class: it moves to the next class, shifting the rest, or it is skipped. */
export type CancelPlan = "shift" | "skip";
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
export interface ClassLessonPlan { activities: { id: string; title: string; minutes: number; grouping?: ActivityGrouping }[]; resources: { id: string; title: string; kind: "text" | "link" | "file" }[] }
/** A resource as a class shows it: enough to open it, without editorial fields. */
export interface ClassResource { id: string; courseId?: string; title: string; description: string; kind: "text" | "link" | "file"; content?: string; fileName?: string; available: boolean }
/** A group of students formed inside a section to work together (DEC-028). The whole section is the default group. */
export interface WorkGroup { id: string; name: string; learnerIds: string[] }
/** An activity of a published lesson done in pairs or teams, and the section's groups that do it; none means the whole section. */
export interface GroupActivity { lessonId: string; lessonTitle: string; unitName: string; activityId: string; title: string; grouping: "pairs" | "teams"; workGroupIds: string[] }
export interface SectionWorkGroups { workGroups: WorkGroup[]; activities: GroupActivity[] }
/** Who does an activity, as the students of a section see it in the lesson: group names, and the members of their own group. */
export interface StudentActivityGroups { activityId: string; groups: { name: string; mine: boolean; members?: string[] }[] }
/** What a learner sees after entering a section code: the section's classes, their lessons and resources, and nothing else. */
export interface StudentSpace {
  group: { name: string }; course: { title: string }; organization: string; today: string;
  next: StudentClass | null; upcoming: StudentClass[]; recent: StudentClass[];
  lessons: { title: string; shareCode: string }[];
  pacing: Pacing;
  /** A tu ritmo: the student who chose their name from the section's list, the list to choose from, and the whole published course in order. */
  learner: { id: string; name: string } | null;
  roster: { id: string; name: string }[];
  path: StudentPathModule[];
  /** ST-157: «Tu educador»: the published profiles of the section's educators, with the sections they show to students. */
  educators: PublicProfile[];
}
export interface StudentPathModule { id: string; name: string; lessons: StudentPathLesson[] }
export interface StudentPathLesson { title: string; shareCode: string; opened: boolean; completed: boolean }
/** How far each student of a self-paced section got in the course's published lessons, in content order. */
export interface SectionProgress {
  lessons: { id: string; title: string; unitName: string }[];
  learners: { id: string; name: string; completed: string[]; opened: string[]; lastActivity: string | null }[];
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

/** ST-123: what a departing person is responsible for, and who can take it over. Administration only. */
export interface DeparturePerson { id: string; name: string; username: string }
export interface DeparturePreview {
  member: DeparturePerson & { active: boolean };
  today: string;
  /** Active courses: a course the person leads needs a new lead; co-teaching ends on its own. */
  courses: { id: string; title: string; role: CourseRole; team: DeparturePerson[] }[];
  /** Active sections the person teaches; `required` when nobody else teaches it, so it needs a replacement. */
  sections: { id: string; name: string; courseId: string; courseTitle: string; others: DeparturePerson[]; required: boolean }[];
  /** Active people of the organization who can take over, without the departing person. */
  people: DeparturePerson[];
  /** The latest departure already recorded for the person, with administration's note. */
  lastDeparture: { departedOn: string; reason: string; recordedAt: string; recordedBy: string } | null;
}
export interface DepartureInput {
  date: string; reason?: string; conflictReason?: string;
  reassignments: { courses: Record<string, string>; sections: Record<string, string> };
}
/**
 * Terms and conditions and the privacy policy of an organization (ST-126, ST-127). A draft has no version; publishing
 * gives it the next one and it never changes again. A privacy policy carries the consent text people agree to.
 */
export type LegalKind = "terms" | "privacy" | "volunteer";
export interface LegalDocument {
  id: string; kind: LegalKind; status: "draft" | "published"; version: number | null; title: string; body: string; consent: string | null;
  updatedAt: string; publishedAt: string | null; publishedBy: string | null;
}
/** A version the signed-in person must accept (terms) or consent to (privacy) before using the platform. */
export type PendingDocument = Pick<LegalDocument, "id" | "kind" | "version" | "title">;
/** Who accepted which version and when; a withdrawn privacy consent keeps its record with the withdrawal date. */
export interface LegalAcceptance {
  id: string; documentId: string; kind: LegalKind; version: number; userId: string; name: string; acceptedAt: string; withdrawnAt: string | null;
  /** ST-153: the electronic signature of this acceptance; null for a privacy consent or an acceptance recorded before signing existed ("sin firma"). */
  signatureId?: string | null; signedName?: string | null;
}
/**
 * ST-153 (DEC-043): what a simple electronic signature records and its receipt shows. documentSha256 fingerprints the
 * canonical text of the signed version; signatureSha256 fingerprints these fields, so a changed receipt is detected.
 */
export interface SignatureRecord {
  signatureId: string; organizationId: string; userId: string; username: string; signedName: string;
  documentId: string; kind: LegalKind; version: number; documentSha256: string; signedAt: string;
}
export interface LegalSignature extends SignatureRecord {
  acceptanceId: string; signatureSha256: string; title: string; name: string; active: boolean; departedOn: string | null;
}
/** The result of verifying a receipt: valid, a signed document that no longer matches, a changed receipt, or an unknown signature. */
export type SignatureCheck = "valid" | "document_mismatch" | "receipt_mismatch" | "unknown";
export interface SignatureVerification { status: SignatureCheck; message: string; signature?: LegalSignature; mismatches?: string[] }
/**
 * ST-149: an educator's profile. Phone and contact e-mail are seen only by the person and administration (`contact`
 * is absent for course teammates); students never receive any of it.
 */
export interface StaffAvailabilitySlot { day: 1 | 2 | 3 | 4 | 5 | 6 | 7; start: string; end: string }
export interface StaffProfile {
  userId: string; displayName: string; username: string; role: "admin" | "educator"; active: boolean;
  photo: boolean; photoVersion: string | null; education: string; specialties: string[]; availability: StaffAvailabilitySlot[];
  contact?: { phone: string | null; contactEmail: string | null; loginEmail: string | null };
  updatedAt: string | null;
}
/**
 * ST-154: the professional profile of an educator, agnostic to subject, level and country. Levels follow ISCED 2011
 * (plus adult and vocational education), languages are BCP 47 tags with a CEFR-like scale (a descriptor applies to
 * languages without CEFR), countries are ISO 3166-1 alpha-2 codes, time zones are IANA names and teaching areas are an
 * open taxonomy with an optional ISCED-F 2013 broad field ("00" to "10").
 */
export type IscedLevel = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "adult" | "vocational";
export type LanguageProficiency = "native" | "C2" | "C1" | "B2" | "B1" | "A2" | "A1";
export type TeachingModality = "in_person" | "online" | "hybrid";
export type TeachingFormat = "one_to_one" | "group" | "self_paced";
export type LearnerAudience = "children" | "adolescents" | "adults" | "special_needs";
export type ProfileLinkKind = "website" | "linkedin" | "orcid" | "other";
export interface ProfileLanguage { code: string; proficiency: LanguageProficiency; teaches: boolean }
export interface TeachingArea { label: string; field: string | null }
/** A position held; `to` is null while it is the current one. Months are YYYY-MM. */
export interface ProfileExperience { role: string; institution: string; country: string | null; from: string; to: string | null; description: string }
export interface ProfileEducation { degree: string; institution: string; country: string | null; year: number | null; field: string }
export interface ProfileLink { kind: ProfileLinkKind; url: string }
export interface ProfessionalProfile {
  preferredName: string; pronouns: string; headline: string; country: string | null; city: string; timezone: string | null;
  bio: string; approach: string; videoUrl: string | null;
  languages: ProfileLanguage[];
  areas: TeachingArea[]; levels: IscedLevel[]; modalities: TeachingModality[]; formats: TeachingFormat[]; audiences: LearnerAudience[]; experienceYears: number | null;
  experience: ProfileExperience[]; education: ProfileEducation[];
  links: ProfileLink[];
}
/** Who sees each section: the person and administration only, the team of the organization, or also the students of their sections. */
export type ProfileVisibilityLevel = "private" | "organization" | "learners";
export type ProfileSection = "identity" | "about" | "languages" | "teaching" | "career" | "links" | "credentials" | "availability" | "contact";
export type ProfileVisibility = Record<ProfileSection, ProfileVisibilityLevel>;
/** ST-156: draft → in_review → published; in_review → changes_requested → in_review; published ⇄ hidden. */
export type ProfileStatus = "draft" | "in_review" | "changes_requested" | "published" | "hidden";
export type ProfileVersionStatus = "in_review" | "returned" | "published" | "superseded" | "withdrawn";
export interface ProfileVersionSummary { version: number; status: ProfileVersionStatus; submittedAt: string; decidedAt: string | null; decidedBy: string | null; note: string | null; publishedAt: string | null }
export interface CompletenessStep { key: string; label: string; section: ProfileSection | "photo"; done: boolean }
export interface ProfileCompleteness { percent: number; steps: CompletenessStep[] }
/** ST-155: credentials. `expired` is never stored: a verified credential counts as expired after its expiry date. */
export type CredentialType = "degree" | "certification" | "teaching_license" | "language_certificate" | "other";
export type CredentialState = "draft" | "submitted" | "verified" | "rejected" | "withdrawn";
export type CredentialStatus = CredentialState | "expired";
export interface Credential {
  id: string; userId: string; type: CredentialType; name: string; issuer: string; country: string | null; issuedOn: string; expiresOn: string | null;
  credentialCode: string | null; verificationUrl: string | null; documentId: string | null; documentTitle: string | null;
  status: CredentialStatus; rejectionReason: string | null; submittedAt: string | null; decidedAt: string | null; decidedBy: string | null; version: number; updatedAt: string;
}
/** What the team and the students see of a verified credential: never the code, the link or the supporting document. */
export interface PublicCredential { id: string; type: CredentialType; name: string; issuer: string; country: string | null; issuedOn: string; expiresOn: string | null; status: "verified" | "expired" }
/** «Mi perfil»: the working copy, its publication, the open review and how complete it is. */
export interface MyProfessionalProfile {
  userId: string; username: string; displayName: string; role: "admin" | "educator"; photoVersion: string | null;
  contact: { phone: string | null; contactEmail: string | null; loginEmail: string | null }; availability: StaffAvailabilitySlot[]; education: string;
  draft: ProfessionalProfile; draftVersion: number; visibility: ProfileVisibility;
  status: ProfileStatus; hiddenBy: "self" | "admin" | "system" | null; reviewRequired: boolean;
  publication: { version: number; publishedAt: string; content: ProfessionalProfile } | null;
  /** The latest version sent for review while it is open or returned with changes to make. */
  submission: ProfileVersionSummary | null;
  /** Whether the working copy differs from what is published (or sent for review). */
  hasChanges: boolean;
  history: ProfileVersionSummary[];
  completeness: ProfileCompleteness; missing: string[];
  credentials: Credential[];
}
/**
 * ST-157: a published profile as the team (`organization`) or the students of the person's sections (`learners`) see it.
 * Sections the person keeps for a narrower audience come empty and are not listed in `sections`.
 */
export interface PublicProfile {
  userId: string; displayName: string; photoUrl: string | null; role: "admin" | "educator"; audience: "organization" | "learners";
  sections: ProfileSection[]; content: ProfessionalProfile; credentials: PublicCredential[];
  availability?: StaffAvailabilitySlot[]; contact?: { phone: string | null; contactEmail: string | null };
  version: number; publishedAt: string;
}
export interface DirectoryEntry {
  userId: string; displayName: string; photoUrl: string | null; headline: string; country: string | null;
  areas: TeachingArea[]; levels: IscedLevel[]; languages: ProfileLanguage[]; modalities: TeachingModality[]; verifiedCredentials: number;
}
export interface ProfileReviewItem {
  userId: string; name: string; photoUrl: string | null; version: number; submittedAt: string; firstPublication: boolean;
  changes: string[]; content: ProfessionalProfile; published: ProfessionalProfile | null; missing: string[];
}
export interface CredentialReviewItem { userId: string; name: string; credential: Credential }
export interface ProfileReviewQueue { reviewRequired: boolean; profiles: ProfileReviewItem[]; credentials: CredentialReviewItem[] }
/** ST-150: one document of a person's staff file. Withdrawn documents keep their metadata; only administration sees them. */
export type StaffDocumentKind = "dpi" | "cv" | "criminal-record" | "police-record" | "studies" | "certificate" | "other";
export interface StaffDocument {
  id: string; userId: string; type: StaffDocumentKind; title: string; issuedOn: string; expiresOn: string | null;
  status: "valid" | "expiring" | "expired"; mediaType: string; sizeBytes: number; uploadedAt: string; uploadedBy: string;
  selfUploaded: boolean; withdrawnAt: string | null;
}
export interface StaffFile { member: { id: string; name: string; active: boolean }; today: string; documents: StaffDocument[] }
/** Administration's overview: active people with expired documents or documents that expire within 30 days. */
export interface ExpiringDocuments { today: string; people: { id: string; name: string; documents: Pick<StaffDocument, "id" | "type" | "title" | "expiresOn" | "status">[] }[] }
/**
 * ST-124: e-mail notifications. Each person chooses which types they receive; administration marks the mandatory ones.
 * Every message is recorded in the outbox with its recipient, its reason (motivo) and its status.
 */
export type NotificationKind = "course_assignment" | "section_assignment" | "review_submitted" | "review_returned" | "review_approved" | "class_changed" | "class_cancelled";
export type NotificationDelivery = DeliveryStatus | "no_address";
export interface NotificationSetting { type: NotificationKind; label: string; description: string; audience: string; mandatory: boolean; enabled: boolean }
export interface NotificationRecord {
  id: string; type: NotificationKind; userId: string; personName: string; recipient: string | null; reason: string; targetId: string | null;
  status: NotificationDelivery; mandatory: boolean; attempts: number; error: string | null; createdAt: string; sentAt: string | null;
}
/**
 * ST-152 (DEC-043): effective hours teaching classes, as recognition of the volunteer work (not payroll). A completed
 * class counts from its start to its completion; `counted` counts, `no_start` (no real start recorded) and `review`
 * (more than 8 hours) count 0 until administration corrects them; `adjusted` carries a correction in force.
 */
export type HoursState = "counted" | "no_start" | "review" | "adjusted";
export interface HoursAdjustment { minutesBefore: number; minutesAfter: number; educatorBefore: string | null; educatorAfter: string; reason: string; adjustedBy: string; adjustedAt: string }
export interface HoursRow {
  sessionId: string; courseId: string; courseTitle: string; sectionId: string; sectionName: string; sessionDate: string;
  /** Calendar day of the start in the organization's time zone (the class day when there is no start). */
  day: string; startedAt: string | null; completedAt: string;
  educatorId: string | null; educatorName: string | null; computedMinutes: number; minutes: number; state: HoursState;
  adjustment: HoursAdjustment | null; adjustments: number;
}
export interface HoursTotal { id: string; name: string; minutes: number; classes: number }
export interface HoursFilter { from: string | null; to: string | null; course: string | null; section: string | null; person: string | null }
export interface HoursReport {
  filter: HoursFilter; timezone: string; scope: "all" | "own"; rows: HoursRow[]; minutes: number;
  totals: { people: HoursTotal[]; courses: HoursTotal[]; sections: HoursTotal[] };
  /** What the filters can choose from: the courses, sections and people of the classes the person may see. */
  options: { courses: { id: string; name: string }[]; sections: { id: string; name: string; courseId: string }[]; people: { id: string; name: string }[] };
}
export interface HoursAdjustmentInput { minutes: number; educatorId?: string; reason: string }
/**
 * ST-122: guided onboarding on the first sign-in. `password`, `legal`, `profile` and `agreement` (signed) are derived
 * from the real data; `welcome`, `tour` and leaving an optional agreement for later are declared by the person.
 */
export type OnboardingStep = "password" | "legal" | "welcome" | "profile" | "agreement" | "tour";
export interface OnboardingStepState { key: OnboardingStep; label: string; done: boolean; optional: boolean; skipped?: true }
export type OnboardingPersonStatus = "pending" | "in_progress" | "complete";
/** GET /api/onboarding: the signed-in person's own onboarding and what to show in each step. */
export interface OnboardingState {
  status: OnboardingPersonStatus; startedAt: string | null; completedAt: string | null; steps: OnboardingStepState[]; next: OnboardingStep | null;
  /** What is still missing for «perfil completo». */
  profileGaps: string[];
  /** The volunteer agreement in force to sign, when the step applies and is not done. */
  agreement: PendingDocument | null;
  courses: { id: string; title: string; role: CourseRole }[];
  sections: { id: string; name: string; courseId: string; courseTitle: string }[];
}
/** GET /api/onboarding/people: administration's view of each person's onboarding. */
export interface OnboardingPerson {
  userId: string; name: string; username: string; role: "admin" | "educator"; active: boolean;
  status: OnboardingPersonStatus; startedAt: string | null; completedAt: string | null; steps: OnboardingStepState[]; missing: OnboardingStep[];
}
