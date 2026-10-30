# Ficha para Cursor: lote 4, libertad de cátedra por sección (1.3.6)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 4. Rama nueva `feat/HL-15-libertad-de-catedra` desde
`main` (con 1.3.4 integrado). **El diseño manda:** implementa exactamente `docs/design/libertad-de-catedra.md`. Si algo
no se puede hacer como está escrito, detente y explícalo en lugar de improvisar otra interfaz. Por omisión (política
`shared`) todo se comporta y se ve como hoy. Clases CSS nuevas con prefijo `freedom-`; no reutilices clases de otras
pantallas. Tres commits en la misma rama: dominio, esquema y API (4a); interfaz (4b); unidades propias, revisión y compartir (4c).

## Hoy

- El contenido es del curso: `learning_units` y `lessons` (`course_unit_id`, `position`, `archived`, borrador y
  publicado); el plan curricular (`course_outcomes`, `unit_outcomes`) y la cobertura por curso; el cronograma de cada
  sección planifica lecciones del curso en sus clases (`class_session_lessons`).
- Evaluación (1.3.1–1.3.3): el plan de evaluación (`assessment_activities`) es del curso y lo comparten sus secciones;
  se diseña en `Curso › Evaluación` (`apps/web/src/pages/course/Assessment.tsx`) y se califica en `Sección › Notas`.
- Grupos unificados (1.3.3): cada sección elige el conjunto de grupos de cada actividad en `section_activity_sets`.
- La configuración del curso hereda del programa y el programa puede fijar un ajuste (DEC-041).

## 4a · Dominio, esquema y API

### Política

Ajuste `sectionFreedom` en `CourseSettings` (heredable y fijable por el programa, como los demás): `shared` (por
omisión), `flexible` (núcleo obligatorio; la sección agrega, reordena y oculta lo que no es núcleo) y `free` (además
reemplaza una actividad de evaluación del núcleo por otra de la misma categoría y con los mismos puntos).
Cambiar de política valida lo descrito en la sección 1 del diseño (rechazo con la lista de lo afectado si hay notas).

### Modelo (migración `0065_section_freedom.sql`, registrar en `storage.ts`)

- **Núcleo:** `lessons.is_core` y `assessment_activities.is_core` (por omisión 1: lo existente es núcleo).
- **Propio de una sección:** `lessons.group_id` y `assessment_activities.group_id` (NULL = del curso). Una lección o
  actividad propia solo la ven y usan esa sección, la coordinación y la administración; nunca entra en el PDF de entrega
  ni en el cronograma de otra sección. Una actividad propia en grupos usa `section_activity_sets` de su sección.
- **Ajustes de la sección:** `section_content_overrides(group_id, item_type 'lesson'|'activity', item_id, position NULL,
  hidden 0/1, replaces NULL, updated_by, updated_at)`, clave `(group_id, item_type, item_id)`. `replaces` solo para
  actividades y solo en `free`.
- Validaciones en la API (y triggers donde sea posible): no se oculta ni reemplaza núcleo en `flexible`; no se reemplaza
  sin la misma categoría y puntos; no se oculta una lección ya impartida en la sección ni una actividad con notas.

### Dominio (puro, `packages/domain/src/section-freedom.ts`)

- `sectionContent(courseItems, sectionItems, overrides, policy)`: lecciones efectivas de una sección (orden, ocultas,
  propias) y su plan de evaluación efectivo; errores claros si un ajuste viola la política. Con `shared` devuelve
  exactamente lo del curso.
- `coreCoverage(coreLessons, coreOutcomes, sectionPlan, taught, today)`: lecciones del núcleo impartidas, planificadas y
  sin planificar; resultados del núcleo cubiertos y sin lecciones; `behind` cuando hay clases pasadas sin lecciones del
  núcleo planificadas.
- `sectionDifferences(sections)`: por sección, qué agregó, ocultó, reordenó o reemplazó y su cobertura.

### API

- Leer: los endpoints de hoy (contenido, cronograma, notas, PDF de entrega, espacio del estudiante) devuelven el
  contenido efectivo de la sección cuando la política no es `shared`; con `shared` las respuestas no cambian.
- `GET /api/sections/:id/plan` (contenido y evaluación efectivos con su origen, cobertura y acciones permitidas).
- `POST /api/sections/:id/lessons` (lección propia; mismo editor y validaciones que las del curso; la publica quien
  imparte la sección), `PUT|DELETE /api/sections/:id/content-overrides`, actividades propias y reemplazos en el plan
  de evaluación de la sección.
- `PUT /api/courses/:id/core` (marca o quita del núcleo lecciones, unidades enteras y actividades; solo si la política
  no es `shared`; responde cuántas secciones vuelven a mostrar algo).
- `GET /api/courses/:id/sections/differences` (responsable del curso, coordinación y administración).
- Todo queda en la actividad. Permisos: quienes imparten la sección para lo propio; el responsable del curso para el
  núcleo; coordinación y administración leen las diferencias y el plan de cualquier sección de su alcance.

