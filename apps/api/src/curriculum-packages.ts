import type { CoursePackageView, CurriculumPackageSummary, Member } from "@happy-learners/contracts";
import { competencyDescription, competencyLimit, competencyName, curriculumPackages, indicatorEvidence, linkPlan, maxPickedIndicators, outcomeLimit, packageOf, packageSummary } from "@happy-learners/domain";
import type { CurriculumPackage } from "@happy-learners/domain";
import type { Database, Prepared } from "./storage";
import { accessTo } from "./access";
import { event } from "./activity";

/**
 * Curriculum packages (official references versioned in the repository):
 *   GET  /api/curriculum-packages                          every member: the catalog and what is active
 *   POST /api/curriculum-packages/:id/(activate|deactivate) administration
 *   GET  /api/courses/:id/curriculum-packages               whoever reaches the course: active packages, what is linked
 *   POST /api/courses/:id/curriculum-packages/:pkg          the course's lead: { codes, version } adds indicators to the plan
 * Linked items are the course's own competencies and outcomes; course_package_links keeps the code they came from.
 */
const reply = (value: unknown, status = 200) => Response.json(value, { status });
const catalogPath = /^\/api\/curriculum-packages$/;
const activationPath = /^\/api\/curriculum-packages\/([a-z0-9-]+)\/(activate|deactivate)$/;
const coursePath = /^\/api\/courses\/([a-z0-9-]+)\/curriculum-packages$/;
const linkPath = /^\/api\/courses\/([a-z0-9-]+)\/curriculum-packages\/([a-z0-9-]+)$/;

export function packageMethods(path: string): string[] | null {
  if (catalogPath.test(path) || coursePath.test(path)) return ["GET"];
  if (activationPath.test(path) || linkPath.test(path)) return ["POST"];
  return null;
}

type Activation = { packageId: string; version: string; activatedAt: string };
async function catalog(db: Database, organizationId: string): Promise<CurriculumPackageSummary[]> {
  const active = (await db.prepare("SELECT package_id AS packageId,version,activated_at AS activatedAt FROM curriculum_package_activations WHERE organization_id=?").bind(organizationId).all<Activation>()).results;
  return curriculumPackages.map(item => {
    const found = active.find(row => row.packageId === item.id);
    return { ...packageSummary(item), active: !!found, activatedAt: found?.activatedAt || null, activatedVersion: found?.version || null };
  });
}

type Link = { packageId: string; kind: "competency" | "indicator"; code: string; competencyId: string | null; outcomeId: string | null };
const linksOf = async (db: Database, courseId: string, packageId?: string) =>
  (await db.prepare(`SELECT package_id AS packageId,kind,code,competency_id AS competencyId,outcome_id AS outcomeId FROM course_package_links WHERE course_id=?${packageId ? " AND package_id=?" : ""}`)
    .bind(...(packageId ? [courseId, packageId] : [courseId])).all<Link>()).results;

function courseView(item: CurriculumPackage, summary: CurriculumPackageSummary, links: Link[]): CoursePackageView {
  const own = links.filter(link => link.packageId === item.id);
  return { ...summary, competencyList: item.competencies.map(competency => ({
    code: competency.code, statement: competency.statement,
    competencyId: own.find(link => link.kind === "competency" && link.code === competency.code)?.competencyId || null,
    indicators: competency.indicators.map(indicator => ({ ...indicator, outcomeId: own.find(link => link.kind === "indicator" && link.code === indicator.code)?.outcomeId || null })),
  })) };
}

