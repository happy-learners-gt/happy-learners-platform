import type { Member } from "@happy-learners/contracts";
import { tokenPrefix } from "@happy-learners/domain";
import type { Database } from "./storage";
import { digest, newToken } from "./auth";
import type { Client } from "./account";
import { event } from "./activity";
import { securityEvent } from "./security-log";

/**
 * ST-136: integration tokens. A person creates one with a name and an expiry of 1 to 90 days; it reads (GET only) what
 * that person can read, and never their account, the organization's security, its backup or its people. It is shown
 * once: only its SHA-256 is kept. Its owner and administration revoke it; the first use of each day is logged.
 * Format: `hlt_<letra>_<64 hex>`, the letter naming the organization like a session token.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
export const integrationToken = /^hlt_([a-z])_([a-f0-9]{64})$/;
export const maxTokens = 10;
/** The token of an Authorization: Bearer header, if it is one. */
export function bearerToken(request: Request): string | null {
  const value = /^Bearer\s+(\S+)$/.exec(request.headers.get("Authorization") || "")?.[1];
  return value && integrationToken.test(value) ? value : null;
}
/** The session-like token whose letter names the organization of an integration token. */
export const tokenScopeKey = (token: string) => `${integrationToken.exec(token)![1]}_${"0".repeat(64)}`;
/** What a read-only token can never open. */
export const closedToTokens = (path: string) => /^\/api\/(me|security|account|members|access|session|logout|organization\/(backup|restore)|invitations|legal)(\/|$)/.test(path);

/** The person a valid token belongs to, or null. Updates its last use at most once an hour. */
export async function tokenMember(token: string, db: Database, columns: string, client: Client): Promise<(Member & { tokenId: string }) | null> {
  const hash = await digest(token), now = new Date(), iso = now.toISOString();
  // nosemgrep: sql-interpolated-text -- columns es la lista constante de permisos de index.ts
  const row = await db.prepare(`SELECT t.id AS tokenId,t.last_used_at AS lastUsed,u.id,u.username,COALESCE(u.display_name,u.username) AS displayName,CASE m.role WHEN 'instructor' THEN 'educator' ELSE m.role END AS role,m.organization_id AS organizationId, ${columns}
    FROM access_tokens t JOIN users u ON u.id=t.user_id JOIN memberships m ON m.user_id=u.id AND m.active=1 WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>?`).bind(hash, iso).first<Member & { tokenId: string; lastUsed: string | null }>();
  if (!row) return null;
  const { lastUsed, ...member } = row;
  if (!lastUsed || now.getTime() - Date.parse(lastUsed) >= 3600000) {
    await db.batch([
      db.prepare("UPDATE access_tokens SET last_used_at=? WHERE id=?").bind(iso, row.tokenId),
      ...(!lastUsed || lastUsed.slice(0, 10) !== iso.slice(0, 10) ? [securityEvent(db, { organizationId: row.organizationId, type: "token_used", outcome: "succeeded", actorId: row.id, subjectId: row.id, method: "token", detail: "Primer uso del día", client })] : []),
    ]);
  }
  return member;
}

type Row = { id: string; name: string; scope: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null; userId: string; owner: string };
const columns = "t.id,t.name,t.scope,t.created_at AS createdAt,t.expires_at AS expiresAt,t.last_used_at AS lastUsedAt,t.revoked_at AS revokedAt,t.user_id AS userId,COALESCE(u.display_name,u.username) AS owner";
const shape = (row: Row, now: string) => ({ ...row, status: row.revokedAt ? "revoked" : row.expiresAt <= now ? "expired" : "active" });
export const myTokenPath = /^\/api\/me\/tokens\/(token-[a-f0-9-]{36})$/;
export const orgTokenPath = /^\/api\/security\/tokens\/(token-[a-f0-9-]{36})$/;
export function tokenMethods(path: string): string[] | null {
  if (path === "/api/me/tokens") return ["GET", "POST"];
  if (path === "/api/security/tokens") return ["GET"];
  if (myTokenPath.test(path) || orgTokenPath.test(path)) return ["DELETE"];
  return null;
}

