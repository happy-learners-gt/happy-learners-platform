# Diseño de la libertad de cátedra por sección (1.3.6)

Cómo un curso define lo que toda sección debe cubrir (el **núcleo**) y cómo cada sección adapta el resto a su grupo,
sin perder el control de coordinación. Fecha: 29 de octubre de 2026. Ficha: `docs/handoff/cursor/lote-4a-libertad-de-catedra.md`.

## Problema

Hoy el curso es uno solo para todas sus secciones: mismo contenido, mismo orden y mismo plan de evaluación. Sirve a un
colegio con un programa oficial, pero no a una universidad o una academia donde cada docente tiene libertad de cátedra
dentro de unos mínimos (resultados de aprendizaje, temas y evaluaciones obligatorias). Lo que se pide:

1. Que el curso marque el núcleo obligatorio y la política del programa diga cuánto se puede adaptar.
2. Que cada sección agregue, ordene, oculte o reemplace lo que no es núcleo, en un lugar propio y claro.
3. Que la coordinación vea, sin abrir sección por sección, en qué difiere cada una y si cubre el núcleo.

## Principios

- **Por omisión nada cambia.** Con la política «Igual en todas las secciones» la plataforma se ve y funciona como hoy;
  ninguna pantalla nueva aparece.
- **Se diseña donde ya se diseña.** El curso marca el núcleo en Contenido y en Evaluación; la sección adapta lo suyo en
  una sola página propia. Notas sigue siendo solo para calificar (`docs/design/evaluacion.md`).
- **Siempre se ve qué es núcleo, qué es propio y qué está oculto,** con la misma etiqueta en todas partes.
- **Lo que ya se impartió o tiene notas se protege con explicación**, igual que en la evaluación.
- **Coordinación lee diferencias, no persigue secciones.**

Etiquetas (chips) en toda la plataforma: **Núcleo** (candado pequeño), **Propia de la sección**, **Oculta en esta
sección**, **Reemplaza a «…»**.

## 1. La política

`Configuración del curso › Libertad de cátedra`, heredable y fijable por el programa como los demás ajustes (DEC-041).
En `Configuración académica › programa` aparece el mismo ajuste con «Fijar para los cursos del programa».

```
Libertad de cátedra
( ) Igual en todas las secciones
    Todas las secciones siguen el mismo contenido, en el mismo orden, y el mismo plan de evaluación.
(•) Núcleo y adaptación
    Lo marcado como núcleo es obligatorio. Cada sección puede agregar lecciones y actividades propias, reordenar
    y ocultar lo que no es núcleo.
( ) Libre con núcleo de resultados
    Como la anterior y, además, una sección puede reemplazar una actividad de evaluación del núcleo por otra de la
    misma categoría y con los mismos puntos. Los resultados de aprendizaje del núcleo siguen siendo obligatorios.
Fijado por el programa «Licenciatura en Educación»  (cuando el programa lo fija, el control se ve deshabilitado con la razón)
```

**Cambiar de política** abre una confirmación con lo que pasará en palabras:

- De «Igual» a otra: «Todo el contenido y la evaluación actuales quedan como núcleo. Desmarca en Contenido y Evaluación
  lo que cada sección puede omitir.»
- De «Libre» a «Núcleo y adaptación»: los reemplazos dejan de aplicarse; si alguno tiene notas, **no se permite** y se
  listan las secciones y actividades afectadas.
- A «Igual»: lo propio de cada sección queda guardado pero deja de mostrarse y de contar, y los ajustes se ignoran; si
  alguna actividad propia o un reemplazo tiene notas, **no se permite** y se explica por qué. Volver a la política
  anterior lo recupera todo.

## 2. Curso › Contenido y Curso › Evaluación: marcar el núcleo

Solo cuando la política no es «Igual». Quien publica el curso (responsable) marca; el resto lee.

```
Contenido                                    [ Planificar con IA ] [ PDF de entrega ] ⋯   [ Crear unidad ]
3 unidades · 18 lecciones · 15 publicadas · 12 en el núcleo
┌ ⓘ Las secciones pueden adaptar lo que no es núcleo. Ver diferencias entre secciones → ┐
▾ Unidad 1 · Fracciones
  ▣ 1. Qué es una fracción          Publicada   🔒 Núcleo          ⋯ (Quitar del núcleo)
  ▣ 2. Fracciones en la cocina      Publicada                      ⋯ (Marcar como núcleo)
```

