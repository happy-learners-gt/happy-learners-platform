# v0.7.0 · Organización de demostración, equipos y avance

HL-44 · ST-041 · REL-003.

## Qué cambia

- **Una demo que se puede recorrer completa.** El entorno de pruebas trae a Colegio Horizonte, una organización ficticia que incluye:
  - Seis personas: Marta Ruiz, de coordinación, y cinco educadores (Lucía Herrera, Carlos Mejía, Ana López, Diego Ramírez y Sofía Castillo).
  - Tres programas: Primaria bilingüe, Inglés para niños y Formación tecnológica.
  - Seis cursos: Matemáticas 3.º, Ciencias 4.º, English Explorers A1, Taller de robótica, Arte (preprimaria) y un Club de lectura archivado, además de Exploradores.
  - En cada curso: plan curricular, módulos, lecciones con momentos y bloques, recursos con enlaces reales, grupos y asistencia de septiembre.

  Cada educador hizo las operaciones que le corresponden, y el historial lo refleja. Todas las cuentas usan `Aprender-2026!`. Guía: `docs/demo/organizacion-demo.md`.
- **Equipo docente por curso:** una persona responsable y colaboradores. Es visible en las tarjetas y en el resumen, editable en Configuración y filtrable en Cursos. Todos los educadores siguen pudiendo editar, así que no cambia ningún permiso.
- **Historial de actividad con autor**, registrado en la API tras cada operación de configuración o de autoría y en cada registro de asistencia.
- **Avance:**
  - *Mis cursos* en Inicio, para cada educador.
  - En **Educadores**: contribuciones por persona, avance por curso y actividad filtrable por persona.

## Datos

- `0014_course_teams_activity.sql`:
  - `users.display_name`.
  - `course_members`, con índice único para un solo responsable y disparador de organización.
  - `activity_events`, con claves compuestas por curso y organización.
- `0015_demo_organization.sql`:
  - Generado y determinista; cada sentencia comprueba que la base es la de `org-demo`, así que en otras organizaciones no hace nada.
  - Exploradores conserva su contenido: solo se agregan a Ana como colaboradora y un historial de asistencia de su grupo.
- **Hallazgo y corrección previa al despliegue:** SQLite en Durable Objects rechaza cadenas SQL demasiado largas. El seed (596 KB) habría fallado con `SQLITE_TOOBIG`. Ahora el generador escribe una sentencia por línea y la base la ejecuta por partes dentro de la misma transacción, y una prueba lo garantiza.

## Validación

- `tests/seed.test.ts`:
  - El seed está sincronizado con su generador y tiene una sentencia por línea.
  - Hay cinco o más cursos completos.
  - Cada lección pasa `validActivities`.
  - Las lecciones publicadas cumplen los requisitos de su curso, tienen todos sus momentos y su tiempo cuadra con la duración.
  - Toda persona aparece en el historial.
- `tests/test_migrations.py`: el seed es completo en `org-demo` y no deja nada en `org-other`; no hay violaciones de claves foráneas.
- E2E nuevo `team.spec.ts`: Inicio de una educadora, equipo y procedencia de ajustes, filtro por responsable, contribuciones en Educadores y programas.
- Resto de la suite en escritorio y móvil, con axe WCAG 2.2 A/AA y el detector de CSP.
