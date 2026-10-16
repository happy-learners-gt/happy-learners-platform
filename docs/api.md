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
| GET, POST | `/api/members` · PUT `/api/members/:id` · POST `/api/members/:id/password` · GET, POST `/api/members/:id/departure` · PUT `/api/members/:id/coordination` | Administración |
| GET | `/api/access/matrix` · GET, POST `/api/access/groups` · PUT, DELETE `/api/access/groups/:id` · PUT `/api/access/groups/:id/permissions` · PUT `/api/access/groups/:id/members` | Administración |
| GET, POST | `/api/calendar` · DELETE `/api/calendar/:id` | Lectura con sesión; escritura de administración |
| GET | `/api/activity`, `/api/progress`, `/api/people`, `/api/reviews` | Sesión, filtrado por permisos |
| GET, POST | `/api/feeds/calendar` | Sesión: estado del enlace de calendario propio; POST lo crea o regenera |
| GET | `/api/feeds/calendar/:token.ics` | Público con el enlace secreto; solo GET |
| GET, POST | `/api/invitations` · POST `/api/invitations/:id/resend` · POST `/api/invitations/:id/revoke` | Administración |
| GET, POST | `/api/invitations/accept/:token` | Público con el enlace secreto; POST limitado a 30 intentos cada 15 minutos por origen |
| GET | `/api/hours` · GET `/api/hours/export` · POST `/api/hours/:sessionId/adjustment` | Sesión: administración ve todas las horas y corrige; cualquier otra persona ve solo las suyas |

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

## Roles y accesos

ST-128 y ST-135 (DEC-041, DEC-043). Un solo modelo de permisos con un catálogo fijo por área: **Contenido**
(`courses.view` consultar cursos, `lessons.review` revisar, devolver y publicar lecciones), **Equipo docente**
(`teams.assign` responsable y colaboradores, `sections.assign` educadores de sección), **Secciones y clases**
(`classes.view` secciones, cronogramas, asistencia y avance), **Reportes** (`activity.view` actividad) y
**Administración** (`organization.configure`, `accounts.manage`, `access.manage`, `backup.manage`, `legal.manage`), que
solo tiene el rol de administración y nunca se otorga a un grupo (400; la base de datos también lo impide). Los roles
integrados son de solo lectura: Administración (todo; publica lecciones solo si es responsable del curso), Educador
(reglas de equipo de DEC-023 y DEC-024, sin cambios) y Coordinación académica (DEC-041).

Cada permiso otorgable tiene un alcance: `{ all: true }` (todos los programas) o `{ programs: [ids] }`; un curso sin
programa solo entra en `all`. Cualquier permiso hace visible el curso en su alcance (`/api/courses`, `/api/lessons`,
`/api/progress`); ninguno deja editar lecciones ni impartir secciones. Fuera del alcance, el curso responde 403 como a
cualquier educador fuera del equipo, la sección 403 y la lección 404. `GET /api/session` incluye
`member.permissions: { admin, coordination, grants }`, calculados de nuevo en cada solicitud: un cambio se aplica en la
siguiente solicitud de la persona.

Coordinación académica (ST-128). `PUT /api/members/:id/coordination` recibe `{ enabled: true, scope }` o
`{ enabled: false }`. Solo para educadores (409 para administración); los programas deben ser de la organización
(400). Responde `{ coordination, changed }`; si el alcance no cambia, no escribe nada. Cada asignación, cambio de
alcance o retiro cierra las sesiones abiertas de la persona y queda en la actividad (`assigned`, `updated` o
`revoked` sobre `account`) y en el historial de accesos. En su alcance, la coordinación consulta todos los cursos,
secciones, cronogramas, asistencia y avance (`CourseAccess.sections: "all"`), revisa, devuelve y publica lecciones
(`review: true`, también en `GET /api/reviews`), asigna el equipo (`PUT /api/courses/:id/team`, `team: true`) y los
educadores de cada sección (`PUT /api/courses/:id/groups/:gid/educators`, `educators: true`). No configura cursos,
secciones ni la organización y no usa cuentas, invitaciones, respaldo, términos ni accesos (403). `GET /api/members`
incluye `coordination` de cada educador.

Grupos de seguridad (ST-135). `GET /api/access/matrix` devuelve `{ areas, catalog, roles, reachLabels, groups,
coordinators, programs, events }`; `events` son los últimos 50 cambios de accesos. `POST /api/access/groups` recibe
`{ name, description? }` (nombre de 2 a 80 caracteres, único sin distinguir mayúsculas: 409) y responde 201 con
`group`. `PUT /api/access/groups/:id` recibe `{ name, description?, version }` (409 si cambió). `PUT
/api/access/groups/:id/permissions` recibe `{ grants: [{ permission, scope }] }` y reemplaza los permisos;
`PUT /api/access/groups/:id/members` recibe `{ userIds }` (educadores de la organización) y reemplaza las personas;
`DELETE /api/access/groups/:id` lo elimina con sus permisos y personas. Los cambios de grupos no cierran sesiones: se
aplican en la siguiente solicitud. Cada cambio se guarda en `access_events` (quién, qué, cuándo; se conserva al eliminar
el grupo). El respaldo incluye `coordination_scopes`, `security_groups`, `security_group_grants`,
`security_group_members` y `access_events`.

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

