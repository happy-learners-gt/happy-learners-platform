import type { Activity, Lesson, Member, Organization, Resource } from "@happy-learners/contracts";
import { hasText, organizationIds, organizationInput, richTextFieldsOf, scopeOfSection, scopeOfShare, scopeOfToken, sessionTouchMs, tokenPrefix } from "@happy-learners/domain";
import { sha } from "./generated/version";
import { database } from "./storage";
import type { Database } from "./storage";
export { OrganizationStore } from "./storage";
import { cookie, digest, newToken, sessionToken, verifyPassword } from "./auth";
import { roles } from "./roles";
import { changePassword } from "./accounts";
import { digests, type Backup } from "./backup";
import { content, reviews, shared } from "./content";
import { courses, programs, taxonomy } from "./courses";
import { assessmentMethods, courseAssessment } from "./assessment";
import { duplicateCourse } from "./duplicate";
import { accessTo } from "./access";
import { activity, people, progress } from "./team";
import { legal, pendingFor, publicPrivacy } from "./legal";
import { classroom } from "./attendance";
import { calendar, myClasses, student, studentToken } from "./classes";
import { sections } from "./sections";
import { sectionFreedom } from "./section-freedom";
import { courseFiles, sharedFile } from "./files";
import { feed, feedLink, feedPath } from "./calendar-feed";
import { acceptInvitation, acceptPath, invitations, previewInvitation } from "./invitations";
import { mailSender } from "./mail";
import { staff, staffMethods } from "./profiles";
import { LessonCollaborationRoom } from "./collaboration";
import { encodeLessonDraft } from "./rich-text";
import { accessMatrix, permissionColumns, withPermissions } from "./permissions";
import { notificationMethods, notifications } from "./notifications";
import { deliverScheduled } from "./notify";
import { me, meMethods, preferencesFor } from "./preferences";
import { hours } from "./hours";
import { onboarding, onboardingPending } from "./onboarding";
import { professional, professionalMethods } from "./professional";
import { contractMethods, contracts } from "./contracts";
import { academicYearMethods, academicYearsApi } from "./academic-years";
import { bellScheduleMethods, bellSchedulesApi } from "./bell-schedules";
import { documentPreview, gradebookMethods, grades } from "./gradebook";
import { groupSetMethods, groupSets } from "./group-sets";
import { bibliography, bibliographyMethods } from "./bibliography";
import { resourceMethods, resources } from "./resources";
import { curriculumPackagesApi, packageMethods } from "./curriculum-packages";
import { bookTextPath, proposalMethods, proposals } from "./proposals";
import { delivery, deliveryMethods } from "./delivery";
import { bookMap, bookMapMethods } from "./book-map";
import { aiUsage, aiUsageMethods } from "./ai-usage";
import { aiAssist, aiAssistMethods } from "./ai-assist";
import { timetableMethods, timetables } from "./timetables";
import { reportMethods, reports } from "./reports";
import { panelMinuteMethods, panelMinutes } from "./panel-minutes";
import { account, accountBody, accountMethods, clientOf, confirmEmail, emailConfirmPath, failedSignIn, openSession } from "./account";
import { institutionalCalendarMethods, institutionalCalendars } from "./institutional-calendar";
import { agenda, agendaMethods } from "./agenda";
import { gradingSchemeMethods, gradingSchemesApi } from "./grading-schemes";
export { LessonCollaborationRoom };

