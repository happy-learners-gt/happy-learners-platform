# Ficha para Cursor: lote 3c, rediseño de la evaluación y unificación de grupos (1.3.3)

Rama nueva `feat/HL-15-evaluacion-rediseno` desde `main`. **El diseño manda:** implementa exactamente
`docs/design/evaluacion.md` (lugares, estructura de cada pantalla, textos y flujo). Si algo del diseño no se puede hacer
como está escrito, detente y explica por qué en tu respuesta en lugar de improvisar otra interfaz.

## Alcance

1. **Dominio:** `schemeExplanation(scheme)` en `packages/domain/src/grading.ts`: el texto en lenguaje natural del
   diseño (categorías con pesos, descartes, mínimos, forma de mostrar, combinación de periodos, mínimo para aprobar),
   probado para las 7 plantillas con el texto exacto esperado.
2. **API:**
   - `GET /api/courses/:id/assessment?year=`: esquema efectivo con su explicación, periodos con su estado (completo,
     faltan puntos, pesos que no suman), actividades por periodo con si tienen notas y qué se puede cambiar.
   - `POST|PUT|DELETE /api/courses/:id/assessment/activities[/:activityId]`: una actividad a la vez (no el reemplazo de
     toda la lista), con las mismas validaciones y protecciones de 1.3.1–1.3.2; `POST …/periods/:periodId/template` y
     `…/copy-from/:periodId`.
   - Permisos: editar = administración y el equipo del curso con permiso de edición; leer = quien ve el curso.
   - `PUT /api/sections/:id/grades/periods/:periodId/plan` sigue funcionando (compatibilidad) pero la interfaz deja de usarlo.
3. **Grupos unificados** (migración `0062_section_activity_sets.sql`):
   - Conjunto por defecto «Grupos de la sección» por sección con grupos de 0025 (`work_groups.set_id` NULL pasa a ese
     conjunto); `activity_work_groups` se conserva para saber qué grupos hacen cada actividad de lección.
   - `section_activity_sets(group_id, activity_id, kind, set_id)` y migración de `assessment_activities.work_group_set_id`.
   - La calificación grupal lee el conjunto de **la sección** que califica.
   - API de la página de Grupos con «Se usa en» y la lista única «Actividades en grupos».
4. **Interfaz:** las cuatro pantallas del diseño. Quita `GradePlanDialog` de Notas. Corrige el descriptor de la rúbrica
   (campo propio `description` en el nivel, con migración de datos si hace falta, y validación en `rubricInput`).
5. **Ayuda y `docs/api.md`.**

## Pruebas

- `tests/grading.test.ts`: `schemeExplanation` exacta para las 7 plantillas.
- API (`tests/assessment-course.test.ts`): crear, editar y borrar una actividad; protección con notas (mensaje exacto);
  plantilla y copia; dos secciones del mismo curso califican la misma evaluación en grupos con **sus propios** conjuntos;
  permisos (colaborador sin permiso de edición 403, otra organización 404).
- Migración: los grupos de siempre quedan en el conjunto por defecto; el conjunto de una evaluación queda asignado a su
  sección.
- `tests/app.test.tsx`: la página Evaluación muestra la explicación y las categorías con su peso; el panel de actividad
  guarda una rúbrica con descriptores; Notas ya no tiene «Editar el plan» y enlaza a Evaluación.
- E2E `tests/e2e/assessment-design.spec.ts` (escritorio y móvil): diseñar un periodo (actividad de puntos, de rúbrica y
  en grupos), elegir el conjunto en Grupos de dos secciones, calificar en Notas. Actualiza las E2E de notas y grupos que
  usaban el diálogo anterior **solo en los pasos de diseño**; sus aserciones de calificación no cambian.
- `/cursos/:id/evaluacion` en `accessibility.spec.ts` y `layout.spec.ts`.

## Definición de terminado

`./scripts/verify` completo sin servidores sobrantes; E2E nuevas y afectadas en escritorio y móvil; **capturas** en 1440
y 390 de: Evaluación con dos categorías, el panel de actividad con una rúbrica, Grupos con dos conjuntos y «Se usa en», y
Notas con la explicación, en `.release-evidence/screenshots/lote-3c/`; versión 1.3.3 y `CHANGELOG.md`; un commit
`HL-15 ST-049: rediseño de la evaluación y grupos unificados (lote 3c)`, sin push ni PR.
