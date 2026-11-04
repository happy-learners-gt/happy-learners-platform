import type { SealedFields } from "@happy-learners/domain";
import { genesisHash, sealText, securityRetentionDays, sha256Hex } from "@happy-learners/domain";

/**
 * ST-186: the chain of seals of the security log. The store calls `sealSecurityEvents` inside the transaction of any
 * batch that inserts into security_events (storage.ts); `verifySecurityChain` recomputes it on demand. Both take the
 * smallest interface they need, so tests run them on node:sqlite with every migration.
 */
type Sql = { exec(query: string, ...bindings: any[]): { toArray(): Record<string, unknown>[]; one(): Record<string, unknown> } };
type Reader = { prepare(query: string): { bind(...values: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> } } };
const sha256 = sha256Hex;
const sealedColumns = "id,organization_id,type,outcome,actor_id,subject_id,method,detail,device,country,occurred_at";

/**
 * Seals every unsealed event in rowid order, each with the SHA-256 of the previous seal and its own fields, and once a
 * day removes the events past the retention, keeping the seal of the last one removed as the chain's anchor.
 * Synchronous: it runs inside the store's transaction.
 */
export function sealSecurityEvents(sql: Sql, scope: string) {
  const now = new Date(), iso = now.toISOString();
  sql.exec("INSERT OR IGNORE INTO security_chain(organization_id,anchor_rowid,anchor_hash,head_rowid,head_hash,sealed_at) VALUES (?,0,?,0,?,?)", scope, genesisHash, genesisHash, iso);
  const chain = (sql.exec("SELECT head_rowid,head_hash,pruned_on FROM security_chain WHERE organization_id=?", scope).one() as { head_rowid: number; head_hash: string; pruned_on: string | null });
  let previous = chain.head_hash, head = chain.head_rowid;
  // nosemgrep: sql-interpolated-text -- sealedColumns es la lista constante de columnas del sello
  for (const row of sql.exec(`SELECT rowid AS r,${sealedColumns} FROM security_events WHERE hash IS NULL ORDER BY rowid`).toArray()) {
    previous = sha256(sealText(previous, row as unknown as SealedFields)); head = Number(row.r);
    sql.exec("UPDATE security_events SET hash=? WHERE rowid=?", previous, head);
  }
  sql.exec("UPDATE security_chain SET head_rowid=?,head_hash=?,sealed_at=? WHERE organization_id=?", head, previous, iso, scope);
  const today = iso.slice(0, 10);
  if (chain.pruned_on === today) return;
  const cutoff = new Date(now.getTime() - securityRetentionDays * 86400000).toISOString();
  const last = sql.exec("SELECT rowid AS r,hash FROM security_events WHERE occurred_at<? AND hash IS NOT NULL ORDER BY rowid DESC LIMIT 1", cutoff).toArray()[0] as { r: number; hash: string } | undefined;
  if (last) {
    sql.exec("DELETE FROM security_events WHERE rowid<=?", last.r);
    sql.exec("UPDATE security_chain SET anchor_rowid=?,anchor_hash=? WHERE organization_id=?", last.r, last.hash, scope);
  }
  sql.exec("UPDATE security_chain SET pruned_on=? WHERE organization_id=?", today, scope);
}

export interface ChainStatus { ok: boolean; events: number; head: string; anchor: string; checkedAt: string; brokenAt: { id: string; occurredAt: string } | null; reason?: "event" | "head" }
/** Recomputes every seal from the anchor; any changed, removed or reordered event, or a different head, breaks it. */
export async function verifySecurityChain(db: Reader, organizationId: string): Promise<ChainStatus> {
  const checkedAt = new Date().toISOString();
  const chain = await db.prepare("SELECT anchor_rowid AS anchorRowid,anchor_hash AS anchorHash,head_rowid AS headRowid,head_hash AS headHash FROM security_chain WHERE organization_id=?")
    .bind(organizationId).first<{ anchorRowid: number; anchorHash: string; headRowid: number; headHash: string }>();
  if (!chain) {
    const any = await db.prepare("SELECT id,occurred_at AS occurredAt FROM security_events ORDER BY rowid LIMIT 1").bind().first<{ id: string; occurredAt: string }>();
    return { ok: !any, events: 0, head: genesisHash, anchor: genesisHash, checkedAt, brokenAt: any, ...(any ? { reason: "event" as const } : {}) };
  }
  let previous = chain.anchorHash, after = chain.anchorRowid, events = 0, lastRowid = chain.anchorRowid;
  for (;;) {
    // nosemgrep: sql-interpolated-text -- sealedColumns es la lista constante de columnas del sello
    const rows = (await db.prepare(`SELECT rowid AS r,${sealedColumns},hash FROM security_events WHERE rowid>? ORDER BY rowid LIMIT 1000`).bind(after)
      .all<SealedFields & { r: number; hash: string | null }>()).results;
    for (const row of rows) {
      previous = sha256(sealText(previous, row));
      if (row.hash !== previous) return { ok: false, events, head: chain.headHash, anchor: chain.anchorHash, checkedAt, brokenAt: { id: row.id, occurredAt: row.occurred_at }, reason: "event" };
      events++; lastRowid = row.r;
    }
    if (rows.length < 1000) break;
    after = rows[rows.length - 1].r;
  }
  const ok = lastRowid === chain.headRowid && previous === chain.headHash;
  return { ok, events, head: chain.headHash, anchor: chain.anchorHash, checkedAt, brokenAt: null, ...(ok ? {} : { reason: "head" as const }) };
}

