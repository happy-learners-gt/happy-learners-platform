/** How far a section may adapt the course (1.3.5). `shared` is today's behaviour. */
export type FreedomPolicy = "shared" | "flexible" | "free";
export const freedomPolicies: FreedomPolicy[] = ["shared", "flexible", "free"];
export const freedomPolicyLabel: Record<FreedomPolicy, string> = {
  shared: "Igual en todas las secciones",
  flexible: "Núcleo y adaptación",
  free: "Libre con núcleo de resultados",
};

export type FreedomLesson = {
  id: string; unitId: string; position: number; core: boolean; groupId: string | null; title: string; outcomeIds: string[];
};
export type FreedomActivity = {
  id: string; periodId: string; categoryId: string; points: number; position: number; core: boolean; groupId: string | null; title: string;
};
/** A section's adjustment. `replaces` is the course activity this section activity stands in for, and only in `free`. */
export type FreedomOverride = {
  itemType: "lesson" | "activity" | "unit"; itemId: string; position: number | null; hidden: boolean; replaces: string | null;
};
export type EffectiveLesson = FreedomLesson & { origin: "course" | "section"; hidden: boolean };
export type EffectiveActivity = FreedomActivity & { origin: "course" | "section"; hidden: boolean; replaces: string | null; replacedTitle: string | null };

export type SectionContentInput = {
  policy: FreedomPolicy;
  lessons: FreedomLesson[];
  sectionLessons: FreedomLesson[];
  activities: FreedomActivity[];
  sectionActivities: FreedomActivity[];
  overrides: FreedomOverride[];
};

export type SectionContent = {
  ok: true;
  lessons: EffectiveLesson[];
  hiddenLessons: EffectiveLesson[];
  activities: EffectiveActivity[];
  hiddenActivities: EffectiveActivity[];
  reordered: boolean;
};
export type SectionContentError = { ok: false; errors: string[] };

const byPosition = <T extends { position: number; id: string; groupId: string | null }>(a: T, b: T) => a.position - b.position || Number(a.groupId !== null) - Number(b.groupId !== null) || a.id.localeCompare(b.id);

/**
 * The lessons and the assessment plan a section actually follows. `shared` returns the course, in its order,
 * and ignores section items and adjustments. Anything else is an error the caller shows as written.
 */