export async function curriculumPackagesApi(path: string, method: string, input: unknown, current: Member, db: Database): Promise<Response> {
  if (catalogPath.test(path)) return reply({ packages: await catalog(db, current.organizationId) });
  const activation = activationPath.exec(path);
  if (activation) {
    if (current.role !== "admin") return reply({ error: "Solo administración activa los paquetes curriculares." }, 403);
    const item = packageOf(activation[1]);
    if (!item) return reply({ error: "Paquete curricular no disponible." }, 404);
    const now = new Date().toISOString();
    // Activating again records the version in the repository; deactivating hides it from new picks and keeps every plan.
    await db.batch(activation[2] === "activate"
      ? [db.prepare("INSERT INTO curriculum_package_activations(organization_id,package_id,version,activated_by,activated_at) VALUES (?,?,?,?,?) ON CONFLICT(organization_id,package_id) DO UPDATE SET version=excluded.version").bind(current.organizationId, item.id, item.version, current.id, now)]
      : [db.prepare("DELETE FROM curriculum_package_activations WHERE organization_id=? AND package_id=?").bind(current.organizationId, item.id)]);
    return reply({ packages: await catalog(db, current.organizationId) });
  }

  const [, courseId, packageId] = (linkPath.exec(path) || coursePath.exec(path))!;
  const course = await db.prepare("SELECT id,status,version FROM courses WHERE id=? AND organization_id=?").bind(courseId, current.organizationId).first<{ id: string; status: string; version: number }>();
  if (!course) return reply({ error: "Curso no disponible." }, 404);
  const access = await accessTo(db, current, courseId);
  if (!access) return reply({ error: "Este curso no está asignado a tu cuenta." }, 403);
  const summaries = (await catalog(db, current.organizationId)).filter(item => item.active);
  if (method === "GET") {
    const links = await linksOf(db, courseId);
    return reply({ packages: summaries.map(summary => courseView(packageOf(summary.id)!, summary, links)), canLink: access.publish && course.status === "active" });
  }

  if (!access.publish) return reply({ error: "Solo la persona responsable del curso organiza su plan curricular." }, 403);
  if (course.status !== "active") return reply({ error: "Restaura el curso antes de modificarlo. Sus enlaces publicados se conservan." }, 409);
  const item = packageOf(packageId), summary = summaries.find(entry => entry.id === packageId);
  if (!item || !summary) return reply({ error: "Ese paquete curricular no está activo en tu organización." }, 404);
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const codes = value.codes;
  if (!Array.isArray(codes) || !codes.length || codes.length > maxPickedIndicators || codes.some(code => typeof code !== "string") || new Set(codes).size !== codes.length) return reply({ error: "Elige al menos un indicador del paquete." }, 400);
  const plan = linkPlan(item, codes as string[], await linksOf(db, courseId, item.id));
  if (plan.unknown.length) return reply({ error: `Estos indicadores no son del paquete: ${plan.unknown.join(", ")}.` }, 400);

  const [competencies, outcomes] = await db.batch([
    db.prepare("SELECT id,name FROM course_competencies WHERE course_id=? ORDER BY position,id").bind(courseId),
    db.prepare("SELECT id FROM course_outcomes WHERE course_id=?").bind(courseId),
  ]) as unknown as [{ id: string; name: string }[], { id: string }[]];
  // A competency the course already has under the same name is reused instead of duplicated.
  const reused = new Map(plan.competencies.map(competency => [competency.code, competencies.find(row => row.name.toLocaleLowerCase("es") === competencyName(item, competency).toLocaleLowerCase("es"))?.id || null]));
  const created = plan.competencies.filter(competency => !reused.get(competency.code));
  if (competencies.length + created.length > competencyLimit) return reply({ error: `Un curso admite hasta ${competencyLimit} competencias; esta selección agregaría ${created.length}.` }, 400);
  if (outcomes.length + plan.indicators.length > outcomeLimit) return reply({ error: `Un curso admite hasta ${outcomeLimit} resultados de aprendizaje; esta selección agregaría ${plan.indicators.length}.` }, 400);
  if (!plan.indicators.length) return reply({ added: 0, skipped: plan.skipped, version: course.version });

  const now = new Date().toISOString();
  const competencyIds = new Map((await linksOf(db, courseId, item.id)).filter(link => link.kind === "competency").map(link => [link.code, link.competencyId!]));
  const statements: Prepared[] = [];
  plan.competencies.forEach(competency => {
    const id = reused.get(competency.code) || `competency-${crypto.randomUUID()}`;
    competencyIds.set(competency.code, id);
    if (!reused.get(competency.code)) statements.push(db.prepare("INSERT INTO course_competencies(id,course_id,organization_id,name,description,position,status,updated_at) VALUES (?,?,?,?,?,?,'active',?)")
      .bind(id, courseId, current.organizationId, competencyName(item, competency), competencyDescription(item, competency), competencies.length + created.indexOf(competency), now));
    statements.push(db.prepare("INSERT INTO course_package_links(course_id,organization_id,package_id,version,kind,code,competency_id,outcome_id,linked_by,linked_at) VALUES (?,?,?,?,'competency',?,?,NULL,?,?)")
      .bind(courseId, current.organizationId, item.id, item.version, competency.code, id, current.id, now));
  });
  plan.indicators.forEach(({ competency, indicator }, index) => {
    const id = `outcome-${crypto.randomUUID()}`;
    statements.push(
      db.prepare("INSERT INTO course_outcomes(id,course_id,organization_id,competency_id,statement,level,evidence,position,status,updated_at) VALUES (?,?,?,?,?,?,?,?,'active',?)")
        .bind(id, courseId, current.organizationId, competencyIds.get(competency.code)!, indicator.statement, indicator.level, indicatorEvidence(item, indicator), outcomes.length + index, now),
      db.prepare("INSERT INTO course_package_links(course_id,organization_id,package_id,version,kind,code,competency_id,outcome_id,linked_by,linked_at) VALUES (?,?,?,?,'indicator',?,NULL,?,?,?)")
        .bind(courseId, current.organizationId, item.id, item.version, indicator.code, id, current.id, now),
    );
  });
  statements.push(event(db, current, { action: "created", targetType: "outcome", targetId: courseId, courseId, summary: `Agregó ${plan.indicators.length === 1 ? "1 indicador" : `${plan.indicators.length} indicadores`} de «${item.title}» al plan curricular` }));
  // Compare-and-write like every change to the plan: the course is still at the version the person saw.
  const version = Number.isInteger(value.version) ? Number(value.version) : -1;
  const ok = await db.guardedBatch(db.prepare("UPDATE courses SET version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status='active' RETURNING id").bind(now, courseId, current.organizationId, version), statements);
  if (!ok) return reply({ error: "El curso cambió mientras elegías. Recarga y vuelve a intentar." }, 409);
  return reply({ added: plan.indicators.length, skipped: plan.skipped, version: course.version + 1 }, 201);
}