### Acuerdo de voluntariado y firma electrónica

ST-151 y ST-153 (migración 0038). El tercer tipo de documento, `volunteer` (Acuerdo de voluntariado ad honorem), se
redacta, publica y versiona como los términos, pero no cierra la plataforma: `GET /api/legal` lo devuelve en
`agreement` mientras la persona no haya firmado la versión vigente, y entonces `POST …/sessions/:id/start`,
`POST …/sessions/:id/complete` y `PUT …/sessions/:id/attendance` responden **403**
`{ code: "VOLUNTEER_AGREEMENT_REQUIRED", agreement }` a quien imparte la sección (las respuestas 404 y 403 previas
no cambian). Una organización sin acuerdo publicado no bloquea nada. No se retira como un consentimiento.

Aceptar `terms` o `volunteer` exige firmar (DEC-043, firma electrónica simple): `POST /api/legal/accept`
`{ documentIds, signature: { fullName, password } }`. `fullName` se guarda tal como se escribe, sin espacios a los lados
(3 a 120 caracteres, una línea); la contraseña se comprueba con la de la cuenta y no se guarda. Sin firma responde
**400** `SIGNATURE_REQUIRED`; con una contraseña incorrecta, **403** `SIGNATURE_PASSWORD_INVALID`; tras cinco fallos en
15 minutos, **429** `SIGNATURE_RATE_LIMITED` con `Retry-After: 900` (contador por cuenta en `login_limits`). La
respuesta añade `signatures` con los identificadores creados. El consentimiento de privacidad sigue sin firma, y las
aceptaciones anteriores a la migración se conservan sin firma (`signatureId: null`, «Sin firma»).

Cada firma (`legal_signatures`, sin cambios ni borrado) guarda la aceptación, la cuenta (`userId`, `username`), el
nombre escrito, el documento y su versión, `signedAt` (UTC ISO), `documentSha256` = SHA-256 del JSON canónico
(claves ordenadas, sin espacios) de `{ kind, version, title, body, publishedAt }` de la versión, y `signatureSha256` =
SHA-256 del JSON canónico de `{ signatureId, organizationId, userId, username, signedName, documentId, kind, version,
documentSha256, signedAt }`.

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | `/api/legal/signatures/:id/receipt` | Quien firmó o administración: constancia HTML descargable (`Content-Disposition: attachment`) con todos los datos, ambas huellas, el texto firmado, cómo verificarla y un bloque `application/json` `#hl-constancia` |
| GET | `/api/legal/signatures` | Administración: todas las firmas, también de personas sin acceso (`active`, `departedOn`) |
| POST | `/api/legal/signatures/verify` `{ signatureId }` o `{ receipt }` | Administración: recalcula la huella del documento guardado y la de la firma, y compara la constancia campo a campo. `status`: `valid`, `document_mismatch`, `receipt_mismatch` o `unknown` |

`GET /api/legal/acceptances` añade `signatureId` y `signedName` a cada registro y `role` a cada persona. El respaldo
incluye `legal_signatures`.

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

## Perfil y expediente laboral (ST-149, ST-150, DEC-043)

| Método | Ruta | Quién |
| --- | --- | --- |
| GET, PUT | `/api/profile` | La persona con sesión: su perfil completo |
| PUT, DELETE | `/api/profile/photo` | La persona: sube (cuerpo binario `image/jpeg`, `image/png` o `image/webp`, hasta 2 MB) o quita su foto |
| GET | `/api/members/:id/profile` | Administración y la propia persona (con contacto); quien comparte el equipo de un curso activo (sin contacto); otros, 403 |
| GET | `/api/members/:id/photo` | Cualquier persona del equipo con sesión; sin foto, 404 |
| GET, POST | `/api/members/:id/files` | Administración y la propia persona: lista o agrega un documento |
| GET | `/api/members/:id/files/:doc/content` | Administración y la propia persona: descarga |
| POST | `/api/members/:id/files/:doc/withdraw` | Administración: retira el documento |
| GET | `/api/expiring-documents` | Administración: personas activas con documentos vencidos o por vencer |

`PUT /api/profile` recibe `{ displayName, phone, contactEmail, education, specialties, availability }`: nombre de 2 a
80 caracteres (es `users.display_name`, el que muestra toda la plataforma), teléfono opcional de 7 a 15 dígitos (admite
`+`, espacios, guiones y paréntesis), correo de contacto opcional (puede ser distinto del de acceso; se guarda en
minúsculas), formación de hasta 1000 caracteres, hasta 12 especialidades de 2 a 60 caracteres sin repetir y hasta 21
franjas `{ day, start, end }` (día 1 = lunes … 7 = domingo, horas `HH:MM`, inicio antes del fin, sin cruces el mismo día).
Responde `{ profile, changed }`, donde `changed` nombra los campos que cambiaron. El perfil (`StaffProfile`) trae
`contact: { phone, contactEmail, loginEmail }` solo para administración y la propia persona; los compañeros de equipo
ven nombre, foto, formación, especialidades y disponibilidad. Ninguna ruta de estudiantes (`/api/student/*`,
`/api/share/*`) incluye datos del perfil.

