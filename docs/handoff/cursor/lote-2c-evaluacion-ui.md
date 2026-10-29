# Ficha para Cursor: lote 2c, evaluación agnóstica (interfaz)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 2. Usa la API del lote 2b (`docs/api.md`, «Evaluación
agnóstica») y el motor de 2a (`learnerResult`, `displayOf`, `schemeTemplates`). Rama `feat/HL-15-evaluacion`.
Sigue `docs/design/fluent.md` (puntos 1 a 9). Cierra el lote 2 como versión **1.3.1**.

## Pantallas

1. **Configuración académica › Esquemas de evaluación** (administración): lista con su método y uso; «Agregar desde
   plantilla» (las 7 de `schemeTemplates`, con su descripción); editor con método, categorías (peso, descartar la
   más baja, mínimo), niveles, forma de mostrar (número con decimales, letras o GPA con umbrales, niveles,
   aprobado/no aprobado), nota o nivel mínimo, combinación de periodos, tope de extra y reposiciones; **vista previa en
   vivo**: un estudiante de ejemplo con marcas editables y su resultado calculado con `learnerResult`. Archivar en
   lugar de borrar si está en uso.
2. **Configuración del curso y del programa:** vuelve a mostrar «Esquema de evaluación», ahora como selector con los
   esquemas activos (y «Puntos acumulados» como el de siempre). Quita el ocultamiento temporal de 2b
   (`visibleSettingDefinitions`) y adapta la prueba que lo comprueba para que verifique el selector con sus opciones.
3. **Notas › plan de evaluación:** por actividad, categoría (las del esquema), forma de calificar (puntos, rúbrica,
   aprobado/no aprobado, nivel, tribunal), extra y «reposición de…»; editor de **rúbrica** (criterios × niveles con
   descriptor y puntos, pesos que suman 100); **tribunal**: elegir integrantes de la organización y quién preside.
4. **Notas › cuadrícula:** cada celda se adapta a la forma de calificar: número; casilla aprobado/no aprobado; selector
   de nivel; rúbrica (abre un diálogo para elegir el nivel de cada criterio, con el total); tribunal (estado «2 de 3»
   y el resultado al completarse; solo lectura para quien imparte). En el menú de la celda: **Exonerar** y quitar la
   exoneración. El resultado del periodo y final muestra el `display` del esquema (letra, GPA, nivel, aprobado) y las
   **razones** («No alcanzó el mínimo de 60 en Examen final»). Teclado y pegado siguen funcionando en las celdas
   numéricas.
5. **Mis tribunales** (`/tribunales`, en el menú principal solo si la persona integra alguno): agrega
   `GET /api/me/panels` (actividades de tribunal asignadas, con sección, curso, estudiantes y si ya marcó cada uno) y la
   página donde cada integrante registra **su** marca por estudiante sin ver las de los demás hasta completar.

## Pruebas

- `tests/app.test.tsx`: editor de esquema con vista previa (cambiar un peso cambia el resultado mostrado), celda de
  rúbrica que envía las elecciones, celda de nivel, exonerar desde el menú, razones visibles, selector de esquema en la
  configuración del curso con sus opciones.
- `tests/grading-api.test.ts`: `GET /api/me/panels` (solo lo asignado a quien llama; otra persona recibe una lista vacía).
- E2E nueva `tests/e2e/grading.spec.ts` (escritorio y móvil): plantilla universitaria, rúbrica calificada en la
  cuadrícula y un tribunal de 2 completado desde «Mis tribunales» con dos sesiones.
- Agrega `/tribunales` y la configuración de esquemas a `accessibility.spec.ts` y `layout.spec.ts`.

## Definición de terminado

`./scripts/verify` completo; las E2E nuevas y `accessibility`/`layout` en escritorio y móvil; **adjunta capturas** del
editor de esquema, la cuadrícula con rúbrica y nivel, y «Mis tribunales», en escritorio (1440) y móvil (390); ayuda y
`docs/api.md` al día; versión 1.3.1 y `CHANGELOG.md`; un commit `HL-15 ST-049: evaluación agnóstica, interfaz (lote 2c)`,
sin push ni PR.
