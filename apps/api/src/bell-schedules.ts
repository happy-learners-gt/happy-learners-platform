import type { BellSchedule, Member } from "@happy-learners/contracts";
import { bellBlocks, bellScheduleInput, maxBellSchedules } from "@happy-learners/domain";
import type { Database } from "./storage";

/**
 * The organization's bell schedules (jornadas, 1.2.4): GET /api/bell-schedules lists them for every member (a section's
 * schedule takes its meetings from their blocks); administration creates them (POST), edits them (PUT /:id) and
 * removes them (DELETE /:id). Blocks are generated from the configuration on the server. Removing a jornada leaves
 * the sections' schedules as they are: a meeting keeps its time.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const itemPath = /^\/api\/bell-schedules\/(bell-[a-f0-9-]{36})$/;

export function bellScheduleMethods(path: string): string[] | null {
  if (path === "/api/bell-schedules") return ["GET", "POST"];
  return itemPath.test(path) ? ["PUT", "DELETE"] : null;
}

type Row = { id: string; name: string; weekdays: string; config: string; blocks: string; updatedAt: string };
const toSchedule = (row: Row): BellSchedule => ({ id: row.id, name: row.name, weekdays: row.weekdays.split(",").map(Number), config: JSON.parse(row.config), blocks: JSON.parse(row.blocks), updatedAt: row.updatedAt });
async function list(db: Database, organizationId: string) {
  return (await db.prepare("SELECT id,name,weekdays,config,blocks,updated_at AS updatedAt FROM bell_schedules WHERE organization_id=? ORDER BY lower(name),id").bind(organizationId).all<Row>()).results.map(toSchedule);
}
const taken = async (db: Database, organizationId: string, name: string, id?: string) =>
  !!(await db.prepare(`SELECT 1 AS found FROM bell_schedules WHERE organization_id=? AND lower(name)=lower(?)${id ? " AND id<>?" : ""}`).bind(organizationId, name, ...(id ? [id] : [])).first());

export async function bellSchedulesApi(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  if (method === "GET") return reply({ schedules: await list(db, current.organizationId) });
  if (current.role !== "admin") return reply({ error: "Solo administración configura las jornadas." }, 403);
  const id = itemPath.exec(path)?.[1];
  const found = id ? await db.prepare("SELECT id,name FROM bell_schedules WHERE id=? AND organization_id=?").bind(id, current.organizationId).first<{ id: string; name: string }>() : null;
  if (id && !found) return reply({ error: "Jornada no disponible." }, 404);
  const now = new Date().toISOString();
  if (method === "DELETE") {
    await db.prepare("DELETE FROM bell_schedules WHERE id=? AND organization_id=?").bind(id!, current.organizationId).run();
    return reply({ schedules: await list(db, current.organizationId) });
  }
  const draft = bellScheduleInput(input);
  if ("error" in draft) return reply(draft, 400);
  if (await taken(db, current.organizationId, draft.name, id)) return reply({ error: `Ya hay una jornada llamada «${draft.name}».` }, 409);
  const blocks = JSON.stringify(bellBlocks(draft.config)), config = JSON.stringify(draft.config);
  if (!id) {
    const count = (await db.prepare("SELECT count(*) AS total FROM bell_schedules WHERE organization_id=?").bind(current.organizationId).first<{ total: number }>())!.total;
    if (count >= maxBellSchedules) return reply({ error: `La organización tiene hasta ${maxBellSchedules} jornadas.` }, 409);
  }
  await (id
      ? db.prepare("UPDATE bell_schedules SET name=?,weekdays=?,config=?,blocks=?,updated_at=? WHERE id=? AND organization_id=?").bind(draft.name, draft.weekdays.join(","), config, blocks, now, id, current.organizationId)
      : db.prepare("INSERT INTO bell_schedules(id,organization_id,name,weekdays,config,blocks,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(`bell-${crypto.randomUUID()}`, current.organizationId, draft.name, draft.weekdays.join(","), config, blocks, current.id, now, now)).run();
  return reply({ schedules: await list(db, current.organizationId) }, id ? 200 : 201);
}