La foto y los documentos se guardan en el bucket R2 privado `COURSE_FILES` bajo `<organización>/staff/<persona>/…`, con su
SHA-256, y se comprueban por sus primeros bytes. Solo el Worker los entrega, con sesión, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff` y CSP `sandbox`; los documentos salen como adjunto con un nombre genérico
(`antecedentes-penales-2026-01-10.pdf`), nunca con el nombre original del archivo.

`POST /api/members/:id/files` recibe el archivo como cuerpo (`application/pdf`, `image/jpeg` o `image/png`, hasta 10 MB)
y sus datos en cabeceras: `X-Document-Type` (`dpi`, `cv`, `criminal-record`, `police-record`, `studies`,
`certificate`, `other`), `X-Document-Title` (opcional, codificado con `encodeURIComponent`; sin él, el tipo),
`X-Issued-On` (`AAAA-MM-DD`, no futura) y `X-Expires-On` (opcional, no anterior a la emisión). Responde 201 con
`{ document }`; datos o archivo inválidos, 400; más de 100 documentos vigentes por persona o 1 GiB por organización,
413. La persona puede agregar documentos a su propio expediente (`selfUploaded: true`). Cada documento trae `status`:
`expired` (pasó su vencimiento), `expiring` (vence en 30 días o menos, en la zona horaria de la organización) o `valid`.
Retirar solo registra `withdrawnAt`: el registro y el objeto se conservan, administración los sigue viendo y
descargando, y la persona deja de verlos (404). El expediente se conserva cuando la persona sale del equipo (ST-123).
`GET /api/expiring-documents` responde `{ today, people: [{ id, name, documents }] }` con las personas activas.

Cambiar el perfil o la foto, agregar, descargar y retirar documentos quedan en `GET /api/activity` como
`targetType: "account"` con las acciones existentes `updated`, `uploaded`, `recorded` (la consulta o descarga) y
`withdrawn`. El resumen nombra los campos del perfil que cambiaron y el tipo del documento, nunca sus valores, el
título ni el contenido. Como las demás entradas sin curso, solo las ve administración.

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

## Horas efectivas (ST-152)

Migración `0040_effective_hours.sql`. Reconocen el voluntariado ad honorem (DEC-043); no son nómina.

`GET /api/hours?from=&to=&course=&section=&person=` lista las clases **finalizadas** con sus horas. Una clase cuenta
desde `started_at` (Comenzar clase o pasar lista) hasta `completed_at` (Finalizar clase), en minutos redondeados, y se
atribuye a quien la comenzó (`taught_by`). Estados: `counted`; `no_start` (sin inicio real: sin `started_at` o igual a la
finalización, como las clases finalizadas antes de esta versión o finalizadas directamente desde «pendiente») cuenta 0;
`review` (más de 480 minutos) cuenta 0 hasta que administración la corrige; `adjusted` usa la corrección vigente. Las
clases canceladas, pendientes o en curso no aparecen ni suman. `from` y `to` (AAAA-MM-DD, ambos incluidos) comparan el día
del inicio en la zona horaria de la organización (sin inicio, el día de la clase). Administración ve a todas las personas
(`scope: "all"`); cualquier otra cuenta, solo las clases atribuidas a ella (`scope: "own"`), aunque pida otra `person`.
Responde `{ filter, timezone, scope, rows, minutes, totals: { people, courses, sections }, options }`; 400 con filtros
inválidos.

`GET /api/hours/export` acepta los mismos filtros y la misma visibilidad y entrega `text/csv; charset=utf-8` con BOM,
encabezados en español (Fecha, Curso, Sección, Educador, Inicio, Finalización, Minutos calculados, Minutos efectivos,
Horas efectivas, Estado, Motivo de la corrección), horas locales, separador coma, líneas CRLF y una fila `Total`. Las
celdas que empiezan con `=`, `+`, `-` o `@` llevan un apóstrofo delante.

`POST /api/hours/:sessionId/adjustment` (administración) recibe `{ minutes, educatorId?, reason }`: minutos enteros de 0 a
720, la persona de la organización a quien se atribuye y un motivo de 5 a 300 caracteres. 400 sin motivo o si no cambia
nada, 403 para otras cuentas, 404 si la clase no existe y 409 si no está finalizada. Guarda la corrección en
`class_hour_adjustments` (minutos y persona antes y después, motivo, quién y cuándo; la última está vigente) y escribe la
actividad `updated`/`session` «Corrigió las horas efectivas de la clase del … : antes → después[, atribuidas a …]. Motivo:
…». Responde `{ row }`. El respaldo incluye `class_hour_adjustments`.

