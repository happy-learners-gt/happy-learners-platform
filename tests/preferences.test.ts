import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calendarFeed, canonicalLocale, digestMessage, effectivePreferences, emailPlan, inQuietHours, lockedBy, nextDigestAt, notificationPreferencesInput, optionalNotificationCap,
  orderedWeekdays, quietHoursEnd, receivesOn, userPreferencesInput, wallTimeIn, weekdays,
} from "../packages/domain/src/index";
import type { MailMessage, MailSender, NotificationType } from "../packages/domain/src/index";
import { deliverScheduled, notify, scheduleIntervalMs } from "../apps/api/src/notify";
import type { NotifyStore } from "../apps/api/src/notify";

// ST-160 and ST-161 (DEC-045): regional, appearance and notification preferences. Domain rules first, then the outbox
// queue on a real SQLite store with every migration, then the built Worker on a fresh store (no Brevo key).
describe("ST-160 regional and appearance rules", () => {
  it("validates only the preferences sent, refuses unknown keys and lets the regional ones go back to automatic", () => {
    expect(userPreferencesInput({ theme: "dark", textScale: 130, highContrast: true, motion: "reduce", density: "compact", homePage: "agenda" }))
      .toEqual({ preferences: { theme: "dark", textScale: 130, highContrast: true, motion: "reduce", density: "compact", homePage: "agenda" } });
    expect(userPreferencesInput({ locale: "pt-br", timezone: "America/Sao_Paulo", weekStart: 7, hourCycle: "h12", language: "es" }))
      .toEqual({ preferences: { locale: "pt-BR", timezone: "America/Sao_Paulo", weekStart: 7, hourCycle: "h12", language: "es" } });
    expect(userPreferencesInput({ locale: null, timezone: null, weekStart: null, hourCycle: null })).toEqual({ preferences: { locale: null, timezone: null, weekStart: null, hourCycle: null } });
    for (const bad of [null, {}, [], { theme: "sepia" }, { textScale: 99 }, { textScale: 151 }, { textScale: 120.5 }, { timezone: "Guatemala" }, { locale: "en_US" }, { locale: "zz-ZZZZZZZZZ" },
      { weekStart: 0 }, { weekStart: 8 }, { hourCycle: "h24" }, { language: "en" }, { homePage: "admin" }, { highContrast: "yes" }, { colour: "red" }])
      expect(userPreferencesInput(bad), JSON.stringify(bad)).toHaveProperty("error");
  });
  it("accepts any BCP 47 locale the runtime formats, in its canonical spelling", () => {
    expect(canonicalLocale("es-gt")).toBe("es-GT");
    expect(canonicalLocale("es-419")).toBe("es-419");
    expect(canonicalLocale("qu-PE")).toBe("qu-PE");
    for (const bad of ["", "es GT", "en_US", "<b>", 42, null]) expect(canonicalLocale(bad)).toBeNull();
  });
  it("fills what the person left empty from the organization (locale, zone) or the regional format (first day, hour cycle)", () => {
    const organization = { locale: "es-GT", timezone: "America/Guatemala" };
    expect(effectivePreferences(null, organization)).toMatchObject({ locale: "es-GT", timezone: "America/Guatemala", weekStart: 7, hourCycle: "h12", theme: "system", textScale: 100, chosen: { locale: null, timezone: null } });
    expect(effectivePreferences({ locale: "en-GB" }, organization)).toMatchObject({ locale: "en-GB", weekStart: 1, hourCycle: "h23", organization });
    expect(effectivePreferences({ locale: "es", weekStart: 6, hourCycle: "h12", timezone: "Europe/Madrid" }, organization)).toMatchObject({ weekStart: 6, hourCycle: "h12", timezone: "Europe/Madrid" });
    // A stored zone the runtime no longer knows falls back to the organization's.
    expect(effectivePreferences({ timezone: "Mars/Olympus" }, organization).timezone).toBe("America/Guatemala");
    expect(effectivePreferences(null, { locale: "es", timezone: "America/Guatemala" })).toMatchObject({ weekStart: 1, hourCycle: "h23" });
  });
  it("moves a class from the organization's zone to the person's, across days and daylight saving time", () => {
    expect(wallTimeIn("2026-10-16", "08:00", "America/Guatemala", "America/New_York")).toEqual({ day: "2026-10-16", time: "10:00", shifted: true });
    expect(wallTimeIn("2026-11-02", "08:00", "America/Guatemala", "America/New_York")).toEqual({ day: "2026-11-02", time: "09:00", shifted: true });
    expect(wallTimeIn("2026-10-16", "20:00", "America/Guatemala", "Asia/Tokyo")).toEqual({ day: "2026-10-17", time: "11:00", shifted: true });
    expect(wallTimeIn("2026-10-16", "08:00", "America/Guatemala", "America/Guatemala")).toEqual({ day: "2026-10-16", time: "08:00", shifted: false });
    expect(wallTimeIn("2026-10-16", null, "America/Guatemala", "Asia/Tokyo")).toEqual({ day: "2026-10-16", time: null, shifted: false });
  });
  it("orders the week from the person's first day", () => {
    expect(orderedWeekdays(weekdays, 1).map(([, name]) => name)).toEqual(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
    expect(orderedWeekdays(weekdays, 7).map(([day]) => day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(weekdays, 6)[0][1]).toBe("Sábado");
  });
  it("announces the person's zone in the calendar feed while classes keep the organization's", () => {
    const feed = calendarFeed({ name: "Mis clases", timezone: "America/Guatemala", displayTimezone: "Europe/Madrid", origin: "https://hl.test", now: new Date("2026-10-16T00:00:00Z"),
      classes: [{ id: "c1", groupId: "g", sessionDate: "2026-10-20", startsAt: "08:00", durationMinutes: 45, status: "planned", version: 1, updatedAt: null, courseTitle: "Arte", groupName: "A" }] });
    expect(feed).toContain("X-WR-TIMEZONE:Europe/Madrid");
    expect(feed).toContain("DTSTART:20261020T140000Z");
  });
});

describe("ST-161 notification channels, frequency and quiet hours", () => {
  it("locks the account and terms notices and the organization's mandatory ones; the rest follow each channel", () => {
    const policy = new Set<NotificationType>(["class_cancelled"]);
    expect(lockedBy("account_security", policy)).toBe("system");
    expect(lockedBy("class_cancelled", policy)).toBe("policy");
    expect(lockedBy("class_changed", policy)).toBeNull();
    const mine = { class_changed: { email: false }, terms_updated: { email: false, in_app: false }, class_cancelled: { in_app: false } };
    expect(receivesOn("class_changed", "email", mine, policy)).toBe(false);
    expect(receivesOn("class_changed", "in_app", mine, policy)).toBe(true);
    expect(receivesOn("terms_updated", "email", mine, policy)).toBe(true);
    expect(receivesOn("class_cancelled", "in_app", mine, policy)).toBe(true);
    expect(receivesOn("review_returned", "email", {}, policy)).toBe(true);
  });
  it("validates the matrix, the frequency, the digest time and the quiet hours", () => {
    expect(notificationPreferencesInput({ channels: { class_changed: { email: false }, review_returned: { in_app: false, email: true } }, frequency: "weekly", digestTime: "18:30", quietHours: { start: "22:00", end: "07:00" } }))
      .toEqual({ channels: { class_changed: { email: false }, review_returned: { in_app: false, email: true } }, frequency: "weekly", digestTime: "18:30", quietHours: { start: "22:00", end: "07:00" } });
    expect(notificationPreferencesInput({ quietHours: null })).toEqual({ quietHours: null });
    for (const bad of [null, {}, { channels: {} }, { channels: { nope: { email: false } } }, { channels: { class_changed: { sms: false } } }, { channels: { class_changed: { email: "no" } } },
      { frequency: "hourly" }, { digestTime: "7:00" }, { digestTime: "24:00" }, { quietHours: { start: "22:00", end: "22:00" } }, { quietHours: { start: "22:00" } }, { mandatory: true }])
      expect(notificationPreferencesInput(bad), JSON.stringify(bad)).toHaveProperty("error");
  });
  it("tells quiet hours that cross midnight and when they end in the person's zone", () => {
    const night = { start: "22:00", end: "07:00" };
    expect([inQuietHours("23:30", night), inQuietHours("06:59", night), inQuietHours("07:00", night), inQuietHours("21:59", night)]).toEqual([true, true, false, false]);
    expect(inQuietHours("13:30", { start: "13:00", end: "14:00" })).toBe(true);
    expect(inQuietHours("13:30", null)).toBe(false);
    // 23:00 in Guatemala (UTC−6) on the 15th ends at 07:00 of the 16th; 05:00 ends the same morning; 21:00 is not quiet.
    expect(quietHoursEnd(new Date("2026-10-16T05:00:00Z"), "America/Guatemala", night)?.toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(quietHoursEnd(new Date("2026-10-16T11:00:00Z"), "America/Guatemala", night)?.toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(quietHoursEnd(new Date("2026-10-16T03:00:00Z"), "America/Guatemala", night)).toBeNull();
  });
  it("places the next daily and weekly digest at the person's time and first day, after the quiet hours", () => {
    const now = new Date("2026-10-16T14:00:00Z"); // Friday 08:00 in Guatemala
    expect(nextDigestAt(now, "America/Guatemala", { frequency: "daily", digestTime: "07:00", quietHours: null }).toISOString()).toBe("2026-10-17T13:00:00.000Z");
    expect(nextDigestAt(now, "America/Guatemala", { frequency: "daily", digestTime: "18:00", quietHours: null }).toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(nextDigestAt(now, "America/Guatemala", { frequency: "weekly", digestTime: "07:00", quietHours: null }, 1).toISOString()).toBe("2026-10-19T13:00:00.000Z");
    expect(nextDigestAt(now, "America/Guatemala", { frequency: "weekly", digestTime: "07:00", quietHours: null }, 7).toISOString()).toBe("2026-10-18T13:00:00.000Z");
    expect(nextDigestAt(now, "America/Guatemala", { frequency: "daily", digestTime: "07:00", quietHours: { start: "06:00", end: "09:00" } }).toISOString()).toBe("2026-10-17T15:00:00.000Z");
  });
  it("sends mandatory notices at once, skips optional ones with «never», and schedules digests and quiet hours", () => {
    const base = { zone: "America/Guatemala", now: new Date("2026-10-16T05:00:00Z") };
    const settings = (frequency: "immediate" | "daily" | "weekly" | "never", quiet = false) => ({ frequency, digestTime: "07:00", quietHours: quiet ? { start: "22:00", end: "07:00" } : null });
    expect(emailPlan({ ...base, mandatory: true, settings: settings("never", true) })).toEqual({ action: "send" });
    expect(emailPlan({ ...base, mandatory: false, settings: settings("never") })).toEqual({ action: "skip" });
    expect(emailPlan({ ...base, mandatory: false, settings: settings("immediate") })).toEqual({ action: "send" });
    expect(emailPlan({ ...base, mandatory: false, settings: settings("immediate", true) })).toEqual({ action: "schedule", at: new Date("2026-10-16T13:00:00Z") });
    expect(emailPlan({ ...base, mandatory: false, settings: settings("daily") })).toEqual({ action: "schedule", at: new Date("2026-10-16T13:00:00Z") });
  });
  it("writes one digest e-mail grouped by notice, in Spanish, escaping what people wrote", () => {
    const message = digestMessage("p@example.test", { organization: "Colegio <Ficticio>", recipientName: "Paula", frequency: "daily", preferencesLink: "https://hl.test/preferencias#notificaciones", timezone: "America/Guatemala",
      items: [{ type: "class_changed", reason: "Cambió la clase del 2026-10-20 de «<b>A</b>»", link: "https://hl.test/secciones/g/clases/c", createdAt: "2026-10-16T14:00:00Z" },
        { type: "review_returned", reason: "Sofía devolvió tu lección", link: "https://hl.test/cursos/c", createdAt: "2026-10-16T15:00:00Z" }] });
    expect(message.subject).toBe("Tu resumen diario: 2 avisos · Colegio <Ficticio>");
    for (const part of ["Hola, Paula:", "Revisión devuelta (1)", "Cambio de una clase (1)", "https://hl.test/secciones/g/clases/c", "https://hl.test/preferencias#notificaciones"]) { expect(message.text).toContain(part); expect(message.html).toContain(part); }
    expect(message.html).toContain("&lt;b&gt;A&lt;/b&gt;"); expect(message.html).not.toContain("<b>A</b>");
  });
});

/** A NotifyStore on node:sqlite with every migration applied, as the Durable Object runs them. */
function sqliteStore() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("../database/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(`../database/migrations/${name}`, import.meta.url), "utf8"));
  const statement = (sql: string) => {
    let values: (string | number | null)[] = [];
    return {
      sql, bind(...bound: (string | number | null)[]) { values = bound; return this; },
      async all<T>() { return { results: raw.prepare(sql).all(...values) as T[] }; },
      async first<T>() { return (raw.prepare(sql).get(...values) as T | undefined) ?? null; },
      async run() { raw.prepare(sql).run(...values); },
    };
  };
  const store: NotifyStore = { prepare: statement, async batch(list) { raw.exec("BEGIN"); try { for (const item of list) await item.run(); raw.exec("COMMIT"); } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  return { raw, store };
}

describe("ST-161 the outbox queue on a migrated store", () => {
  const actor = { id: "user-0", username: "admin-demo", displayName: "Administración", role: "admin" as const, organizationId: "org-demo" };
  const sender = (): MailSender & { sent: MailMessage[] } => ({ configured: true, sent: [], async send(message) { this.sent.push(message); return { ok: true, id: `m-${this.sent.length}` }; } });
  const notice = (type: NotificationType, targetId: string) => ({ userId: "seed-user-sofia", targetId, path: `/secciones/g/clases/${targetId}`, facts: { type, course: "Arte", section: "B", date: "2026-10-20" } as never });
  const rows = (raw: DatabaseSync, sql: string) => raw.prepare(sql).all() as Record<string, unknown>[];
  function prepared(frequency: string, quiet?: { start: string; end: string }) {
    const { raw, store } = sqliteStore();
    raw.prepare("UPDATE users SET email='sofia@example.test' WHERE id='seed-user-sofia'").run();
    raw.prepare("INSERT INTO notification_settings(user_id,organization_id,email_frequency,digest_time,quiet_start,quiet_end,updated_at) VALUES ('seed-user-sofia','org-demo',?,'07:00',?,?,'t')").run(frequency, quiet?.start ?? null, quiet?.end ?? null);
    return { raw, store };
  }

  it("a daily digest keeps optional notices scheduled, sends mandatory ones at once and leaves as one message when due", async () => {
    const { raw, store } = prepared("daily"), mail = sender(), notifier = { origin: "https://hl.test", sender: mail };
    expect(await notify(store, notifier, actor, [notice("class_changed", "c1"), notice("class_cancelled", "c2")])).toBe(2);
    await notify(store, notifier, actor, [{ userId: "seed-user-sofia", targetId: "seed-user-sofia", path: "/perfil", facts: { type: "account_security", change: "password_reset" } }]);
    const outbox = rows(raw, "SELECT notification_type AS type,status,deliver_after AS due,mandatory,path FROM mail_outbox WHERE user_id='seed-user-sofia' ORDER BY rowid");
    expect(outbox.map(row => [row.type, row.status, row.mandatory])).toEqual([["class_changed", "scheduled", 0], ["class_cancelled", "scheduled", 0], ["account_security", "sent", 1]]);
    expect(outbox[0].due).toBe(outbox[1].due);
    expect(outbox[0].path).toBe("/secciones/g/clases/c1");
    expect(mail.sent.map(message => message.subject)).toEqual([expect.stringMatching(/^Aviso de seguridad de tu cuenta/)]);
    // The bell got all three at once; no notice waits there.
    expect(rows(raw, "SELECT type FROM notification_inbox WHERE user_id='seed-user-sofia' ORDER BY rowid").map(row => row.type)).toEqual(["class_changed", "class_cancelled", "account_security"]);

    const due = new Date(outbox[0].due as string);
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(due.getTime() - 60_000))).toBe(0);
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(due.getTime() + scheduleIntervalMs))).toBe(1);
    expect(mail.sent.at(-1)!.subject).toMatch(/^Tu resumen diario: 2 avisos · /);
    expect(mail.sent.at(-1)!.text).toContain("https://hl.test/secciones/g/clases/c2");
    const digest = rows(raw, "SELECT id,status,reason,mandatory FROM mail_outbox WHERE kind='digest'");
    expect(digest).toEqual([{ id: expect.any(String), status: "sent", reason: "Resumen diario con 2 avisos", mandatory: 0 }]);
    expect(rows(raw, "SELECT status,digest_id AS digest FROM mail_outbox WHERE notification_type IN ('class_changed','class_cancelled')")).toEqual([{ status: "digested", digest: digest[0].id }, { status: "digested", digest: digest[0].id }]);
    // A second look within five minutes does nothing: one run per organization at a time.
    raw.prepare("UPDATE mail_outbox SET status='scheduled',digest_id=NULL,deliver_after='2000-01-01T00:00:00.000Z' WHERE notification_type='class_changed'").run();
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(due.getTime() + scheduleIntervalMs + 60_000))).toBe(0);
  });

  it("quiet hours hold an optional e-mail alone and send it as itself when they end; the daily cap keeps it waiting", async () => {
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guatemala", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
    const [hours] = local.split(":").map(Number), clock = (value: number) => `${String((value + 24) % 24).padStart(2, "0")}:00`;
    const { raw, store } = prepared("immediate", { start: clock(hours - 1), end: clock(hours + 2) }), mail = sender(), notifier = { origin: "https://hl.test", sender: mail };
    await notify(store, notifier, actor, [notice("class_changed", "c9")]);
    const [held] = rows(raw, "SELECT status,deliver_after AS due FROM mail_outbox WHERE notification_type='class_changed'");
    expect(held.status).toBe("scheduled");
    expect(mail.sent).toEqual([]);
    const due = new Date(held.due as string);
    expect(due.getTime()).toBeGreaterThan(Date.now());

    // At the cap for optional e-mail it stays scheduled for a later access.
    const day = due.toISOString().slice(0, 10);
    const insert = raw.prepare("INSERT INTO mail_outbox(id,organization_id,kind,recipient,subject,status,created_at,sent_at) VALUES (?,'org-demo','invitation','x@example.test','S','sent',?,?)");
    for (let index = 0; index < optionalNotificationCap; index++) insert.run(`cap-${index}`, `${day}T00:00:01.000Z`, `${day}T00:00:01.000Z`);
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(due.getTime() + 60_000))).toBe(0);
    expect(rows(raw, "SELECT status FROM mail_outbox WHERE notification_type='class_changed'")).toEqual([{ status: "scheduled" }]);
    raw.prepare("DELETE FROM mail_outbox WHERE id LIKE 'cap-%'").run();
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(due.getTime() + 60_000 + scheduleIntervalMs))).toBe(1);
    expect(mail.sent.map(message => message.subject)).toEqual([expect.stringMatching(/^Cambió una clase de tu sección/)]);
    expect(rows(raw, "SELECT status,deliver_after AS due FROM mail_outbox WHERE notification_type='class_changed'")).toEqual([{ status: "sent", due: null }]);
  });

  it("«never» writes no optional e-mail; a person who left the organization gets nothing later", async () => {
    const { raw, store } = prepared("never"), mail = sender(), notifier = { origin: "https://hl.test", sender: mail };
    expect(await notify(store, notifier, actor, [notice("class_changed", "c3")])).toBe(0);
    expect(rows(raw, "SELECT count(*) AS count FROM notification_inbox WHERE user_id='seed-user-sofia'")).toEqual([{ count: 1 }]);
    raw.prepare("UPDATE notification_settings SET email_frequency='daily' WHERE user_id='seed-user-sofia'").run();
    await notify(store, notifier, actor, [notice("class_changed", "c4")]);
    raw.prepare("UPDATE memberships SET active=0 WHERE user_id='seed-user-sofia'").run();
    expect(await deliverScheduled(store, notifier, "org-demo", new Date(Date.now() + 9 * 86_400_000))).toBe(0);
    expect(rows(raw, "SELECT status,last_error AS error FROM mail_outbox WHERE notification_type='class_changed'")).toEqual([{ status: "deferred", error: "La persona ya no está activa en la organización." }]);
    expect(mail.sent).toEqual([]);
  });
});

