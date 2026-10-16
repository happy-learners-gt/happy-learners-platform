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
| POST | `/api/account/password` | Sesión |
| GET, PUT | `/api/organization` | Lectura con sesión; escritura de administración |
| GET | `/api/organization/backup` | Administración |
| POST | `/api/organization/restore` | Administración, solo donde `RESTORE_ENABLED=true` |
| GET, POST | `/api/members` · PUT `/api/members/:id` · POST `/api/members/:id/password` · GET, POST `/api/members/:id/departure` | Administración |
| GET, POST | `/api/calendar` · DELETE `/api/calendar/:id` | Lectura con sesión; escritura de administración |
| GET | `/api/activity`, `/api/progress`, `/api/people`, `/api/reviews` | Sesión, filtrado por permisos |
| GET, POST | `/api/feeds/calendar` | Sesión: estado del enlace de calendario propio; POST lo crea o regenera |
| GET | `/api/feeds/calendar/:token.ics` | Público con el enlace secreto; solo GET |
| GET, POST | `/api/invitations` · POST `/api/invitations/:id/resend` · POST `/api/invitations/:id/revoke` | Administración |
| GET, POST | `/api/invitations/accept/:token` | Público con el enlace secreto; POST limitado a 30 intentos cada 15 minutos por origen |

Cuentas del equipo (ST-093). `POST /api/members` recibe `{ displayName, username, role }` (`admin` o `educator`); el
usuario tiene de 3 a 32 letras minúsculas, números, puntos, guiones o guiones bajos y es único en todas las
organizaciones, porque decide dónde inicia sesión su dueño (409 si ya existe). Responde 201 con `member` y
`temporaryPassword`, que solo aparece en esa respuesta: no se guarda en claro ni entra en la actividad ni en el respaldo.
`POST /api/members/:id/password` (sin cuerpo) emite otra contraseña temporal y cierra las sesiones de esa persona;
responde 409 para la propia cuenta y la administradora inicial. `PUT /api/members/:id` recibe `{ role, active }`: con
`active: false` la cuenta no inicia sesión y conserva su historial; nunca se borra.
Mientras una cuenta use una contraseña temporal, `GET /api/session` incluye `member.mustChangePassword: true` y las
demás rutas responden 403 con `code: "PASSWORD_CHANGE_REQUIRED"`, salvo `POST /api/logout` y
`POST /api/account/password`, que recibe `{ currentPassword, newPassword }` (12 a 128 caracteres variados, distinta del
usuario y de la actual) y cierra las demás sesiones. Crear una cuenta, cambiar su rol, desactivarla o reactivarla,
restablecer su contraseña y cambiarla quedan en `GET /api/activity` como `targetType: "account"` (acciones `created`,
`updated`, `archived`, `restored` y `reset`), visibles para administración.

Salida de una persona (ST-123). `GET /api/members/:id/departure` devuelve lo que la persona tiene a su cargo en los
cursos activos: `courses` (`role` `lead` o `co-teacher`, con su equipo), `sections` (secciones activas que imparte,
con `others` y `required: true` cuando nadie más la imparte), `people` (personas activas que pueden asumirlo), `today`
y `lastDeparture`. `POST /api/members/:id/departure` recibe `{ date, reason?, reassignments: { courses: { courseId:
userId }, sections: { sectionId: userId } }, conflictReason? }`: `date` es AAAA-MM-DD, hoy o antes (400 si no);
`reason`, opcional, hasta 300 caracteres, solo para administración. Cada curso que dirige necesita una nueva persona
responsable y cada sección que imparte sola o solo, quien la imparta; si falta alguna, responde 409 con
`missing: { courses, sections }` sin cambiar nada. Las personas elegidas deben estar activas y no ser quien sale (400);
quien no está en el equipo entra como responsable o como colaborador, hasta 20 por equipo. Si el reemplazo de una
sección ya imparte otra a la misma hora, responde 409 con `conflicts` hasta recibir `conflictReason` (3 a 300
caracteres), como en ST-118. En una sola transacción aplica las reasignaciones, retira a la persona de los equipos y
secciones de los cursos activos (los archivados conservan su equipo), desactiva su acceso, cierra sus sesiones y su
enlace de calendario, guarda la salida en `departures` y escribe la actividad: `archived`/`account` («Registró la
salida de … el AAAA-MM-DD», sin el motivo) y `assigned` sobre `team` o `group` por cada reasignación. Nada de lo que
hizo se borra. Responde 409 para la propia cuenta, la administradora inicial o una salida ya registrada de una cuenta
sin acceso. Reactivar con `PUT /api/members/:id` conserva la salida; `GET /api/members` incluye `departedOn` con la
fecha de la última. El respaldo incluye la tabla `departures`.

## Términos y privacidad

