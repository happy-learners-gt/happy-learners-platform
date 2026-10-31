# Diseño del asistente pedagógico como harness (1.4.x)

Cómo la plataforma usa la IA de forma medible, explicable y revisable: un núcleo (harness) por el que pasa toda llamada
al modelo, una revisión de calidad con puntaje basado en hechos, mejoras como borradores revisables, planificación con
reglas y redacción asistida. Fecha: 30 de octubre de 2026. Lo implementa Claude Code (sin Cursor).

## Hoy

- Una sola puerta al modelo: `structured()` en `apps/api/src/openai.ts` (Responses API, salida JSON estricta, sin
  guardar). La usan las propuestas de lecciones (`proposals.ts`) y el mapa al plan (`book-map.ts`). Con el generador
  local (`fixture`) las pruebas y `./scripts/verify` no llaman a OpenAI.
- No se registra qué se pidió, cuánto costó ni cuánto tardó; no hay forma de comparar la calidad entre modelos.
- La calidad de una lección solo la juzga quien la revisa (revisión de lecciones de DEC-047), sin criterios explícitos.

## Principios

- **La IA propone, explica y redacta; las reglas deciden.** El puntaje de calidad, el cronograma y el horario salen de
  funciones deterministas del dominio. La IA traduce, explica y propone texto; nunca aplica un cambio sola.
- **Todo lo que hace la IA queda registrado** (para quién, para qué, modelo, tamaño de la entrada, tokens, costo
  estimado, duración y resultado), sin guardar el texto de la entrada ni datos personales.
- **Todo cambio propuesto es un borrador con diferencias visibles**, que la persona acepta por partes o descarta.
- **Un mismo lugar de entrada:** «Revisar», «Mejorar» y «Redactar con IA» aparecen junto a lo que revisan o redactan.

## Entregas

| Versión | Contenido |
| --- | --- |
| 1.4.0 | 6a harness (registro, uso y costo, evaluaciones con fixtures) y 6b revisión con puntaje |
| 1.4.1 | 6c mejora asistida (borradores con diferencias) y 6e redacción en toda la plataforma |
| 1.4.2 | 6d planificación: cronograma propuesto |
| 1.4.3 | 6d planificación: horarios con un solver de reglas y reglas en lenguaje natural |

## 6a · El harness

- **Tarea de IA:** cada uso tiene un nombre estable (`lesson-proposal`, `book-map`, `lesson-review-explain`,
  `lesson-improve`, `write`, `rules-to-constraints`), su esquema de salida, su prompt versionado (`promptVersion`) y su
  validación. `structured()` pasa a `runAiTask(task, input, context)`, que llama al modelo y registra la ejecución.
- **Registro `ai_runs`:** id, organización, persona, curso (si aplica), tarea, versión del prompt, generador (`openai` o
  `fixture`), modelo, caracteres de entrada, tokens de entrada y salida (de `usage`), costo estimado en USD, duración,
  estado (`ok`, `error`, `transient`, `refused`, `incomplete`) y fecha. **Nunca** el texto de la entrada ni la salida.
- **Costo estimado:** administración registra en Uso de IA el precio por millón de tokens de entrada y de salida de cada
  modelo, con su fecha de vigencia (`ai_prices`); el costo se calcula al leer con el precio vigente en la fecha de cada
  ejecución. Un modelo sin precio muestra los tokens y «costo no disponible». No se fijan precios en el código: cambian.
- **Organización › Uso de IA** (administración): este mes y el anterior, por tarea, por curso y por persona: ejecuciones,
  tokens, costo estimado, errores y duración media; una lista de las últimas ejecuciones con su estado. Es la base para
  los límites por organización del plan de alta de organizaciones (decisión del usuario: hoy libre).
- **Evaluaciones del harness:** `tests/ai-evals/` con casos de entrada y verificaciones de la salida por tarea (esquema
  válido, citas verificables, campos obligatorios, longitud). Corren siempre con el generador local en
  `./scripts/verify`; `npm run ai:eval -- --live` (manual, nunca en CI) las corre contra el modelo configurado y deja un
  informe en `.release-evidence/ai-evals/` para comparar modelos o versiones de prompt.

## 6b · Revisión con puntaje basado en hechos

Función de dominio `lessonReview(lesson, context)`: verificaciones deterministas, cada una con peso, resultado
(`pass`, `partial`, `fail`, `n/a`), evidencia (qué actividad o campo) y una sugerencia concreta. El puntaje es la suma
ponderada sobre lo aplicable, de 0 a 100, y es **reproducible**: la misma lección da el mismo puntaje.

| Criterio | Peso | Se cumple cuando |
| --- | --- | --- |
| Objetivo | 10 | Hay objetivo de 15 a 300 caracteres (sin reglas de idioma: hay cursos en inglés) |
| Alineación | 20 | La lección trabaja al menos un resultado del plan y cada actividad hereda o declara los suyos |
| Secuencia | 15 | Las actividades cubren todos los momentos de la secuencia del curso, en orden |
| Tiempo | 15 | La suma de minutos queda entre el 90 % y el 110 % de la duración |
| Evaluación | 15 | Al menos una actividad con propósito «Evaluar» (o una pregunta con respuesta) |
| Agrupación | 10 | En lecciones de más de 30 minutos, al menos dos formas de agrupación |
| Recursos | 10 | Al menos un recurso o material; si el curso tiene recursos indexados, al menos una referencia con páginas |
| Instrucciones | 5 | Ninguna actividad sin instrucciones ni contenido |

