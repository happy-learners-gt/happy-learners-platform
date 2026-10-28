import { DurableObject } from "cloudflare:workers";
import migration from "../../../database/migrations/0001_sprint_one.sql";
import catalogMigration from "../../../database/migrations/0002_catalog.sql";
import rolesMigration from "../../../database/migrations/0003_roles.sql";
import curriculumMigration from "../../../database/migrations/0004_curriculum.sql";
import editingMigration from "../../../database/migrations/0005_editing.sql";
import greetingsMigration from "../../../database/migrations/0006_greetings_seed.sql";
import coursesMigration from "../../../database/migrations/0007_courses.sql";
import attendanceMigration from "../../../database/migrations/0008_classroom_attendance.sql";
import filesMigration from "../../../database/migrations/0009_course_files.sql";
import legacyE2eMigration from "../../../database/migrations/0010_remove_legacy_e2e_records.sql";
import mediaFilesMigration from "../../../database/migrations/0011_pdf_video_files.sql";
import curricularMigration from "../../../database/migrations/0012_curricular_framework.sql";
import academicMigration from "../../../database/migrations/0013_academic_model.sql";
import teamsMigration from "../../../database/migrations/0014_course_teams_activity.sql";
import demoMigration from "../../../database/migrations/0015_demo_organization.sql";
import assignmentsMigration from "../../../database/migrations/0016_lesson_assignments.sql";
import demoAssignmentMigration from "../../../database/migrations/0017_demo_class_assignment.sql";
import classPlanningMigration from "../../../database/migrations/0018_class_planning.sql";
import sectionScheduleMigration from "../../../database/migrations/0019_section_schedule.sql";
import classLessonsMigration from "../../../database/migrations/0020_class_lessons.sql";
import rolesReviewsMigration from "../../../database/migrations/0021_roles_and_reviews.sql";
import sectionInstancesMigration from "../../../database/migrations/0022_section_instances.sql";
import classCalendarMigration from "../../../database/migrations/0023_class_calendar.sql";
import selfPacedMigration from "../../../database/migrations/0024_self_paced.sql";
import workGroupsMigration from "../../../database/migrations/0025_work_groups.sql";
import prerequisitesMigration from "../../../database/migrations/0026_course_prerequisites.sql";
import organizationsMigration from "../../../database/migrations/0027_organization_accounts.sql";
import routesMigration from "../../../database/migrations/0028_program_routes.sql";
import lessonTimeMigration from "../../../database/migrations/0029_lesson_time_and_conflicts.sql";
import englishMigration from "../../../database/migrations/0030_english_program.sql";
import teamAccountsMigration from "../../../database/migrations/0031_team_accounts.sql";
import legalMigration from "../../../database/migrations/0032_terms_and_privacy.sql";
import calendarFeedsMigration from "../../../database/migrations/0033_calendar_feeds.sql";
import invitationsMigration from "../../../database/migrations/0034_invitations.sql";
import departuresMigration from "../../../database/migrations/0035_departures.sql";
import accessMatrixMigration from "../../../database/migrations/0036_access_matrix.sql";
import profileMigration from "../../../database/migrations/0037_profile_and_staff_file.sql";
import signaturesMigration from "../../../database/migrations/0038_signatures_and_agreement.sql";
import notificationsMigration from "../../../database/migrations/0039_notifications.sql";
import effectiveHoursMigration from "../../../database/migrations/0040_effective_hours.sql";
import onboardingMigration from "../../../database/migrations/0041_onboarding.sql";
import professionalProfileMigration from "../../../database/migrations/0042_professional_profile.sql";
import accountSettingsMigration from "../../../database/migrations/0043_account_settings.sql";
import preferencesMigration from "../../../database/migrations/0044_preferences.sql";
import contractsMigration from "../../../database/migrations/0045_contracts.sql";
import lifecycleMigration from "../../../database/migrations/0046_demo_educator_lifecycle.sql";
import demoAvailabilityMigration from "../../../database/migrations/0047_demo_availability.sql";
import academicYearsMigration from "../../../database/migrations/0048_academic_years.sql";
import gradebookMigration from "../../../database/migrations/0049_gradebook.sql";
import bibliographyMigration from "../../../database/migrations/0050_course_bibliography.sql";
import packagesMigration from "../../../database/migrations/0051_curriculum_packages.sql";
import proposalsMigration from "../../../database/migrations/0052_lesson_proposals.sql";
import bookMapMigration from "../../../database/migrations/0053_book_map.sql";
import demoPilotMigration from "../../../database/migrations/0054_demo_pilot.sql";
import assessmentPlansMigration from "../../../database/migrations/0055_assessment_plans.sql";
import demoGradebookMigration from "../../../database/migrations/0056_demo_gradebook.sql";
import { organizationIds } from "@happy-learners/domain";
import { exportStore, importStore, RestoreError, type Backup } from "./backup";
import { processProposals } from "./proposals";
import { processBookMaps } from "./book-map";

