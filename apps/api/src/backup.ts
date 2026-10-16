/**
 * Logical backup of one organization's store (ST-044): every table, in creation order, without credentials.
 * Sessions, student access sessions, login limits, calendar links (ST-125), invitations and the mail outbox (ST-121)
 * are not copied: they hold link secrets or delivery records that only make sense in the store that issued them.
 * Password columns never leave the store. Staff e-mail addresses (users.email) are copied: the backup is
 * administration's and already holds the organization's personal data.
 * A restore keeps the credentials the target already has, so a restored account signs in as it did there; whether
 * the password is a temporary one (ST-093) belongs to those credentials and stays with them.
 */
declare global { interface Env { RESTORE_ENABLED?: string } }

export const BACKUP_FORMAT = "happy-learners-backup/1";
const SKIPPED = new Set(["sessions", "group_access_sessions", "login_limits", "calendar_feeds", "invitations", "mail_outbox", "schema_migrations"]);
const SECRET: Record<string, string[]> = { users: ["password_salt", "password_hash", "must_change_password"] };

type Cell = string | number | null | { b64: string };
export interface BackupTable { columns: string[]; rows: Cell[][] }
export interface Backup { format: string; organizationId: string; schemaVersion: number; createdAt: string; tables: Record<string, BackupTable>; digests: Record<string, string> }

const cell = (value: SqlStorageValue): Cell => value instanceof ArrayBuffer ? { b64: btoa(String.fromCharCode(...new Uint8Array(value))) } : value;
const raw = (value: Cell): SqlStorageValue => value && typeof value === "object" ? Uint8Array.from(atob(value.b64), c => c.charCodeAt(0)).buffer : value;
/** Order-independent text of a table: each row as JSON, sorted. Restoring the same rows gives the same text. */
export const canonical = (table: BackupTable) => table.columns.join(",") + "\n" + table.rows.map(row => JSON.stringify(row)).sort().join("\n");

function tables(sql: SqlStorage) {
  return sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite!_%' ESCAPE '!' AND name NOT LIKE '!_cf!_%' ESCAPE '!' AND name NOT LIKE '!_!_%' ESCAPE '!' ORDER BY rowid").toArray()
    .map(row => row.name).filter(name => !SKIPPED.has(name));
}
function columnsOf(sql: SqlStorage, table: string) {
  return sql.exec<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`).toArray().map(row => row.name);
}
function read(sql: SqlStorage, table: string, columns: string[]): BackupTable {
  const list = columns.map(name => `"${name}"`).join(",");
  return { columns, rows: [...sql.exec(`SELECT ${list} FROM "${table}" ORDER BY rowid`).raw()].map(row => row.map(cell)) };
}
export function schemaVersion(sql: SqlStorage) {
  return sql.exec<{ version: number }>("SELECT max(version) AS version FROM schema_migrations").one().version;
}

export async function digests(backup: Pick<Backup, "tables">) {
  const out: Record<string, string> = {};
  for (const [name, table] of Object.entries(backup.tables)) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(table)));
    out[name] = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return out;
}

export function exportStore(sql: SqlStorage, scope: string): Omit<Backup, "digests"> {
  const out: Record<string, BackupTable> = {};
  for (const name of tables(sql)) out[name] = read(sql, name, columnsOf(sql, name).filter(column => !SECRET[name]?.includes(column)));
  return { format: BACKUP_FORMAT, organizationId: scope, schemaVersion: schemaVersion(sql), createdAt: new Date().toISOString(), tables: out };
}

/** Replaces every table with the backup, inside the caller's transaction; throws (and so rolls back) on any difference. */
export function importStore(sql: SqlStorage, scope: string, backup: Backup) {
  if (backup.format !== BACKUP_FORMAT || backup.organizationId !== scope) throw new RestoreError("La copia no corresponde a esta organización.");
  if (backup.schemaVersion !== schemaVersion(sql)) throw new RestoreError(`La copia es del esquema ${backup.schemaVersion} y este espacio usa el ${schemaVersion(sql)}.`);
  const names = tables(sql);
  if (names.length !== Object.keys(backup.tables).length || names.some(name => !backup.tables[name])) throw new RestoreError("La copia no tiene las mismas tablas que este espacio.");
  const credentials = new Map(sql.exec<Record<string, SqlStorageValue>>("SELECT id,password_salt,password_hash,must_change_password FROM users").toArray().map(row => [String(row.id), row]));
  const unusable: Record<string, () => SqlStorageValue> = { password_salt: () => crypto.randomUUID(), password_hash: () => "!", must_change_password: () => 1 };
  sql.exec("PRAGMA defer_foreign_keys = ON");
  // Triggers check rows against other tables that may not be loaded yet; the copy came from a store that passed
  // them, and every table is compared with it below. They are recreated before the transaction commits.
  const triggers = sql.exec<{ name: string; sql: string }>(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${names.map(() => "?").join(",")})`, ...names).toArray();
  for (const trigger of triggers) sql.exec(`DROP TRIGGER "${trigger.name}"`);
  for (const name of [...names].reverse()) sql.exec(`DELETE FROM "${name}"`);
  for (const name of names) {
    const table = backup.tables[name], secret = SECRET[name] || [];
    const columns = [...table.columns, ...secret];
    const statement = `INSERT INTO "${name}"(${columns.map(column => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
    for (const row of table.rows) {
      // Accounts the target does not know get credentials nobody can use until administration resets them.
      const kept = secret.length ? credentials.get(String(row[table.columns.indexOf("id")])) : undefined;
      const extra = secret.map(column => kept ? kept[column] : unusable[column]());
      sql.exec(statement, ...row.map(raw), ...extra);
    }
  }
  for (const trigger of triggers) sql.exec(trigger.sql);
  sql.exec("DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)");
  sql.exec("DELETE FROM calendar_feeds WHERE user_id NOT IN (SELECT id FROM users)");
  sql.exec("DELETE FROM invitations WHERE invited_by NOT IN (SELECT id FROM users) OR (accepted_user_id IS NOT NULL AND accepted_user_id NOT IN (SELECT id FROM users))");
  sql.exec("DELETE FROM group_access_sessions WHERE group_id NOT IN (SELECT id FROM course_groups) OR (learner_id IS NOT NULL AND learner_id NOT IN (SELECT id FROM group_learners))");
  for (const name of names) if (canonical(read(sql, name, backup.tables[name].columns)) !== canonical(backup.tables[name])) throw new RestoreError(`La tabla ${name} no quedó igual a la copia.`);
  return Object.fromEntries(names.map(name => [name, backup.tables[name].rows.length]));
}

export class RestoreError extends Error {}
