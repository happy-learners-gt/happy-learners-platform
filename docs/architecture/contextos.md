# Contextos delimitados

Hoja de ruta, carril C.1. Cómo se reparte la plataforma, qué datos son de cada parte y qué dependencias se permiten.
Describe el código de 1.5.7 (31-oct-2026); el mapa de importaciones se obtuvo de `apps/api/src` con un script, no de
memoria. Los cambios de patrón se registran como decisiones (DEC) en `happy-learners-ops/docs/architecture/decisiones.md`.

## 1. Capas que ya existen

- **`packages/domain`**: reglas puras, sin E/S (validaciones, motores deterministas como el de horarios, el de PDF, la
  revisión de lecciones o el reporte de avance). Se prueba sin Worker. Nunca importa de `apps/`.
- **`packages/contracts`**: tipos de lo que viaja entre la API y la web.
- **`apps/api`**: el Worker. `index.ts` enruta; cada módulo atiende un grupo de rutas y habla con la base de la
  organización por `storage.ts` (un Durable Object con SQLite por organización).
- **`apps/web`**: React; habla solo con la API.

## 2. Contextos

| Contexto | Módulos de la API | Datos que posee | Puede usar |
| --- | --- | --- | --- |
| **Identidad y accesos** | `auth`, `accounts`, `account`, `roles`, `permissions`, `access`, `invitations`, `onboarding`, `departures`, `closures`, `personal-data`, `preferences` | usuarios, membresías, sesiones, grupos de seguridad, alcances de coordinación, invitaciones, preferencias | Plataforma |
| **Personas y perfiles** | `profiles`, `professional`, `legal`, `contracts` | perfiles, documentos del personal, credenciales, términos y consentimientos, plantillas y contratos firmados | Identidad, Plataforma |
| **Contenido** | `courses`, `team`, `content`, `duplicate`, `collaboration`, `rich-text`, `files`, `resources`, `bibliography`, `delivery` | cursos y sus equipos, unidades, lecciones (borrador y publicada), archivos, biblioteca, lecturas | Identidad, Plataforma |
| **Plan curricular** | `curriculum-packages`, `prerequisites` | resultados, paquetes curriculares, prerrequisitos | Contenido |
| **Secciones y calendario** | `sections`, `classes`, `attendance`, `agenda`, `calendar-feed`, `conflicts`, `hours`, `academic-years`, `bell-schedules`, `institutional-calendar`, `timetables`, `workgroups`, `group-sets`, `section-freedom`, `section-sharing`, `freedom-plan` | secciones, estudiantes de la sección, clases, asistencia, ciclos, jornadas, aulas, eventos, grupos de trabajo | Contenido, Identidad, Plataforma |
| **Evaluación y documentos** | `assessment`, `gradebook`, `grading-schemes`, `group-grading`, `panel-minutes`, `reports` | plan de evaluación, punteos, esquemas, tribunales, actas, plantillas de documentos, documentos generados | Secciones, Contenido, Identidad |
| **IA** | `openai`, `ai-runs`, `ai-usage`, `ai-assist`, `proposals`, `book-map` | registro de uso de IA, precios, propuestas de lecciones, mapas de libros | Contenido, Plan curricular |
| **Plataforma** | `index`, `storage`, `backup`, `telemetry`, `activity`, `home`, `mail`, `notify`, `notifications`, `account-notices` | migraciones, respaldo, registro, correo y avisos, bitácora de actividad; `home` compone Inicio a partir de los demás | — (todos la usan) |

## 3. Reglas de dependencia

1. El dominio no conoce la API ni la base: recibe datos y devuelve datos.
2. Un contexto usa a otro por sus funciones exportadas, nunca leyendo sus tablas con SQL propio. Hoy hay excepciones
   (por ejemplo, Evaluación lee `class_sessions` y `group_learners`); se corrigen cuando se toca ese código.
3. La Plataforma no depende de ningún contexto de negocio. Excepciones actuales: `storage.ts` importa `proposals` y
   `book-map` para el trabajo en segundo plano de las alarmas.
4. Sin importaciones circulares entre módulos.

## 4. Estado real y deudas (medido)

Al escribir este documento había siete importaciones circulares directas entre módulos de la API. En la misma entrega
(1.5.8) se cortaron las que pasaban por `team.ts`: la bitácora salió a `activity.ts` (Plataforma, sin dependencias) y el
progreso de Inicio a `home.ts`. `team.ts` pasó de 34 módulos que lo importaban a 2.

Quedan tres ciclos en tiempo de ejecución (los de `storage` con `proposals` y `book-map` son solo de tipos y TypeScript
los borra al compilar):

- `classes ↔ content`, `classes ↔ professional`: `classes.ts` (664 líneas, importa 11 módulos) mezcla clases,
  espacio del estudiante, archivos de la sección y educadores visibles.
- `book-map ↔ proposals`: el mapa del libro y las propuestas comparten pasos del trabajo en segundo plano.

Módulos que más dependen de otros: `content` (12), `classes` (11), `gradebook` (10).

## 5. Orden para corregir (cuando se toque cada parte)

1. ~~Sacar la bitácora de `team.ts`~~ (1.5.8, `activity.ts`) y ~~el progreso de Inicio~~ (1.5.8, `home.ts`).
2. Partir `classes.ts`: espacio del estudiante (`student-space.ts`) y clases de la sección; corta los ciclos con
   `content` y `professional`.
3. Separar lo común de `book-map` y `proposals` en un módulo de trabajos de fondo; registrar esos trabajos en
   Plataforma (`storage` recibe una lista de tareas) en lugar de importar módulos de IA.
4. Partir `gradebook.ts` (1 018 líneas): libreta, documentos (boleta, constancia, reporte de avance) y tribunales.

Cada paso es un cambio sin efecto visible, con las pruebas existentes como red.
