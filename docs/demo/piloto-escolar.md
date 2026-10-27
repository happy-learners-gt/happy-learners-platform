# Demostración del piloto escolar (12 minutos)

Guion para presentar la versión 1.2.0 en la organización de demostración «Colegio Horizonte». El momento central es
**Proponer lecciones**: del libro de texto y los indicadores del CNB a lecciones con actividades, revisadas y
planificadas en el calendario de la sección. Los datos vienen de la migración 0054 (`scripts/seed/pilot.mjs`).

## Antes de empezar (5 minutos)

- Dos ventanas: **administración** (`admin-demo`) y **Lucía Herrera**, responsable de Matemáticas (`lucia.herrera`).
  La contraseña de las cuentas de demostración es `Aprender-2026!`.
- Contexto de los datos: el **Ciclo 2026** está vigente con cuatro bimestres; el cuarto (7 sep – 27 nov) está en curso
  y los tres primeros tienen sus notas cerradas. **Matemáticas 6.º primaria** tiene 8 indicadores del CNB en su plan,
  solo 2 con lección publicada, su libro principal ya leído y la sección **6.º A** con clases próximas sin lecciones.
- La demostración cambia datos: después de proponer, los indicadores quedan cubiertos. Para repetirla, elige otro
  módulo al proponer (las propuestas no se duplican para el mismo módulo y libro) o usa otro curso.

## Guion

| Minuto | Pantalla | Qué hacer y qué decir |
| --- | --- | --- |
| 0:00 | — | El problema: preparar un bimestre exige leer el libro, encontrar qué páginas trabajan cada indicador del CNB, escribir lecciones con actividades y evaluación y repartirlas en el calendario. Son horas por curso. |
| 1:00 | Administración › **Organización** | **Ciclo lectivo**: Ciclo 2026 vigente con sus bimestres y el Ciclo 2027 ya preparado con **Crear el siguiente ciclo** (sin estudiantes ni notas). |
| 1:45 | Administración › **Configuración académica** | **Paquetes curriculares**: la dosificación de Matemáticas de Sexto Grado del CNB, con su fuente oficial. Se activa una vez para todo el colegio. |
| 2:30 | Lucía › Matemáticas 6.º › **Plan curricular** | 8 indicadores del CNB en tres competencias. El **mapa de cobertura** muestra los huecos: 6 indicadores sin lección. |
| 3:30 | **Biblioteca del curso** | **Bibliografía**: el libro principal (PDF) y un recurso de apoyo. |
| 4:00 | **Contenido › Proponer lecciones** | Todo en verde: indicadores, secuencia didáctica, libro leído, módulos y generador. Cada indicador dice si ya tiene lección. |
| 4:30 | **Revisar el mapa del libro** | **Buscar en el libro** (instantáneo) y **Revisar con IA** (unos 20 segundos para 8 indicadores). Mientras corre: la IA solo acepta una página si cita una frase que está de verdad en ella. Mostrar las citas y el indicador **4.5 (decimales)**: el libro solo menciona el «sistema decimal» junto a la numeración maya, la IA concluye que **no lo trata** y eso es un hueco del libro que coordinación debe saber. **Confirmar todo**. |
| 6:30 | **Proponer lecciones** | **Elegir los que faltan** (6 indicadores), módulo «Unidad 1», 45 minutos, **Proponer 6 lecciones** (unos 40 segundos; el avance se ve en vivo: en cola, en curso, listo). Mientras corre: cada propuesta usa solo las páginas confirmadas, sigue los momentos de la secuencia del curso, incluye una pregunta de evaluación y queda en borrador; nada se publica solo. El 4.5 termina con «el libro no trata este indicador» en lugar de inventar. |
| 8:30 | Abrir una propuesta en el **editor** | Actividades por momento (Inicio, Desarrollo, Cierre), minutos que suman la clase, el libro como recurso con sus páginas, la pregunta de evaluación y el indicador. Cambiar una frase y **Publicar**. Publicar dos o tres más. |
| 10:00 | Sección **6.º A › Cronograma** | **Asignar lecciones en orden**: las lecciones publicadas se reparten en las próximas clases del horario. Volver al **Plan curricular**: la cobertura subió. |
| 11:00 | **Notas** de 3.º A y de Ciencias 4.º A | Bimestres cerrados, promedio, «Aprueba (parcial)» cuando falta una nota (un periodo vacío no es cero) y Ciencias leyendo en letras A–F. |
| 11:30 | Matemáticas 6.º › **Contenido › PDF de entrega** | Unidad 1, sección 6.º A: el PDF lleva solo lo publicado, con membrete y pie de copia de entrega. |

## Tiempos medidos en el ensayo

Con el modelo `gpt-5.6-luna`, el 27 de octubre de 2026: revisión del mapa de 8 indicadores, 21 segundos; 6 propuestas
(5 lecciones y 1 indicador sin cobertura), 36 segundos; asignar en orden, al instante.

## Preguntas frecuentes

- **¿Crea también las actividades?** Sí: cada propuesta es una lección completa con título, objetivo y de 3 a 6
  actividades por momento de la secuencia, con su propósito, agrupación, minutos, las páginas del libro y una
  pregunta de evaluación de opción múltiple. La plataforma la valida antes de guardarla.
- **¿Sabe qué falta y qué ya está cubierto?** Sí: «Proponer lecciones» muestra por indicador las lecciones publicadas
  o en borrador, y **Elegir los que faltan** toma solo los huecos. El mapa del libro además detecta qué indicadores
  el libro no trata.
- **¿Ayuda a planificar?** Sí: con las lecciones publicadas, **Asignar lecciones en orden** las reparte en las clases
  del horario de la sección, que respeta el ciclo lectivo y los días sin clase.
- **¿Puede inventar?** Las páginas solo se aceptan con una cita verificada en el texto del libro, el equipo confirma el
  mapa y cada lección es un borrador que una persona revisa y publica.
- **¿Qué pasa con un PDF escaneado?** Se rechaza con un mensaje claro: la plataforma no hace reconocimiento de imágenes.
