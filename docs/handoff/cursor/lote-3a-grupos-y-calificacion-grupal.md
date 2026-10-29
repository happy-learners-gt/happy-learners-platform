# Ficha para Cursor: lote 3a, grupos de trabajo y calificación grupal (dominio, esquema y API)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 3. Rama nueva `feat/HL-15-grupos` desde `main`.
**Sin interfaz** (lote 3b). Lo actual (grupos de 0025 y la libreta de 1.3.1) debe seguir funcionando igual.

## Hoy

- `0025_work_groups.sql`: `work_groups` (de una sección), `work_group_members`, `activity_work_groups` (qué grupos
  hacen una actividad de una lección publicada). API en `apps/api/src/workgroups.ts`; UI en
  `apps/web/src/pages/sections/WorkGroups.tsx`.
- Evaluación (1.3.1): `assessment_activities`, `assessment_scores` (puntos), `assessment_marks` (otras marcas),
  `learnerResult` en `packages/domain/src/grading.ts`. La asistencia de cada clase está en las tablas de asistencia.

## 1. Formación de grupos (dominio puro, nuevo `packages/domain/src/group-formation.ts`)

`formGroups(learners, rules, seed)`, determinista con una semilla (PRNG propio, sin `Math.random`):

- **Quiénes:** toda la lista activa, o solo los **presentes** en una clase (la API pasa la lista ya filtrada).
- **Cuántos:** por tamaño (`size`, con reparto parejo: 10 en grupos de 3 → 3, 3, 4) o por cantidad (`count`).
- **Cómo:** `random`; `balanced` por una calificación previa (reparte a los de cada banda entre los grupos);
  `mixed` por un atributo nominal que la API provee (por ejemplo, el grupo anterior: nadie repite compañeros si se
  puede).
- **Restricciones:** pares que deben ir separados y pares que deben ir juntos; tamaño mínimo y máximo. Si no se pueden
  cumplir todas, devuelve el mejor reparto y la lista de restricciones que no se cumplieron (nunca falla en silencio).
- Nombres «Grupo 1», «Grupo 2»… o con un prefijo.
- `groupRulesInput(input)`: validación con mensajes en español (tú).

## 2. Conjuntos de grupos (migración `0061_group_sets.sql`, registrar en `storage.ts`)

- `work_group_sets` (id `groupset-<uuid>`, organización, sección, nombre, `rules` JSON con la semilla usada, `source`
  `manual` | `generated`, `session_id` NULL o la clase de la que se tomaron los presentes, `archived`, timestamps,
  `created_by`). `work_groups.set_id` NULL = los grupos de siempre de la sección (compatibilidad).
- Un conjunto se reutiliza en varias actividades y se puede **regenerar** con otra semilla mientras ninguna actividad
  calificada lo use.

## 3. Calificación grupal (misma migración)

- `assessment_activities` gana `group_mode` (`individual` por omisión | `group`) y `work_group_set_id`.
- `assessment_group_marks(activity_id, work_group_id, mark JSON, updated_by, updated_at)`: una marca por grupo
  (cualquier forma de 1.3.1: puntos, rúbrica, nivel, aprobado…).
- `assessment_group_adjustments(activity_id, learner_id, kind, value, note, updated_by, updated_at)`: `kind` en
  `factor` (multiplica la nota del grupo, de 0 a 2), `override` (nota propia), `peer` (coevaluación).
- **Coevaluación (WebPA):** `assessment_peer_ratings(activity_id, rater_id, ratee_id, score 0–5)`, registradas por quien
  imparte en este lote. Factor individual = puntaje recibido ÷ promedio del grupo, acotado a [0,5; 1,5] (configurable
  en la actividad).
- **Propagación (dominio puro, `groupToIndividual(...)`):** la marca del grupo pasa a cada integrante con su ajuste;
  la API la escribe en `assessment_scores`/`assessment_marks` con una columna nueva `source` (`individual` | `group`)
  para que la libreta, el motor, la boleta y el CSV la usen sin cambios. Un estudiante que no estuvo en ningún grupo
  queda sin marca (nunca cero); uno exonerado sigue exonerado; una marca individual escrita a mano gana sobre la del
  grupo y se indica en la respuesta.
- Mismas reglas de bloqueo por periodo cerrado o entregado que las demás marcas.

## API

- `POST /api/sections/:id/group-sets?preview=1` y sin `preview`: `{ name, rules, sessionId? }` → vista previa y
  creación (con los grupos y las restricciones no cumplidas); `PUT|DELETE /api/sections/:id/group-sets/:setId`
  (renombrar, mover integrantes, archivar); `POST …/:setId/regenerate`.
- `PUT /api/sections/:id/grades/activities/:activityId/groups` con `{ workGroupId, mark }`;
  `PUT …/adjustments` con `{ learnerId, kind, value, note }`; `PUT …/peer-ratings` con `{ ratings: [...] }`.
- La libreta agrega por actividad grupal sus grupos, marcas de grupo, ajustes y el origen de cada marca individual.
- Quién: administración y quienes imparten la sección; todo queda en la actividad sin valores de notas.

## Pruebas obligatorias

1. `tests/group-formation.test.ts`: reparto parejo, semilla reproducible, solo presentes, `balanced` y `mixed`,
   separados/juntos, restricciones imposibles reportadas, validación (al menos 8 rechazos).
2. Dominio de propagación: factor, override, WebPA con valores exactos y acotado, sin grupo, exonerado, marca manual que gana.
3. Worker (`tests/group-grading.test.ts`): conjunto aleatorio de presentes de una clase; actividad grupal con rúbrica
   calificada por grupo que aparece en la libreta de cada integrante; ajuste por factor y por coevaluación; periodo
   entregado bloquea; permisos (otro educador 403, otra organización 404).
4. Migración (`tests/test_migrations.py`) y las pruebas existentes de grupos y de notas **sin cambios**.

## Definición de terminado

`./scripts/verify` completo; `docs/api.md` al día; ninguna aserción relajada; un commit
`HL-15 ST-049: grupos y calificación grupal, dominio y API (lote 3a)` en `feat/HL-15-grupos`, sin push ni PR.
