# Ficha para Cursor: lote 2b, evaluación agnóstica (esquema y API)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 2. Usa el motor del lote 2a (`packages/domain/src/grading.ts`).
Rama `feat/HL-15-evaluacion`. **Sin interfaz** (lote 2c); la libreta actual debe seguir funcionando igual.

## Hoy

- Libreta: `apps/api/src/gradebook.ts` (0049 notas por periodo; 0055 plan de evaluación por puntos con
  `assessment_activities` y `assessment_scores`, comentarios, historial y revisión de cierre).
- La política de notas sale de la configuración del curso con herencia del programa (`configurationOf`):
  `gradeScale`, `passingGrade`, `letterThresholds`, `gradeAverage`.

## Decisiones

1. **El esquema es un ajuste más de la configuración** (`gradingSchemeId` en `CourseSettings`), heredable y fijable
   por el programa como los demás (DEC-041). Sin esquema elegido, el esquema efectivo es `pointsScheme` con los ajustes
   actuales traducidos (escala, mínimo, umbrales, promedio): nueva función de dominio `schemeFromSettings(settings)`,
   con prueba de que reproduce exactamente las respuestas actuales de la libreta.
2. **Esquemas de la organización** en `grading_schemes` (id `scheme-<uuid>`, organización, `config` JSON validado con
   `schemeInput`, `builtin`, timestamps); administración los crea, edita y archiva; un esquema en uso no se borra
   (se archiva). «Agregar desde plantilla» copia una de `schemeTemplates`.
3. **Actividades:** `assessment_activities` gana `category_id` (por omisión `general`), `grading`
   (`points` por omisión), `extra`, `retake_of`, `rubric` (JSON validado con `rubricInput`) y `panel` (JSON:
   `combine`, `chair`). Las de hoy quedan como `points` en `general` (migración aditiva).
4. **Marcas:** `assessment_scores` sigue siendo la marca de puntos (sin cambiar su camino). Nueva
   `assessment_marks(activity_id, learner_id, evaluator_id, mark JSON, updated_by, updated_at)` con clave única
   (actividad, estudiante, evaluador; evaluador NULL salvo panel) para rúbrica, aprobado, nivel, exonerado y cada
   marca de panel. Mismas reglas de bloqueo por periodo cerrado o entregado que `assessment_scores` (triggers).
5. **Tribunal:** `assessment_evaluators(activity_id, user_id, chair)`. Cada evaluador escribe **solo su marca**, aunque
   no imparta la sección; nadie ve las marcas individuales de los demás hasta que el tribunal completa la actividad
   (administración y quien imparte sí). El historial registra cada marca.
6. **Cálculo:** al guardar, la nota del periodo (`section_grades`) se recalcula con `learnerResult` del esquema
   efectivo, como hoy con el plan de puntos. La respuesta de la libreta agrega `scheme`, `marks` y, por estudiante,
   `display`, `level`, `reasons` y `final`, sin quitar campos actuales.

## Migración `0060_grading_schemes.sql` (registrar en `storage.ts`)

Aditiva. No reescribas 0049 ni 0055. Prueba en `tests/test_migrations.py`: columnas con valores por omisión correctos,
claves únicas de marcas y evaluadores, triggers de bloqueo en marcas y que una actividad con marcas no se borra.

## API

- `GET|POST /api/grading-schemes`, `PUT|DELETE /api/grading-schemes/:id`, `POST /api/grading-schemes/templates/:templateId`.
- `PUT …/grades/periods/:periodId/plan` acepta los campos nuevos de actividad (validados).
- `PUT /api/sections/:id/grades` acepta además `marks: [{ activityId, learnerId, mark }]`.
- `PUT /api/sections/:id/grades/activities/:activityId/panel` con `{ learnerId, mark }`: la marca del evaluador que
  llama; `PUT …/activities/:activityId/evaluators` con `{ evaluators: [{ userId, chair }] }` (quien imparte o
  administración, antes de que haya marcas).
- La boleta PDF y el CSV muestran el `display` del esquema (letras, GPA, niveles, aprobado) y las razones.

## Pruebas obligatorias

1. `tests/gradebook.test.ts` **sin cambios** y en verde (equivalencia).
2. Nuevo `tests/grading-api.test.ts` sobre el Worker: esquema universitario (categorías ponderadas, GPA, examen
   mínimo) con una actividad de rúbrica, una reposición y una exoneración; tribunal de 3 con presidente: cada uno ve
   solo lo suyo, el resultado combinado aparece al completar y un evaluador ajeno recibe 403; esquema de niveles con
   boleta que dice el nivel; permisos (educador no edita esquemas, otra organización no ve nada).
3. `schemeFromSettings` en `tests/grading.test.ts` (agregar casos, sin cambiar los existentes).

## Definición de terminado

`./scripts/verify` completo; `docs/api.md` con la sección nueva; ninguna aserción relajada; un commit
`HL-15 ST-049: evaluación agnóstica, esquema y API (lote 2b)` en la rama `feat/HL-15-evaluacion`, sin push ni PR.
