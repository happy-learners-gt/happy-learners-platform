import type { Member } from "@happy-learners/contracts";
import type { Database } from "./storage";
import type { Client } from "./account";
import { event } from "./activity";
import { securityEvent } from "./security-log";
import { policyOf } from "./sign-in";
import { profileOnLeave } from "./professional";

/**
 * Identidad y acceso for administration (docs/design/identidad-y-acceso.md §2): the organization's posture with its
 * recommendations, the directory of people with their sign-in methods, one person's whole picture, and access reviews.
 * Everything is read from what the platform already keeps; nothing here stores new personal data.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const day = 86400000;

type Person = {
  id: string; username: string; name: string; email: string | null; role: "admin" | "educator"; active: number; mustChange: number;
  mfa: number; passkeys: number; providers: string | null; tokens: number; recoveryLeft: number; lastSignIn: string | null; failed7: number; sessions: number;
  coordination: string | null; groups: string | null; createdAt: string | null;
};
const peopleQuery = `SELECT u.id,u.username,COALESCE(u.display_name,u.username) AS name,u.email,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.active,u.must_change_password AS mustChange,
  EXISTS (SELECT 1 FROM totp_factors f WHERE f.user_id=u.id AND f.status='active') AS mfa,
  (SELECT count(*) FROM passkeys p WHERE p.user_id=u.id) AS passkeys,
  (SELECT group_concat(l.provider) FROM linked_identities l WHERE l.user_id=u.id) AS providers,
  (SELECT count(*) FROM access_tokens t WHERE t.user_id=u.id AND t.revoked_at IS NULL AND t.expires_at>?1) AS tokens,
  (SELECT count(*) FROM recovery_codes r WHERE r.user_id=u.id AND r.used_at IS NULL) AS recoveryLeft,
  (SELECT max(s.occurred_at) FROM sign_in_events s WHERE s.user_id=u.id AND s.outcome='succeeded') AS lastSignIn,
  (SELECT count(*) FROM sign_in_events s WHERE s.user_id=u.id AND s.outcome='failed' AND s.occurred_at>?2) AS failed7,
  (SELECT count(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?3) AS sessions,
  (SELECT group_concat(cs.program_id) FROM coordination_scopes cs WHERE cs.user_id=u.id) AS coordination,
  (SELECT group_concat(g.name, ' · ') FROM security_group_members gm JOIN security_groups g ON g.id=gm.group_id WHERE gm.user_id=u.id) AS groups,
  (SELECT min(r.occurred_at) FROM role_events r WHERE r.member_id=u.id) AS createdAt
  FROM users u JOIN memberships m ON m.user_id=u.id AND m.organization_id=?4`;
async function people(db: Database, org: string) {
  const now = new Date();
  return (await db.prepare(`${peopleQuery} ORDER BY m.active DESC,name`).bind(now.toISOString(), new Date(now.getTime() - 7 * day).toISOString(), now.getTime(), org).all<Person>()).results; // nosemgrep: sql-interpolated-text -- consulta constante de este módulo
}
/** How strong a person's sign-in is: phishing-resistant (a passkey), two factors, or a password alone. */
const strength = (person: Person) => person.passkeys > 0 ? "phishing-resistant" : person.mfa ? "mfa" : "password";
/** What needs attention about a person, most serious first. */
function risks(person: Person, now: number, policy: { mfaAdmin: boolean; mfaEducator: boolean }) {
  const out: string[] = [];
  if (!person.active) return out;
  if (person.role === "admin" && strength(person) === "password") out.push("admin-without-mfa");
  else if (strength(person) === "password" && (person.role === "admin" ? policy.mfaAdmin : policy.mfaEducator)) out.push("mfa-required-missing");
  if (person.failed7 >= 5) out.push("failed-sign-ins");
  const last = person.lastSignIn ? Date.parse(person.lastSignIn) : null;
  if (last !== null ? now - last > 90 * day : person.createdAt && now - Date.parse(person.createdAt) > 90 * day) out.push("inactive");
  if (person.mustChange) out.push("temporary-password");
  return out;
}
const shape = (person: Person, now: number, policy: { mfaAdmin: boolean; mfaEducator: boolean }) => ({
  id: person.id, username: person.username, name: person.name, email: person.email, role: person.role, active: !!person.active,
  methods: { password: true, mfa: !!person.mfa, passkeys: person.passkeys, providers: person.providers ? person.providers.split(",") : [], recoveryLeft: person.recoveryLeft },
  strength: strength(person), tokens: person.tokens, sessions: person.sessions, lastSignIn: person.lastSignIn, failed7: person.failed7,
  coordination: person.coordination, groups: person.groups ? person.groups.split(" · ") : [], risks: risks(person, now, policy),
});

