# Ficha para Cursor: lote 4a, libertad de cátedra por sección (dominio, esquema y API)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 4. Rama nueva `feat/HL-15-libertad-de-catedra` desde
`main`. **Sin interfaz** (lote 4b). Por omisión todo se comporta como hoy: el curso es uno solo para todas sus
secciones.

## Hoy

- El contenido es del curso: `learning_units` y `lessons` (`course_unit_id`, `position`, `archived`, borrador y
  publicado); el plan curricular (`course_outcomes`, `unit_outcomes`) y la cobertura por curso; el cronograma de cada
  sección planifica lecciones del curso en sus clases (`class_session_lessons`).
- Evaluación (1.3.1–1.3.2): el plan de evaluación (`assessment_activities`) es del curso y lo comparten sus secciones.
- La configuración del curso hereda del programa y el programa puede fijar un ajuste (DEC-041).

## Política

Nuevo ajuste `sectionFreedom` en `CourseSettings` (heredable y fijable por el programa, como los demás):

- `shared` (por omisión, lo de hoy): todas las secciones siguen el mismo contenido y el mismo plan de evaluación.
- `flexible`: hay un **núcleo** obligatorio; cada sección puede agregar lecciones y actividades de evaluación propias,
  reordenar y ocultar lo que **no** es núcleo.
- `free`: como `flexible`, y además una sección puede reemplazar actividades de evaluación del núcleo por otras de la
  misma categoría y con los mismos puntos (los resultados de aprendizaje del núcleo siguen siendo obligatorios).

## Modelo (migración `0062_section_freedom.sql`, registrar en `storage.ts`)

- **Núcleo:** `lessons.is_core` y `assessment_activities.is_core` (por omisión 1: lo existente es núcleo). El núcleo de
  resultados de aprendizaje son los del plan curricular del curso (sin cambio).
- **Propio de una sección:** `lessons.group_id` y `assessment_activities.group_id` (NULL = del curso). Una lección o
  actividad propia solo la ven y usan esa sección y la coordinación o administración; nunca entra en el PDF de entrega de
  otra sección ni en su cronograma.
- **Ajustes de la sección:** `section_content_overrides(group_id, item_type 'lesson'|'activity', item_id, position NULL,
  hidden 0/1, replaces NULL, updated_by, updated_at)`. `replaces` solo para actividades en `free`.
- Triggers o validaciones: no se oculta ni reemplaza núcleo en `flexible`; no se reemplaza sin la misma categoría y puntos.

## Dominio (puro, `packages/domain/src/section-freedom.ts`)

- `sectionContent(courseItems, sectionItems, overrides, policy)`: la lista efectiva de lecciones de una sección (orden,
  ocultas, propias) y su plan de evaluación efectivo; errores claros si un ajuste viola la política.
- `coreCoverage(coreOutcomes, sectionLessons, taught)`: cobertura del núcleo en la sección (planificado, impartido,
  sin cubrir).
- `sectionDifferences(sections)`: para coordinación, qué agregó, ocultó, reordenó o reemplazó cada sección respecto al
  núcleo.

## API

- Leer: la sección ve su contenido efectivo en los mismos endpoints de hoy (contenido, cronograma, notas) cuando la
  política no es `shared`; con `shared` las respuestas no cambian.
- `POST /api/sections/:id/lessons` (lección propia, mismo editor y validaciones que las del curso; la redacta quien
  imparte la sección), `PUT|DELETE /api/sections/:id/content-overrides`, y actividades propias o reemplazos en el plan de
  evaluación de la sección.
- `GET /api/courses/:id/sections/differences` (responsable del curso, coordinación y administración).
- El responsable del curso marca qué lecciones y actividades son núcleo (`PUT …/core`), solo si la política no es `shared`.
- Todo queda en la actividad; permisos: quienes imparten la sección para lo propio; el responsable del curso para el
  núcleo; coordinación y administración leen las diferencias.

## Pruebas obligatorias

1. Dominio (`tests/section-freedom.test.ts`): las tres políticas, ocultar núcleo rechazado en `flexible`, reemplazo
   válido e inválido en `free`, orden efectivo, cobertura del núcleo exacta, diferencias.
2. Worker (`tests/section-freedom-api.test.ts`): dos secciones del mismo curso con contenido distinto en `flexible`; una
   lección propia no aparece en la otra sección ni en su PDF; el plan de evaluación efectivo de cada sección en la libreta;
   la coordinación ve las diferencias; con `shared` todo sigue igual que hoy.
3. Migración (`tests/test_migrations.py`) aplicada sobre datos existentes: todo queda como núcleo y del curso.
4. Pruebas existentes de contenido, cronograma, notas y PDF de entrega **sin cambios**.

## Definición de terminado

`./scripts/verify` completo **sin servidores locales sobrantes**; `docs/api.md` al día; ninguna aserción relajada ni con
mensajes sin comprobar; un commit `HL-15 ST-049: libertad de cátedra por sección, dominio y API (lote 4a)` en
`feat/HL-15-libertad-de-catedra`, sin push ni PR.