ST-126 y ST-127. Cada organización publica versiones de sus términos y condiciones (`terms`) y de su política de
privacidad (`privacy`), que además lleva el texto del consentimiento. Un borrador no tiene versión; publicarlo le da la
siguiente y desde entonces no cambia ni se borra. `GET /api/session` responde `{ member, pending }`: `pending` lista la
última versión publicada de cada documento que la persona no ha aceptado o cuyo consentimiento retiró. Mientras no
esté vacía, las demás rutas con sesión responden **403** con el mismo `pending`, salvo `GET /api/organization` y
`/api/legal`. Sin versiones publicadas, nadie tiene pendientes.

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/public/privacy[?organization=:id]` | Público: la política vigente de cada organización (o de una; 404 si no tiene) |
| GET | `/api/legal` | Sesión: versiones vigentes, `pending` y los registros propios (`mine`) |
| POST | `/api/legal/accept` `{ documentIds }` | Sesión: acepta versiones vigentes; una versión anterior responde 409 |
| POST | `/api/legal/withdraw` `{ documentId }` | Sesión: retira el consentimiento de privacidad vigente; el registro se conserva con `withdrawnAt` |
| GET | `/api/legal/documents` | Administración: borradores y todas las versiones |
| PUT | `/api/legal/documents/:kind` `{ title, body, consent? }` | Administración: guarda el borrador de `terms` o `privacy` |
| POST | `/api/legal/documents/:kind/publish` | Administración: publica el borrador como nueva versión |
| GET | `/api/legal/acceptances` | Administración: quién aceptó qué versión y cuándo, y las personas activas |

Publicar, aceptar y retirar quedan en `/api/activity` (`targetType: "legal"`), sin el texto de los documentos.

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

## Invitaciones por correo (ST-121, DEC-042)

`POST /api/invitations` recibe `{ email, displayName, role }` (correo válido que se guarda en minúsculas, nombre de 2 a
80 caracteres, `admin` o `educator`). Responde 201 con `{ invitation, link, delivery }`: `link` es
`<origen>/invitacion/<token>` y solo aparece en esta respuesta y en la de reenviar; es la alternativa documentada para
compartirlo a mano cuando el correo no sale. El token tiene 256 bits aleatorios y empieza por la letra de la
organización, como los de sesión; solo se guarda su SHA-256. La invitación caduca a los 7 días. Responde 409 si ya hay
una cuenta con ese correo en la organización o una invitación pendiente para él.

`delivery` es el estado del mensaje en la bandeja de salida de la organización (`mail_outbox`): `sent`, `failed`
(se intentó dos veces si el fallo era temporal: red, 429 o 5xx), `not_configured` (el Worker no tiene
`BREVO_API_KEY` y `MAIL_FROM`; es el caso de desarrollo local y pruebas) o `deferred` (la organización ya envió 250
correos ese día UTC, por debajo del límite de 300 del plan gratuito de Brevo). El mensaje sale con el remitente
«Happy Learners», asunto «Te invitaron a Happy Learners», texto y HTML con la organización, el rol, quien invita, el
enlace y su caducidad. La bandeja no guarda el cuerpo (contiene el enlace) y `last_error` nunca lleva la clave.

`GET /api/invitations` lista las últimas 100 con `status` (`pending`, `accepted`, `revoked`, `expired`), `expiresAt`,
`invitedBy`, `delivery`, `deliveryError` y `sentAt`, nunca el token; incluye `mailConfigured`.
`POST /api/invitations/:id/resend` (sin cuerpo; también es «Reintentar envío») emite un enlace nuevo con 7 días de
vigencia, el anterior responde 404, y vuelve a enviar; responde como la creación. `POST /api/invitations/:id/revoke`
(sin cuerpo) la invalida. Ambas responden 409 si la invitación ya fue aceptada o revocada.

`GET /api/invitations/accept/<token>` no requiere sesión y responde `{ invitation: { organization, displayName, email,
role, expiresAt } }`; un token desconocido o reemplazado responde 404 (`INVITATION_NOT_FOUND`) y uno caducado, revocado
o ya usado, 410 (`INVITATION_EXPIRED`, `INVITATION_REVOKED`, `INVITATION_USED`). `POST` con `{ username, password }`
(reglas de ST-093: usuario único en todas las organizaciones, 409 si existe; contraseña de 12 a 128 caracteres
variados distinta del usuario) crea la cuenta con el rol, el nombre y el correo de la invitación, sin contraseña
temporal, la marca aceptada y responde 201 con `member` y la cookie de sesión, como el inicio de sesión.

Crear, reenviar, revocar y aceptar quedan en `GET /api/activity` como `targetType: "invitation"` (acciones `created`,
`resent`, `revoked`, `accepted`; la aceptación la registra la nueva cuenta), sin enlaces ni contraseñas. El correo de
las cuentas solo aparece en `GET /api/members` (administración); `GET /api/people` y las listas de estudiantes no lo
incluyen. El respaldo copia `users.email` y omite `invitations` y `mail_outbox`.

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

`GET /api/courses/:id/sessions` acepta filtros combinables (ST-065): `section` (la sección o grupo), `from` y `to`
(días `AAAA-MM-DD` en la zona horaria de la organización, ambos incluidos). Los días sin clase (`breaks`) se limitan a
los mismos filtros y la respuesta repite el `filter` aplicado. Fechas inválidas o `to` anterior a `from` responden 400.
Una sección de otro curso o que la persona no ve (un educador solo ve las suyas; administración, todas) responde 404
sin datos; fuera del equipo del curso responde 403. En la web, el **Cronograma** de una sección filtra por sección y
periodo, y guarda el periodo en la dirección (`?desde=&hasta=`).

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