export type Recommendation = { id: string; severity: "high" | "medium" | "low"; title: string; detail: string; count: number; people?: string[]; action: { kind: "policy" | "people" | "review" | "provider" | "logs" | "tokens"; label: string; filter?: string } };
/** GET /api/identity/overview: the posture of the organization and what to do next, with a score of 0 to 100. */
async function overview(db: Database, org: string) {
  const now = Date.now(), policy = await policyOf(db, org), list = (await people(db, org)).map(person => shape(person, now, policy)), active = list.filter(person => person.active);
  const since = new Date(now - day).toISOString(), week = new Date(now - 7 * day).toISOString();
  const [events, tokens, review, sso, chain] = await db.batch([
    db.prepare("SELECT sum(type='sign_in' AND outcome='failed') AS failed,sum(type='sign_in_locked') AS locked,sum(type='sign_in' AND outcome='succeeded') AS succeeded FROM security_events WHERE organization_id=? AND occurred_at>?").bind(org, since),
    db.prepare("SELECT count(*) AS expiring FROM access_tokens WHERE revoked_at IS NULL AND expires_at>? AND expires_at<?").bind(new Date(now).toISOString(), new Date(now + 7 * day).toISOString()),
    db.prepare("SELECT max(completed_at) AS last,(SELECT count(*) FROM access_reviews WHERE organization_id=?1 AND status='open') AS open FROM access_reviews WHERE organization_id=?1 AND status='completed'").bind(org),
    db.prepare("SELECT status,name FROM sso_connections WHERE organization_id=?").bind(org),
    db.prepare("SELECT sealed_at AS sealedAt FROM security_chain WHERE organization_id=?").bind(org),
  ]) as unknown as [{ failed: number | null; locked: number | null; succeeded: number | null }[], { expiring: number }[], { last: string | null; open: number }[], { status: string; name: string }[], { sealedAt: string }[]];
  const names = (items: typeof list) => items.map(person => person.name).slice(0, 8);
  const adminsWeak = active.filter(person => person.role === "admin" && person.strength === "password");
  const requiredMissing = active.filter(person => person.risks.includes("mfa-required-missing"));
  const inactive = active.filter(person => person.risks.includes("inactive"));
  const noStrong = active.filter(person => person.strength === "password");
  const attacked = active.filter(person => person.risks.includes("failed-sign-ins"));
  const recommendations: Recommendation[] = [];
  if (!policy.mfaAdmin) recommendations.push({ id: "require-mfa-admin", severity: "high", title: "Exige la verificación en dos pasos a administración", detail: "Una contraseña robada de administración abre toda la organización. Exigirla obliga a configurarla en el siguiente acceso.", count: active.filter(person => person.role === "admin").length, action: { kind: "policy", label: "Exigir a administración" } });
  if (adminsWeak.length) recommendations.push({ id: "admins-without-mfa", severity: "high", title: `${adminsWeak.length === 1 ? "Una cuenta" : `${adminsWeak.length} cuentas`} de administración solo con contraseña`, detail: "Pídeles crear una passkey o activar la aplicación de autenticación desde Mi cuenta › Seguridad.", count: adminsWeak.length, people: names(adminsWeak), action: { kind: "people", label: "Ver quiénes", filter: "admin-without-mfa" } });
  if (attacked.length) recommendations.push({ id: "failed-sign-ins", severity: "high", title: `${attacked.length === 1 ? "Una persona tiene" : `${attacked.length} personas tienen`} 5 o más intentos fallidos esta semana`, detail: "Revisa en los registros si fueron ellas; si no, cierra sus sesiones y restablece su contraseña.", count: attacked.length, people: names(attacked), action: { kind: "people", label: "Revisar", filter: "failed-sign-ins" } });
  if (requiredMissing.length) recommendations.push({ id: "mfa-pending", severity: "medium", title: `${requiredMissing.length === 1 ? "Una persona aún no configura" : `${requiredMissing.length} personas aún no configuran`} el segundo factor exigido`, detail: "Lo configurarán en su siguiente acceso; hasta entonces su cuenta solo tiene contraseña.", count: requiredMissing.length, people: names(requiredMissing), action: { kind: "people", label: "Ver quiénes", filter: "mfa-required-missing" } });
  if (inactive.length) recommendations.push({ id: "inactive", severity: "medium", title: `${inactive.length === 1 ? "Una cuenta" : `${inactive.length} cuentas`} con acceso sin entrar en 90 días`, detail: "Una cuenta olvidada es una puerta abierta. Revisa si deben conservar el acceso.", count: inactive.length, people: names(inactive), action: { kind: "review", label: "Revisar accesos" } });
  if (!policy.breachedCheck) recommendations.push({ id: "breached-off", severity: "medium", title: "Las contraseñas filtradas no se revisan", detail: "Activa la revisión: compara sin enviar la contraseña.", count: 1, action: { kind: "policy", label: "Activar" } });
  if (!review[0]?.open && (!review[0]?.last || now - Date.parse(review[0].last) > 90 * day)) recommendations.push({ id: "review-due", severity: "medium", title: review[0]?.last ? "Han pasado más de 90 días desde la última revisión de accesos" : "Aún no se ha hecho una revisión de accesos", detail: "Confirma persona por persona quién conserva el acceso; quitar el de quien ya no está se aplica al completar.", count: active.length, action: { kind: "review", label: "Iniciar revisión" } });
  if (tokens[0]?.expiring) recommendations.push({ id: "tokens-expiring", severity: "low", title: `${tokens[0].expiring === 1 ? "Un token de integración vence" : `${tokens[0].expiring} tokens de integración vencen`} esta semana`, detail: "Avisa a sus dueños para que creen uno nuevo antes de que la integración deje de funcionar.", count: tokens[0].expiring, action: { kind: "tokens", label: "Ver tokens" } });
  if (sso[0] && sso[0].status !== "active") recommendations.push({ id: "sso-pending", severity: "low", title: `El proveedor «${sso[0].name}» no está activo`, detail: sso[0].status === "draft" ? "Pruébalo con una cuenta de la institución y actívalo." : "Ya se probó: actívalo para que el equipo entre con su cuenta institucional.", count: 1, action: { kind: "provider", label: "Abrir" } });
  if (noStrong.length && active.length) recommendations.push({ id: "adopt-passkeys", severity: "low", title: `${Math.round(noStrong.length / active.length * 100)} % del equipo entra solo con contraseña`, detail: "Las passkeys son más seguras y más rápidas: invita al equipo a crear una desde Mi cuenta › Seguridad.", count: noStrong.length, people: names(noStrong), action: { kind: "people", label: "Ver quiénes", filter: "password-only" } });
  // The score weighs what protects the most: administration, everyone's sign-in strength, and the policy.
  const share = (part: number, whole: number) => whole ? part / whole : 1;
  const admins = active.filter(person => person.role === "admin");
  const score = Math.round(100 * (0.3 * share(admins.filter(person => person.strength !== "password").length, admins.length) + 0.25 * share(active.filter(person => person.strength !== "password").length, active.length)
    + 0.15 * (policy.mfaAdmin ? 1 : 0) + 0.1 * (policy.mfaEducator ? 1 : 0) + 0.1 * (policy.breachedCheck ? 1 : 0) + 0.1 * (review[0]?.last && now - Date.parse(review[0].last) <= 90 * day ? 1 : 0)));
  return reply({
    score, recommendations, policy,
    metrics: {
      people: active.length, admins: admins.length, mfa: active.filter(person => person.methods.mfa).length, passkeys: active.filter(person => person.methods.passkeys > 0).length,
      passwordOnly: noStrong.length, inactive: inactive.length, signIns24h: events[0]?.succeeded || 0, failed24h: events[0]?.failed || 0, locked24h: events[0]?.locked || 0,
      tokensExpiring: tokens[0]?.expiring || 0,
    },
    lastReview: review[0]?.last || null, openReviews: review[0]?.open || 0, provider: sso[0] || null, sealedAt: chain[0]?.sealedAt || null, since: week,
  });
}