type Statement = { sql: string; values: (string | number | null)[] };
/**
 * Durable Object SQLite rejects a single SQL string beyond its length limit. Large migrations (the demo seed)
 * keep one statement per line and run in chunks of whole lines, inside the caller's transaction.
 */
const CHUNK = 60_000;
function runScript(sql: SqlStorage, script: string) {
  if (script.length <= CHUNK) { sql.exec(script); return; }
  let chunk = "";
  for (const line of script.split("\n")) {
    if (chunk.length + line.length + 1 > CHUNK && chunk) { sql.exec(chunk); chunk = ""; }
    chunk += line + "\n";
  }
  if (chunk.trim()) sql.exec(chunk);
}
// One SQLite object per organization; only the Worker holds this binding.
export class OrganizationStore extends DurableObject<Env> {
  async exportData(scope: string) {
    await this.query(scope, []);
    return exportStore(this.ctx.storage.sql, scope);
  }
  async importData(scope: string, backup: Backup) {
    await this.query(scope, []);
    try { return { restored: this.ctx.storage.transactionSync(() => importStore(this.ctx.storage.sql, scope, backup)) }; }
    catch (error) { if (error instanceof RestoreError) return { error: error.message }; throw error; }
  }
  async authorizeCollaborator(organizationId: string, courseId: string, lessonId: string, userId: string, tokenHash: string): Promise<boolean> {
    if (!/^[a-z0-9-]{1,80}$/.test(organizationId) || !/^[a-z0-9-]{1,100}$/.test(courseId) || !/^[a-z0-9-]{1,100}$/.test(lessonId) || !/^[a-z0-9-]{1,100}$/.test(userId) || !/^[a-f0-9]{64}$/.test(tokenHash)) return false;
    const result = await this.query(organizationId, [{ sql: `SELECT s.user_id FROM sessions s
      JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=? AND m.active=1
      JOIN courses c ON c.organization_id=m.organization_id AND c.id=? AND c.status='active'
      JOIN lessons l ON l.id=? AND l.program_id=c.legacy_program_id AND l.archived=0
      JOIN course_members cm ON cm.course_id=c.id AND cm.organization_id=c.organization_id AND cm.user_id=s.user_id
      WHERE s.token_hash=? AND s.user_id=? AND s.expires_at>?` , values: [organizationId, courseId, lessonId, tokenHash, userId, Date.now()] }]);
    return result[0].length === 1;
  }

