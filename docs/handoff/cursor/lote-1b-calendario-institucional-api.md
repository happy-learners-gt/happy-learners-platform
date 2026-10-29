# Ficha para Cursor: lote 1b, calendario institucional (esquema y API)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 1. Usa el motor del lote 1a
(`packages/domain/src/calendar-rules.ts`). Trabaja sobre la rama `feat/HL-15-motor-de-fechas`. **Sin interfaz**: la UI
es el lote 1c; la interfaz actual (Días sin clase, Horario) debe seguir funcionando igual gracias a la compatibilidad.

## Hoy

- `calendar_breaks` (0023): días sin clase de la organización (`group_id` NULL) o de una sección. API `GET|POST
  /api/calendar`, `DELETE /api/calendar/:id` en `apps/api/src/classes.ts` (`calendar()`), y `breaksOf()` alimenta
  `applySchedule()`, que rehace las clases pendientes de las secciones afectadas.
- `academic_years` (0048): un ciclo vigente por organización (`academic_years_one_current`).
- Jornadas (0057) y reuniones por día (`course_groups.schedule_meetings`).

## Modelo nuevo (migración `0059_institutional_calendar.sql`, siguiente libre; registrar en `storage.ts`)

- `calendars`: id `calendar-<uuid>`, `organization_id`, `scope` (`organization` | `program` | `section`), `scope_id`
  (NULL para la organización), `name`, timestamps; único por (organización, alcance, scope_id).
- `calendar_categories`: id, organización, `key`, `label`, `no_class_default` (0/1), `builtin` (0/1). Categorías
  base que se crean para cada organización existente en la migración y, para las nuevas, al primer uso: `no-class`
  (Día sin clase, 1), `holiday` (Asueto, 1), `academic-period` (Periodo académico), `admissions` (Admisiones),
  `enrollment` (Inscripciones), `course-selection` (Asignación de cursos), `exams` (Exámenes), `make-up`
  (Recuperación), `extracurricular` (Actividad extracurricular), `performance` (Competencia o presentación),
  `institutional` (Institucional).
- `calendar_rules`: id `rule-<uuid>`, `calendar_id`, organización, `category_id`, `rule` (JSON con un `DateRule` validado
  por `ruleInput`, cuyo `id` es el de la fila), `no_class` (0/1), timestamps, `created_by`.
- `calendar_events`: id `event-<uuid>`, `calendar_id`, organización, `category_id`, `title`, `starts_on`, `ends_on`,
  `part`, `no_class`, `rule_id` (NULL si es un evento suelto), `year` (año que generó la regla), `status`
  (`active` | `skipped`), timestamps, `created_by`. Una regla genera un evento por ocurrencia y año; una ocurrencia se
  puede mover (fechas propias) o saltar sin tocar la regla.
- `academic_years.program_id` NULL (el ciclo de la organización) o un programa (ciclo propio, por ejemplo una maestría):
  reemplaza el índice de un vigente por organización por uno por (organización, `COALESCE(program_id, '')`).
- `course_groups.schedule_period_id` NULL: si la sección sigue un periodo, su horario toma `from`/`until` del periodo.
- **Migración de datos:** cada fila de `calendar_breaks` pasa a `calendar_events` (`no-class`, `no_class = 1`) en el
  calendario de la organización o de su sección (creándolos). `calendar_breaks` deja de escribirse; no se borra.

## Reglas de negocio (dominio puro, nuevo `packages/domain/src/institutional-calendar.ts`)

- `noClassDays(events, range)`: los rangos sin clase activos `{ from, until, part }` (excluye `skipped`). Un día
  completo quita todas las clases de esas fechas; medio día quita solo las clases que **empiezan** en esa mitad
  (`morning`: antes de las 12:00; `afternoon`: desde las 12:00), usando la hora de la reunión de ese día
  (`meetingOn`). Pruébalo con una sección de mañana y otra de tarde.
- **Calendario efectivo de una sección** = organización + programa de su curso + sección; los eventos de un nivel
  inferior no anulan los de arriba (se suman). Un evento `skipped` en un nivel inferior **no** salta uno de arriba.
- `generateYear(rules, year, existing)`: qué eventos crear, actualizar (regla editada) o dejar (ocurrencias movidas o
  saltadas a mano se respetan) para un año; devuelve un plan `{ create, update, keep }` para la vista previa.

## API (nuevo `apps/api/src/institutional-calendar.ts`, cableado en `index.ts` como los demás módulos)

- `GET /api/calendars` (todas las personas): los calendarios visibles con sus categorías.
- `GET /api/calendars/view?from&until[&program][&section]`: eventos del calendario efectivo con su origen (nivel y
  calendario), para la vista del lote 1c.
- Administración (coordinación con `sections.assign` en su alcance para programas y secciones):
  `POST|PUT|DELETE /api/calendars/:id/rules[/:ruleId]`, `POST|PUT|DELETE /api/calendars/:id/events[/:eventId]`
  (incluye mover o saltar una ocurrencia), `POST /api/calendars/:id/years/:year/generate?preview=1` (plan) y sin
  `preview` (aplica), `POST /api/calendars/:id/templates/guatemala` (agrega las reglas de la plantilla con categoría
  `holiday`, sin duplicar por título).
- Todo cambio de un evento sin clase reprograma las clases pendientes de las secciones afectadas reutilizando
  `applySchedule()` (como hace hoy `calendar()`), y la actividad lo registra.
- **Compatibilidad:** `GET|POST /api/calendar` y `DELETE /api/calendar/:id` siguen funcionando con la misma forma de
  respuesta, leyendo y escribiendo eventos `no-class`. `breaksOf()` lee el calendario efectivo. Las pruebas existentes
  (`tests/e2e/calendar.spec.ts`, `tests/calendar-feed.test.ts`, `tests/preferences.test.ts`, `tests/classes.test.ts`) no
  se modifican y deben pasar.
- El horario de una sección acepta `periodId` en `PUT …/schedule` (toma las fechas del periodo; error claro si el
  periodo no es del ciclo vigente de su organización o programa).

## Pruebas obligatorias

1. Dominio (`tests/institutional-calendar.test.ts`): `noClassDays`, suma de niveles, `generateYear` con regla nueva,
   editada, ocurrencia movida y saltada.
2. Worker (en el mismo archivo o en `tests/academic-years.test.ts`): plantilla de Guatemala aplicada y año 2027
   generado con vista previa; un asueto nuevo sin clase mueve las clases pendientes de una sección; un evento de programa
   solo afecta a sus secciones; un ciclo propio de un programa convive con el de la organización; permisos (educador no
   escribe, otra organización no ve); compatibilidad de `/api/calendar`.
3. Migración (`tests/test_migrations.py`): datos de `calendar_breaks` migrados al calendario correcto, índices únicos,
   y dos ciclos vigentes (organización y programa) aceptados mientras dos de la organización se rechazan.

## Definición de terminado

`./scripts/verify` completo; pruebas existentes sin cambios; ninguna aserción relajada; `docs/api.md` con la sección
nueva; un commit `HL-15 ST-049: calendario institucional, esquema y API (lote 1b)` en la misma rama, sin push ni PR.