/** GET /api/identity/people/:id: one person's whole picture. */
async function person(db: Database, org: string, id: string) {
  const now = Date.now(), policy = await policyOf(db, org);
  const found = await db.prepare(`${peopleQuery} WHERE u.id=?5`).bind(new Date(now).toISOString(), new Date(now - 7 * day).toISOString(), now, org, id).first<Person>(); // nosemgrep: sql-interpolated-text -- consulta constante de este módulo
  if (!found) return reply({ error: "Persona no disponible." }, 404);
  const [passkeys, identities, tokens, sessions, events] = await db.batch([
    db.prepare("SELECT id,name,created_at AS createdAt,last_used_at AS lastUsedAt,backed_up AS synced FROM passkeys WHERE user_id=? ORDER BY created_at").bind(id),
    db.prepare("SELECT provider,email,linked_at AS linkedAt,last_used_at AS lastUsedAt FROM linked_identities WHERE user_id=? ORDER BY linked_at").bind(id),
    db.prepare("SELECT id,name,expires_at AS expiresAt,last_used_at AS lastUsedAt FROM access_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC").bind(id, new Date(now).toISOString()),
    db.prepare("SELECT id,device,country,method,created_at AS createdAt,last_used_at AS lastUsedAt FROM sessions WHERE user_id=? AND expires_at>? ORDER BY last_used_at DESC LIMIT 20").bind(id, now),
    db.prepare("SELECT id,type,outcome,method,detail,device,country,occurred_at AS occurredAt FROM security_events WHERE subject_id=? ORDER BY occurred_at DESC,rowid DESC LIMIT 30").bind(id),
  ]) as unknown as Record<string, unknown>[][];
  return reply({ person: { ...shape(found, now, policy), passkeys: passkeys.map(item => ({ ...item, synced: !!item.synced })), identities, tokens,
    sessions: sessions.map(item => ({ ...item, createdAt: new Date(item.createdAt as number).toISOString(), lastUsedAt: new Date(item.lastUsedAt as number).toISOString() })), events } });
}

