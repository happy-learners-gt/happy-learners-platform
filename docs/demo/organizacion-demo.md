# Organización de demostración: Colegio Horizonte

El entorno de demostración incluye una organización completa y ficticia para recorrer todos los flujos.

- **Datos:** personas, programas, cursos, plan curricular, módulos, lecciones, actividades, recursos, grupos, asistencia, finalizaciones e historial de quién hizo qué.
- **Origen:** la migración `0015_demo_organization.sql`, generada por `scripts/seed/build.mjs` desde `scripts/seed/content-*.mjs`.
- **Garantías:** es determinista y solo escribe en la organización `org-demo`. Las pruebas comprueban que cada lección cumple las mismas reglas del editor y del servidor (`tests/seed.test.ts`, `tests/test_migrations.py`).

Todas las cuentas usan la contraseña **`Aprender-2026!`**. Son datos ficticios: no escribas información personal real.

## Personas

| Cuenta | Persona | Rol | Qué hizo en la demo |
|---|---|---|---|
| `marta.ruiz` | Marta Ruiz | Administración (coordinación académica) | Creó los tres programas. Revisa en **Educadores** el avance de cursos y personas. |
| `lucia.herrera` | Lucía Herrera | Educadora | Responsable de Matemáticas 3.º y colabora en Ciencias. Creó y publicó la mayoría de lecciones de Matemáticas. |
| `carlos.mejia` | Carlos Mejía | Educador | Responsable de Ciencias 4.º y colabora en Matemáticas. Pasa lista en 3.º B y 4.º A. |
| `ana.lopez` | Ana López | Educadora | Responsable de English Explorers A1 y del club de lectura archivado. Colabora en Arte y en Exploradores. |
| `diego.ramirez` | Diego Ramírez | Educador | Responsable del Taller de robótica; tiene el reto final en borrador. |
| `sofia.castillo` | Sofía Castillo | Educadora | Responsable de Arte (preprimaria) y colabora en inglés. |
| `educador-demo`, `admin-demo`, `instructor-demo` | Cuentas originales | Educador / Administración | Exploradores sigue como antes, ahora con equipo, clases planificadas e historial de asistencia. |

## Programas y cursos

| Curso | Programa | Configuración | Estado que muestra |
|---|---|---|---|
| Matemáticas 3.º primaria | Primaria bilingüe (formal, CINE 1, fija «Unidades» y exige resultados) | Asignatura · Matemáticas y estadística | **Completo:** 4 unidades, 8 lecciones publicadas, 5 resultados trabajados y evaluados, 2 grupos con asistencia. |
| Ciencias Naturales 4.º primaria | Primaria bilingüe | Laboratorio · secuencia 5E | **Casi completo:** una lección con cambios sin publicar y una en borrador. |
| English Explorers A1 | Inglés para niños (no formal, híbrido, PPP) | Curso libre · Idiomas | 5 de 6 lecciones publicadas y grupo de los sábados. |
| Taller de robótica educativa | Formación tecnológica (fija «Sesiones») | Taller · Ingeniería | 3 de 4 sesiones listas; el reto final está en preparación. |
| Arte y expresión creativa | — (curso independiente) | Formal, preprimaria; «Temas»; no exige resultados ni evaluación para publicar | Ajustes **definidos en el curso**; una lección en borrador. |
| Exploradores | — | Curso libre · Idiomas | Contenido original; hueco curricular a propósito (un resultado sin módulo ni lecciones). |
| Club de lectura 2025 | — | Seminario | **Archivado**: se consulta, no se edita; su lección publicada sigue disponible. |

Cada curso activo tiene competencias, resultados, planificación por módulo, recursos etiquetados (enlaces reales a Khan Academy, PhET, NASA, British Council, Scratch, Code.org y Google Arts & Culture), lecciones con momentos, propósito, organización, bloques y notas para el docente, grupos con 12 a 20 participantes ficticios y clases de septiembre con asistencia. La migración `0018_class_planning.sql` agrega hora, duración y estado a cada clase, planifica las clases de cada grupo hasta el 27 de noviembre de 2026 con su lección y dos recursos de la biblioteca, y asigna a cada grupo activo un código para estudiantes:

