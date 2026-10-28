import type {
  CalendarCategory, CalendarScope, DateRule, InstitutionalCalendar, InstitutionalCalendarEvent,
  InstitutionalCalendarRule, Member,
} from "@happy-learners/contracts";
import { breakInput, generateYear, grantedIn, guatemalaTemplate, isCalendarDay, ruleInput } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { reapplyCalendar } from "./classes";
import { event as activityEvent } from "./team";

const reply = (value: unknown, status = 200) => Response.json(value, { status });
const calendarPath = /^\/api\/calendars\/(calendar-[a-z0-9-]+)\/(rules|events)(?:\/((?:rule|event)-[a-z0-9-]+))?$/;
const generationPath = /^\/api\/calendars\/(calendar-[a-z0-9-]+)\/years\/(\d{4})\/generate$/;
const templatePath = /^\/api\/calendars\/(calendar-[a-z0-9-]+)\/templates\/guatemala$/;

export function institutionalCalendarMethods(path: string): string[] | null {
  if (path === "/api/calendars" || path === "/api/calendars/view") return ["GET"];
  const item = calendarPath.exec(path);
  if (item) return item[3] ? ["PUT", "DELETE"] : ["POST"];
  if (generationPath.test(path) || templatePath.test(path)) return ["POST"];
  return null;
}

const calendarColumns = "id,scope,scope_id AS scopeId,name,created_at AS createdAt,updated_at AS updatedAt";
const categoryColumns = "id,key,label,no_class_default AS noClassDefault,builtin";
const eventColumns = `e.id,e.calendar_id AS calendarId,e.category_id AS categoryId,e.title,e.starts_on AS "from",e.ends_on AS until,
  e.part,e.no_class AS noClass,e.rule_id AS ruleId,e.year,e.status,e.created_at AS createdAt,e.updated_at AS updatedAt`;

