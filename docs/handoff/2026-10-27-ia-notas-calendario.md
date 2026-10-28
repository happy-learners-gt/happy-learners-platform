# Plan: IA integrada, notas profesionales y calendario académico (REL-010)

Aprobado por el usuario el 27 de octubre de 2026. Tres entregas en orden, cada una con dominio, API, migración, UI,
pruebas (dominio, API, migración, UI y E2E focalizadas), `./scripts/verify`, ensayo en local y despliegue.

## Diagnóstico

- **IA.** «Proponer lecciones» y «Mapa del libro» son dos páginas sueltas fuera del menú del curso (incumple
  `docs/design/fluent.md`, punto 8), sin una sola acción principal por pantalla, y el flujo se corta: leer el libro,
  mapear, proponer, revisar y planificar están en lugares distintos. Las lecciones propuestas no dicen de dónde salen
  ni se distinguen de las escritas por una persona, y la revisión obliga a abrir cada borrador.
- **Notas.** Una sola nota por periodo: no hay plan de evaluación (zona y examen, actividades con ponderación), ni
  comentarios, ni boleta, ni exportación, ni estadísticas, ni un cierre con revisión de coordinación.
- **Calendario académico.** El horario de una sección es un solo patrón (mismos días, misma hora, misma duración). No
  hay horario de bloques de la organización (periodos de clase, recesos y tiempo entre periodos), ni varias reuniones
  por semana con horas distintas, como necesita un colegio de alto nivel o una universidad.

## Entrega 1 — Asistente de planificación con IA (1.2.2)

1. **Una sola página del curso, en el menú:** «Planificar con IA» (`/cursos/:id/asistente`) con pasos visibles
   (`StatusSteps`) y navegables: **Libro** (requisitos y lectura), **Mapa** (matriz indicador ↔ páginas, revisión con IA
   y confirmación), **Propuestas** (huecos, generación y avance), **Revisión** (vista previa de cada borrador con sus
   actividades; publicar o descartar sin salir) y **Calendario** (asignar en orden en el cronograma de una sección).
   El paso actual se deduce del estado del curso; las rutas anteriores redirigen.
2. **Entradas en contexto:** en el Plan curricular, cada indicador sin lección ofrece «Proponer con IA»; en Contenido,
   cada módulo ofrece «Proponer lecciones para este módulo». Ambas abren el asistente con la selección hecha.
3. **Transparencia (estándar de IA):** cada lección propuesta guarda su procedencia (modelo, páginas del libro,
   indicador y fecha) y muestra «Propuesta de IA» en el editor y en el contenido hasta que una persona la revisa. Publicar
   una propuesta pide confirmar que se revisó.
4. **Estándares de la plataforma:** una acción principal por paso, componentes de `ui/primitives`, rutas en la prueba de
   accesibilidad (axe) y textos de ayuda.

## Entrega 2 — Notas profesionales (1.2.3)

1. **Plan de evaluación** por curso y periodo: actividades de evaluación (tarea, proyecto, examen, participación…) con
   punteo o ponderación que suman 100, plantillas (zona 60 y examen 40) y copia entre periodos.
2. **Libreta en cuadrícula:** nota por actividad, nota del periodo calculada, navegación con teclado (flechas, Intro),
   pegar desde una hoja de cálculo, comentarios por estudiante y periodo, cambios sin guardar visibles e historial.
3. **Estadísticas** del periodo (promedio, aprobados, distribución, estudiantes en riesgo).
4. **Boleta** de calificaciones en PDF por estudiante y por sección, y exportación CSV.
5. **Cierre con revisión:** quien imparte entrega el periodo y coordinación o administración lo aprueba y lo cierra.

## Entrega 3 — Calendario académico (1.2.4)

1. **Horario de bloques de la organización** (jornadas): periodos de clase y recesos con su hora, generados desde la hora
   de entrada, la duración de cada periodo, el tiempo entre periodos y la posición de los recesos.
2. **Horario de la sección con varias reuniones por semana**, cada una con su día, hora y duración, o con bloques de la
   jornada; compatibilidad con los horarios actuales.
3. **Calendario del ciclo** en Organización: periodos, intervalos entre periodos (vacaciones) configurables y días sin
   clase en una sola vista.
