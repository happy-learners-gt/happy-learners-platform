import { DurableObject } from "cloudflare:workers";
import migration from "../../../database/migrations/0001_sprint_one.sql";
import catalogMigration from "../../../database/migrations/0002_catalog.sql";

type Statement = { sql: string; values: (string | number | null)[] };
// One SQLite object per organization; only the Worker holds this binding.
export class OrganizationStore extends DurableObject<Env> {
  async query(scope: string, statements: Statement[]): Promise<Record<string, unknown>[][]> {
    if (!["org-demo", "org-other"].includes(scope)) throw new Error("Invalid organization");
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
        this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (1,?)", scope);
        this.ctx.storage.sql.exec(catalogMigration);
        this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (2,?)", scope);
      } else if (applied[0].organization_id !== scope) throw new Error("Organization mismatch");
      if (applied.length && applied[0].version < 2) { this.ctx.storage.sql.exec(catalogMigration); this.ctx.storage.sql.exec("INSERT INTO schema_migrations VALUES (2,?)", scope); }
      return statements.map(statement => this.ctx.storage.sql.exec(statement.sql, ...statement.values).toArray());
    });
  }
}
class Prepared {
  values: (string | number | null)[] = [];
  constructor(public db: Database, public sql: string) {}
  bind(...values: (string | number | null)[]) { this.values = values; return this; }
  async all<T>() { return { results: (await this.db.execute([this]))[0] as T[] }; }
  async first<T>() { return (await this.all<T>()).results[0] || null; }
  async run() { await this.db.execute([this]); }
}
export class Database {
  constructor(private stub: DurableObjectStub<OrganizationStore>, private scope: string) {}
  prepare(sql: string) { return new Prepared(this, sql); }
  execute(statements: Prepared[]) { return this.stub.query(this.scope, statements.map(({ sql, values }) => ({ sql, values }))); }
  batch(statements: Prepared[]) { return this.execute(statements); }
}
export function database(env: Env, scope: string) { return new Database(env.ORGANIZATIONS.getByName(scope), scope); }
