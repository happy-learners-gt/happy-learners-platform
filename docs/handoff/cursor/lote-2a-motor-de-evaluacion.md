# Ficha para Cursor: lote 2a, motor de evaluación (1.3.1-a)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 2. **Solo dominio y pruebas** (sin migración, API ni UI);
rama nueva `feat/HL-15-evaluacion` desde `main`. El lote 2b guarda y expone lo que aquí se calcula; 2c es la interfaz.

## Hoy (no lo rompas)

- `packages/domain/src/gradebook.ts`: nota de 0 a 100 con un decimal, letras A–F por umbrales, promedio simple o
  ponderado por periodo, «un periodo sin nota no es cero» (`averageOf`, `gradeResult`), y el plan de evaluación por
  puntos acumulados de 1.2.3 (`periodFromPlan`, plantillas zona/examen). Sus pruebas (`tests/gradebook.test.ts`)
  deben seguir pasando sin cambios: el esquema «puntos acumulados» del motor nuevo debe dar exactamente lo mismo.

## Objetivo

Un motor puro que calcule el resultado de cada estudiante para **cualquier** forma de evaluar, configurada como datos.

## Archivos

- Nuevo `packages/domain/src/grading.ts` (exportar desde `index.ts`); tipos que cruzan la API en
  `packages/contracts/src/index.ts`.
- Nueva prueba `tests/grading.test.ts`. No toques otros archivos salvo los `export`.

## Modelo

```ts
type GradingScheme = {
  id: string; name: string;
  // How an activity's result turns into the period's result.
  method: "points" | "weighted-categories" | "pass-fail" | "levels";
  categories: { id: string; label: string; weight?: number; dropLowest?: number; minimum?: number }[]; // weight %: suma 100 en weighted-categories
  levels?: { id: string; label: string; value?: number }[];   // ordenados de mayor a menor (Destacado, Logrado, En proceso, Inicio)
  display: { kind: "numeric"; max: number; decimals: 0 | 1 | 2 } | { kind: "letters"; thresholds: { letter: string; min: number }[] }
         | { kind: "gpa"; thresholds: { letter: string; min: number; points: number }[] } | { kind: "levels" } | { kind: "pass-fail" };
  passing: { min?: number; level?: string };                 // nota mínima (0–100) o nivel mínimo
  periods: "simple" | "weighted" | "cumulative" | "last" | "none"; // cómo se combinan los periodos del ciclo
  extraCreditCap?: number;                                   // puntos extra máximos sobre 100 (0 = sin extra)
  retakes: "replace" | "highest" | "average";                // cómo cuenta una reposición o recuperación
};
type Activity = { id: string; periodId: string; categoryId: string; title: string; points: number;
  grading: "points" | "rubric" | "pass-fail" | "level" | "panel"; extra?: boolean; retakeOf?: string;
  rubric?: Rubric; panel?: { combine: "average" | "median" | "majority" | "chair"; chair?: string } };
type Rubric = { criteria: { id: string; label: string; weight: number; levels: { id: string; label: string; points: number }[] }[] };
type Mark =  // lo que una persona registra para un estudiante en una actividad
  | { kind: "points"; value: number } | { kind: "pass"; value: boolean } | { kind: "level"; value: string }
  | { kind: "rubric"; choices: Record<string, string> }       // criterio → nivel
  | { kind: "panel"; marks: { evaluator: string; mark: Exclude<Mark, { kind: "panel" }> }[] }
  | { kind: "exempt" };                                       // exonerado: no cuenta ni como cero
type LearnerResult = { periods: { periodId: string; score: number | null; display: string | null; level: string | null;
  graded: number; complete: boolean; passed: boolean | null; reasons: string[] }[];
  final: { score: number | null; display: string | null; passed: boolean | null; complete: boolean; reasons: string[] } };
```

## Funciones

- `schemeInput(input)` / `rubricInput(input)`: validación con mensajes en español (tú), como `scheduleInput`.
- `markValue(activity, mark)`: el resultado de una marca en la escala de la actividad (0..points), o `null`; el
  panel combina las marcas de cada evaluador según `combine` (con `chair`, la del presidente decide; empate en
  `majority` → la del presidente o, sin presidente, la media).
- `learnerResult(scheme, activities, marks, periods)`: aplica categorías y pesos, `dropLowest`, extra hasta
  `extraCreditCap`, reposiciones según `retakes`, exoneraciones, mínimos por categoría (si no se alcanza,
  `passed = false` con la razón en `reasons`), niveles (el nivel del periodo es el más frecuente o el del promedio de sus
  `value`; documenta la regla), y combina los periodos según `periods`. Un periodo o actividad sin marca nunca es cero.
- `displayOf(scheme, score | level)`: el texto que se muestra (85,5 · B · 3,0 · «Logrado» · «Aprobado»).
- `schemeTemplates`: datos de ejemplo, no lógica: colegio (zona 60 / examen 40 en puntos), universidad (categorías
  ponderadas, letras con GPA 4.0, examen final mínimo 60), academia de idiomas (niveles MCER por competencia), técnica
  tipo INTECAP (competencias logrado/no logrado), artes (rúbrica de interpretación y panel de recital), seminario o
  taller (aprobado/no aprobado por asistencia y entrega), doctorado (examen privado con tribunal y dictamen).
- `pointsScheme`: el esquema que reproduce exactamente el comportamiento de 1.2.3.

## Pruebas obligatorias (`tests/grading.test.ts`)

1. **Equivalencia:** con `pointsScheme`, los casos de `tests/gradebook.test.ts` (plan zona/examen, parcial, sin nota no
   es cero, ponderado por periodo, letras) dan los mismos números.
2. Categorías ponderadas con `dropLowest`, mínimos por categoría con razón, extra con tope.
3. Reposición en los tres modos; exonerado que no cuenta; actividad sin marca.
4. Rúbrica: 3 criterios con pesos distintos → puntos exactos.
5. Panel: promedio, mediana, mayoría con empate, presidente que decide; un evaluador sin marca.
6. Niveles y aprobado/no aprobado de punta a punta; GPA con dos decimales.
7. Combinación de periodos: simple, ponderado, acumulado, último y ninguno.
8. Cada plantilla de `schemeTemplates` es válida según `schemeInput` y produce un resultado razonable para un caso de
   ejemplo escrito en la prueba (valores exactos).
9. `schemeInput` y `rubricInput`: al menos 10 rechazos con su mensaje (pesos que no suman 100, umbrales desordenados,
   niveles repetidos, panel sin forma de combinar…).

## Definición de terminado

Funciones puras, sin dependencias, en UTC donde haya fechas; comentarios en inglés y textos en español informal;
`npx vitest run tests/grading.test.ts tests/gradebook.test.ts` y `npm run typecheck` en verde, y `./scripts/verify`;
ninguna aserción que acepte varios resultados; un commit `HL-15 ST-049: motor de evaluación (lote 2a)` en la rama
`feat/HL-15-evaluacion`, sin push ni PR.
