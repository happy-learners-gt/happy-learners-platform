# Ficha para Cursor: lote 3b, grupos de trabajo y calificación grupal (interfaz)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 3. Usa la API del lote 3a (`docs/api.md`, conjuntos de
grupos y calificación grupal). Rama `feat/HL-15-grupos`. Sigue `docs/design/fluent.md` (puntos 1 a 9) y **no reutilices
clases CSS de otras pantallas** (`.program-list`, `.template-grid`…): crea las tuyas. Cierra el lote 3 como **1.3.2**.

## Pantallas

1. **Sección › Grupos** (`WorkGroups.tsx`): además de los grupos de siempre, **conjuntos de grupos**.
   - «Formar grupos» (acción principal): asistente en un diálogo con quiénes (toda la lista o los presentes de una clase,
     con selector de la clase), cuántos (por tamaño o por cantidad), cómo (al azar, equilibrado por la nota de un
     periodo, mixto para no repetir compañeros), pares juntos o separados (selector de estudiantes), mínimo y máximo.
   - **Vista previa** con los grupos en tarjetas y las restricciones no cumplidas como aviso; «Otra combinación»
     (nueva semilla) y «Crear conjunto».
   - Cada conjunto: sus grupos en tarjetas; mover a un estudiante de grupo arrastrando (usa `SortHandle`/el patrón de
     arrastre existente) o con el menú «Mover a…» (teclado y táctil); renombrar, regenerar (solo si ninguna actividad
     calificada lo usa: si no, la acción explica por qué no) y archivar.
2. **Notas › plan de evaluación:** por actividad, «Individual» o «En grupos» con el conjunto de grupos; en grupos, el
   rango del factor de coevaluación.
3. **Notas › cuadrícula:** una actividad en grupos muestra la marca **por grupo** (una fila por grupo con sus
   integrantes, en el mismo tipo de celda de 1.3.1: puntos, rúbrica, nivel…) y, por estudiante, la marca resultante con
   su origen («del grupo», «ajustada ×0,8», «propia»). Desde el detalle del estudiante: ajuste por factor, nota propia y
   quitar ajuste, con nota.
4. **Coevaluación:** diálogo por grupo con la matriz quién califica a quién (0–5), totales y el factor resultante de cada
   integrante en vivo.

## Pruebas

- `tests/app.test.tsx`: el asistente envía las reglas y muestra la vista previa con una restricción no cumplida; mover
  a un estudiante con el menú; calificar un grupo y ver la marca de un integrante con su origen; ajuste por factor; la
  matriz de coevaluación calcula el factor.
- E2E nueva `tests/e2e/group-grading.spec.ts` (escritorio y móvil): formar un conjunto con los presentes de una clase,
  calificar la actividad en grupos y aplicar una coevaluación.
- Agrega las pantallas nuevas a `accessibility.spec.ts` y `layout.spec.ts`. Las pruebas existentes de grupos y de notas
  sin cambios (salvo agregar rutas).

## Definición de terminado

`./scripts/verify` completo **sin servidores locales sobrantes** (cierra los de corridas E2E antes); las E2E nuevas y
`accessibility`/`layout`/`grading` en escritorio y móvil; **capturas** del asistente, un conjunto y la cuadrícula
grupal en 1440 y 390 en `.release-evidence/screenshots/lote-3b/`; ayuda y `docs/api.md` al día; versión 1.3.2 y
`CHANGELOG.md`; un commit `HL-15 ST-049: grupos y calificación grupal, interfaz (lote 3b)`, sin push ni PR.
