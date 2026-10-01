# v0.3.0 · Secuencia didáctica y actividades compuestas

HL-44 · ST-041 · REL-003. Fase 1 de 2 del rediseño curricular; la fase 2 (v0.4.0) agrega el marco curricular: competencias, resultados de aprendizaje, alineación y mapa de cobertura.

## Por qué

Una lección no es una lista de contenidos sueltos: es una secuencia de momentos con intención. El editor anterior obligaba a elegir un único tipo por actividad (contenido, recurso o pregunta), de modo que una sola tarea de clase —"mira el video y responde"— quedaba partida en dos o tres actividades, sin decir para qué servía cada una ni cómo se organizaba el grupo.

## Qué cambia

- **Secuencia didáctica por lección.** Plantillas: Inicio · Desarrollo · Cierre (general), 5E (indagación), Presentación · Práctica · Producción (idiomas), Demostración · Práctica guiada · Práctica independiente (talleres y laboratorios) y Libre. Las lecciones nuevas usan la del perfil del curso; las existentes quedan en Libre. Cambiar de plantilla conserva el orden y reubica cada actividad en el momento equivalente.
- **Editor por momentos.** Cada momento muestra su intención, cuántas actividades tiene y cuántos minutos suma, y termina con su botón para agregar. El índice lateral se agrupa igual; subir y bajar cruzan de momento.
- **Actividades compuestas.** Propósito, organización, minutos y hasta 12 bloques ordenados: texto, recurso de la biblioteca, pregunta con opciones o nota para el docente. La duración de la lección indica cuánto suman las actividades.
- **Notas privadas del docente.** Se quitan al publicar y en la vista previa; la API pública no las devuelve.
- **Experiencia del estudiante.** Al empezar ve los momentos de la lección; cada actividad muestra su momento, propósito y organización, y todos sus bloques en orden.

## Compatibilidad y datos

Sin migración. Las actividades anteriores se leen como un bloque cuyo ID es el de la actividad, así conservan su texto colaborativo, su recurso enlazado y los enlaces públicos. La validación del Worker es la misma que la del editor (`packages/domain`).

## Validación

Pruebas de dominio para la lectura de actividades anteriores, la validación de bloques, la eliminación de notas y la ubicación por momento; E2E nuevo `sequence.spec.ts` (momentos, bloques, cruce de momentos y nota que nunca llega al estudiante, ni por API ni en pantalla) en escritorio y móvil, más el resto de la suite con axe WCAG 2.2 A/AA.