- El chip «Núcleo» va en la fila; el menú de la lección agrega «Marcar como núcleo» o «Quitar del núcleo».
- En la cabecera de cada unidad, el menú tiene «Marcar toda la unidad como núcleo» y «Quitar la unidad del núcleo».
- La cabecera de la página suma «· N en el núcleo». El aviso enlaza con las diferencias (sección 4).
- **Curso › Evaluación** igual: chip «Núcleo» por actividad y la misma opción en su menú; la barra de cada periodo dice
  además «Núcleo: 60 de 100 puntos» para que el responsable sepa cuánto queda a criterio de las secciones.
- Quitar del núcleo una lección que alguna sección ya ocultó no requiere nada; volver a marcarla núcleo la muestra de
  nuevo en esas secciones (se avisa: «Volverá a mostrarse en 2 secciones que la ocultaron»).
- Una lección nueva del curso aparece en todas las secciones al final de su unidad (en las que reordenaron) o en su
  posición (en las demás).

## 3. Sección › Plan de la sección (`/secciones/:id/plan`)

Página nueva de la sección, después de «Cronograma», **solo si la política no es «Igual»**. La ven quienes imparten la
sección, la coordinación y la administración; editan quienes imparten la sección.

```
Plan de la sección                                                         [ Crear lección propia ]
Matemáticas 3.º primaria · 3.º B · Núcleo y adaptación (fijado por el programa)

┌ Cobertura del núcleo ──────────────────────────────────────────────────────────────────────┐
│ Lecciones del núcleo   12  ·  8 impartidas  ·  3 planificadas  ·  1 sin planificar  →      │
│ Resultados del núcleo  9   ·  7 cubiertos   ·  2 sin lecciones planificadas  →            │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
[ Contenido ]  [ Evaluación ]

▾ Unidad 1 · Fracciones
  ⠿ 1. Qué es una fracción              🔒 Núcleo
  ⠿ 2. Fracciones con regletas          Propia de la sección   Borrador     ⋯
  ⠿ 3. Fracciones en la cocina                                             ⋯ (Ocultar en esta sección)
▸ Ocultas en esta sección (2)
```

- **Contenido:** el contenido efectivo de la sección por unidad, con los chips. Se reordena dentro de la unidad con las
  mismas manijas y teclas que el contenido del curso; el núcleo también se puede reordenar (no ocultar). «Ocultas en esta
  sección» al final de cada unidad, con «Mostrar». Una lección ya impartida en esta sección no se oculta (se explica).
- **Crear lección propia** abre el mismo editor de lecciones del curso, con la unidad elegida y la nota «Solo la ve esta
  sección». Quien imparte la sección la publica directamente, salvo que la política pida aprobación del responsable
  (sección 6); coordinación la ve en las diferencias.
- **Evaluación:** la misma vista de Curso › Evaluación (explicación de la nota, pestañas por periodo con su estado,
  categorías) sobre el plan **efectivo de la sección**: actividades del curso con sus chips, «Agregar actividad propia»
  en cada categoría (el mismo panel de 4 pasos) y, en una actividad no núcleo, «Ocultar en esta sección». Con «Libre», en
  una actividad del núcleo, «Reemplazar en esta sección» abre el panel con la categoría y los puntos fijos.
  El estado del periodo es **el de la sección** («faltan 10 pts» si ocultó algo y no lo repuso).
- Cobertura: «→» abre un panel con la lista (lecciones del núcleo sin planificar con «Planificar en el cronograma»;
  resultados sin lecciones). Los números salen de la función de dominio `coreCoverage`, los mismos que ve coordinación.
- Sección con política «Igual»: la página no existe y su ruta lleva al resumen de la sección.

### Lo que cambia en otras páginas de la sección

- **Cronograma:** al planificar una clase se eligen lecciones del contenido efectivo (incluidas las propias, sin las
  ocultas), con sus chips.
- **Notas:** la explicación de la nota es la del plan efectivo; las actividades propias o de reemplazo llevan su chip; el
  enlace dice «Ver la evaluación de la sección». Notas no edita el plan.
- **Grupos:** una actividad propia en grupos aparece en «Actividades en grupos» como cualquier otra (`section_activity_sets`).
- **PDF de entrega:** con la sección elegida, usa su contenido efectivo; nunca incluye lecciones propias de otra sección.
- **Estudiantes:** ven el contenido efectivo de su sección.

