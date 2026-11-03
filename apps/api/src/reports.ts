import type { Member } from "@happy-learners/contracts";
import { checkedSuggestions, defaultTemplate, exampleSuggestions, fixtureSuggester, jpegImage, pdfFile, renderReport, reportKinds, suggestInput, suggestPromptVersion, templateInput } from "@happy-learners/domain";
import type { PdfImage, ReportKind, ReportRecord, ReportTemplate, SuggestOutput } from "@happy-learners/domain";
import type { Database } from "./storage";
import { aiGate, aiRunId, tracked } from "./ai-runs";
import { openAiSettings, openAiSuggester, shortModel } from "./openai";

/**
 * The report builder (1.5.0, docs/design/constructor-de-reportes.md), administration only: templates with a draft and
 * published versions (`/api/report-templates`; restore with `…/restore?version=n`), their images (`/api/report-images`)
 * and a preview with real data. POST …/suggest-fields { text, sectionId? } proposes fields for a block's text (1.5.2).
 * Documents use the published version of the program's template, or else the organization's; without one, each
 * document keeps the format it had before templates existed.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const templatePath = /^\/api\/report-templates\/([a-z0-9-]+)(?:\/(publish|restore|preview|suggest-fields))?$/;
export const reportMethods = (path: string) => path === "/api/report-templates" ? ["GET", "POST"] : path === "/api/report-images" ? ["GET", "POST"]
  : templatePath.test(path) ? (/\/(publish|restore|preview|suggest-fields)$/.test(path) ? ["POST"] : ["GET", "PUT", "DELETE"]) : null;

const sha256 = async (bytes: Uint8Array | string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
export const pdfResponse = (file: string, name: string) => new Response(new TextEncoder().encode(file), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

/** The published template a document of this kind uses for a course of `programId`: the program's, else the organization's. */
export async function activeTemplate(db: Database, organizationId: string, kind: ReportKind, programId: string | null) {
  const row = await db.prepare(`SELECT t.id,v.version,v.content FROM report_templates t JOIN report_template_versions v ON v.template_id=t.id AND v.version=t.published_version
    WHERE t.organization_id=? AND t.kind=? AND t.status='active' AND (t.program_id IS NULL OR t.program_id=?) ORDER BY t.program_id IS NULL LIMIT 1`).bind(organizationId, kind, programId).first<{ id: string; version: number; content: string }>();
  return row ? { id: row.id, version: row.version, template: JSON.parse(row.content) as ReportTemplate } : null;
}
export async function imagesOf(db: Database, organizationId: string, template: ReportTemplate): Promise<Record<string, PdfImage>> {
  const ids = [template.logoId, ...template.blocks.flatMap(block => block.type === "image" ? [block.imageId] : [])].filter((id): id is string => !!id);
  const out: Record<string, PdfImage> = {};
  for (const id of new Set(ids)) {
    const row = await db.prepare("SELECT bytes,width,height,components FROM report_images WHERE id=? AND organization_id=?").bind(id, organizationId).first<{ bytes: ArrayBuffer; width: number; height: number; components: 1 | 3 }>();
    if (row) out[id] = { bytes: new Uint8Array(row.bytes), width: row.width, height: row.height, components: row.components };
  }
  return out;
}
/** A document from a template; it is recorded with its version and fingerprint. */
export async function generate(db: Database, current: Member, kind: ReportKind, used: { id: string | null; version: number | null; template: ReportTemplate }, records: ReportRecord[], title: string, subject: { type: "section" | "learner" | "minute"; id: string }, record = true) {
  const { document } = renderReport(used.template, records, await imagesOf(db, current.organizationId, used.template), title);
  const file = pdfFile(document);
  if (record) await db.prepare("INSERT INTO generated_documents(id,organization_id,kind,template_id,template_version,subject_type,subject_id,sha256,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(`document-${crypto.randomUUID()}`, current.organizationId, kind, used.id, used.version, subject.type, subject.id, await sha256(file), current.id, new Date().toISOString()).run();
  return file;
}

/** Real values of the fields every document has, from one section, so «Sugerir campos» recognizes them in a text. */
async function examplesOf(db: Database, organizationId: string, sectionId: string): Promise<{ values: Record<string, string>; learners: string[] }> {
  const [organization, section, educators, years, learners] = await db.batch([
    db.prepare("SELECT name,timezone FROM organizations WHERE id=?").bind(organizationId),
    db.prepare("SELECT g.name,c.title FROM course_groups g JOIN courses c ON c.id=g.course_id WHERE g.id=? AND g.organization_id=?").bind(sectionId, organizationId),
    db.prepare("SELECT COALESCE(u.display_name,u.username) AS name FROM section_educators e JOIN users u ON u.id=e.user_id WHERE e.group_id=? ORDER BY name").bind(sectionId),
    db.prepare("SELECT name FROM academic_years WHERE organization_id=? AND status='current' ORDER BY program_id IS NULL LIMIT 1").bind(organizationId),
    db.prepare("SELECT display_name AS name FROM group_learners WHERE group_id=? AND organization_id=? AND status='active' ORDER BY display_name COLLATE NOCASE,id").bind(sectionId, organizationId),
  ]) as unknown as [{ name: string | null; timezone: string }[], { name: string; title: string }[], { name: string }[], { name: string }[], { name: string }[]];
  if (!section[0]) return { values: {}, learners: [] };
  const zone = organization[0]?.timezone || "America/Guatemala";
  return { values: {
    "organizacion.nombre": organization[0]?.name || "", "fecha.hoy": new Intl.DateTimeFormat("es-GT", { timeZone: zone, dateStyle: "long" }).format(new Date()),
    "ciclo.nombre": years[0]?.name || "", "seccion.nombre": section[0].name, "curso.nombre": section[0].title, "seccion.docentes": educators.map(row => row.name).join(", "),
  }, learners: learners.map(row => row.name) };
}

type TemplateRow = { id: string; kind: ReportKind; programId: string | null; programName: string | null; name: string; draft: string; publishedVersion: number | null; updatedAt: string };
const columns = "t.id,t.kind,t.program_id AS programId,p.name AS programName,t.name,t.draft,t.published_version AS publishedVersion,t.updated_at AS updatedAt";
const viewOf = (row: TemplateRow) => ({ ...row, draft: JSON.parse(row.draft) as ReportTemplate });

export async function reports(path: string, method: string, input: unknown, request: Request, current: Member, db: Database, previewOf: (kind: ReportKind, template: ReportTemplate, sectionId: string, learnerId: string | null) => Promise<Response>, env?: Env): Promise<Response> {
  if (current.role !== "admin") return reply({ error: "Solo administración diseña los documentos de la organización." }, 403);
  const now = new Date().toISOString();
  const imageIds = async () => (await db.prepare("SELECT id FROM report_images WHERE organization_id=?").bind(current.organizationId).all<{ id: string }>()).results.map(row => row.id);
  if (path === "/api/report-images") {
    if (method === "GET") return reply({ images: (await db.prepare("SELECT id,name,width,height,created_at AS createdAt FROM report_images WHERE organization_id=? ORDER BY created_at DESC").bind(current.organizationId).all()).results });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const image = bytes.length <= 1_048_576 ? jpegImage(bytes) : null;
    if (!image) return reply({ error: "Sube una imagen JPEG o PNG de hasta 1 MB." }, 400);
    const name = decodeURIComponent(request.headers.get("X-File-Name") || "imagen").slice(0, 120) || "imagen";
    const id = `report-image-${crypto.randomUUID()}`;
    await db.prepare("INSERT INTO report_images(id,organization_id,name,bytes,width,height,components,sha256,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(id, current.organizationId, name, bytes.slice().buffer, image.width, image.height, image.components, await sha256(bytes), current.id, now).run();
    return reply({ image: { id, name, width: image.width, height: image.height } }, 201);
  }
  if (path === "/api/report-templates") {
    if (method === "GET") {
      const rows = (await db.prepare(`SELECT ${columns} FROM report_templates t LEFT JOIN study_programs p ON p.id=t.program_id WHERE t.organization_id=? AND t.status='active' ORDER BY t.kind,p.name`).bind(current.organizationId).all<TemplateRow>()).results; // nosemgrep: sql-interpolated-text -- columns es una lista constante
      return reply({ templates: rows.map(viewOf), kinds: reportKinds });
    }
    const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const kind = body.kind as ReportKind;
    if (!reportKinds[kind]) return reply({ error: "Elige el tipo de documento." }, 400);
    const programId = typeof body.programId === "string" && body.programId ? body.programId : null;
    if (programId && !await db.prepare("SELECT 1 FROM study_programs WHERE id=? AND organization_id=?").bind(programId, current.organizationId).first()) return reply({ error: "El programa no existe." }, 400);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : reportKinds[kind].label;
    const id = `report-template-${crypto.randomUUID()}`;
    try {
      await db.prepare("INSERT INTO report_templates(id,organization_id,kind,program_id,name,draft,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id, current.organizationId, kind, programId, name, JSON.stringify(defaultTemplate(kind)), current.id, now).run();
    } catch { return reply({ error: "Ya hay una plantilla de ese tipo para ese alcance: edítala." }, 409); }
    return reply({ template: viewOf((await db.prepare(`SELECT ${columns} FROM report_templates t LEFT JOIN study_programs p ON p.id=t.program_id WHERE t.id=?`).bind(id).first<TemplateRow>())!) }, 201); // nosemgrep: sql-interpolated-text -- columns es una lista constante
  }
  const [, templateId, action] = templatePath.exec(path)!;
  const row = await db.prepare(`SELECT ${columns} FROM report_templates t LEFT JOIN study_programs p ON p.id=t.program_id WHERE t.id=? AND t.organization_id=? AND t.status='active'`).bind(templateId, current.organizationId).first<TemplateRow>(); // nosemgrep: sql-interpolated-text -- columns es una lista constante
  if (!row) return reply({ error: "La plantilla no existe." }, 404);
  const versions = async () => (await db.prepare("SELECT v.version,v.published_at AS publishedAt,COALESCE(u.display_name,u.username) AS publishedBy FROM report_template_versions v LEFT JOIN users u ON u.id=v.published_by WHERE v.template_id=? ORDER BY v.version DESC").bind(templateId).all()).results;
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  if (!action && method === "GET") return reply({ template: viewOf(row), versions: await versions() });
  if (!action && method === "DELETE") { await db.prepare("UPDATE report_templates SET status='archived',updated_by=?,updated_at=? WHERE id=?").bind(current.id, now, templateId).run(); return reply({ archived: true }); }
  if (!action && method === "PUT") {
    const checked = templateInput({ ...(body.draft as object), kind: row.kind }, await imageIds());
    if ("error" in checked) return reply(checked, 400);
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : row.name;
    await db.prepare("UPDATE report_templates SET draft=?,name=?,updated_by=?,updated_at=? WHERE id=?").bind(JSON.stringify(checked), name, current.id, now, templateId).run();
    return reply({ template: viewOf({ ...row, draft: JSON.stringify(checked), name, updatedAt: now }) });
  }
  if (action === "publish") {
    const checked = templateInput(JSON.parse(row.draft), await imageIds());
    if ("error" in checked) return reply(checked, 400);
    const version = (row.publishedVersion || 0) + 1;
    await db.batch([
      db.prepare("INSERT INTO report_template_versions(template_id,version,content,published_by,published_at) VALUES (?,?,?,?,?)").bind(templateId, version, JSON.stringify(checked), current.id, now),
      db.prepare("UPDATE report_templates SET published_version=?,updated_by=?,updated_at=? WHERE id=? AND (published_version IS ? )").bind(version, current.id, now, templateId, row.publishedVersion),
    ]);
    return reply({ template: viewOf({ ...row, publishedVersion: version }), versions: await versions() });
  }
  if (action === "restore") {
    // Actions such as …/restore carry no body (see the router): the version goes in the address.
    const version = await db.prepare("SELECT content FROM report_template_versions WHERE template_id=? AND version=?").bind(templateId, Number(new URL(request.url).searchParams.get("version"))).first<{ content: string }>();
    if (!version) return reply({ error: "Esa versión no existe." }, 404);
    await db.prepare("UPDATE report_templates SET draft=?,updated_by=?,updated_at=? WHERE id=?").bind(version.content, current.id, now, templateId).run();
    return reply({ template: viewOf({ ...row, draft: version.content }) });
  }
  if (action === "suggest-fields") {
    const examples = typeof body.sectionId === "string" ? await examplesOf(db, current.organizationId, body.sectionId) : { values: {}, learners: [] };
    const spec = reportKinds[row.kind];
    const asked = suggestInput(spec.label, body.text, spec.fields.map(item => ({ key: item.key, label: item.label, example: examples.values[item.key] })));
    if ("error" in asked) return reply(asked, 400);
    // The text may be written for any student of the section: their names are matched here and never sent as examples.
    const named = spec.fields.some(item => item.key === "estudiante.nombre") ? examples.learners : [];
    const found = [exampleSuggestions(asked), ...named.map(name => exampleSuggestions({ ...asked, fields: [{ key: "estudiante.nombre", label: "", example: name }] }))];
    const settings = env ? openAiSettings(env) : null;
    const suggester = settings ? openAiSuggester(settings) : env?.LESSON_GENERATOR === "fixture" ? fixtureSuggester : null;
    let proposed: SuggestOutput = { suggestions: [] }, runId: string | undefined;
    // Over the hourly AI limit or the month's budget, the fields found in the examples are still offered.
    if (suggester && env && !await aiGate(db, current, env)) {
      try {
        runId = aiRunId();
        proposed = await tracked(db, { id: runId, organizationId: current.organizationId, userId: current.id, courseId: null, task: "suggest-fields", promptVersion: suggestPromptVersion, generator: suggester.kind, model: settings ? shortModel(settings) : "fixture", inputChars: asked.text.length },
          observe => suggester.suggest(asked, observe));
      // What was found without the model is still worth showing.
      } catch { return reply({ suggestions: checkedSuggestions(found, asked), ai: false, notice: "La IA no respondió: se muestran solo los datos reconocidos en el texto." }); }
    }
    return reply({ suggestions: checkedSuggestions([...found, proposed], asked), ai: !!suggester, ...(runId ? { runId } : {}) });
  }
  // Preview: the draft sent (or the stored one) with a real section's data, without recording a document.
  const checked = templateInput({ ...((body.draft as object) || JSON.parse(row.draft)), kind: row.kind }, await imageIds());
  if ("error" in checked) return reply(checked, 400);
  if (typeof body.sectionId !== "string") return reply({ error: "Elige una sección para la vista previa." }, 400);
  return previewOf(row.kind, checked, body.sectionId, typeof body.learnerId === "string" ? body.learnerId : null);
}