## 4b · Interfaz (según el diseño)

1. Configuración del curso y del programa: el ajuste «Libertad de cátedra» con su explicación, fijable por el programa,
   y el diálogo de confirmación al cambiarlo.
2. Curso › Contenido y Curso › Evaluación: chip «Núcleo», opciones de menú por lección, unidad y actividad, «N en el
   núcleo» en la cabecera, «Núcleo: X de Y puntos» por periodo y el aviso con enlace a Diferencias.
3. Sección › Plan de la sección (`/secciones/:id/plan`, en la navegación después de «Cronograma», solo si la política no
   es `shared`): cobertura con su panel, pestañas Contenido y Evaluación (reutiliza los componentes de
   `Assessment.tsx` y el esquema de contenido; no los copies), lección propia con el editor de lecciones.
4. Cronograma, Notas, Grupos, PDF de entrega y espacio del estudiante con el contenido efectivo y los chips.
5. Curso › Secciones: pestaña «Diferencias» con la tabla y el panel lateral por sección.
6. Ayuda y `docs/api.md`.

## 4c · Unidades propias, revisión y compartir lo propio (sección 6 del diseño)

- Migración `0066_section_freedom_sharing.sql`: `learning_units.group_id`, `section_proposals`; ajuste
  `sectionFreedomReview` en `CourseSettings` (heredable y fijable por el programa).
- Dominio: `sectionContent` incluye unidades propias y unidades del curso ocultas; lo propio «En revisión» no cuenta en
  la nota ni se califica, y un reemplazo en revisión no aplica.
- API: unidades propias; aprobar o devolver lo propio cuando la política lo pide (con notificación); `POST
  /api/sections/:id/copies` (copiar a otras secciones del alcance); propuestas al curso (`POST` desde la sección,
  `GET` y decisión `accept|reject` con comentario para el responsable; al aceptar, copia en el curso y elección de la
  sección de origen).
- Interfaz según las secciones 6 y 7 del diseño, en un tercer commit.
- Pruebas: dominio (unidad propia, unidad oculta con núcleo rechazada, revisión), Worker (copia independiente, propuesta
  aceptada y rechazada, permisos, actividad en revisión fuera de la nota), `app.test.tsx` y la E2E de la sección amplía
  el recorrido con una propuesta aceptada.

## Semilla

Generador en `scripts/seed/` y migración `0067_demo_section_freedom.sql`, solo org-demo y tolerante
a lo existente: un curso universitario de la demostración en `flexible` con dos secciones, una con una lección propia y
una oculta, otra con una actividad propia; prueba en `tests/seed.test.ts`.

## Pruebas obligatorias

1. Dominio (`tests/section-freedom.test.ts`): las tres políticas; ocultar núcleo rechazado en `flexible`; reemplazo
   válido e inválido en `free`; orden efectivo con una lección nueva del curso; cobertura exacta (incluido `behind`);
   diferencias.
2. Worker (`tests/section-freedom-api.test.ts`): dos secciones del mismo curso con contenido distinto en `flexible`; una
   lección propia no aparece en la otra sección, en su cronograma ni en su PDF; el plan de evaluación efectivo de cada
   sección en la libreta; una actividad propia en grupos con `section_activity_sets`; cambio de política rechazado con
   notas; permisos (una persona de otra sección recibe 403); con `shared` las respuestas son idénticas a las de hoy.
3. Migración (`tests/test_migrations.py`) aplicada sobre datos existentes: todo queda como núcleo y del curso.
4. `tests/app.test.tsx`: chip y menú de núcleo, plan de la sección con las dos pestañas, diferencias.
5. E2E nueva `tests/e2e/section-freedom.spec.ts` (escritorio y móvil, nombres con `e2eName`): el responsable cambia la
   política y quita una lección del núcleo; la docente de una sección la oculta, crea una lección propia y una actividad
   propia; la otra sección no ve nada de eso; coordinación lo ve en Diferencias. `/secciones/:id/plan` y la pestaña
   Diferencias en `accessibility.spec.ts` y `layout.spec.ts`.
6. Pruebas existentes de contenido, cronograma, notas, grupos y PDF de entrega **sin cambios** en sus aserciones.

## Definición de terminado

`./scripts/verify` completo **sin servidores locales sobrantes** (cierra `wrangler dev` y `workerd` antes); E2E nuevas y
afectadas en escritorio y móvil; ninguna aserción relajada ni con mensajes sin comprobar; **capturas** en 1440 y 390 de
las pantallas de las secciones 5 y 7 del diseño en `.release-evidence/screenshots/lote-4/`; versión 1.3.6 y `CHANGELOG.md`;
tres commits `HL-15 ST-049: libertad de cátedra por sección, dominio y API (lote 4a)`,
`HL-15 ST-049: libertad de cátedra por sección, interfaz (lote 4b)` y
`HL-15 ST-049: unidades propias, revisión y propuestas al curso (lote 4c)` en `feat/HL-15-libertad-de-catedra`, sin push ni PR.
