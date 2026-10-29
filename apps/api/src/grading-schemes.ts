import type { GradingScheme, Member, OrganizationGradingScheme } from "@happy-learners/contracts";
import { schemeInput, schemeTemplates } from "@happy-learners/domain";
import type { Database } from "./storage";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const collectionPath = "/api/grading-schemes";
const itemPath = /^\/api\/grading-schemes\/(scheme-[a-f0-9-]{36})$/;
const templatePath = /^\/api\/grading-schemes\/templates\/([a-z0-9-]+)$/;

export function gradingSchemeMethods(path: string): string[] | null {
  if (path === collectionPath) return ["GET", "POST"];
  if (itemPath.test(path)) return ["PUT", "DELETE"];
  if (templatePath.test(path)) return ["POST"];
  return null;
}

type Row = {
  id: string; name: string; config: string; builtin: number; status: "active" | "archived";
  createdAt: string; updatedAt: string;
};
const view = (row: Row): OrganizationGradingScheme => ({
  ...(JSON.parse(row.config) as GradingScheme),
  id: row.id,
  name: row.name,
  builtin: !!row.builtin,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export async function gradingSchemesFor(db: Database, organizationId: string) {
  const rows = (await db.prepare(`SELECT id,name,config,builtin,status,created_at AS createdAt,updated_at AS updatedAt
    FROM grading_schemes WHERE organization_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,name COLLATE NOCASE,id`)
    .bind(organizationId).all<Row>()).results;
  return rows.map(view);
}

function checkedScheme(input: unknown, id: string): GradingScheme | { error: string } {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const config = raw.config && typeof raw.config === "object" ? raw.config as Record<string, unknown> : raw;
  return schemeInput({ ...config, id });
}

export async function gradingSchemesApi(path: string, method: string, input: unknown, current: Member, db: Database) {
  if (method === "GET") return reply({ schemes: await gradingSchemesFor(db, current.organizationId) });
  if (current.role !== "admin") return reply({ error: "Solo administración configura los esquemas de evaluación." }, 403);
  const now = new Date().toISOString();
  const template = templatePath.exec(path);
  if (template) {
    const source = schemeTemplates.find(item => item.id === template[1]);
    if (!source) return reply({ error: "Esa plantilla de evaluación no está disponible." }, 404);
    const id = `scheme-${crypto.randomUUID()}`;
    const nameKey = source.name.toLocaleLowerCase("es");
    const config = { ...source, id };
    const created = await db.prepare(`INSERT INTO grading_schemes(id,organization_id,name,name_key,config,builtin,status,created_at,updated_at)
      VALUES (?,?,?,?,?,1,'active',?,?) ON CONFLICT(organization_id,name_key) DO NOTHING RETURNING id`)
      .bind(id, current.organizationId, source.name, nameKey, JSON.stringify(config), now, now).first();
    if (!created) return reply({ error: "Ya existe un esquema con ese nombre." }, 409);
    return reply({ scheme: (await gradingSchemesFor(db, current.organizationId)).find(item => item.id === id) }, 201);
  }
  if (path === collectionPath) {
    const id = `scheme-${crypto.randomUUID()}`;
    const checked = checkedScheme(input, id);
    if ("error" in checked) return reply(checked, 400);
    const created = await db.prepare(`INSERT INTO grading_schemes(id,organization_id,name,name_key,config,builtin,status,created_at,updated_at)
      VALUES (?,?,?,?,?,0,'active',?,?) ON CONFLICT(organization_id,name_key) DO NOTHING RETURNING id`)
      .bind(id, current.organizationId, checked.name, checked.name.toLocaleLowerCase("es"), JSON.stringify(checked), now, now).first();
    if (!created) return reply({ error: "Ya existe un esquema con ese nombre." }, 409);
    return reply({ scheme: (await gradingSchemesFor(db, current.organizationId)).find(item => item.id === id) }, 201);
  }
  const id = itemPath.exec(path)![1];
  const existing = (await gradingSchemesFor(db, current.organizationId)).find(item => item.id === id);
  if (!existing) return reply({ error: "El esquema de evaluación no está disponible." }, 404);
  if (method === "DELETE") {
    const used = await db.prepare(`SELECT 1 AS found FROM courses WHERE organization_id=? AND json_extract(settings,'$.gradingSchemeId')=?
      UNION ALL SELECT 1 FROM study_programs WHERE organization_id=? AND json_extract(settings,'$.gradingSchemeId')=? LIMIT 1`)
      .bind(current.organizationId, id, current.organizationId, id).first();
    if (used) await db.prepare("UPDATE grading_schemes SET status='archived',updated_at=? WHERE id=? AND organization_id=?").bind(now, id, current.organizationId).run();
    else await db.prepare("DELETE FROM grading_schemes WHERE id=? AND organization_id=?").bind(id, current.organizationId).run();
    return reply({ ok: true, archived: !!used });
  }
  const checked = checkedScheme(input, id);
  if ("error" in checked) return reply(checked, 400);
  const updated = await db.prepare(`UPDATE grading_schemes SET name=?,name_key=?,config=?,updated_at=? WHERE id=? AND organization_id=?
    AND NOT EXISTS (SELECT 1 FROM grading_schemes WHERE organization_id=? AND name_key=? AND id<>?) RETURNING id`)
    .bind(checked.name, checked.name.toLocaleLowerCase("es"), JSON.stringify(checked), now, id, current.organizationId, current.organizationId, checked.name.toLocaleLowerCase("es"), id).first();
  if (!updated) return reply({ error: "Ya existe un esquema con ese nombre." }, 409);
  return reply({ scheme: (await gradingSchemesFor(db, current.organizationId)).find(item => item.id === id) });
}