- **Dónde:** en el editor de la lección, un botón **Revisar** abre el panel lateral «Revisión de la lección»:
  puntaje grande, la lista de criterios con su estado y evidencia, y para cada fallo «Ir a la actividad». Con IA
  configurada, **Explicar con IA** agrega una explicación breve y sugerencias en lenguaje natural (tarea
  `lesson-review-explain`), marcadas como de la IA; no cambia el puntaje.
- **Curso › Contenido:** cada lección muestra su puntaje como un chip (verde ≥ 80, ámbar 60–79, rojo < 60) y la cabecera
  dice «Calidad media 78 · 3 lecciones por debajo de 60». El puntaje se calcula al leer; no se guarda.
- **Revisión de lecciones (DEC-047):** quien revisa ve el mismo panel antes de publicar o devolver.

## 6c · Mejora asistida (1.4.1)

- En el panel de revisión, **Mejorar** pide a la IA una versión mejorada de lo que falla (tarea `lesson-improve`, con la
  lección, los criterios fallidos y los recursos indexados). La respuesta es un **borrador de cambios por actividad y
  campo**, que se muestra como diferencias (antes y después) con «Aceptar» y «Descartar» por cambio y «Aceptar todo».
  Al aceptar, el cambio entra en el borrador de la lección (no se publica) y el puntaje se recalcula.
- En el curso, **Plan de mejora**: las lecciones por debajo de 60 con sus criterios fallidos y un acceso a cada una.

## 6d · Planificación (1.4.2)

- **Cronograma propuesto (1.4.2):** en Sección › Cronograma, «Asignar lecciones en orden» con «Según la duración de
  cada clase» (el modo por omisión) reparte las lecciones del contenido efectivo de
  la sección en sus clases futuras, según su duración, el orden del curso y los días sin clase (función determinista
  `proposeTimetable`). Se muestra como borrador sobre el cronograma, con «Aplicar» y «Descartar».
- **Horarios con reglas (1.4.3):** en Organización › Horarios (`/organizacion/horarios`), «Generar horario» toma secciones, docentes, aulas y bloques de la
  jornada y reglas (disponibilidad docente, carga máxima diaria, sin choques de docente ni de secciones que comparten
  estudiantes, días sin clase y días preferidos). Las aulas no están en el modelo de datos: quedan para una entrega
  posterior. Un **solver determinista** (búsqueda con retroceso y heurísticas, en el dominio) devuelve una solución o
  las reglas que no se pueden cumplir. La IA solo traduce reglas escritas en lenguaje natural («la profesora Herrera no
  da clases los viernes») a restricciones, que la persona confirma antes de usarlas (tarea `rules-to-constraints`).
- **Aulas (1.5.3):** las aulas entran al modelo de datos (`classrooms`: nombre y capacidad; se archivan, no se borran) y
  cada sección puede tener un **aula habitual** (`course_groups.classroom_id`).
  - **Dónde:** en Organización › Horarios, una sección «Aulas» lista las aulas con su capacidad y las secciones que las
    usan; «Agregar aula», editar y archivar. En la tabla de secciones de la misma página, administración elige el aula
    habitual de cada una («La que quepa» si no tiene).
  - **Generar horario:** si la organización tiene aulas, cada sección recibe **una** aula para todas sus clases de la
    semana: la habitual si la tiene; si no, la más pequeña con capacidad para sus estudiantes activos. Un aula no tiene
    dos clases a la vez, y las secciones que no se regeneran ocupan su aula habitual. Sin aulas registradas, el horario
    se genera como antes. Una sección que no cabe explica «sin aula libre con capacidad para N».
  - **Aplicar** guarda el horario y, a la sección sin aula habitual, le asigna la que recibió. La cuadrícula del horario
    muestra el aula de cada clase.

  ```
  Aulas                                                         [ Agregar aula ]
  Aula 1 · 30 estudiantes · 3.º A, 4.º B                         [ Editar ] [ Archivar ]
  Laboratorio · 20 estudiantes · sin secciones                    [ Editar ] [ Archivar ]
  ```

## 6e · Redacción en toda la plataforma (1.4.1)

- Componente **Redactar con IA** junto a los campos de texto largos: objetivo de la lección, del curso y de la unidad,
  comentarios de boleta y descripción de un recurso. La API ya admite «aviso» (`notice`); el botón aparecerá cuando la
  plataforma tenga una pantalla para redactar avisos (hoy no la hay). Opciones: «Redactar», «Mejorar redacción»,
  «Más breve». Devuelve una propuesta debajo del campo con «Usar» y «Descartar»; nunca reemplaza sin confirmación.
- Tarea `write` con el tipo de campo, el contexto mínimo (curso, unidad, nivel) y el texto actual; sin datos personales
  de estudiantes salvo el nombre de pila en comentarios de boleta.

## Seguridad y privacidad

- La clave del modelo sigue solo en el Worker. Las entradas no incluyen correos, teléfonos ni datos de contacto.
- `ai_runs` es de la organización; solo administración lo ve. No guarda texto.
- Las tareas sin IA configurada muestran «La IA no está configurada en esta organización» y el resto funciona.

## Pantallas para capturar (1440 y 390)

1.4.0: Organización › Uso de IA; panel de revisión con un puntaje alto y otro bajo; chips de calidad en Contenido.
1.4.1: diferencias de una mejora; Redactar con IA en el objetivo y en un comentario de boleta. 1.4.2: cronograma
propuesto; horario generado y una regla imposible explicada.
