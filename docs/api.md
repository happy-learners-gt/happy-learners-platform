# API

Rutas vigentes de la versión 1.0 (ST-076). Todas responden JSON con `Cache-Control: no-store` y las cabeceras de
seguridad de la aplicación. Las escrituras exigen el mismo origen (`Origin`) y responden 403 si llegan de otro sitio.
Un método no admitido responde 405 con `Allow`; una ruta desconocida, 404.

## Sesión y organización

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/health`, `/api/version` | Público |
| POST | `/api/login`, `/api/logout` | Público; 30 intentos cada 15 minutos por origen |
| GET | `/api/session` | Sesión |
| GET, PUT | `/api/organization` | Lectura con sesión; escritura de administración |
| GET | `/api/organization/backup` | Administración |
| POST | `/api/organization/restore` | Administración, solo donde `RESTORE_ENABLED=true` |
| GET | `/api/members` · PUT `/api/members/:id` | Administración |
| GET, POST | `/api/calendar` · DELETE `/api/calendar/:id` | Lectura con sesión; escritura de administración |
| GET | `/api/activity`, `/api/progress`, `/api/people`, `/api/reviews` | Sesión, filtrado por permisos |
| GET, POST | `/api/feeds/calendar` | Sesión: estado del enlace de calendario propio; POST lo crea o regenera |
| GET | `/api/feeds/calendar/:token.ics` | Público con el enlace secreto; solo GET |

## Programas, cursos y contenido

| Método | Ruta |
| --- | --- |
| GET, POST | `/api/programs` |
| GET, PUT | `/api/programs/:id`, `/api/programs/:id/prerequisites` |
| GET, POST | `/api/courses` |
| GET, PUT | `/api/courses/:id` |
| POST | `/api/courses/:id/duplicate` |
| PUT | `/api/courses/:id/team` |
| GET, POST | `/api/courses/:id/units`, `/api/courses/:id/materials` |
| PUT | `/api/courses/:id/units/:unit` (incluye `order`), `/api/courses/:id/materials/:material` |
| POST · PUT | `/api/courses/:id/competencies`, `/api/courses/:id/outcomes` · `…/:item` |
| PUT | `/api/courses/:id/units/:unit/outcomes` |
| GET, POST | `/api/courses/:id/files` · GET `…/files/:file/content` · POST `…/files/:file/archive` |
| GET, POST | `/api/lessons` · GET, PUT, DELETE `/api/lessons/:id` |
| POST | `/api/lessons/:id/publish`, `…/duplicate`, `…/review`, `…/review/return` |
| GET | `/api/courses/:id/lessons/:lesson/collaborate` (WebSocket de coedición) |
| GET | `/api/resources` (biblioteca compartida, solo lectura) |
| GET | `/api/taxonomy` · POST `/api/vocabularies`, `/api/terms` · PUT `…/:id` |

## Secciones y clases

| Método | Ruta |
| --- | --- |
| GET | `/api/sections`, `/api/sections/:id`, `/api/sections/:id/progress`, `/api/classes` |
| GET, POST | `/api/courses/:id/groups`, `/api/courses/:id/sessions` |
| GET, PUT | `/api/courses/:id/groups/:group` |
| PUT, DELETE | `/api/courses/:id/groups/:group/schedule` |
| POST | `/api/courses/:id/groups/:group/lessons`, `…/learners` · PUT `…/learners/:learner` |
| PUT | `/api/courses/:id/groups/:group/educators`, `…/activity-groups` |
| GET, POST | `/api/courses/:id/groups/:group/work-groups` · PUT, DELETE `…/work-groups/:id` |
| POST, DELETE | `/api/courses/:id/groups/:group/code` |
| GET, PUT | `/api/courses/:id/sessions/:session`, `…/attendance` · PUT `…/outcomes` |
| POST | `/api/courses/:id/sessions/:session/start`, `…/complete`, `…/cancel`, `…/restore` |

`PUT …/educators` recibe `{ userIds, conflictReason? }`. Si una persona agregada imparte otra sección activa con
clases próximas a la misma hora, responde 409 con `conflicts` y no cambia nada; con `conflictReason` (3 a 300
caracteres) guarda la asignación y registra la confirmación, que ya no se vuelve a pedir para esa persona en ese par
de secciones.

## Calendario de clases (ST-125)

`POST /api/feeds/calendar` crea o regenera el enlace de suscripción de quien tiene la sesión y responde 201 con
`{ active, createdAt, url, webcal }`. El enlace (`/api/feeds/calendar/<token>.ics`) solo se muestra en esa
respuesta: el token tiene 256 bits aleatorios, empieza por la letra de la organización como los de sesión y se
guarda únicamente su SHA-256 en `calendar_feeds`. Regenerarlo reemplaza el hash, de modo que el enlace anterior
responde 404 de inmediato. `GET /api/feeds/calendar` responde `{ active, createdAt }` sin el enlace.

`GET /api/feeds/calendar/<token>.ics` no requiere sesión (lo consultan Google Calendar, Outlook y Apple Calendar)
y responde `text/calendar; charset=utf-8` con `Cache-Control: private, max-age=900`. Es un VCALENDAR (RFC 5545) con
un VEVENT por clase de las secciones que la persona imparte (la misma consulta que `/api/classes` y la Agenda),
desde 30 días atrás hasta 180 días adelante: UID estable por clase, horas en UTC (`Z`), `SUMMARY` «curso · sección»,
`STATUS:CANCELLED` en las clases canceladas y `SEQUENCE`/`LAST-MODIFIED` que crecen con cada cambio, para que una
reprogramación actualice el evento. Una clase sin hora es un evento de día completo. Un token desconocido o
reemplazado, o una cuenta desactivada, responde 404. El respaldo no copia `calendar_feeds`.
Para administración, los educadores de `GET …/groups` y `GET /api/sections/:id` incluyen `conflicts` con su
confirmación. La `duration` de una lección es la suma de los minutos de sus actividades; la que envía el cliente solo se
usa si ninguna actividad tiene minutos. La zona horaria de la organización es un identificador IANA, por ejemplo `America/Guatemala`.

## Estudiantes y lecciones compartidas

| Método | Ruta |
| --- | --- |
| GET | `/api/share/:code`, `/api/share/:code/files/:file` |
| POST | `/api/share/:code/complete` |
| POST | `/api/student/login`, `/api/student/logout`, `/api/student/identity`, `/api/student/progress` |
| GET | `/api/student/space`, `/api/student/files/:file` |

## Rutas retiradas

Responden **410** con «Esta ruta se retiró en la versión 1.0.». El currículo de niveles y unidades se reemplazó por
los módulos de cada curso, y los recursos se agregan en la biblioteca de cada curso (`materials`).

- `/api/curriculum`
- `/api/levels`, `/api/levels/:id` (incluye `order`)
- `/api/units`, `/api/units/:id`
- `POST /api/resources`, `/api/resources/:id`