| Grupo | Curso | Horario | Código |
|---|---|---|---|
| 3.º A | Matemáticas 3.º primaria | lunes y miércoles, 08:00 | `DG-MATE-3A` |
| 3.º B | Matemáticas 3.º primaria | martes y jueves, 10:00 | `DG-MATE-3B` |
| 4.º A | Ciencias Naturales 4.º primaria | lunes y jueves, 13:00 | `DG-CIEN-4A` |
| Sábados 9:00 | English Explorers A1 | sábados, 09:00 | `DG-ENGL-SAB` |
| Martes 15:00 | Taller de robótica educativa | martes, 15:00 | `DG-ROBO-MAR` |
| Preprimaria K2 | Arte y expresión creativa | lunes, miércoles y viernes, 09:30 | `DG-ARTE-K2` |
| Grupo de demostración | Exploradores | martes y jueves, 11:00 | `DG-EXPL-DEMO` |

Las clases de septiembre con asistencia quedan como **Impartidas**; las de octubre anteriores a hoy sin lista aparecen como **Sin registrar**.

## Flujos para evaluar

1. **Avance de una educadora:** entra como `lucia.herrera`. En **Inicio** aparecen *Mis cursos* (con su rol, lecciones publicadas, resultados evaluados y asistencia) y *Actividad en mis cursos*.
2. **Equipo y responsabilidades:** abre **Matemáticas → Resumen** (equipo docente y actividad del curso) y **Configuración → Equipo docente** para agregar o quitar personas.
3. **Configuración heredada:** en Matemáticas, *Nombre de las partes del curso* aparece como **Fijado por el programa**. En Arte, los ajustes aparecen como **Definido en el curso**.
4. **Publicación con requisitos:** en un curso de Primaria bilingüe, una lección sin resultados no se puede publicar; en Arte sí.
5. **Plan curricular:** en Ciencias, el mapa muestra lo trabajado y lo evaluado. En Exploradores, el hueco se cierra con **Crear lección**.
6. **Cambios sin publicar:** en Ciencias, «El ciclo del agua» tiene cambios en borrador. Los estudiantes ven la versión publicada hasta **Publicar cambios**.
7. **Clases:** entra como `lucia.herrera`. En **Inicio → Próximas clases** abre la siguiente clase de 3.º A: muestra la lección, los recursos y la lista. Elige **Comenzar clase**, pasa lista, guarda y **Finalizar clase**. En **Matemáticas → Clases → Historial** aparece como impartida, con el porcentaje de asistencia. Con **Planificar clase** se elige grupo, fecha, hora, lección y recursos de cualquier curso.
8. **Coordinación:** entra como `marta.ruiz`. En **Educadores** verás cada persona con sus cursos, lecciones creadas, publicaciones, clases registradas y última actividad; al elegir una persona se filtra su actividad. **Avance por curso** compara todos los cursos. En **Configuración académica** están los programas.
9. **Filtros:** en **Cursos**, filtra por programa, nivel, formato, área, modalidad o responsable. En **Biblioteca**, filtra por etiqueta o área.
10. **Estudiante:** en una ventana privada, escribe `DG-MATE-3A` en **¿Eres estudiante?**. El espacio del grupo muestra la próxima clase, su lección y sus recursos, sin cuenta ni datos personales. El código de una lección publicada (por ejemplo `GREETINGS`) abre solo esa lección. Las notas para el docente no aparecen.

## Regenerar el seed

`node scripts/seed/build.mjs` reescribe la migración. Una migración aplicada no se modifica: si la demo necesita cambios después de publicarse, se agrega una migración nueva.