export function sectionContent(input: SectionContentInput): SectionContent | SectionContentError {
  if (input.policy === "shared") {
    return {
      ok: true,
      lessons: [...input.lessons].sort(byPosition).map(item => ({ ...item, origin: "course", hidden: false })),
      hiddenLessons: [],
      activities: [...input.activities].sort(byPosition).map(item => ({ ...item, origin: "course", hidden: false, replaces: null, replacedTitle: null })),
      hiddenActivities: [],
      reordered: false,
    };
  }
  const errors: string[] = [];
  const lessons = new Map(input.lessons.map(item => [item.id, item]));
  const sectionLessons = new Map(input.sectionLessons.map(item => [item.id, item]));
  const activities = new Map(input.activities.map(item => [item.id, item]));
  const sectionActivities = new Map(input.sectionActivities.map(item => [item.id, item]));
  const policyName = freedomPolicyLabel[input.policy];
  for (const override of input.overrides) {
    if (override.replaces && override.itemType !== "activity") errors.push("Solo una actividad puede reemplazar a otra.");
    if (override.replaces && input.policy !== "free") errors.push(`Con «${policyName}» no se reemplazan actividades del núcleo.`);
    const courseLesson = override.itemType === "lesson" ? lessons.get(override.itemId) : undefined;
    const courseActivity = override.itemType === "activity" ? activities.get(override.itemId) : undefined;
    if (override.hidden && courseLesson?.core) errors.push(`No se oculta la lección del núcleo «${courseLesson.title}» con «${policyName}». El núcleo se puede reordenar, no omitir.`);
    if (override.hidden && courseActivity?.core) errors.push(`No se oculta la actividad del núcleo «${courseActivity.title}» con «${policyName}».`);
    if (override.replaces && input.policy === "free") {
      const own = sectionActivities.get(override.itemId);
      const target = activities.get(override.replaces);
      if (!own || own.groupId === null) errors.push("El reemplazo tiene que ser una actividad propia de la sección.");
      else if (!target?.core) errors.push("Solo se reemplaza una actividad del núcleo.");
      else if (own.categoryId !== target.categoryId || own.points !== target.points) errors.push(`«${own.title}» no puede reemplazar a «${target.title}»: tiene que ser de la misma categoría y con los mismos puntos.`);
    }
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const overrideOf = (type: FreedomOverride["itemType"], id: string) => input.overrides.find(item => item.itemType === type && item.itemId === id);
  const reorderedUnits = new Set(input.lessons.filter(item => overrideOf("lesson", item.id)?.position !== null && overrideOf("lesson", item.id)?.position !== undefined).map(item => item.unitId));
  const hiddenLessons: EffectiveLesson[] = [];
  const visible: EffectiveLesson[] = [];
  const units = [...new Set([...input.lessons, ...input.sectionLessons].map(item => item.unitId))];
  for (const unitId of units) {
    const course = input.lessons.filter(item => item.unitId === unitId).sort(byPosition);
    const own = input.sectionLessons.filter(item => item.unitId === unitId);
    const reordered = reorderedUnits.has(unitId);
    const placed: EffectiveLesson[] = [];
    const fresh: EffectiveLesson[] = [];
    for (const item of course) {
      const override = overrideOf("lesson", item.id);
      const effective: EffectiveLesson = { ...item, origin: "course", hidden: !!override?.hidden, position: override?.position ?? item.position };
      if (effective.hidden) { hiddenLessons.push(effective); continue; }
      if (reordered && (override?.position === null || override?.position === undefined)) fresh.push(effective);
      else placed.push(effective);
    }
    for (const item of own) {
      const override = overrideOf("lesson", item.id);
      placed.push({ ...item, origin: "section", hidden: !!override?.hidden, position: override?.position ?? item.position });
    }
    placed.sort(byPosition);
    const tail = fresh.sort(byPosition);
    const start = placed.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    visible.push(...placed.filter(item => !item.hidden), ...tail.map((item, index) => ({ ...item, position: start + index })));
    hiddenLessons.push(...placed.filter(item => item.hidden && item.origin === "section"));
  }

  const replacedIds = new Set(input.overrides.filter(item => item.itemType === "activity" && item.replaces).map(item => item.replaces!));
  const hiddenActivities: EffectiveActivity[] = [];
  const effectiveActivities: EffectiveActivity[] = [];
  for (const item of [...input.activities].sort(byPosition)) {
    const override = overrideOf("activity", item.id);
    if (replacedIds.has(item.id)) continue;
    const effective: EffectiveActivity = { ...item, origin: "course", hidden: !!override?.hidden, replaces: null, replacedTitle: null };
    if (effective.hidden) hiddenActivities.push(effective);
    else effectiveActivities.push(effective);
  }
  for (const item of [...input.sectionActivities].sort(byPosition)) {
    const override = overrideOf("activity", item.id);
    const target = override?.replaces ? activities.get(override.replaces) : undefined;
    const effective: EffectiveActivity = { ...item, origin: "section", hidden: !!override?.hidden, replaces: override?.replaces || null, replacedTitle: target?.title || null, position: override?.position ?? (target?.position ?? item.position) };
    if (effective.hidden) hiddenActivities.push(effective);
    else effectiveActivities.push(effective);
  }
  effectiveActivities.sort(byPosition);
  return { ok: true, lessons: visible, hiddenLessons, activities: effectiveActivities, hiddenActivities, reordered: reorderedUnits.size > 0 };
}

export type CoverageClass = { date: string; lessonIds: string[]; cancelled?: boolean };
export type CoreCoverage = {
  lessons: { total: number; taught: number; planned: number; unplanned: number; unplannedIds: string[] };
  outcomes: { total: number; covered: number; withoutLessons: number; withoutLessonIds: string[] };
  behind: boolean;
};

/**
 * How far a section is with the core. A core lesson is taught, planned on a class, or still unplanned.
 * `behind` is true when a class already held has no core lesson planned for it.
 */
export function coreCoverage(coreLessons: { id: string; outcomeIds: string[] }[], coreOutcomes: { id: string }[], sectionPlan: CoverageClass[], taught: string[], today: string): CoreCoverage {
  const coreIds = new Set(coreLessons.map(item => item.id));
  const taughtIds = new Set(taught.filter(id => coreIds.has(id)));
  const plannedIds = new Set(sectionPlan.filter(item => !item.cancelled).flatMap(item => item.lessonIds).filter(id => coreIds.has(id) && !taughtIds.has(id)));
  const unplanned = coreLessons.filter(item => !taughtIds.has(item.id) && !plannedIds.has(item.id));
  const covered = new Set(coreLessons.filter(item => taughtIds.has(item.id) || plannedIds.has(item.id)).flatMap(item => item.outcomeIds));
  const withoutLessons = coreOutcomes.filter(item => !covered.has(item.id));
  const behind = sectionPlan.some(item => !item.cancelled && item.date < today && !item.lessonIds.some(id => coreIds.has(id)));
  return {
    lessons: { total: coreLessons.length, taught: taughtIds.size, planned: plannedIds.size, unplanned: unplanned.length, unplannedIds: unplanned.map(item => item.id) },
    outcomes: { total: coreOutcomes.length, covered: coreOutcomes.filter(item => covered.has(item.id)).length, withoutLessons: withoutLessons.length, withoutLessonIds: withoutLessons.map(item => item.id) },
    behind,
  };
}

export type DifferenceItem = { id: string; title: string; type: "lesson" | "activity" | "unit" };
export type SectionDifferenceSource = {
  id: string; name: string; educator: string;
  lessons: EffectiveLesson[];
  hiddenLessons: EffectiveLesson[];
  activities: EffectiveActivity[];
  hiddenActivities: EffectiveActivity[];
  reordered: boolean;
  coverage: CoreCoverage;
  proposals?: { id: string; title: string; type: DifferenceItem["type"]; status: "pending" | "accepted" | "rejected" }[];
};
export type SectionDifference = {
  id: string; name: string; educator: string;
  added: number; hidden: number; reordered: boolean; replacements: number;
  coreTaught: string; outcomes: string; behind: boolean;
  detail: {
    added: DifferenceItem[];
    hidden: DifferenceItem[];
    replacements: { id: string; title: string; replaces: string; replacedTitle: string }[];
    proposals: { id: string; title: string; type: DifferenceItem["type"]; status: "pending" | "accepted" | "rejected" }[];
    coverage: CoreCoverage;
  };
};

const countText = (done: number, total: number) => `${done} de ${total}`;

/** What each section added, hid, reordered or replaced, and whether its core coverage is behind. */
export function sectionDifferences(sections: SectionDifferenceSource[]): SectionDifference[] {
  return sections.map(section => {
    const added: DifferenceItem[] = [
      ...section.lessons.filter(item => item.origin === "section").map(item => ({ id: item.id, title: item.title, type: "lesson" as const })),
      ...section.activities.filter(item => item.origin === "section").map(item => ({ id: item.id, title: item.title, type: "activity" as const })),
    ];
    const hidden: DifferenceItem[] = [
      ...section.hiddenLessons.map(item => ({ id: item.id, title: item.title, type: "lesson" as const })),
      ...section.hiddenActivities.map(item => ({ id: item.id, title: item.title, type: "activity" as const })),
    ];
    const replacements = section.activities.filter(item => item.replaces).map(item => ({ id: item.id, title: item.title, replaces: item.replaces!, replacedTitle: item.replacedTitle || item.replaces! }));
    return {
      id: section.id, name: section.name, educator: section.educator,
      added: added.length, hidden: hidden.length, reordered: section.reordered, replacements: replacements.length,
      coreTaught: countText(section.coverage.lessons.taught, section.coverage.lessons.total),
      outcomes: countText(section.coverage.outcomes.covered, section.coverage.outcomes.total),
      behind: section.coverage.behind,
      detail: { added, hidden, replacements, proposals: section.proposals || [], coverage: section.coverage },
    };
  });
}

export type GradedFreedom = { section: string; activity: string; kind: "own" | "replacement" };

/** What changing the policy does, or why the grades already recorded do not allow it. */
export function policyChange(from: FreedomPolicy, to: FreedomPolicy, graded: GradedFreedom[]): { ok: true; message: string } | { ok: false; message: string; affected: GradedFreedom[] } {
  if (from === to) return { ok: true, message: "La política no cambia." };
  if (from === "shared") return { ok: true, message: "Todo el contenido y la evaluación actuales quedan como núcleo. Desmarca en Contenido y Evaluación lo que cada sección puede omitir." };
  const blocked = to === "shared" ? graded : to === "flexible" && from === "free" ? graded.filter(item => item.kind === "replacement") : [];
  if (to === "flexible" && from === "free" && !blocked.length) return { ok: true, message: "Los reemplazos dejan de aplicarse. Las actividades del núcleo vuelven a contar en cada sección." };
  if (to === "shared" && !blocked.length) return { ok: true, message: "Lo propio de cada sección queda guardado pero deja de mostrarse y de contar, y los ajustes se ignoran. Volver a la política anterior lo recupera todo." };
  if (!blocked.length) return { ok: true, message: `La política pasa a «${freedomPolicyLabel[to]}».` };
  const lines = blocked.map(item => `${item.section}: ${item.activity}`);
  const why = to === "shared"
    ? "No se puede volver a «Igual en todas las secciones»: hay actividades propias o reemplazos con notas."
    : "No se puede pasar a «Núcleo y adaptación»: hay reemplazos con notas.";
  return { ok: false, message: `${why} ${lines.join("; ")}.`, affected: blocked };
}
