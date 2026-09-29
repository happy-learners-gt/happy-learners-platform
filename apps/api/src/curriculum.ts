import type { Database } from "./storage";
import type { Level, Member, Unit } from "@happy-learners/contracts";

export async function curriculum(path: string, method: string, input: unknown, current: Member, db: Database) {
  const result = (data: unknown, status = 200) => Response.json(data, { status });
  const levels = (await db.prepare("SELECT id,name,description,position,status,updated_at AS updatedAt FROM levels WHERE organization_id=? ORDER BY position,id").bind(current.organizationId).all<Level>()).results;
  const units = (await db.prepare("SELECT u.id,u.level_id AS levelId,u.name,u.objective,u.position,u.status,u.updated_at AS updatedAt FROM units u JOIN levels l ON l.id=u.level_id WHERE l.organization_id=? ORDER BY u.position,u.id").bind(current.organizationId).all<Unit>()).results;
  if (method === "GET") return result({ levels, units });
  if (current.role !== "educator") return result({ error: "Solo educadores pueden modificar el currículo." }, 403);
  if (!input || typeof input !== "object") return result({ error: "Completa el formulario." }, 400);
  const v = input as Record<string, unknown>;
  const kind = path.split("/")[2]; const id = path.split("/")[3];
  const isLevel = kind === "levels"; const table = isLevel ? "levels" : "units";
  const rows = isLevel ? levels : units;
  if (id === "order") {
    const selected = isLevel ? levels : units.filter(u => u.levelId === v.levelId);
    if (!isLevel && !levels.some(l => l.id === v.levelId)) return result({ error: "Nivel no disponible." }, 404);
    if (!Array.isArray(v.ids) || v.ids.length !== selected.length || new Set(v.ids).size !== selected.length || v.ids.some(x => !selected.some(row => row.id === x))) return result({ error: "El orden debe incluir todos los elementos una sola vez." }, 400);
    await db.batch(v.ids.map((item, position) => db.prepare(`UPDATE ${table} SET position=?,updated_at=? WHERE id=?`).bind(position, new Date().toISOString(), String(item))));
    return result({ ok: true });
  }
  if (id && !rows.some(row => row.id === id)) return result({ error: "Elemento no disponible." }, 404);
  const detail = isLevel ? "description" : "objective";
  if (typeof v.name !== "string" || !v.name.trim() || v.name.length > 100 || typeof v[detail] !== "string" || (v[detail] as string).length > 1000) return result({ error: "Escribe un nombre (hasta 100 caracteres) y una descripción u objetivo (hasta 1000)." }, 400);
  const status = String(v.status || "active");
  if (!(isLevel ? ["draft", "active", "archived"] : ["active", "archived"]).includes(status)) return result({ error: "Estado inválido." }, 400);
  const now = new Date().toISOString(); const itemId = id || `${isLevel ? "level" : "unit"}-${crypto.randomUUID()}`;
  if (isLevel) {
    if (id) await db.prepare("UPDATE levels SET name=?,description=?,status=?,updated_at=? WHERE id=? AND organization_id=?").bind(v.name.trim(), v.description as string, status, now, id, current.organizationId).run();
    else await db.prepare("INSERT INTO levels VALUES (?,?,?,?,?,?,?)").bind(itemId, current.organizationId, v.name.trim(), v.description as string, levels.length, status, now).run();
  } else {
    const parent = levels.find(l => l.id === v.levelId);
    if (!parent || parent.status === "archived") return result({ error: "Selecciona un nivel disponible." }, 400);
    const old = units.find(u => u.id === id);
    if (old && old.levelId !== v.levelId) return result({ error: "La unidad conserva su nivel; edita su nombre, objetivo u orden." }, 400);
    if (id) await db.prepare("UPDATE units SET name=?,objective=?,status=?,updated_at=? WHERE id=?").bind(v.name.trim(), v.objective as string, status, now, id).run();
    else await db.prepare("INSERT INTO units VALUES (?,?,?,?,?,?,?)").bind(itemId, parent.id, v.name.trim(), v.objective as string, units.filter(u => u.levelId === parent.id).length, status, now).run();
  }
  return result({ id: itemId }, id ? 200 : 201);
}