async function revoke(id: string, current: Member, db: Database, client: Client, own: boolean) {
  const found = await db.prepare(`SELECT ${columns} FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=?${own ? " AND t.user_id=?" : ""}`).bind(...(own ? [id, current.id] : [id])).first<Row>(); // nosemgrep: sql-interpolated-text -- columnas y condición constantes
  if (!found || found.revokedAt) return reply({ error: "Ese token no existe o ya se revocó." }, 404);
  await db.batch([
    db.prepare("UPDATE access_tokens SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL").bind(new Date().toISOString(), current.id, id),
    securityEvent(db, { organizationId: current.organizationId, type: "token_revoked", actorId: current.id, subjectId: found.userId, method: "token", detail: found.name, client }),
    event(db, current, { action: "revoked", targetType: "account", targetId: found.userId, summary: own ? `Revocó su token de integración «${found.name}»` : `Revocó el token de integración «${found.name}» de ${found.owner}` }),
  ]);
  return reply({ ok: true });
}

/** /api/me/tokens… and /api/security/tokens…: the person's tokens, and all of the organization for administration. */
export async function tokens(path: string, method: string, input: unknown, current: Member, db: Database, client: Client): Promise<Response> {
  const now = new Date().toISOString();
  if (path.startsWith("/api/security/")) {
    if (current.role !== "admin") return reply({ error: "Solo administración consulta los tokens de la organización." }, 403);
    const target = orgTokenPath.exec(path)?.[1];
    if (target) return revoke(target, current, db, client, false);
    const rows = (await db.prepare(`SELECT ${columns} FROM access_tokens t JOIN users u ON u.id=t.user_id ORDER BY t.revoked_at IS NOT NULL,t.expires_at<=?,t.created_at DESC LIMIT 200`).bind(now).all<Row>()).results; // nosemgrep: sql-interpolated-text -- columnas constantes
    return reply({ tokens: rows.map(row => shape(row, now)) });
  }
  const target = myTokenPath.exec(path)?.[1];
  if (target) return revoke(target, current, db, client, true);
  if (method === "GET") {
    const rows = (await db.prepare(`SELECT ${columns} FROM access_tokens t JOIN users u ON u.id=t.user_id WHERE t.user_id=? ORDER BY t.created_at DESC LIMIT 50`).bind(current.id).all<Row>()).results; // nosemgrep: sql-interpolated-text -- columnas constantes
    return reply({ tokens: rows.map(row => shape(row, now)) });
  }
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "", days = value.days;
  if (name.length < 2 || name.length > 60 || /[<>\x00-\x1f]/.test(name)) return reply({ error: "Ponle al token un nombre de 2 a 60 caracteres que diga dónde se usa." }, 400);
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 90) return reply({ error: "Elige una caducidad de 1 a 90 días." }, 400);
  const active = await db.prepare("SELECT count(*) AS n FROM access_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at>?").bind(current.id, now).first<{ n: number }>();
  if ((active?.n || 0) >= maxTokens) return reply({ error: `Ya tienes ${maxTokens} tokens activos. Revoca uno antes de crear otro.` }, 409);
  const token = `hlt_${tokenPrefix(current.organizationId)}${newToken()}`, id = `token-${crypto.randomUUID()}`, expiresAt = new Date(Date.now() + (days as number) * 86400000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO access_tokens(id,user_id,name,token_hash,scope,created_at,expires_at) VALUES (?,?,?,?,'read',?,?)").bind(id, current.id, name, await digest(token), now, expiresAt),
    securityEvent(db, { organizationId: current.organizationId, type: "token_created", actorId: current.id, subjectId: current.id, method: "token", detail: `${name} · solo lectura · ${days} días`, client }),
    event(db, current, { action: "created", targetType: "account", targetId: current.id, summary: `Creó el token de integración «${name}» (solo lectura, ${days} días)` }),
  ]);
  return reply({ token, id, name, scope: "read", expiresAt }, 201);
}