  /** Wakes the organization's background work (lesson proposals) as soon as possible; an earlier alarm is kept. */
  async schedule(scope: string) {
    await this.query(scope, []);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > Date.now()) await this.ctx.storage.setAlarm(Date.now());
  }
  /**
   * Background work runs here, never inside a request: each wake processes one small batch of lesson proposals and
   * schedules the next while work remains. Alarms are retried by the platform if this throws.
   */
  async alarm() {
    const scope = this.ctx.storage.sql.exec<{ organization_id: string }>("SELECT organization_id FROM schema_migrations LIMIT 1").toArray()[0]?.organization_id;
    if (!scope) return;
    const db = new Database(this, scope);
    const proposals = await processProposals(db, this.env, scope), maps = await processBookMaps(db, this.env, scope);
    const more = proposals || maps;
    if (more) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async query(scope: string, statements: Statement[], guard?: Statement): Promise<Record<string, SqlStorageValue>[][]> {
    if (!organizationIds.includes(scope)) throw new Error("Invalid organization");
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, organization_id TEXT NOT NULL)");
      const applied = this.ctx.storage.sql.exec<{ version: number; organization_id: string }>("SELECT version, organization_id FROM schema_migrations ORDER BY version DESC LIMIT 1").toArray();
      if (!applied.length) {
        this.ctx.storage.sql.exec(migration);
        this.ctx.storage.sql.exec("DELETE FROM lessons WHERE program_id IN (SELECT id FROM programs WHERE organization_id<>?)", scope);
        this.ctx.storage.sql.exec("DELETE FROM programs WHERE organization_id<>?", scope);
        this.ctx.storage.sql.exec("DELETE FROM memberships WHERE organization_id<>?", scope);
        this.ctx.storage.sql.exec("DELETE FROM users WHERE id NOT IN (SELECT user_id FROM memberships)");
        this.ctx.storage.sql.exec("DELETE FROM organizations WHERE id<>?", scope);
        // Organizations added after the first migration start empty; later migrations name them and add their accounts.
        this.ctx.storage.sql.exec("INSERT OR IGNORE INTO organizations(id,name,configured) VALUES (?,NULL,0)", scope);
        this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (1,?)", scope);
        this.ctx.storage.sql.exec(catalogMigration);
        this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (2,?)", scope);
      } else if (applied[0].organization_id !== scope) throw new Error("Organization mismatch");
      if (applied.length && applied[0].version < 2) { this.ctx.storage.sql.exec(catalogMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (2,?)", scope); }
      if (!applied.length || applied[0].version < 3) { this.ctx.storage.sql.exec(rolesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (3,?)", scope); }
      if (!applied.length || applied[0].version < 4) { this.ctx.storage.sql.exec(curriculumMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (4,?)", scope); }
      if (!applied.length || applied[0].version < 5) { this.ctx.storage.sql.exec(editingMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (5,?)", scope); }
      if (!applied.length || applied[0].version < 6) { this.ctx.storage.sql.exec(greetingsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (6,?)", scope); }
      if (!applied.length || applied[0].version < 7) { this.ctx.storage.sql.exec(coursesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (7,?)", scope); }
      if (!applied.length || applied[0].version < 8) { this.ctx.storage.sql.exec(attendanceMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (8,?)", scope); }
      if (!applied.length || applied[0].version < 9) { this.ctx.storage.sql.exec(filesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (9,?)", scope); }
      if (!applied.length || applied[0].version < 10) { this.ctx.storage.sql.exec(legacyE2eMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (10,?)", scope); }
      if (!applied.length || applied[0].version < 11) { this.ctx.storage.sql.exec(mediaFilesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (11,?)", scope); }
      if (!applied.length || applied[0].version < 12) { this.ctx.storage.sql.exec(curricularMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (12,?)", scope); }
      if (!applied.length || applied[0].version < 13) { this.ctx.storage.sql.exec(academicMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (13,?)", scope); }
      if (!applied.length || applied[0].version < 14) { this.ctx.storage.sql.exec(teamsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (14,?)", scope); }
      if (!applied.length || applied[0].version < 15) { runScript(this.ctx.storage.sql, demoMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (15,?)", scope); }
      if (!applied.length || applied[0].version < 16) { this.ctx.storage.sql.exec(assignmentsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (16,?)", scope); }
      if (!applied.length || applied[0].version < 17) { this.ctx.storage.sql.exec(demoAssignmentMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (17,?)", scope); }
      if (!applied.length || applied[0].version < 18) { this.ctx.storage.sql.exec(classPlanningMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (18,?)", scope); }
      if (!applied.length || applied[0].version < 19) { this.ctx.storage.sql.exec(sectionScheduleMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (19,?)", scope); }
      if (!applied.length || applied[0].version < 20) { this.ctx.storage.sql.exec(classLessonsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (20,?)", scope); }
      if (!applied.length || applied[0].version < 21) { this.ctx.storage.sql.exec(rolesReviewsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (21,?)", scope); }
      if (!applied.length || applied[0].version < 22) { this.ctx.storage.sql.exec(sectionInstancesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (22,?)", scope); }
      if (!applied.length || applied[0].version < 23) { this.ctx.storage.sql.exec(classCalendarMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (23,?)", scope); }
      if (!applied.length || applied[0].version < 24) { this.ctx.storage.sql.exec(selfPacedMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (24,?)", scope); }
      if (!applied.length || applied[0].version < 25) { this.ctx.storage.sql.exec(workGroupsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (25,?)", scope); }
      if (!applied.length || applied[0].version < 26) { this.ctx.storage.sql.exec(prerequisitesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (26,?)", scope); }
      if (!applied.length || applied[0].version < 27) { this.ctx.storage.sql.exec(organizationsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (27,?)", scope); }
      if (!applied.length || applied[0].version < 28) { runScript(this.ctx.storage.sql, routesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (28,?)", scope); }
      if (!applied.length || applied[0].version < 29) { this.ctx.storage.sql.exec(lessonTimeMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (29,?)", scope); }
      if (!applied.length || applied[0].version < 30) { runScript(this.ctx.storage.sql, englishMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (30,?)", scope); }
      if (!applied.length || applied[0].version < 31) { this.ctx.storage.sql.exec(teamAccountsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (31,?)", scope); }
      if (!applied.length || applied[0].version < 32) { this.ctx.storage.sql.exec(legalMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (32,?)", scope); }
      if (!applied.length || applied[0].version < 33) { this.ctx.storage.sql.exec(calendarFeedsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (33,?)", scope); }
      if (!applied.length || applied[0].version < 34) { this.ctx.storage.sql.exec(invitationsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (34,?)", scope); }
      if (!applied.length || applied[0].version < 35) { this.ctx.storage.sql.exec(departuresMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (35,?)", scope); }
      if (!applied.length || applied[0].version < 36) { this.ctx.storage.sql.exec(accessMatrixMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (36,?)", scope); }
      if (!applied.length || applied[0].version < 37) { this.ctx.storage.sql.exec(profileMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (37,?)", scope); }
      if (!applied.length || applied[0].version < 38) { this.ctx.storage.sql.exec(signaturesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (38,?)", scope); }
      if (!applied.length || applied[0].version < 39) { this.ctx.storage.sql.exec(notificationsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (39,?)", scope); }
      if (!applied.length || applied[0].version < 40) { this.ctx.storage.sql.exec(effectiveHoursMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (40,?)", scope); }
      if (!applied.length || applied[0].version < 41) { this.ctx.storage.sql.exec(onboardingMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (41,?)", scope); }
      if (!applied.length || applied[0].version < 42) { this.ctx.storage.sql.exec(professionalProfileMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (42,?)", scope); }
      if (!applied.length || applied[0].version < 43) { this.ctx.storage.sql.exec(accountSettingsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (43,?)", scope); }
      if (!applied.length || applied[0].version < 44) { this.ctx.storage.sql.exec(preferencesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (44,?)", scope); }
      if (!applied.length || applied[0].version < 45) { this.ctx.storage.sql.exec(contractsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (45,?)", scope); }
      if (!applied.length || applied[0].version < 46) { runScript(this.ctx.storage.sql, lifecycleMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (46,?)", scope); }
      if (!applied.length || applied[0].version < 47) { this.ctx.storage.sql.exec(demoAvailabilityMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (47,?)", scope); }
      if (!applied.length || applied[0].version < 48) { this.ctx.storage.sql.exec(academicYearsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (48,?)", scope); }
      if (!applied.length || applied[0].version < 49) { this.ctx.storage.sql.exec(gradebookMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (49,?)", scope); }
      if (!applied.length || applied[0].version < 50) { this.ctx.storage.sql.exec(bibliographyMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (50,?)", scope); }
      if (!applied.length || applied[0].version < 51) { this.ctx.storage.sql.exec(packagesMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (51,?)", scope); }
      if (!applied.length || applied[0].version < 52) { this.ctx.storage.sql.exec(proposalsMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (52,?)", scope); }
      if (!applied.length || applied[0].version < 53) { this.ctx.storage.sql.exec(bookMapMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (53,?)", scope); }
      if (!applied.length || applied[0].version < 54) { runScript(this.ctx.storage.sql, demoPilotMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (54,?)", scope); }
      if (!applied.length || applied[0].version < 55) { this.ctx.storage.sql.exec(assessmentPlansMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (55,?)", scope); }
      if (!applied.length || applied[0].version < 56) { runScript(this.ctx.storage.sql, demoGradebookMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (56,?)", scope); }
      // Compare-and-write plus dependent writes belong to one SQLite transaction.
      if (guard && !this.ctx.storage.sql.exec(guard.sql, ...guard.values).toArray().length) return [];
      return statements.map(statement => this.ctx.storage.sql.exec(statement.sql, ...statement.values).toArray());
    });
  }
}
export class Prepared {
  values: (string | number | null)[] = [];
  constructor(public db: Database, public sql: string) {}
  bind(...values: (string | number | null)[]) { this.values = values; return this; }
  async all<T>() { return { results: (await this.db.execute([this]))[0] as T[] }; }
  async first<T>() { return (await this.all<T>()).results[0] || null; }
  async run() { await this.db.execute([this]); }
}
/** What a Database runs on: the organization's Durable Object, through its stub or, inside it (alarms), itself. */
type Store = Pick<OrganizationStore, "query" | "exportData" | "importData">;
export class Database {
  constructor(private stub: DurableObjectStub<OrganizationStore> | Store, private scope: string) {}
  prepare(sql: string) { return new Prepared(this, sql); }
  execute(statements: Prepared[]) { return this.stub.query(this.scope, statements.map(({ sql, values }) => ({ sql, values }))); }
  batch(statements: Prepared[]) { return this.execute(statements); }
  exportData() { return this.stub.exportData(this.scope); }
  importData(backup: Backup) { return this.stub.importData(this.scope, backup); }
  async guardedBatch(guard: Prepared, statements: Prepared[]) {
    const results = await this.stub.query(this.scope, statements.map(({ sql, values }) => ({ sql, values })), { sql: guard.sql, values: guard.values });
    return results.length > 0;
  }
}
export function database(env: Env, scope: string) { return new Database(env.ORGANIZATIONS.getByName(scope), scope); }