const headers = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: ws:; frame-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("INPUT");
  const pathname = new URL(request.url).pathname;
  // Lessons carry rich text for every block; other bodies stay small.
  const limit = pathname === "/api/login" || pathname === "/api/account/password" || acceptPath.test(pathname) ? 2048 : pathname === "/api/organization/restore" ? 33554432 : /^\/api\/contract-templates(\/|$)/.test(pathname) ? 524288 : bookTextPath.test(pathname) ? 8388608 : /^\/api\/(lessons|legal)(\/|$)/.test(pathname) ? 262144 : 65536;
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INPUT");
  let text = ""; const decoder = new TextDecoder(); let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > limit) { await reader.cancel(); throw new Error("INPUT"); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  try { return JSON.parse(text + decoder.decode()); } catch { throw new Error("INPUT"); }
}
async function member(request: Request, db: Database): Promise<Member | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const tokenHash = await digest(token), now = Date.now();
  const row = await db.prepare(`SELECT s.id AS sessionId, s.last_used_at AS lastUsed, u.id, u.username, COALESCE(u.display_name,u.username) AS displayName, CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role, m.organization_id AS organizationId, u.must_change_password AS mustChange, ${permissionColumns} FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND m.active=1`)
    .bind(tokenHash, now).first<Member & { mustChange: number; sessionId: string; lastUsed: number }>();
  if (!row) return null;
  // ST-158: the session's last use, written at most once a minute so it costs nothing on most requests.
  if (now - row.lastUsed >= sessionTouchMs) await db.prepare("UPDATE sessions SET last_used_at=? WHERE token_hash=? AND last_used_at<?").bind(now, tokenHash, now).run();
  // ST-128, ST-135: effective permissions are computed on every request, from the same query.
  const { mustChange, sessionId: _, lastUsed: __, ...current } = row;
  return withPermissions(mustChange ? { ...current, mustChangePassword: true } : current);
}
/** Whether a username exists in any organization, active or not: it decides where its owner signs in (ST-093). */
async function usernameTaken(env: Env, username: string) {
  const found = await Promise.all(organizationIds.map(id => database(env, id).prepare("SELECT 1 AS found FROM users WHERE username=?").bind(username).first()));
  return found.some(Boolean);
}
/** The organization a username belongs to: each store is asked once; an unknown name stays with the default one. */
async function organizationOf(env: Env, username: string) {
  const found = await Promise.all(organizationIds.map(id => database(env, id).prepare("SELECT 1 AS found FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.username=? AND m.active=1").bind(username).first()));
  return organizationIds[found.findIndex(Boolean)] || organizationIds[0];
}
async function route(request: Request, env: Env, ctx?: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  if (!path.startsWith("/api/")) {
    const asset = await env.ASSETS.fetch(request); const result = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(headers)) result.headers.set(name, value);
    return result;
  }
  // ST-154 to ST-157: the professional profile reads an optional JSON body (sending, hiding and approving carry none).
  const professionalAllowed = professionalMethods(path);
  // DEC-046: contract templates and contracts read a JSON body.
  const contractAllowed = contractMethods(path);
  // The organization's school year and its periods read a JSON body; activating, closing and opening the next carry none.
  const academicYearAllowed = academicYearMethods(path);
  // The organization's bell schedules (jornadas); creating and editing read a JSON body.
  const bellAllowed = bellScheduleMethods(path);
  // The section's gradebook: saving scores and the plan read a JSON body, and so does returning a period; the rest carry none.
  const gradebookAllowed = gradebookMethods(path);
  const groupSetAllowed = groupSetMethods(path);
  // The course's bibliography; its POST and PUT bodies are read with the other course routes.
  const bibliographyAllowed = bibliographyMethods(path);
  const resourceAllowed = resourceMethods(path);
  // Curriculum packages; picking indicators reads its body with the other course routes.
  const packageAllowed = packageMethods(path);
  // Lesson proposals (rebanada 5a); their bodies are read with the other course routes.
  const proposalAllowed = proposalMethods(path);
  const deliveryAllowed = deliveryMethods(path);
  const bookMapAllowed = bookMapMethods(path);
  const aiUsageAllowed = aiUsageMethods(path);
  const aiAssistAllowed = aiAssistMethods(path);
  const timetableAllowed = timetableMethods(path);
  const reportAllowed = reportMethods(path);
  const minuteAllowed = panelMinuteMethods(path);
  const institutionalCalendarAllowed = institutionalCalendarMethods(path);
  const agendaAllowed = agendaMethods(path);
  const gradingSchemeAllowed = gradingSchemeMethods(path);
  const assessmentAllowed = assessmentMethods(path);
  let input = (["POST", "PUT"].includes(method) && /^\/api\/(login|account|organization|calendar|members|access|levels|units|resources|lessons|courses|programs|vocabularies|terms|student|legal|hours|ai|timetables|report-templates|panel-minutes)(\/[a-z0-9-]+){0,5}$/.test(path) && !/\/(publish|duplicate|start|complete|cancel|restore|code|logout|retry)$/.test(path) && !path.includes("/files") && !/^\/api\/members\/[a-z0-9-]+\/password$/.test(path) && !professionalAllowed)
    || (method === "POST" && path === "/api/organization/restore" && env.RESTORE_ENABLED === "true")
    || (method === "POST" && (path === "/api/invitations" || acceptPath.test(path)))
    ? await body(request) : undefined;
  if (/^\/api\/sections\/[a-z0-9-]+\/(lessons|activities|content-overrides|units|copies|proposals|reviews)$/.test(path) && ["POST", "PUT", "DELETE"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  // Finishing or cancelling a class may say what was covered or what happens to its plan; without a body, the defaults apply.
  if (method === "POST" && /^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/(complete|cancel)$/.test(path) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  // ST-124: notification preferences and policy.
  if (method === "PUT" && notificationMethods(path)) input = await body(request);
  if (professionalAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  if (contractAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  if (bellAllowed && ["POST", "PUT"].includes(method)) input = await body(request);
  if (academicYearAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  if (institutionalCalendarAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  if (gradingSchemeAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  if (gradebookAllowed && (method === "PUT" || (method === "POST" && request.headers.get("content-type")?.startsWith("application/json")))) input = await body(request);
  if (groupSetAllowed && ["POST", "PUT"].includes(method) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  // DEC-046: publishing a legal document may carry the date from which the version applies.
  if (method === "POST" && /^\/api\/legal\/documents\/[a-z]+\/publish$/.test(path) && request.headers.get("content-type")?.startsWith("application/json")) input = await body(request);
  // ST-158, ST-159: a change of e-mail and a closure request.
  if (accountBody(path, method)) input = await body(request);
  // ST-160, ST-161: the person's own preferences and the bell; marking every notice as read needs no body.
  if (["PUT", "POST"].includes(method) && meMethods(path) && (method === "PUT" || request.headers.get("content-type")?.startsWith("application/json"))) input = await body(request);
  let scope: string = scopeOfToken(sessionToken(request));
  if (path.startsWith("/api/share/")) scope = scopeOfShare(path.split("/")[3]);
  const feedToken = feedPath.exec(path)?.[1];
  if (feedToken) scope = scopeOfToken(feedToken);
  // ST-121: an invitation link names its organization like a session token does.
  const invitationToken = acceptPath.exec(path)?.[1];
  if (invitationToken) scope = scopeOfToken(invitationToken);
  // ST-158: so does the link that confirms a new sign-in e-mail.
  const emailToken = emailConfirmPath.exec(path)?.[1];
  if (emailToken) scope = scopeOfToken(emailToken);
  if (path.startsWith("/api/student/")) scope = path === "/api/student/login" ? scopeOfSection(String((input as Record<string, unknown> | null)?.code || "").trim().toUpperCase()) : scopeOfToken(studentToken(request));
  if (path === "/api/login" && method === "POST") {
    const credentials = input as Record<string, unknown> | null;
    if (typeof credentials?.username === "string" && credentials.username.length <= 64) scope = await organizationOf(env, credentials.username.trim().toLowerCase());
  }
  const db = database(env, scope);
  if (["/api/health", "/api/version"].includes(path)) {
    if (!["GET", "HEAD"].includes(method)) return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD" });
    if (path === "/api/health") await db.prepare("SELECT id FROM organizations LIMIT 1").first();
    return method === "HEAD" ? new Response(null, { headers }) : json(path === "/api/health" ? { status: "ok" } : { sha });
  }
  // Retired in 1.0 (ST-076): no screen uses them; their data stays readable through courses and the library.
  if (/^\/api\/(curriculum|levels|units)(\/[a-z0-9-]+)?$/.test(path) || /^\/api\/resources\/[a-z0-9-]+$/.test(path) || (path === "/api/resources" && !["GET", "HEAD"].includes(method)))
    return json({ error: "Esta ruta se retiró en la versión 1.0." }, 410);
  const methods: Record<string, string[]> = { "/api/session": ["GET"], "/api/login": ["POST"], "/api/logout": ["POST"], "/api/account/password": ["POST"], "/api/organization": ["GET", "PUT"], "/api/organization/backup": ["GET"], "/api/resources": ["GET"], "/api/lessons": ["GET", "POST"] };
  // Restoring replaces an organization's data, so only environments that rehearse it (preview, local tests) offer it.
  if (env.RESTORE_ENABLED === "true") methods["/api/organization/restore"] = ["POST"];
  if (/^\/api\/courses$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(units|materials)$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(units|materials|competencies|outcomes)\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(competencies|outcomes)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/units\/[a-z0-9-]+\/outcomes$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/team$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/duplicate$/.test(path)) methods[path] = ["POST"];
  if (path === "/api/activity" || path === "/api/progress" || path === "/api/people" || path === "/api/reviews") methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files\/[a-z0-9-]+\/content$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/files\/[a-z0-9-]+\/archive$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/lessons\/[a-z0-9-]+\/collaborate$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/(groups|sessions)$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/schedule$/.test(path)) methods[path] = ["PUT", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/lessons$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/educators$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/work-groups$/.test(path)) methods[path] = ["GET", "POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/work-groups\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/activity-groups$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/learners$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/learners\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (path === "/api/sections" || /^\/api\/sections\/[a-z0-9-]+(\/progress)?$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/sections\/[a-z0-9-]+\/plan$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/sections\/[a-z0-9-]+\/(lessons|activities|units|copies|proposals|reviews)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/sections\/[a-z0-9-]+\/content-overrides$/.test(path)) methods[path] = ["PUT", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/core$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sections\/differences$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/section-proposals$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/courses\/[a-z0-9-]+\/section-proposals\/[a-z0-9-]+$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/groups\/[a-z0-9-]+\/code$/.test(path)) methods[path] = ["POST", "DELETE"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/(start|complete|cancel|restore)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/attendance$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/courses\/[a-z0-9-]+\/sessions\/[a-z0-9-]+\/outcomes$/.test(path)) methods[path] = ["PUT"];
  if (path === "/api/calendar") methods[path] = ["GET", "POST"];
  if (/^\/api\/calendar\/[a-z0-9-]+$/.test(path)) methods[path] = ["DELETE"];
  if (path === "/api/classes" || path === "/api/student/space" || path === "/api/student/readings" || /^\/api\/student\/files\/[a-z0-9-]+$/.test(path) || /^\/api\/student\/educators\/[a-z0-9-]+\/photo$/.test(path)) methods[path] = ["GET"];
  if (/^\/api\/student\/readings\/reading-[a-z0-9-]+\/mark$/.test(path)) methods[path] = ["POST"];
  if (["/api/student/login", "/api/student/logout", "/api/student/identity", "/api/student/progress"].includes(path)) methods[path] = ["POST"];
  if (path === "/api/taxonomy") methods[path] = ["GET"];
  // ST-125: the calendar link (signed in) and the feed calendars fetch without a session; GET only.
  if (path === "/api/feeds/calendar") methods[path] = ["GET", "POST"];
  if (feedToken) methods[path] = ["GET"];
  if (path === "/api/invitations") methods[path] = ["GET", "POST"];
  // ST-128, ST-135: roles and access.
  if (path === "/api/access/matrix") methods[path] = ["GET"];
  if (path === "/api/access/groups") methods[path] = ["GET", "POST"];
  if (/^\/api\/access\/groups\/security-group-[a-z0-9-]+$/.test(path)) methods[path] = ["PUT", "DELETE"];
  if (/^\/api\/access\/groups\/security-group-[a-z0-9-]+\/(permissions|members)$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/members\/[a-z0-9-]+\/coordination$/.test(path)) methods[path] = ["PUT"];
  if (/^\/api\/invitations\/invitation-[a-z0-9-]+\/(resend|revoke)$/.test(path)) methods[path] = ["POST"];
  if (invitationToken) methods[path] = ["GET", "POST"];
  if (path === "/api/programs") methods[path] = ["GET", "POST"];
  if (/^\/api\/programs\/[a-z0-9-]+$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/programs\/[a-z0-9-]+\/prerequisites$/.test(path)) methods[path] = ["GET", "PUT"];
  if (/^\/api\/(vocabularies|terms)$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/(vocabularies|terms)\/[a-z0-9-]+$/.test(path)) methods[path] = ["PUT"];
  // ST-126, ST-127: terms and privacy; the privacy policy in force is also public.
  if (["/api/legal", "/api/legal/documents", "/api/legal/acceptances", "/api/public/privacy"].includes(path)) methods[path] = ["GET"];
  if (["/api/legal/accept", "/api/legal/withdraw"].includes(path) || /^\/api\/legal\/documents\/[a-z]+\/publish$/.test(path)) methods[path] = ["POST"];
  if (/^\/api\/legal\/documents\/[a-z]+$/.test(path)) methods[path] = ["PUT"];
  // ST-153: signatures, their receipts and administration's verification.
  if (path === "/api/legal/signatures" || /^\/api\/legal\/signatures\/signature-[a-z0-9-]+\/receipt$/.test(path)) methods[path] = ["GET"];
  if (path === "/api/legal/signatures/verify") methods[path] = ["POST"];
  // ST-152: effective hours, their export and administration's corrections.
  if (path === "/api/hours" || path === "/api/hours/export") methods[path] = ["GET"];
  if (/^\/api\/hours\/[a-z0-9-]+\/adjustment$/.test(path)) methods[path] = ["POST"];
  // ST-122: guided onboarding.
  if (path === "/api/onboarding" || path === "/api/onboarding/people") methods[path] = ["GET"];
  if (/^\/api\/onboarding\/steps\/[a-z]+$/.test(path)) methods[path] = ["POST"];
  // ST-149, ST-150: profile, photo and staff file.
  const staffAllowed = staffMethods(path);
  if (staffAllowed) methods[path] = staffAllowed;
  const notificationAllowed = notificationMethods(path);
  if (notificationAllowed) methods[path] = notificationAllowed;
  if (professionalAllowed) methods[path] = professionalAllowed;
  if (contractAllowed) methods[path] = contractAllowed;
  if (academicYearAllowed) methods[path] = academicYearAllowed;
  if (bellAllowed) methods[path] = bellAllowed;
  if (gradebookAllowed) methods[path] = gradebookAllowed;
  if (groupSetAllowed) methods[path] = groupSetAllowed;
  if (gradingSchemeAllowed) methods[path] = gradingSchemeAllowed;
  if (assessmentAllowed) methods[path] = assessmentAllowed;
  if (bibliographyAllowed) methods[path] = bibliographyAllowed;
  if (resourceAllowed) methods[path] = resourceAllowed;
  if (packageAllowed) methods[path] = packageAllowed;
  if (proposalAllowed) methods[path] = proposalAllowed;
  if (deliveryAllowed) methods[path] = deliveryAllowed;
  if (bookMapAllowed) methods[path] = bookMapAllowed;
  if (aiUsageAllowed) methods[path] = aiUsageAllowed;
  if (aiAssistAllowed) methods[path] = aiAssistAllowed;
  if (timetableAllowed) methods[path] = timetableAllowed;
  if (reportAllowed) methods[path] = reportAllowed;
  if (minuteAllowed) methods[path] = minuteAllowed;
  if (institutionalCalendarAllowed) methods[path] = institutionalCalendarAllowed;
  if (agendaAllowed) methods[path] = agendaAllowed;
  // ST-158, ST-159: account settings, my data and closing the account.
  const accountAllowed = accountMethods(path);
  if (accountAllowed) methods[path] = accountAllowed;
  const meAllowed = meMethods(path);
  if (meAllowed) methods[path] = meAllowed;
  const allowed = methods[path] || (path === "/api/members" ? ["GET", "POST"] : /^\/api\/members\/[a-z0-9-]+$/.test(path) ? ["PUT"] : /^\/api\/members\/[a-z0-9-]+\/password$/.test(path) ? ["POST"] : /^\/api\/members\/[a-z0-9-]+\/departure$/.test(path) ? ["GET", "POST"] : /^\/api\/lessons\/[a-z0-9-]+$/.test(path) ? ["GET", "PUT", "DELETE"] : /^\/api\/lessons\/[a-z0-9-]+\/(publish|duplicate|review|review\/return)$/.test(path) ? ["POST"] : /^\/api\/share\/[A-Z0-9-]+$/.test(path) ? ["GET"] : /^\/api\/share\/[A-Z0-9-]+\/complete$/.test(path) ? ["POST"] : /^\/api\/share\/[A-Z0-9-]+\/files\/[a-z0-9-]+$/.test(path) ? ["GET"] : null);
  if (!allowed) return json({ error: "Not found" }, 404);
  if (!allowed.includes(method)) return json({ error: "Method not allowed" }, 405, { Allow: allowed.join(", ") });
  if (!["GET", "HEAD"].includes(method)) {
    if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ error: "Origen no permitido." }, 403);
  }
  if (path === "/api/login") {
    const value = input as Record<string, unknown>;
    if (!value || typeof value.username !== "string" || typeof value.password !== "string" || value.username.length > 64 || value.password.length > 128) return json({ error: "Introduce usuario y contraseña." }, 400);
    // Daily rotating short-lived hash; no raw IP addresses in application storage.
    const bucket = await digest(`${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`);
    const now = Date.now();
    const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
      .bind(bucket, now + 900000, now, now).first<{ attempts: number }>();
    if (!limit || limit.attempts > 30) return json({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    // Security audit 2026-11 (H2): failed attempts also count per account, so guesses spread over many addresses stop
    // too; signing in clears them. The bucket is a hash of the name, never the name itself.
    const account = await digest(`account:${value.username.trim().toLowerCase()}`);
    const failures = await db.prepare("SELECT attempts FROM login_limits WHERE bucket=? AND expires_at>=?").bind(account, now).first<{ attempts: number }>();
    if (failures && failures.attempts >= 10) return json({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    const user = await db.prepare("SELECT u.id, u.password_salt, u.password_hash FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.username=? AND m.active=1").bind(value.username.trim().toLowerCase()).first<{ id: string; password_salt: string; password_hash: string }>();
    const valid = await verifyPassword(value.password, user?.password_salt || "synthetic-dummy-salt", user?.password_hash || "0".repeat(64));
    // ST-158: each attempt on an existing account joins its owner's sign-in history, with a device summary and country.
    const client = clientOf(request);
    if (user && !valid) await failedSignIn(db, user.id, scope, client).run();
    if (!user || !valid) {
      await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END")
        .bind(account, now + 900000, now, now).run();
      return json({ error: "Usuario o contraseña incorrectos." }, 401);
    }
    const token = tokenPrefix(scope) + newToken();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
      db.prepare("DELETE FROM login_limits WHERE expires_at<=?").bind(now),
      db.prepare("DELETE FROM login_limits WHERE bucket=?").bind(account),
      ...openSession(db, await digest(token), user.id, scope, "password", client, now),
    ]);
    return json({ ok: true }, 200, { "Set-Cookie": cookie(token, request) });
  }
  if (path.startsWith("/api/share/")) {
    const shareParts = path.split("/");
    if (shareParts[4] === "files" && method === "GET") return sharedFile(shareParts[3], shareParts[5], scope, db, env.COURSE_FILES);
    return shared(path, method, request, db);
  }
  if (feedToken) return feed(feedToken, url, scope, db);
  if (invitationToken) {
    if (method === "GET") return previewInvitation(invitationToken, scope, db);
    // Choosing a username and password is limited like signing in, with its own bucket.
    const bucket = await digest(`invitation:${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`), now = Date.now();
    const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
      .bind(bucket, now + 900000, now, now).first<{ attempts: number }>();
    if (!limit || limit.attempts > 30) return json({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    const accepted = await acceptInvitation(invitationToken, input, scope, db, username => usernameTaken(env, username), clientOf(request));
    return accepted.session ? json(await accepted.response.json(), accepted.response.status, { "Set-Cookie": cookie(accepted.session, request) }) : accepted.response;
  }
  if (emailToken) {
    if (method === "POST") {
      // Confirming is limited like signing in, with its own bucket.
      const bucket = await digest(`email:${new Date().toISOString().slice(0, 10)}:${request.headers.get("CF-Connecting-IP") || "local"}`), now = Date.now();
      const limit = await db.prepare("INSERT INTO login_limits (bucket, attempts, expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING attempts")
        .bind(bucket, now + 900000, now, now).first<{ attempts: number }>();
      if (!limit || limit.attempts > 30) return json({ error: "Demasiados intentos. Espera 15 minutos y vuelve a intentar." }, 429, { "Retry-After": "900" });
    }
    return confirmEmail(emailToken, method, scope, db, mailSender(env));
  }
  if (path.startsWith("/api/student/")) return student(path, method, input, request, scope, db, env.COURSE_FILES);
  if (path === "/api/logout") {
    const token = sessionToken(request);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", request, true) });
  }
  if (path === "/api/public/privacy") return publicPrivacy(url, id => database(env, id));
  const current = await member(request, db);
  if (!current) return json({ error: "Inicia sesión para continuar." }, 401);
  // Until the person accepts the terms and consents to the privacy policy in force, only those and the session answer.
  const pending = await pendingFor(db, current);
  // ST-124: endpoints that change something tell the people affected, after their write.
  const notifier = { origin: url.origin, sender: mailSender(env) };
  // ST-161: e-mail waiting for a digest or the end of the quiet hours leaves on a later access (there is no cron
  // trigger in this Worker); the response never waits for it.
  const deliverDue = () => { const run = deliverScheduled(db, notifier, current.organizationId); if (ctx) ctx.waitUntil(run); else void run; };
  // ST-122: `onboarding` is true while the person still has to go through the welcome. ST-160: the preferences in
  // force come with the session, so the screen applies the theme, size and formats before showing anything.
  if (path === "/api/session") {
    deliverDue();
    return json({ member: current, pending, preferences: await preferencesFor(db, current.id, current.organizationId), ...(await onboardingPending(db, current) ? { onboarding: true } : {}) });
  }
  if (path === "/api/account/password") return changePassword(input, current, sessionToken(request)!, db, notifier);
  // A temporary password opens nothing else until the person chooses their own (ST-093); the terms come after it.
  if (current.mustChangePassword) return json({ error: "Cambia tu contraseña temporal para continuar.", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  if (path.startsWith("/api/legal")) return legal(path, method, input, current, db, notifier);
  if (pending.length && !(path === "/api/organization" && method === "GET")) return json({ error: "Acepta los términos y la política de privacidad vigentes para continuar.", pending }, 403);
  if (/^\/api\/courses\/[a-z0-9-]+\/files(?:\/|$)/.test(path)) return courseFiles(path, method, request, current, db, env.COURSE_FILES);
  const collaborationMatch = path.match(/^\/api\/courses\/([a-z0-9-]+)\/lessons\/([a-z0-9-]+)\/collaborate$/);
  if (collaborationMatch) {
    const [courseId, lessonId] = [collaborationMatch[1], collaborationMatch[2]];
    if (!(await accessTo(db, current, courseId))?.edit) return json({ error: "Solo el equipo docente del curso edita sus lecciones." }, 403);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket" || request.headers.get("Origin") !== url.origin) return json({ error: "Se requiere una conexión segura del mismo origen." }, 400);
    const lesson = await db.prepare("SELECT l.content FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id JOIN courses c ON c.id=u.course_id WHERE l.id=? AND c.id=? AND c.organization_id=? AND c.status='active' AND u.status='active' AND l.archived=0").bind(lessonId, courseId, current.organizationId).first<{ content: string }>();
    if (!lesson) return json({ error: "Lección no disponible en este curso." }, 404);
    const roomIdentity = { organizationId: current.organizationId, courseId, lessonId };
    const room = env.LESSON_ROOMS.getByName(`${current.organizationId}:${lessonId}`);
    await room.initialize(roomIdentity, encodeLessonDraft((JSON.parse(lesson.content) as Lesson).activities));
    const token = sessionToken(request);
    if (!token) return json({ error: "Inicia sesión para editar." }, 401);
    const internalHeaders = new Headers();
    request.headers.forEach((value, key) => internalHeaders.append(key, value));
    internalHeaders.set("X-HL-Organization", current.organizationId);
    internalHeaders.set("X-HL-Course", courseId);
    internalHeaders.set("X-HL-Lesson", lessonId);
    internalHeaders.set("X-HL-User", current.id);
    internalHeaders.set("X-HL-Username", current.username);
    internalHeaders.set("X-HL-Session", await digest(token));
    return room.fetch(new Request(request, { headers: internalHeaders }));
  }
  if (accountAllowed) return account(path, method, input, current, db, { request, origin: url.origin, sender: notifier.sender, token: sessionToken(request)! });
  if (meAllowed) {
    if (path === "/api/me/inbox") deliverDue();
    return me(path, method, input, current, db);
  }
  if (notificationAllowed) return notifications(path, method, input, url, current, db, notifier.sender.configured);
  if (professionalAllowed) return professional(path, method, input, url, current, db);
  if (contractAllowed) return contracts(path, method, input, current, db);
  if (academicYearAllowed) return academicYearsApi(path, method, input, current, db);
  if (institutionalCalendarAllowed) return institutionalCalendars(path, method, input, url, current, db);
  if (agendaAllowed) return agenda(url, current, db);
  if (bellAllowed) return bellSchedulesApi(path, method, input, current, db);
  if (/^\/api\/(taxonomy|vocabularies|terms)(\/|$)/.test(path)) return taxonomy(path, method, input, current, db);
  if (/^\/api\/courses\/[a-z0-9-]+\/(groups|sessions)(\/|$)/.test(path)) return classroom(path, method, input, current, db, url.searchParams, notifier);
  if (/^\/api\/courses\/[a-z0-9-]+\/duplicate$/.test(path)) return duplicateCourse(path.split("/")[3], current, db, env.COURSE_FILES);
  if (bibliographyAllowed) return bibliography(path, method, input, current, db, url.searchParams.get("format"));
  if (resourceAllowed) return resources(path, method, input, current, db, env);
  if (packageAllowed) return curriculumPackagesApi(path, method, input, current, db);
  if (deliveryAllowed) return delivery(path, url, current, db);
  if (bookMapAllowed) return bookMap(path, method, input, current, db, env, () => env.ORGANIZATIONS.getByName(current.organizationId).schedule(current.organizationId), url.searchParams.get("resourceId"));
  if (proposalAllowed) return proposals(path, method, input, current, db, env, () => env.ORGANIZATIONS.getByName(current.organizationId).schedule(current.organizationId));
  if (/^\/api\/courses\/[a-z0-9-]+\/assessment(\/|$)/.test(path)) return courseAssessment(path, method, input, url, current, db);
  if (/^\/api\/courses\/[a-z0-9-]+\/(core|sections\/differences|section-proposals(\/[a-z0-9-]+)?)$/.test(path) || /^\/api\/sections\/[a-z0-9-]+\/(plan|lessons|activities|content-overrides|units|copies|proposals|reviews)$/.test(path)) return sectionFreedom(path, method, input, current, db, notifier);
  if (/^\/api\/courses(\/|$)/.test(path)) return courses(path, method, input, current, db, notifier);
  if (/^\/api\/programs(\/|$)/.test(path)) return programs(path, method, input, current, db);
  if (path === "/api/activity") return activity(url, current, db);
  if (path === "/api/classes") return myClasses(current, db);
  if (path === "/api/feeds/calendar") return feedLink(method, url, current, db);
  if (path.startsWith("/api/calendar")) return calendar(path, method, input, url, current, db);
  if (gradebookAllowed) return grades(path, method, input, url, current, db);
  if (groupSetAllowed) return groupSets(path, method, input, url, current, db);
  if (gradingSchemeAllowed) return gradingSchemesApi(path, method, input, current, db);
  if (path.startsWith("/api/sections")) return sections(path, current, db);
  if (path === "/api/progress") return progress(current, db);
  if (path === "/api/people") return people(current, db);
  if (path.startsWith("/api/hours")) return hours(path, method, input, url, current, db);
  if (path === "/api/reviews") return reviews(current, db);
  if (path.startsWith("/api/onboarding")) return onboarding(path, method, current, db);
  if (path.startsWith("/api/invitations")) return invitations(path, method, input, url.origin, current, db, mailSender(env));
  if (staffAllowed) return staff(path, method, request, current, db, env.COURSE_FILES);
  if (path.startsWith("/api/access/")) return accessMatrix(path, method, input, current, db);
  if (path.startsWith("/api/members")) return roles(path, method, input, current, db, username => usernameTaken(env, username), notifier);
  if (aiUsageAllowed) return aiUsage(path, method, input, url, current, db);
  if (aiAssistAllowed) return aiAssist(path, method, input, current, db, env);
  if (timetableAllowed) return timetables(path, method, input, current, db, env);
  if (minuteAllowed) return panelMinutes(path, method, input, current, db);
  if (reportAllowed) return reports(path, method, input, request, current, db, (kind, template, sectionId, learnerId) => documentPreview(db, current, kind, template, sectionId, learnerId), env);
  if (path === "/api/organization/backup" || path === "/api/organization/restore") {
    if (current.role !== "admin") return json({ error: "Solo administración respalda o restaura la organización." }, 403);
    if (path.endsWith("/backup")) {
      const data = await db.exportData();
      return json({ ...data, digests: await digests(data) }, 200, { "Content-Disposition": `attachment; filename="${current.organizationId}-${data.createdAt.slice(0, 10)}.json"` });
    }
    const backup = input as Backup;
    if (!backup || typeof backup !== "object" || !backup.tables || typeof backup.tables !== "object" || !backup.digests) return json({ error: "Envía una copia de respaldo completa." }, 400);
    const expected = await digests(backup);
    if (Object.keys(expected).length !== Object.keys(backup.digests).length || Object.entries(expected).some(([name, value]) => backup.digests[name] !== value)) return json({ error: "La copia está dañada: sus huellas no coinciden." }, 400);
    // Right after a deployment the store may still run the previous version; nothing changed, so the client may retry.
    const result = await db.importData(backup).catch((error: unknown) => error instanceof Error ? error : new Error("error desconocido"));
    if (result instanceof Error) return json({ error: `La restauración no se completó y no cambió ningún dato (${result.message.slice(0, 240)}).` }, 503, { "Retry-After": "15" });
    return "error" in result ? json({ error: result.error }, 409) : json({ restored: result.restored, digests: expected });
  }
  if (path === "/api/organization") {
    if (method === "PUT") {
      if (current.role !== "admin") return json({ error: "Solo administración puede configurar la organización." }, 403);
      const settings = organizationInput(input);
      if (!settings) return json({ error: "Usa un nombre de 3 a 80 caracteres, una zona horaria válida y un formato regional válido." }, 400);
      // ST-160: the regional format is optional, so a client that only sends the name and the zone keeps the current one.
      await db.prepare("UPDATE organizations SET name=?,timezone=?,locale=COALESCE(?,locale),configured=1 WHERE id=?").bind(settings.name, settings.timezone, settings.locale || null, current.organizationId).run();
    }
    const organization = await db.prepare("SELECT id,name,timezone,locale,configured FROM organizations WHERE id=?").bind(current.organizationId).first<Organization>();
    if (!organization) return json({ error: "Organización no disponible." }, 404);
    return json({ organization: { ...organization, configured: !!organization.configured } });
  }
  const lessonUpdate = path.match(/^\/api\/lessons\/([a-z0-9-]+)$/);
  if (method === "PUT" && lessonUpdate && input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    const activities = Array.isArray(value.activities) ? value.activities as Activity[] : [];
    const course = await db.prepare("SELECT c.id AS courseId FROM lessons l JOIN learning_units u ON u.id=l.course_unit_id JOIN courses c ON c.id=u.course_id WHERE l.id=? AND c.organization_id=?").bind(lessonUpdate[1], current.organizationId).first<{ courseId: string }>();
    if (course && activities.length) {
      const snapshot = await env.LESSON_ROOMS.getByName(`${current.organizationId}:${lessonUpdate[1]}`).snapshot({ organizationId: current.organizationId, courseId: course.courseId, lessonId: lessonUpdate[1] }, richTextFieldsOf(activities));
      // Live text wins only where the room actually holds text; an empty or missing field never erases what the client sent.
      const live = (id: string | undefined) => { const doc = id ? snapshot[id] as Activity["richContent"] : undefined; return doc && hasText(doc) ? doc : undefined; };
      input = { ...value, activities: activities.map(activity => activity.blocks
        ? { ...activity, blocks: activity.blocks.map(block => { const doc = live(block.id); return doc ? { ...block, richContent: doc, instructions: "" } : block; }) }
        : (() => { const doc = live(activity.id); return doc ? { ...activity, richContent: doc, instructions: "" } : activity; })()) };
    }
  }
  return content(url, method, input, current, db, notifier);
}
export default {
    async fetch(request, env, ctx): Promise<Response> {
    try { const response = await route(request, env, ctx); if (response.status === 101) return response; for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); if (response.headers.get("Content-Type")?.startsWith("text/calendar")) response.headers.set("Cache-Control", "private, max-age=900"); if (response.headers.has("X-File-SHA256")) response.headers.set("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'"); return response; }
    catch (error) {
      if (error instanceof Error && error.message === "INPUT") return json({ error: "Revisa los datos del formulario." }, 400);
      const cause = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown error";
      console.error(JSON.stringify({ event: "request_failed", code: "DEPENDENCY_UNAVAILABLE", sha, cause }));
      return json({ error: "El servicio no está disponible. Vuelve a intentar en un momento." }, 503, { "Retry-After": "30" });
    }
  },
} satisfies ExportedHandler<Env>;
