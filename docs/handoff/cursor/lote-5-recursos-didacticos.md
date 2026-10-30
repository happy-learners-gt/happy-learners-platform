# Ficha para Cursor: lote 5, biblioteca de recursos didácticos (1.3.7)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 5. Rama `feat/HL-15-recursos` (ya creada desde `main` con
este documento y el diseño). **El diseño manda:** implementa exactamente `docs/design/recursos-didacticos.md`. Si algo
no se puede hacer como está escrito, detente y explícalo. Clases CSS nuevas con prefijo `resource-`. **No hagas
`git stash` de cambios que no son tuyos.** Tres commits en la misma rama, sin push ni PR.

## Hoy (léelo antes de empezar)

- `apps/web/src/pages/course/CourseLibrary.tsx` y `Bibliography.tsx`; `apps/api/src/bibliography.ts`
  (`course_bibliography`, migración 0050); materiales (`materials`) y archivos (`course_files`).
- Texto por página del libro principal: `book_texts` y `book_pages` (0052) en `apps/api/src/proposals.ts`.
- Mapa del libro: `book_maps` (0053) en `apps/api/src/book-map.ts`; las propuestas de lecciones lo usan. **Ambos ya
  están por archivo (`file_id`)**: generalízalos a cualquier recurso en lugar de duplicarlos.

## 5a · Dominio, esquema y API

- Migración `0068_course_resources.sql` (registrar en `storage.ts`): `course_resources(id, organization_id, course_id,
  material_id NULL, file_id NULL, kind 'file'|'link'|'text'|'reference', type, title, authors JSON, year, metadata JSON,
  language, license, shareable 0/1, level, area, role NULL 'primary'|'required'|'recommended'|'support', citation_override
  NULL, status, created_by, created_at, updated_at)`, con un recurso principal por curso y las mismas garantías de
  organización y curso que `course_bibliography`. Migra cada material y archivo del curso y la bibliografía según la
  sección 6 del diseño. `course_bibliography` deja de leerse (no la borres).
- `resource_index(resource_id, id, parent_id, position, title, start_page, end_page, start_seconds, end_seconds, source
  'outline'|'detected'|'manual')`.
- `readings(id, course_id, unit_id, group_id NULL, resource_id, index_id NULL, pages, required 0/1, note, position)` y
  `reading_marks(reading_id, learner_id, group_id, read_at)`.
- Dominio puro (`packages/domain/src/resources.ts`): tipos y campos por tipo (`resourceFields(type)`), validación de
  la ficha, `citation(resource, "apa7")` (personas e institución, ediciones, DOI/URL, sin año «s. f.»), índice
  (`indexFromOutline`, `detectHeadings(pages)`, validación de rangos sin solapes ilegales), cobertura
  (`resourceCoverage(outcomes, maps)`).
- API: CRUD de recursos (`/api/courses/:id/resources`), índice (extraer del esquema del PDF en el navegador con pdf.js
  y enviarlo, detectar desde `book_pages`, editar a mano), mapa al plan para cualquier recurso con texto (la API de
  `book-map.ts` toma un `resourceId`; el libro principal sigue funcionando igual), lecturas y marcas de lectura,
  bibliografía APA (`GET …/bibliography?format=apa7`, texto y HTML).
- **Metadatos por ISBN o DOI:** consulta opcional a Open Library (ISBN) y Crossref (DOI) desde el Worker con tiempo
  límite de 3 s, sin enviar datos personales; si falla, la ficha queda para llenar a mano. Pruebas con dobles, nunca
  contra el servicio real.
- Permisos: el equipo del curso con edición administra recursos e índices; quien imparte una sección agrega lecturas
  propias si la política de libertad de cátedra lo permite; estudiantes leen solo recursos `shareable` de sus lecturas
  y marcan las suyas.

## 5b · Interfaz

Secciones 1 a 4 del diseño: Recursos (lista, filtros, estados, panel de dos pasos, Bibliografía APA), página del
recurso con Ficha, Índice, Mapa al plan y Uso (reutiliza la interfaz del mapa del libro de hoy, no la copies),
cobertura en Plan curricular, lecturas en Contenido, en Plan de la sección y en el espacio del estudiante, y el
porcentaje de lecturas en la sección. El menú del curso dice «Recursos».

## 5c · La IA usa todos los recursos indexados

Sección 5 del diseño: «Fuentes» en Planificar con IA; las propuestas y la verificación de citas trabajan con varios
recursos (recurso, capítulo y páginas); el registro de la propuesta guarda los recursos usados. Las pruebas usan el
generador local (`fixture`), nunca OpenAI.

## Semilla

Generador en `scripts/seed/` y migración `0069_demo_resources.sql`, solo org-demo y tolerante a lo existente: en
Matemáticas 6.º, el libro principal con ficha completa e índice, una guía docente indexada, una norma, un video con
marcas de tiempo y lecturas en dos unidades; en un curso de música, una partitura. Prueba en `tests/seed.test.ts`.
El generador exporta los nombres visibles que crea (como `sectionFreedomNames` en `scripts/seed/section-freedom.mjs`) y
se agregan a la lista curada de `tests/e2e/ux-flows.spec.ts` (prueba 7). Corre `ux-flows.spec.ts` y `team.spec.ts`
completos: una semilla nueva cambia lo que ven las cuentas de demostración. Toda unidad, lección o sección creada en una
E2E lleva `e2eName`.

## Pruebas obligatorias

1. Dominio (`tests/resources.test.ts`): campos por tipo; APA 7 exacta para libro, capítulo, artículo con DOI, norma,
   partitura, video y sitio web (con autoría personal e institucional y sin año); índice desde un esquema, detección de
   títulos y rangos inválidos; cobertura.
2. Worker (`tests/resources-api.test.ts`): migración de la bibliografía a roles sin perder la cita manual; un recurso
   principal por curso; mapa al plan de un recurso que no es el principal; lecturas propias de una sección que la otra
   no ve; un estudiante no ve un recurso no compartible y marca su lectura; ISBN y DOI con dobles (éxito y tiempo
   agotado); permisos (403).
3. Migración (`tests/test_migrations.py`) sobre datos existentes: cada material, archivo y referencia queda como
   recurso, y el mapa del libro principal sigue igual.
4. `tests/app.test.tsx` y E2E nueva `tests/e2e/resources.spec.ts` (escritorio y móvil, nombres con `e2eName`): agregar
   un libro con su ficha, ver su cita, indexarlo a mano, mapear un resultado, asignar una lectura y marcarla como
   estudiante; Fuentes en Planificar con IA con dos recursos. Rutas nuevas en `accessibility.spec.ts` y `layout.spec.ts`.
5. Las pruebas existentes de biblioteca, bibliografía, mapa del libro y propuestas **sin cambios** en sus aserciones
   (solo navegación si el menú cambia de nombre).

## Definición de terminado

`./scripts/verify` completo sin servidores locales sobrantes; Semgrep sin hallazgos nuevos (`docs/operations/escaneres.md`:
valores como parámetros `?`, nada de SQL con texto interpolado salvo fragmentos constantes marcados); E2E nuevas y
afectadas en escritorio y móvil; ninguna aserción relajada; **capturas** de la sección 7 del diseño en 1440 y 390 en
`.release-evidence/screenshots/lote-5/` (espera a que terminen las animaciones de los paneles antes de capturar);
versión 1.3.7 y `CHANGELOG.md`; tres commits `HL-15 ST-049: recursos didácticos, dominio y API (lote 5a)`,
`… interfaz (lote 5b)` y `… la IA usa todos los recursos indexados (lote 5c)`.
