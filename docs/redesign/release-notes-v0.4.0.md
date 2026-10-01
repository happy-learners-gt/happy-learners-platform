# v0.4.0 · Marco curricular

HL-44 · ST-041 · REL-003. Fase 2 de 2 del rediseño curricular. La fase 1 (v0.3.0) organizó cada lección en una secuencia didáctica con actividades compuestas.

## Por qué

Hasta ahora un curso tenía perfil, nombre de las agrupaciones y clasificaciones, pero nada decía qué debía aprender un estudiante ni si las lecciones lo cubrían. Esta versión agrega esa capa con un diseño a partir de los resultados (alineación constructiva): primero se define qué podrán demostrar los estudiantes, después dónde se trabaja y cómo se comprueba, y el sistema muestra qué falta.

## Qué cambia

- **Plan curricular** (nueva sección del curso):
  - **Competencias**: lo que el curso desarrolla.
  - **Resultados de aprendizaje**: lo que se demuestra al terminar, con nivel de pensamiento (Recordar → Crear, con verbos de ejemplo), evidencia y código RA según su orden.
  - **Mapa de cobertura**: por resultado y por unidad, *planificado*, *trabajado* (lecciones alineadas) y *evaluado* (preguntas o actividades con propósito Evaluar). Cada hueco tiene su acción: **Crear lección** (queda alineada y en la unidad planificada) o **Agregar evaluación**. Al pie de cada unidad se indica lo planificado que todavía no se trabaja.
- **Editor de lección**:
  - Resultados de la lección, indicando los planificados en su unidad.
  - **Trabaja**: resultados de cada actividad.
  - Recursos sugeridos: los que usan otras lecciones con los mismos resultados.
  - **Antes de publicar**: alineación, momentos con actividades, comprobación del aprendizaje y tiempo. Son recomendaciones; si alguna queda pendiente, al publicar se pide confirmación.
- **Estudiante**: "Lo que aprenderás" agrega "Al terminar podrás:" con los resultados de la lección. El texto queda fijado al publicar.
- **Resumen del curso**: estado del plan con acceso directo. **Duplicar curso** copia competencias, resultados, planificación y alineaciones.

## Datos

Migración `0012_curricular_framework.sql`:

- Agrega `course_competencies`, `course_outcomes` y `unit_outcomes`, con claves compuestas que impiden mezclar cursos u organizaciones.
- Siembra un plan de ejemplo en Exploradores: 2 competencias, 3 resultados y la unidad Greetings con 2 planificados.
- No modifica ninguna lección; una prueba lo verifica byte a byte.

Las lecciones y actividades guardan sus resultados dentro de su contenido versionado, así que borrador y publicación funcionan igual que antes.

## Validación

- Pruebas de dominio: validación, códigos, cobertura, huecos, recomendaciones y sugerencias.
- Prueba de migración 0012.
- E2E nuevo `curriculum.spec.ts`: crear competencia y resultado, planificar, crear la lección desde el hueco, alinear la evaluación, publicar con confirmación, ver la cobertura completa y lo que verá el estudiante. Corre en escritorio y móvil, junto con el resto de la suite, axe WCAG 2.2 A/AA (incluido el plan) y el detector de CSP.