async function ensureCalendars(db: Database, organizationId: string) {
  const now = new Date().toISOString();
  const [programs, sections] = await Promise.all([
    db.prepare("SELECT id,name FROM study_programs WHERE organization_id=? AND status='active'").bind(organizationId).all<{ id: string; name: string }>(),
    db.prepare("SELECT id,name FROM course_groups WHERE organization_id=? AND status='active'").bind(organizationId).all<{ id: string; name: string }>(),
  ]);
  const wanted = [
    { scope: "organization" as const, scopeId: null, name: "Calendario institucional" },
    ...programs.results.map(row => ({ scope: "program" as const, scopeId: row.id, name: `Calendario de ${row.name}` })),
    ...sections.results.map(row => ({ scope: "section" as const, scopeId: row.id, name: `Calendario de ${row.name}` })),
  ];
  const existing = (await db.prepare("SELECT scope,scope_id AS scopeId FROM calendars WHERE organization_id=?").bind(organizationId).all<{ scope: CalendarScope; scopeId: string | null }>()).results;
  const missing = wanted.filter(item => !existing.some(row => row.scope === item.scope && row.scopeId === item.scopeId));
  if (missing.length) await db.batch(missing.map(item => db.prepare("INSERT INTO calendars(id,organization_id,scope,scope_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .bind(`calendar-${crypto.randomUUID()}`, organizationId, item.scope, item.scopeId, item.name, now, now)));
}

async function categories(db: Database, organizationId: string) {
  return (await db.prepare(`SELECT ${categoryColumns} FROM calendar_categories WHERE organization_id=? ORDER BY rowid`).bind(organizationId)
    .all<Omit<CalendarCategory, "noClassDefault" | "builtin"> & { noClassDefault: number; builtin: number }>()).results
    .map(item => ({ ...item, noClassDefault: !!item.noClassDefault, builtin: !!item.builtin }));
}

async function calendarOf(db: Database, organizationId: string, id: string) {
  return db.prepare(`SELECT ${calendarColumns} FROM calendars WHERE id=? AND organization_id=?`).bind(id, organizationId)
    .first<InstitutionalCalendar & { createdAt: string; updatedAt: string }>();
}

async function mayWrite(db: Database, current: Member, calendar: InstitutionalCalendar) {
  if (current.role === "admin") return true;
  if (calendar.scope === "organization") return false;
  const programId = calendar.scope === "program" ? calendar.scopeId : (await db.prepare(`SELECT c.program_id AS programId FROM course_groups g JOIN courses c ON c.id=g.course_id
    WHERE g.id=? AND g.organization_id=?`).bind(calendar.scopeId, current.organizationId).first<{ programId: string | null }>())?.programId;
  return grantedIn(current.permissions, programId || null).has("sections.assign");
}

async function requireCalendar(db: Database, current: Member, id: string, write = false): Promise<{ response: Response } | { calendar: InstitutionalCalendar }> {
  const calendar = await calendarOf(db, current.organizationId, id);
  if (!calendar) return { response: reply({ error: "Calendario no disponible." }, 404) };
  if (write && !await mayWrite(db, current, calendar)) return { response: reply({ error: "No tienes permiso para gestionar este calendario." }, 403) };
  return { calendar };
}

async function rulesOf(db: Database, organizationId: string, calendarId: string) {
  const rows = (await db.prepare(`SELECT id,calendar_id AS calendarId,category_id AS categoryId,rule,no_class AS noClass,created_at AS createdAt,updated_at AS updatedAt
    FROM calendar_rules WHERE organization_id=? AND calendar_id=? ORDER BY json_extract(rule,'$.title'),id`).bind(organizationId, calendarId)
    .all<Omit<InstitutionalCalendarRule, "rule" | "noClass"> & { rule: string; noClass: number }>()).results;
  return rows.map(row => ({ ...row, rule: JSON.parse(row.rule) as DateRule, noClass: !!row.noClass }));
}

async function eventsOf(db: Database, organizationId: string, where: string, values: (string | number | null)[]) {
  const rows = (await db.prepare(`SELECT ${eventColumns} FROM calendar_events e ${where} ORDER BY e.starts_on,e.ends_on,e.title`).bind(organizationId, ...values)
    .all<Omit<InstitutionalCalendarEvent, "noClass"> & { noClass: number }>()).results;
  return rows.map(row => ({ ...row, noClass: !!row.noClass }));
}

function eventInput(input: unknown, current?: InstitutionalCalendarEvent) {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const dates = breakInput({ title: value.title ?? current?.title, from: value.from ?? value.startsOn ?? current?.from, until: value.until ?? value.endsOn ?? current?.until });
  if ("error" in dates) return dates;
  const part = value.part ?? current?.part ?? "full";
  if (!["full", "morning", "afternoon"].includes(String(part))) return { error: "Elige día completo, mañana o tarde." };
  const status = value.status ?? current?.status ?? "active";
  if (!["active", "skipped"].includes(String(status))) return { error: "Elige si el evento está activo o se omite." };
  const categoryId = typeof value.categoryId === "string" ? value.categoryId : current?.categoryId;
  if (!categoryId) return { error: "Elige una categoría." };
  return { ...dates, categoryId, part: part as InstitutionalCalendarEvent["part"], status: status as InstitutionalCalendarEvent["status"], noClass: value.noClass === undefined ? current?.noClass ?? false : value.noClass === true };
}

async function categoryIn(db: Database, organizationId: string, id: string) {
  return db.prepare("SELECT id,no_class_default AS noClassDefault FROM calendar_categories WHERE id=? AND organization_id=?").bind(id, organizationId).first<{ id: string; noClassDefault: number }>();
}

const audit = (db: Database, current: Member, action: "created" | "updated" | "archived", calendar: InstitutionalCalendar, summary: string) =>
  activityEvent(db, current, { action, targetType: "program", targetId: calendar.id, summary });

async function reapply(current: Member, db: Database, calendar: InstitutionalCalendar, from: string, until: string, title: string) {
  return reapplyCalendar(current, db, calendar.scope, calendar.scopeId, from, until, `Cambió el calendario: ${title}`);
}

async function ruleRoute(method: string, input: unknown, id: string | undefined, calendar: InstitutionalCalendar, current: Member, db: Database) {
  if (method === "DELETE") {
    const found = await db.prepare("SELECT id,no_class AS noClass FROM calendar_rules WHERE id=? AND calendar_id=? AND organization_id=?").bind(id!, calendar.id, current.organizationId).first<{ id: string; noClass: number }>();
    if (!found) return reply({ error: "Regla no disponible." }, 404);
    const generated = await eventsOf(db, current.organizationId, "WHERE e.organization_id=? AND e.rule_id=?", [id!]);
    await db.batch([
      db.prepare("DELETE FROM calendar_events WHERE rule_id=? AND organization_id=?").bind(id!, current.organizationId),
      db.prepare("DELETE FROM calendar_rules WHERE id=? AND organization_id=?").bind(id!, current.organizationId),
      audit(db, current, "archived", calendar, "Eliminó una regla del calendario"),
    ]);
    for (const event of generated.filter(item => item.noClass)) await reapply(current, db, calendar, event.from, event.until, event.title);
    return reply({ ok: true });
  }
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const rowId = id || `rule-${crypto.randomUUID()}`;
  const raw = value.rule && typeof value.rule === "object" ? value.rule as Record<string, unknown> : value;
  const rule = ruleInput({ ...raw, id: rowId });
  if ("error" in rule) return reply(rule, 400);
  const categoryId = typeof value.categoryId === "string" ? value.categoryId : null;
  const category = categoryId && await categoryIn(db, current.organizationId, categoryId);
  if (!category) return reply({ error: "Elige una categoría de tu organización." }, 400);
  const noClass = value.noClass === undefined ? !!category.noClassDefault : value.noClass === true;
  const now = new Date().toISOString();
  if (!id) {
    await db.batch([
      db.prepare("INSERT INTO calendar_rules(id,calendar_id,organization_id,category_id,rule,no_class,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(rowId, calendar.id, current.organizationId, categoryId, JSON.stringify(rule), noClass ? 1 : 0, current.id, now, now),
      audit(db, current, "created", calendar, `Agregó la regla «${rule.title}» al calendario`),
    ]);
    return reply({ rule: (await rulesOf(db, current.organizationId, calendar.id)).find(item => item.id === rowId) }, 201);
  }
  const found = await db.prepare("SELECT id FROM calendar_rules WHERE id=? AND calendar_id=? AND organization_id=?").bind(id, calendar.id, current.organizationId).first();
  if (!found) return reply({ error: "Regla no disponible." }, 404);
  await db.batch([
    db.prepare("UPDATE calendar_rules SET category_id=?,rule=?,no_class=?,updated_at=? WHERE id=? AND organization_id=?")
      .bind(categoryId, JSON.stringify(rule), noClass ? 1 : 0, now, id, current.organizationId),
    audit(db, current, "updated", calendar, `Actualizó la regla «${rule.title}» del calendario`),
  ]);
  return reply({ rule: (await rulesOf(db, current.organizationId, calendar.id)).find(item => item.id === id) });
}

async function eventRoute(method: string, input: unknown, id: string | undefined, calendar: InstitutionalCalendar, current: Member, db: Database) {
  const existing = id ? (await eventsOf(db, current.organizationId, "WHERE e.organization_id=? AND e.id=? AND e.calendar_id=?", [id, calendar.id]))[0] : undefined;
  if (id && !existing) return reply({ error: "Evento no disponible." }, 404);
  if (method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM calendar_events WHERE id=? AND organization_id=?").bind(id!, current.organizationId),
      audit(db, current, "archived", calendar, `Eliminó «${existing!.title}» del calendario`),
    ]);
    const changed = existing!.noClass ? await reapply(current, db, calendar, existing!.from, existing!.until, existing!.title) : {};
    return reply({ ok: true, ...changed });
  }
  const value = eventInput(input, existing);
  if ("error" in value) return reply(value, 400);
  const category = await categoryIn(db, current.organizationId, value.categoryId);
  if (!category) return reply({ error: "Elige una categoría de tu organización." }, 400);
  const now = new Date().toISOString();
  if (!id) {
    id = `event-${crypto.randomUUID()}`;
    await db.batch([
      db.prepare("INSERT INTO calendar_events(id,calendar_id,organization_id,category_id,title,starts_on,ends_on,part,no_class,rule_id,year,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,?,?,?,?)")
        .bind(id, calendar.id, current.organizationId, value.categoryId, value.title, value.from, value.until, value.part, value.noClass ? 1 : 0, value.status, current.id, now, now),
      audit(db, current, "created", calendar, `Agregó «${value.title}» al calendario`),
    ]);
  } else {
    await db.batch([
      db.prepare("UPDATE calendar_events SET category_id=?,title=?,starts_on=?,ends_on=?,part=?,no_class=?,status=?,updated_at=? WHERE id=? AND organization_id=?")
        .bind(value.categoryId, value.title, value.from, value.until, value.part, value.noClass ? 1 : 0, value.status, now, id, current.organizationId),
      audit(db, current, "updated", calendar, `Actualizó «${value.title}» en el calendario`),
    ]);
  }
  let changed = {};
  if (value.noClass || existing?.noClass) {
    const from = existing && existing.from < value.from ? existing.from : value.from;
    const until = existing && existing.until > value.until ? existing.until : value.until;
    changed = await reapply(current, db, calendar, from, until, value.title);
  }
  const saved = (await eventsOf(db, current.organizationId, "WHERE e.organization_id=? AND e.id=?", [id]))[0];
  return reply({ event: saved, ...changed }, existing ? 200 : 201);
}

async function generate(calendar: InstitutionalCalendar, year: number, preview: boolean, current: Member, db: Database) {
  if (year < 1583 || year > 4099) return reply({ error: "El año debe estar entre 1583 y 4099." }, 400);
  const rules = await rulesOf(db, current.organizationId, calendar.id);
  const existing = await eventsOf(db, current.organizationId, "WHERE e.organization_id=? AND e.calendar_id=? AND e.year=?", [calendar.id, year]);
  const sourceById = new Map(rules.map(rule => [rule.id, rule]));
  const plan = generateYear(rules, year, existing.map(item => ({
    ...item,
    manual: !!item.ruleId && item.updatedAt! > sourceById.get(item.ruleId)!.updatedAt!,
  })));
  if (preview) return reply({ plan });
  const now = new Date().toISOString();
  const writes: Prepared[] = [];
  for (const item of plan.create) {
    const source = sourceById.get(item.ruleId!)!;
    writes.push(db.prepare("INSERT INTO calendar_events(id,calendar_id,organization_id,category_id,title,starts_on,ends_on,part,no_class,rule_id,year,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(`event-${crypto.randomUUID()}`, calendar.id, current.organizationId, item.categoryId!, item.title, item.from, item.until, item.part, item.noClass ? 1 : 0, item.ruleId, year, "active", current.id, now, source.updatedAt || now));
  }
  for (const item of plan.update) {
    const source = sourceById.get(item.ruleId!)!;
    writes.push(db.prepare("UPDATE calendar_events SET category_id=?,title=?,starts_on=?,ends_on=?,part=?,no_class=?,status='active',updated_at=? WHERE id=? AND organization_id=?")
      .bind(item.categoryId!, item.title, item.from, item.until, item.part, item.noClass ? 1 : 0, source.updatedAt || now, item.id, current.organizationId));
  }
  writes.push(audit(db, current, "created", calendar, `Generó ${year}: ${plan.create.length} nuevos, ${plan.update.length} actualizados y ${plan.keep.length} conservados`));
  await db.batch(writes);
  for (const item of [...plan.create, ...plan.update].filter(event => event.noClass)) await reapply(current, db, calendar, item.from, item.until, item.title);
  return reply({ plan, applied: { created: plan.create.length, updated: plan.update.length, kept: plan.keep.length } });
}

async function addGuatemala(calendar: InstitutionalCalendar, current: Member, db: Database) {
  const category = await db.prepare("SELECT id FROM calendar_categories WHERE organization_id=? AND key='holiday'").bind(current.organizationId).first<{ id: string }>();
  const existing = await rulesOf(db, current.organizationId, calendar.id);
  const known = new Set(existing.map(item => item.rule.title.toLocaleLowerCase("es")));
  const now = new Date().toISOString(), created: InstitutionalCalendarRule[] = [];
  const writes: Prepared[] = [];
  for (const template of guatemalaTemplate.filter(rule => !known.has(rule.title.toLocaleLowerCase("es")))) {
    const id = `rule-${crypto.randomUUID()}`, rule = { ...template, id };
    writes.push(db.prepare("INSERT INTO calendar_rules(id,calendar_id,organization_id,category_id,rule,no_class,created_by,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?,?)")
      .bind(id, calendar.id, current.organizationId, category!.id, JSON.stringify(rule), current.id, now, now));
    created.push({ id, calendarId: calendar.id, categoryId: category!.id, rule, noClass: true, createdAt: now, updatedAt: now });
  }
  if (writes.length) {
    writes.push(audit(db, current, "created", calendar, `Agregó ${writes.length} reglas de la plantilla de Guatemala`));
    await db.batch(writes);
  }
  return reply({ rules: created, added: created.length });
}

export async function institutionalCalendars(path: string, method: string, input: unknown, url: URL, current: Member, db: Database) {
  if (path === "/api/calendars") {
    await ensureCalendars(db, current.organizationId);
    const calendars = (await db.prepare(`SELECT ${calendarColumns} FROM calendars WHERE organization_id=? ORDER BY CASE scope WHEN 'organization' THEN 0 WHEN 'program' THEN 1 ELSE 2 END,name`)
      .bind(current.organizationId).all<InstitutionalCalendar>()).results;
    return reply({ calendars, categories: await categories(db, current.organizationId) });
  }
  if (path === "/api/calendars/view") {
    const from = url.searchParams.get("from"), until = url.searchParams.get("until");
    if (!isCalendarDay(from) || !isCalendarDay(until) || until < from) return reply({ error: "Indica un rango de fechas válido." }, 400);
    const program = url.searchParams.get("program"), section = url.searchParams.get("section");
    const sectionRow = section ? await db.prepare(`SELECT g.id,c.program_id AS programId FROM course_groups g JOIN courses c ON c.id=g.course_id
      WHERE g.id=? AND g.organization_id=?`).bind(section, current.organizationId).first<{ id: string; programId: string | null }>() : null;
    if (section && !sectionRow) return reply({ error: "Sección no disponible." }, 404);
    if (program && !await db.prepare("SELECT id FROM study_programs WHERE id=? AND organization_id=?").bind(program, current.organizationId).first()) return reply({ error: "Programa no disponible." }, 404);
    const effectiveProgram = sectionRow?.programId || program;
    const scope = `AND (c.scope='organization'${effectiveProgram ? " OR (c.scope='program' AND c.scope_id=?)" : ""}${section ? " OR (c.scope='section' AND c.scope_id=?)" : ""})`;
    const values = [...(effectiveProgram ? [effectiveProgram] : []), ...(section ? [section] : []), from, until];
    const rows = (await db.prepare(`SELECT ${eventColumns},c.scope,c.scope_id AS scopeId,c.name AS calendarName,k.key AS categoryKey,k.label AS categoryLabel
      FROM calendar_events e JOIN calendars c ON c.id=e.calendar_id JOIN calendar_categories k ON k.id=e.category_id
      WHERE e.organization_id=? ${scope} AND e.ends_on>=? AND e.starts_on<=? ORDER BY e.starts_on,e.title`).bind(current.organizationId, ...values)
      .all<Omit<InstitutionalCalendarEvent, "noClass"> & { noClass: number }>()).results.map(row => ({ ...row, noClass: !!row.noClass }));
    return reply({ events: rows, from, until });
  }
  const item = calendarPath.exec(path);
  const generation = generationPath.exec(path);
  const template = templatePath.exec(path);
  const calendarId = item?.[1] || generation?.[1] || template?.[1];
  const found = await requireCalendar(db, current, calendarId!, true);
  if ("response" in found) return found.response;
  if (item?.[2] === "rules") return ruleRoute(method, input, item[3], found.calendar, current, db);
  if (item?.[2] === "events") return eventRoute(method, input, item[3], found.calendar, current, db);
  if (generation) return generate(found.calendar, Number(generation[2]), url.searchParams.get("preview") === "1", current, db);
  if (template) return addGuatemala(found.calendar, current, db);
  return reply({ error: "Ruta no disponible." }, 404);
}
