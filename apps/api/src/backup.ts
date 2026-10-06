/**
 * Logical backup of one organization's store (ST-044): every table, in creation order, without credentials.
 * Sessions, student access sessions and login limits are not copied; password columns never leave the store.
 * A restore keeps the credentials the target already has, so a restored account signs in as it did there.
 */
declare global { interface Env { RESTORE_ENABLED?: string } }

export const BACKUP_FORMAT = "happy-learners-backup/1";
const SKIPPED = new Set(["sessions", "group_access_sessions", "login_limits", "schema_migrations"]);
const SECRET: Record<string, string[]> = { users: ["password_salt", "password_hash"] };

type Cell = string | number | null | { b64: string };
export interface BackupTable { columns: string[]; rows: Cell[][] }
export interface Backup { format: string; organizationId: string; schemaVersion: number; createdAt: string; tables: Record<string, BackupTable>; digests: Record<string, string> }

const cell = (value: SqlStorageValue): Cell => value instanceof ArrayBuffer ? { b64: btoa(String.fromCharCode(...new Uint8Array(value))) } : value;
const raw = (value: Cell): SqlStorageValue => value && typeof value === "object" ? Uint8Array.from(atob(value.b64), c => c.charCodeAt(0)).buffer : value;
/** Order-independent text of a table: each row as JSON, sorted. Restoring the same rows gives the same text. */
export const canonical = (table: BackupTable) => table.columns.join(",") + "\n" + table.rows.map(row => JSON.stringify(row)).sort().join("\n");

function tables(sql: SqlStorage) {
  return sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid").toArray()
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
  const credentials = new Map(sql.exec<{ id: string; password_salt: string; password_hash: string }>("SELECT id,password_salt,password_hash FROM users").toArray().map(row => [row.id, row]));
  sql.exec("PRAGMA defer_foreign_keys = ON");
  for (const name of [...names].reverse()) sql.exec(`DELETE FROM "${name}"`);
  for (const name of names) {
    const table = backup.tables[name], secret = SECRET[name] || [];
    const columns = [...table.columns, ...secret];
    const statement = `INSERT INTO "${name}"(${columns.map(column => `"${column}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
    for (const row of table.rows) {
      // Accounts the target does not know get credentials nobody can use until administration resets them.
      const kept = secret.length ? credentials.get(String(row[table.columns.indexOf("id")])) : undefined;
      const extra = secret.map(column => kept ? kept[column as "password_salt" | "password_hash"] : column === "password_salt" ? crypto.randomUUID() : "!");
      sql.exec(statement, ...row.map(raw), ...extra);
    }
  }
  sql.exec("DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)");
  sql.exec("DELETE FROM group_access_sessions WHERE group_id NOT IN (SELECT id FROM course_groups) OR (learner_id IS NOT NULL AND learner_id NOT IN (SELECT id FROM group_learners))");
  for (const name of names) if (canonical(read(sql, name, backup.tables[name].columns)) !== canonical(backup.tables[name])) throw new RestoreError(`La tabla ${name} no quedó igual a la copia.`);
  return Object.fromEntries(names.map(name => [name, backup.tables[name].rows.length]));
}

export class RestoreError extends Error {}