/** Access reviews (docs/design/identidad-y-acceso.md §2). */
const reviewPath = /^\/api\/identity\/reviews\/(review-[a-f0-9-]{36})(\/complete|\/items\/([a-z0-9-]{1,100}))?$/;
async function reviews(path: string, method: string, input: unknown, current: Member, db: Database, client: Client) {
  const org = current.organizationId, value = input && typeof input === "object" ? input as Record<string, unknown> : {}, at = new Date().toISOString();
  if (path === "/api/identity/reviews" && method === "GET") {
    const rows = (await db.prepare(`SELECT r.id,r.name,r.status,r.due_on AS dueOn,r.created_at AS createdAt,r.completed_at AS completedAt,COALESCE(u.display_name,u.username) AS createdBy,
      (SELECT count(*) FROM access_review_items i WHERE i.review_id=r.id) AS total,(SELECT count(*) FROM access_review_items i WHERE i.review_id=r.id AND i.decision IS NOT NULL) AS decided,
      (SELECT count(*) FROM access_review_items i WHERE i.review_id=r.id AND i.decision='remove') AS removed FROM access_reviews r LEFT JOIN users u ON u.id=r.created_by WHERE r.organization_id=? ORDER BY r.created_at DESC LIMIT 50`).bind(org).all()).results;
    return reply({ reviews: rows });
  }
  if (path === "/api/identity/reviews") {
    const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "", due = typeof value.dueOn === "string" ? value.dueOn : "";
    if (name.length < 2 || name.length > 80 || /[<>\x00-\x1f]/.test(name)) return reply({ error: "Escribe un nombre de 2 a 80 caracteres, como «Revisión de noviembre»." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < at.slice(0, 10)) return reply({ error: "Elige una fecha límite de hoy en adelante." }, 400);
    if (await db.prepare("SELECT 1 AS open FROM access_reviews WHERE organization_id=? AND status='open'").bind(org).first()) return reply({ error: "Ya hay una revisión abierta. Complétala o cancélala antes de iniciar otra." }, 409);
    const id = `review-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO access_reviews(id,organization_id,name,due_on,created_by,created_at) VALUES (?,?,?,?,?,?)").bind(id, org, name, due, current.id, at),
      db.prepare("INSERT INTO access_review_items(review_id,user_id,role) SELECT ?,m.user_id,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END FROM memberships m WHERE m.organization_id=? AND m.active=1").bind(id, org),
      securityEvent(db, { organizationId: org, type: "access_review_started", actorId: current.id, detail: `Inició la revisión de accesos «${name}»`, client }),
    ]);
    return reply({ id }, 201);
  }
  const match = reviewPath.exec(path);
  if (!match) return reply({ error: "Ruta no disponible." }, 404);
  const id = match[1];
  const review = await db.prepare("SELECT name,status,due_on AS dueOn,created_at AS createdAt,completed_at AS completedAt FROM access_reviews WHERE id=? AND organization_id=?").bind(id, org).first<{ name: string; status: string; dueOn: string; createdAt: string; completedAt: string | null }>();
  if (!review) return reply({ error: "Esa revisión no existe." }, 404);
  if (method === "GET") {
    const now = Date.now(), policy = await policyOf(db, org);
    const everyone = new Map((await people(db, org)).map(item => [item.id, shape(item, now, policy)]));
    const items = (await db.prepare("SELECT i.user_id AS userId,i.role,i.decision,i.note,i.decided_at AS decidedAt,COALESCE(u.display_name,u.username) AS decidedBy,i.applied_at AS appliedAt FROM access_review_items i LEFT JOIN users u ON u.id=i.decided_by WHERE i.review_id=?").bind(id).all<Record<string, string | null>>()).results;
    return reply({ review: { id, ...review, items: items.map(item => ({ ...item, person: everyone.get(item.userId!) || null })) } });
  }
  if (review.status !== "open") return reply({ error: "Esta revisión ya se cerró." }, 409);
  if (match[2] === "/complete") {
    if (method === "DELETE") {
      await db.batch([db.prepare("UPDATE access_reviews SET status='cancelled' WHERE id=?").bind(id)]);
      return reply({ ok: true });
    }
    const pending = await db.prepare("SELECT count(*) AS n FROM access_review_items WHERE review_id=? AND decision IS NULL").bind(id).first<{ n: number }>();
    if (pending?.n) return reply({ error: `Faltan ${pending.n === 1 ? "1 persona" : `${pending.n} personas`} por decidir.` }, 409);
    const removed = (await db.prepare("SELECT i.user_id AS id,COALESCE(u.display_name,u.username) AS name FROM access_review_items i JOIN users u ON u.id=i.user_id JOIN memberships m ON m.user_id=i.user_id AND m.organization_id=? AND m.active=1 WHERE i.review_id=? AND i.decision='remove'").bind(org, id).all<{ id: string; name: string }>()).results;
    // Each «remove» ends the access as when administration takes it away: sessions, calendar link and tokens end.
    await db.batch([
      ...removed.flatMap(person => [
        db.prepare("UPDATE memberships SET active=0 WHERE user_id=? AND organization_id=?").bind(person.id, org),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(person.id), db.prepare("DELETE FROM calendar_feeds WHERE user_id=?").bind(person.id),
        db.prepare("UPDATE access_tokens SET revoked_at=?,revoked_by=? WHERE user_id=? AND revoked_at IS NULL").bind(at, current.id, person.id),
        db.prepare("INSERT INTO role_events SELECT ?,?,user_id,role,0,? FROM access_review_items WHERE review_id=? AND user_id=?").bind(crypto.randomUUID(), current.id, at, id, person.id),
        ...profileOnLeave(db, current, person.id, person.name, "deactivation"),
        securityEvent(db, { organizationId: org, type: "access_changed", actorId: current.id, subjectId: person.id, detail: `Acceso retirado por la revisión «${review.name}»`, client }),
        event(db, current, { action: "archived", targetType: "account", targetId: person.id, summary: `Quitó el acceso de ${person.name} por la revisión «${review.name}»` }),
      ]),
      db.prepare("UPDATE access_review_items SET applied_at=? WHERE review_id=? AND decision='remove'").bind(at, id),
      db.prepare("UPDATE access_reviews SET status='completed',completed_by=?,completed_at=? WHERE id=?").bind(current.id, at, id),
      securityEvent(db, { organizationId: org, type: "access_review_completed", actorId: current.id, detail: `Completó la revisión «${review.name}»: ${removed.length === 1 ? "1 acceso retirado" : `${removed.length} accesos retirados`}`, client }),
    ]);
    return reply({ ok: true, removed: removed.length });
  }
  const userId = match[3]!;
  const decision = value.decision, note = typeof value.note === "string" ? value.note.trim().slice(0, 300) : null;
  if (decision !== "keep" && decision !== "remove" && decision !== null) return reply({ error: "Elige mantener o quitar el acceso." }, 400);
  if (decision === "remove" && (userId === current.id || userId === "user-0")) return reply({ error: userId === current.id ? "No puedes quitarte el acceso a ti." : "La cuenta administradora inicial conserva su acceso." }, 409);
  const saved = await db.guardedBatch(db.prepare("SELECT 1 FROM access_review_items WHERE review_id=? AND user_id=?").bind(id, userId), [
    db.prepare("UPDATE access_review_items SET decision=?,note=?,decided_by=?,decided_at=? WHERE review_id=? AND user_id=?").bind(decision, decision ? note || null : null, decision ? current.id : null, decision ? at : null, id, userId),
  ]);
  return saved ? reply({ ok: true }) : reply({ error: "Esa persona no está en esta revisión." }, 404);
}

export function identityMethods(path: string): string[] | null {
  if (path === "/api/identity/overview" || path === "/api/identity/people" || /^\/api\/identity\/people\/[a-z0-9-]{1,100}$/.test(path)) return ["GET"];
  if (path === "/api/identity/reviews") return ["GET", "POST"];
  const match = reviewPath.exec(path);
  if (match) return match[2] === "/complete" ? ["POST", "DELETE"] : match[3] ? ["PUT"] : ["GET"];
  return null;
}
/** /api/identity/…: administration only. */
export async function identity(path: string, method: string, input: unknown, current: Member, db: Database, client: Client) {
  if (current.role !== "admin") return reply({ error: "Solo administración consulta la identidad y el acceso de la organización." }, 403);
  const org = current.organizationId;
  if (path === "/api/identity/overview") return overview(db, org);
  if (path === "/api/identity/people") {
    const now = Date.now(), policy = await policyOf(db, org);
    return reply({ people: (await people(db, org)).map(item => shape(item, now, policy)) });
  }
  const one = /^\/api\/identity\/people\/([a-z0-9-]{1,100})$/.exec(path)?.[1];
  if (one) return person(db, org, one);
  return reviews(path, method, input, current, db, client);
}