let worker: ChildProcess;
let origin = "";
let logs = "";
const storage = mkdtempSync(join(tmpdir(), "hl-platform-preferences-"));
beforeAll(async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  origin = `http://127.0.0.1:${address.port}`;
  worker = spawn("node_modules/.bin/wrangler", ["dev", "--local", "--config", "build/wrangler.json", "--ip", "127.0.0.1", "--port", String(address.port), "--inspector-port", "0", "--persist-to", storage, "--var", "RESTORE_ENABLED:true"], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", BROWSER: "none" }, stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout?.on("data", chunk => { logs += chunk; });
  worker.stderr?.on("data", chunk => { logs += chunk; });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (worker.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for the local runtime to start. */ }
    await delay(200);
  }
  throw new Error(`Local Worker did not start:\n${logs}`);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) { const exited = once(worker, "exit"); worker.kill("SIGTERM"); await exited; }
  rmSync(storage, { recursive: true, force: true });
});

async function signIn(username: string, password = "Aprender-2026!") {
  const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username, password }) });
  return response.status === 200 ? response.headers.get("set-cookie")!.split(";")[0] : null;
}
async function as(cookie: string | null, path: string, method = "GET", data?: unknown) {
  return fetch(`${origin}/api${path}`, { method, headers: { Cookie: cookie || "", Origin: origin, ...(data !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const json = async (cookie: string | null, path: string) => (await as(cookie, path)).json();
type Row = { type: string; locked: string | null; channels: { in_app: boolean; email: boolean } };

describe("ST-160 ST-161 preferences on the built Worker", () => {
  let admin: string | null, sofia: string | null, carlos: string | null;
  beforeAll(async () => {
    [admin, sofia, carlos] = await Promise.all(["admin-demo", "sofia.castillo", "carlos.mejia"].map(name => signIn(name)));
    expect((await as(sofia, "/profile", "PUT", { displayName: "Sofía Castillo", phone: "", contactEmail: "sofia.castillo@example.test", education: "", specialties: [], availability: [] })).status).toBe(200);
  });

  it("CA ST-160 each person keeps regional and appearance preferences in the account; the session brings them", async () => {
    const before = (await json(sofia, "/me/preferences")).preferences;
    expect(before).toMatchObject({ language: "es", timezone: "America/Guatemala", homePage: "inicio", highContrast: false, motion: "system", density: "comfortable" });
    const saved = await as(sofia, "/me/preferences", "PUT", { theme: "dark", textScale: 130, highContrast: true, motion: "reduce", density: "compact", homePage: "agenda", locale: "es-MX", timezone: "America/Mexico_City", hourCycle: "h12", weekStart: 7 });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect((await saved.json()).preferences).toMatchObject({ theme: "dark", textScale: 130, highContrast: true, locale: "es-MX", timezone: "America/Mexico_City", hourCycle: "h12", weekStart: 7, chosen: { locale: "es-MX", timezone: "America/Mexico_City" } });
    // A new session (another device) opens with the same preferences.
    const other = await signIn("sofia.castillo");
    expect((await json(other, "/session")).preferences).toMatchObject({ theme: "dark", textScale: 130, homePage: "agenda", timezone: "America/Mexico_City" });
    // Others keep theirs.
    expect((await json(carlos, "/me/preferences")).preferences.theme).toBeTruthy();
    for (const bad of [{ textScale: 160 }, { timezone: "Mexico" }, { locale: "es_MX" }, { theme: "sepia" }, { nope: 1 }]) expect((await as(sofia, "/me/preferences", "PUT", bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await as(null, "/me/preferences")).status).toBe(401);
    // «Automatic» again: the organization's zone and the format's hour cycle.
    expect((await (await as(sofia, "/me/preferences", "PUT", { timezone: null, hourCycle: null, weekStart: null, locale: null })).json()).preferences).toMatchObject({ timezone: "America/Guatemala", locale: "es", hourCycle: "h23", weekStart: 1 });
  });

  it("CA ST-160 the organization's regional format is the default; an invalid one is refused", async () => {
    const organization = (await json(admin, "/organization")).organization;
    expect(organization.locale).toBe("es");
    expect((await as(admin, "/organization", "PUT", { name: organization.name, timezone: organization.timezone, locale: "es_GT" })).status).toBe(400);
    expect((await as(admin, "/organization", "PUT", { name: organization.name, timezone: organization.timezone, locale: "es-GT" })).status).toBe(200);
    expect((await json(carlos, "/me/preferences")).preferences).toMatchObject({ locale: "es-GT", weekStart: 7, hourCycle: "h12", chosen: { locale: null } });
    // A client that only sends name and zone keeps the format.
    expect((await (await as(admin, "/organization", "PUT", { name: organization.name, timezone: organization.timezone })).json()).organization.locale).toBe("es-GT");
    expect((await as(admin, "/organization", "PUT", { name: organization.name, timezone: organization.timezone, locale: "es" })).status).toBe(200);
  });

  it("CA ST-160 the calendar feed and the hours use the person's zone", async () => {
    expect((await as(carlos, "/me/preferences", "PUT", { timezone: "Europe/Madrid" })).status).toBe(200);
    const link = (await (await as(carlos, "/feeds/calendar", "POST")).json()).url as string;
    const feed = await (await fetch(link)).text();
    expect(feed).toContain("X-WR-TIMEZONE:Europe/Madrid");
    expect((await json(carlos, "/hours")).timezone).toBe("Europe/Madrid");
    expect((await json(admin, "/hours")).timezone).toBe("America/Guatemala");
    expect((await as(carlos, "/me/preferences", "PUT", { timezone: null })).status).toBe(200);
  });

  it("CA ST-161 the matrix lists every notice on both channels; account notices and mandatory ones cannot be turned off", async () => {
    const matrix = await json(sofia, "/me/notification-preferences");
    expect(matrix.events.map((row: Row) => row.type)).toEqual(["course_assignment", "section_assignment", "review_submitted", "review_returned", "review_approved", "class_changed", "class_cancelled", "account_security", "account_email", "terms_updated"]);
    expect(matrix.events.every((row: Row) => row.channels.in_app && row.channels.email)).toBe(true);
    expect(matrix.events.filter((row: Row) => row.locked === "system").map((row: Row) => row.type)).toEqual(["account_security", "account_email", "terms_updated"]);
    expect(matrix).toMatchObject({ delivery: { frequency: "immediate", digestTime: "07:00", quietHours: null }, timezone: "America/Guatemala", hasAddress: true, scheduled: 0 });

    const off = await as(sofia, "/me/notification-preferences", "PUT", { channels: { class_cancelled: { email: false }, review_returned: { in_app: false } } });
    expect(off.status).toBe(200);
    const rows = (await off.json()).events as Row[];
    expect(rows.find(row => row.type === "class_cancelled")!.channels).toEqual({ in_app: true, email: false });
    expect(rows.find(row => row.type === "review_returned")!.channels).toEqual({ in_app: false, email: true });
    // ST-124's route reads and writes the e-mail column of the same matrix.
    const legacy = await json(sofia, "/notifications/preferences");
    expect(legacy.settings.find((item: { type: string }) => item.type === "class_cancelled")).toMatchObject({ enabled: false, mandatory: false });
    expect(legacy.settings.find((item: { type: string }) => item.type === "terms_updated")).toMatchObject({ enabled: true, mandatory: true, system: true });
    expect((await as(sofia, "/notifications/preferences", "PUT", { preferences: { class_cancelled: true } })).status).toBe(200);
    expect(((await json(sofia, "/me/notification-preferences")).events as Row[]).find(row => row.type === "class_cancelled")!.channels.email).toBe(true);

    for (const locked of [{ channels: { account_security: { email: false } } }, { channels: { terms_updated: { in_app: false } } }]) expect((await as(sofia, "/me/notification-preferences", "PUT", locked)).status).toBe(409);
    expect((await as(sofia, "/notifications/preferences", "PUT", { preferences: { account_email: false } })).status).toBe(409);
    expect((await as(admin, "/notifications/policy", "PUT", { mandatory: ["class_changed"] })).status).toBe(200);
    expect((await as(sofia, "/me/notification-preferences", "PUT", { channels: { class_changed: { in_app: false } } })).status).toBe(409);
    // The policy only covers the configurable types.
    expect((await as(admin, "/notifications/policy", "PUT", { mandatory: ["account_security"] })).status).toBe(400);
    expect((await json(admin, "/notifications/policy")).settings).toHaveLength(7);
    expect((await as(admin, "/notifications/policy", "PUT", { mandatory: [] })).status).toBe(200);
    for (const bad of [{ frequency: "hourly" }, { quietHours: { start: "22:00", end: "22:00" } }, { digestTime: "7" }, { channels: { nope: { email: false } } }]) expect((await as(sofia, "/me/notification-preferences", "PUT", bad)).status).toBe(400);
  });

  it("CA ST-161 with a daily digest an assignment waits in the outbox as scheduled and reaches the bell at once", async () => {
    const saved = await as(sofia, "/me/notification-preferences", "PUT", { frequency: "daily", digestTime: "18:00", quietHours: { start: "22:00", end: "06:00" } });
    expect(saved.status).toBe(200);
    expect((await saved.json()).delivery).toEqual({ frequency: "daily", digestTime: "18:00", quietHours: { start: "22:00", end: "06:00" } });
    const course = "seed-course-matematicas";
    const current = (await json(admin, `/courses/${course}`)).course as { version: number; team: { userId: string; role: string }[] };
    const team = current.team.filter(member => member.userId !== "seed-user-sofia").map(member => ({ userId: member.userId, role: member.role }));
    expect((await as(admin, `/courses/${course}/team`, "PUT", { members: team, version: current.version })).status).toBe(200);
    const next = (await json(admin, `/courses/${course}`)).course as { version: number };
    expect((await as(admin, `/courses/${course}/team`, "PUT", { members: [...team, { userId: "seed-user-sofia", role: "co-teacher" }], version: next.version })).status).toBe(200);
    const log = (await json(admin, "/notifications/log?type=course_assignment&person=seed-user-sofia")).notifications as { status: string; deliverAfter: string | null; reason: string }[];
    expect(log[0]).toMatchObject({ status: "scheduled", deliverAfter: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/) });
    expect((await json(admin, "/notifications/log?status=scheduled")).notifications.length).toBeGreaterThan(0);
    const mine = await json(sofia, "/me/notification-preferences");
    expect(mine).toMatchObject({ scheduled: 1, nextDelivery: log[0].deliverAfter });

    const inbox = await json(sofia, "/me/inbox");
    expect(inbox.unread).toBeGreaterThan(0);
    const item = inbox.items.find((entry: { type: string }) => entry.type === "course_assignment");
    expect(item).toMatchObject({ reason: log[0].reason, path: `/cursos/${course}`, readAt: null, mandatory: false });
    const read = await as(sofia, "/me/inbox/read", "POST", { ids: [item.id] });
    expect(read.status).toBe(200);
    expect((await read.json()).items.find((entry: { id: string }) => entry.id === item.id).readAt).toEqual(expect.any(String));
    expect((await as(sofia, "/me/inbox/read", "POST", { ids: ["bogus"] })).status).toBe(400);
    const all = await (await as(sofia, "/me/inbox/read", "POST")).json();
    expect(all.unread).toBe(0);
    // Nobody reads another person's bell.
    expect(((await json(carlos, "/me/inbox")).items as { id: string }[]).some(entry => entry.id === item.id)).toBe(false);

    // Back to immediate: what was waiting leaves on the next access.
    expect((await as(sofia, "/me/notification-preferences", "PUT", { frequency: "immediate", quietHours: null })).status).toBe(200);
    expect(new Date((await json(sofia, "/me/notification-preferences")).nextDelivery).getTime()).toBeLessThanOrEqual(Date.now() + 2000);
  });

  it("CA ST-161 changing one's own password leaves a mandatory account notice for the owner", async () => {
    const password = "Una frase segura para Carlos 2026";
    expect((await as(carlos, "/account/password", "POST", { currentPassword: "Aprender-2026!", newPassword: password })).status).toBe(200);
    const notices = (await json(carlos, "/me/inbox")).items as { type: string; mandatory: boolean }[];
    expect(notices.find(item => item.type === "account_security")).toMatchObject({ mandatory: true });
    const log = (await json(admin, "/notifications/log?type=account_security&person=seed-user-carlos")).notifications as { status: string; mandatory: boolean }[];
    expect(notices.some(item => item.type === "account_security" && item.mandatory)).toBe(true);
  });

  it("the backup includes the preferences and the bell, not the schedule runs", async () => {
    const tables = (await json(admin, "/organization/backup")).tables;
    expect(tables.user_preferences.rows.length).toBeGreaterThan(0);
    expect(tables.notification_settings.rows.length).toBeGreaterThan(0);
    expect(tables.notification_inbox.rows.length).toBeGreaterThan(0);
    expect(tables.notification_preferences.columns).toContain("channel");
    expect(tables.mail_schedule_runs).toBeUndefined();
  });
});