## 4. Curso › Secciones › Diferencias (coordinación)

En la página de secciones del curso, una pestaña **Diferencias** (visible para el responsable del curso, coordinación y
administración, solo si la política no es «Igual»).

```
Secciones   [ Lista ]  [ Diferencias ]

Sección      Docente        Propias   Ocultas   Reordenó   Reemplazos   Núcleo impartido   Resultados
3.º A        L. Herrera     2         1         Sí         —            10 de 12           9 de 9
3.º B        M. Castillo    0         0         No         1            8 de 12   ⚠        7 de 9   ⚠
3.º C        A. Pérez       5         3         Sí         2            12 de 12           9 de 9
```

- Una fila abre un panel lateral con el detalle de esa sección: qué agregó (con enlace a cada lección o actividad), qué
  ocultó, qué reemplazó por qué, y su cobertura del núcleo.
- ⚠ cuando la cobertura del núcleo va por detrás de lo esperado a la fecha (clases ya pasadas sin las lecciones del
  núcleo planificadas para ellas).
- Los datos salen de `sectionDifferences` y `coreCoverage` (dominio puro).

## 5. Pantallas y estados que hay que capturar

1440 y 390: configuración del curso con la política (y fijada por el programa); Contenido con chips de núcleo; Evaluación
con «Núcleo: X de Y puntos»; Plan de la sección en Contenido y en Evaluación (con una propia, una oculta y un
reemplazo); el panel de cobertura; Diferencias con su panel; la confirmación de cambio de política bloqueada por notas.

## 6. Unidades propias, revisión y compartir lo propio

### Unidades propias de una sección

- En Plan de la sección › Contenido, el menú de la página tiene «Crear unidad propia»; la unidad lleva el chip «Propia
  de la sección», se reordena entre las del curso y contiene solo lecciones propias.
- Las unidades del curso que son núcleo no se ocultan; una unidad del curso que no es núcleo se puede ocultar entera
  (oculta todas sus lecciones no núcleo; si alguna lección suya es núcleo, la unidad no se oculta y se explica).
- Modelo: `learning_units.group_id` (NULL = del curso), con las mismas reglas de visibilidad que las lecciones propias.

### Revisión de lo propio (ajuste de la política)

En la política, bajo «Núcleo y adaptación» y «Libre», una casilla:

```
[ ] Las lecciones y actividades propias requieren aprobación del responsable del curso
```

- Desmarcada (por omisión): quien imparte la sección publica lo propio directamente.
- Marcada: lo propio queda «En revisión» (el mismo estado y flujo que las lecciones del curso). El responsable recibe la
  notificación y lo aprueba o lo devuelve con comentario desde el panel de la sección en Diferencias o desde la
  notificación. Una actividad propia en revisión no cuenta en la nota ni se califica; un reemplazo en revisión no aplica.
- Ajuste `sectionFreedomReview` en `CourseSettings`, heredable y fijable por el programa.

### Compartir lo propio

Desde el menú de una lección, unidad o actividad propia:

- **Copiar a otra sección:** elige una o varias secciones del mismo curso donde la persona imparte (administración y
  coordinación: cualquiera de su alcance). Crea copias propias e independientes en cada destino, con la misma unidad
  (o una unidad propia copiada) y, si aplica, la revisión de la política del destino.
- **Proponer al curso:** crea una propuesta para el responsable del curso, que la ve en Curso › Contenido o Evaluación
  en un aviso «2 propuestas de las secciones» y en un panel con la vista previa y el origen. Al **aceptar**, se crea una
  copia en el curso (no núcleo por omisión; la puede marcar núcleo en el mismo paso) y la sección de origen elige si
  conserva la propia o pasa a usar la del curso (si la propia tiene notas, se conserva). Al **rechazar**, se envía el
  comentario a quien propuso.
- Todo queda en la actividad y en el detalle de Diferencias («Propuso 1 lección al curso · aceptada»).
- Modelo: `section_proposals(id, group_id, item_type 'unit'|'lesson'|'activity', item_id, status 'pending'|'accepted'|
  'rejected', comment, created_by, decided_by, created_at, decided_at, result_id)`.

## 7. Pantallas adicionales para capturar

Unidad propia en Plan de la sección; la casilla de revisión en la política; una lección propia «En revisión»; el diálogo
«Copiar a otra sección»; el aviso y el panel de propuestas en Curso › Contenido; Diferencias con una propuesta.
