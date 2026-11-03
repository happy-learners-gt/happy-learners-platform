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
| GET | `/api/calendars` · `/api/calendars/view?from&until[&program][&section]` | Todas las personas con sesión |
| GET | `/api/agenda?from&until[&scope=mine\|organization\|program:id\|section:id]` | Sesión. `mine` son las secciones que imparte; administración y coordinación pueden ampliar el alcance. El rango admite hasta 400 días. |
| POST, PUT, DELETE | `/api/calendars/:id/rules[/:ruleId]` · `/events[/:eventId]` | Administración; coordinación con `sections.assign` en su alcance |
| POST | `/api/calendars/:id/years/:year/generate[?preview=1]` · `/templates/guatemala` | Administración; coordinación con `sections.assign` en su alcance |
| GET, POST | `/api/academic-years` · PUT, DELETE `/api/academic-years/:id` · POST `/api/academic-years/:id/activate`, `/close`, `/next` | Lectura con sesión; escritura de administración |
| GET | `/api/activity`, `/api/progress`, `/api/people`, `/api/reviews` | Sesión, filtrado por permisos |
| GET, POST | `/api/feeds/calendar` | Sesión: estado del enlace de calendario propio; POST lo crea o regenera |
| GET | `/api/feeds/calendar/:token.ics` | Público con el enlace secreto; solo GET |
| GET, POST | `/api/invitations` · POST `/api/invitations/:id/resend` · POST `/api/invitations/:id/revoke` | Administración |
| GET, POST | `/api/invitations/accept/:token` | Público con el enlace secreto; POST limitado a 30 intentos cada 15 minutos por origen |
| GET, PUT | `/api/notifications/preferences` | Cada persona con sesión: sus avisos y su historial |
| GET, PUT | `/api/notifications/policy` · GET `/api/notifications/log` | Administración |
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

Ciclo lectivo (0048). `GET /api/academic-years` responde `{ years, today }` con los ciclos de la organización, del más
reciente al más antiguo, cada uno con `{ id, name, from, until, status, periodKind, periods, createdAt, updatedAt,
activatedAt, closedAt }`; `status` es `draft`, `current` o `closed`, y `periodKind`, `bimester`, `trimester`, `semester`
o `unit`. Los periodos (`{ id, position, name, from, until, weight }`, con `weight` de 1 a 100 para el promedio ponderado) van ordenados. `POST` recibe `{ name, from, until,
periodKind, periods: [{ name, from, until, weight? }] }` y crea un borrador (201). `PUT /api/academic-years/:id` recibe lo mismo, y
cada periodo que conserva su `id` mantiene su identidad. El servidor valida que el ciclo dure hasta un año y que los
periodos queden dentro de él, sin traslaparse y con nombres distintos (400). El nombre es único en la organización (409).
`activate` exige un borrador con al menos un periodo y que no haya otro ciclo vigente (409); `close` solo aplica al
vigente; un ciclo cerrado ya no se edita y solo se elimina un borrador (409). `next` crea en borrador el ciclo siguiente
(«Ciclo 2027» → «Ciclo 2028») con las fechas y el patrón de periodos un año después, sin copiar secciones, estudiantes
ni notas. Un ciclo puede incluir `programId`: el vigente de un programa convive con el de la organización. Un horario
de sección puede incluir `periodId`; entonces usa las fechas de ese periodo del ciclo vigente de la organización o del
programa. Los días sin clase siguen siendo compatibles con `/api/calendar` (DEC-026).

## Calendario institucional

`GET /api/calendars` devuelve los calendarios de organización, programa y sección junto con las categorías base; cada
calendario incluye sus `rules`, para que la interfaz pueda describirlas, editarlas y calcular su vista previa local.
`GET /api/calendars/view?from=YYYY-MM-DD&until=YYYY-MM-DD` devuelve los eventos de la organización; `program` suma los
del programa y `section` suma los de su programa y sección. Cada evento indica su calendario, categoría y nivel de
origen. Un evento omitido (`status: "skipped"`) permanece visible, pero no suspende clases.

Las reglas reciben `{ categoryId, noClass, rule: DateRule }`; el servidor asigna el `id` de la regla. Los eventos
sueltos reciben `{ categoryId, title, from, until?, part?, noClass?, status? }`. Una ocurrencia generada puede moverse
con `PUT` o saltarse con `status: "skipped"` sin alterar la regla. Generar con `preview=1` devuelve
`{ plan: { create, update, keep } }`; sin vista previa aplica el plan y conserva las ocurrencias movidas u omitidas.
La plantilla de Guatemala agrega reglas de categoría `holiday` sin duplicar títulos y no afirma la ley vigente.

Los eventos activos con `noClass: true` regeneran las clases pendientes del nivel afectado. `part: "morning"` afecta
reuniones que empiezan antes de las 12:00 y `part: "afternoon"`, las que empiezan desde las 12:00. Las rutas antiguas
`GET|POST /api/calendar` y `DELETE /api/calendar/:id` leen y escriben estos mismos eventos con la respuesta anterior.

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

### Propuestas de lecciones y PDF de entrega (0052)

**Requisitos.** `GET /api/courses/:id/proposals` dice si el curso puede pedir propuestas y lista sus trabajos:
- `outcomes`: indicadores activos del plan, con su código CNB;
- `units`: módulos;
- `sequence`: la secuencia didáctica que resuelve el curso;
- `book`: el libro principal, que debe ser un PDF publicado;
- `bookText`: `missing`, `stale`, `ready` o `no_text`;
- `generator`: `openai`, `fixture` o `null`;
- `blockers`: en español lo que falta;
- `jobs` y `canPropose` (el equipo del curso).

**Texto del libro.** El navegador lee el PDF con pdf.js y `PUT …/proposals/book-text` guarda su texto por página: `{ fileId,
sha256, pages: [{ page, text }] }`, hasta 1000 páginas y 8 MiB. El servidor nunca procesa PDF. Un PDF sin capa de texto
(escaneado) responde 422 y no hay OCR.

**Pedir propuestas.** `POST …/proposals` recibe `{ unitId, outcomeIds, minutes }` (hasta 12 indicadores) y responde 202:
- crea un elemento por indicador, con las páginas del libro que le corresponden según una búsqueda léxica TF-IDF determinista;
- un indicador que el libro no trata queda en `error` de inmediato;
- la clave de idempotencia (curso, módulo, indicador, huella del libro, versión de las instrucciones, generador y duración)
  impide duplicar una lección: pedir lo mismo otra vez responde 409;
- `POST …/proposals/:job/retry` devuelve a la cola los elementos con error que tienen páginas.

**Colocación y procedencia (1.2.2).** Con `unitId: "plan"`, cada lección va al módulo activo cuyo plan trabaja su
indicador (o al primero, si ninguno lo planifica), con un trabajo por módulo. Cada lección propuesta guarda `generated`
(`source`, `model`, `pages`, `indicator`, `at`), que se conserva al editarla y que ningún cliente puede fijar; la
interfaz la presenta como «Propuesta de IA» hasta que alguien la publica. La interfaz es «Planificar con IA»
(`/cursos/:id/asistente`), con los pasos Libro, Mapa del libro, Propuestas, Revisión y Calendario.

**Ejecución.** Nunca ocurre en un request. La alarma del Durable Object de la organización procesa lotes de 3 elementos
(`queued → running → done | error`). En una sola transacción crea la lección en borrador y marca el elemento `done`.
Un elemento interrumpido vuelve a la cola a los 10 minutos.

**Generadores.** Responden un JSON estricto que la plataforma convierte a su modelo de lección (momentos de la secuencia,
bloques, una pregunta de evaluación, el libro como recurso, el indicador) y valida.
- OpenAI se usa si existen los secretos `OPENAI_API_KEY` y `OPENAI_MODEL` (Responses API con salida estructurada,
  `store: false`).
- El generador `fixture`, determinista y sin llamadas externas, se usa solo con `LESSON_GENERATOR=fixture` (pruebas y
  demostración local).
- Los borradores siguen el flujo existente de revisión y publicación; nada se publica solo.

**PDF de entrega.** `GET /api/courses/:id/units/:unitId/delivery.pdf?section=:groupId[&period=:periodId]`:
- incluye solo la versión publicada de cada lección del módulo (`published_content`), nunca un borrador;
- el membrete lleva organización, docentes de la sección, curso, sección, ciclo lectivo, periodo (el pedido o el de hoy)
  y fecha y hora de generación;
- cada página lleva el pie «Copia de entrega. No redistribuir. Generado en Happy Learners.»;
- lo descarga quien ve la sección; responde 409 si el módulo no tiene lecciones publicadas;
- la actividad registra cada descarga.

### Mapa del libro (0053)

`GET /api/courses/:id/book-map` responde, para el libro principal (identificado por su SHA-256: otro libro empieza otro
mapa) y cada indicador activo del plan, `{ candidates, pages, evidence, source, status, aiStatus, aiError }` y un
resumen (`total`, `mapped`, `confirmed`, `uncovered`). Lo gestiona el equipo del curso:
- `POST …/book-map` (cuerpo `{}`) busca de nuevo en el texto del libro y conserva lo confirmado.
- `POST …/book-map/check` encola la revisión con IA, que procesa la alarma del Durable Object en lotes de 3. El modelo
  (o el fixture) dice qué páginas candidatas trabajan el indicador y cita una frase de cada una. **Solo se acepta una
  página si su cita está de verdad en ella**; las demás se descartan y se cuentan.
- `PUT …/book-map/outcomes/:outcomeId` recibe `{ pages: "12, 15-17" }` y confirma. La lista vacía significa «el libro no
  lo trata».
- `POST …/book-map/confirm` confirma lo propuesto.

Las propuestas de lecciones usan las páginas confirmadas y, si no hay, la búsqueda. La clave de idempotencia incluye las
páginas, así que corregir el mapa permite una propuesta nueva.

### OpenAI en local

`./scripts/verify` nunca llama a OpenAI. `./scripts/openai smoke <archivo-env>` hace una petición real de prueba, y
`./scripts/openai dev <archivo-env>` sirve `http://localhost:8787` con OpenAI. El script lee del archivo únicamente
`OPENAI_API_KEY`, `OPENAI_MODEL` y `LESSON_MAX_OUTPUT_TOKENS` (sin ejecutarlo ni mostrar valores) y los pasa al Worker
por un archivo temporal privado. `LESSON_MAX_OUTPUT_TOKENS` vale 16000 por defecto y `LESSON_REQUEST_TIMEOUT_MS`,
120000. En producción serían secretos del Worker (`OPENAI_API_KEY`) y variables (`OPENAI_MODEL`), configurados por
quien administra el despliegue. Opcionales: `OPENAI_MODEL_SHORT` (AIG-3), un modelo menor para redactar un campo y
sugerir campos de documentos (sin ella usan `OPENAI_MODEL`; registrar también su precio en «Inteligencia
artificial»), y `AI_BUDGET_PER_PERSON_USD` / `AI_BUDGET_MIN_USD` (AIG-6, por defecto 2 y 20).

### Paquetes curriculares (0051)

Los paquetes son referencias curriculares oficiales versionadas en el repositorio como datos estructurados
(`packages/domain/src/cnb/`), cada uno con su fuente (URL y fecha de consulta). El primero es la «Dosificación de los
aprendizajes · Matemáticas · Sexto Grado» de CNB Guatemala: 7 competencias, 26 indicadores de logro y sus 84
contenidos. Se transcribió con su redacción y numeración; el extracto no conserva en qué unidad (1–4) va cada contenido,
y eso no se transcribió. El nivel cognitivo de cada indicador es una clasificación de la plataforma, no de la fuente.
`GET /api/curriculum-packages` responde `{ packages }` con cada paquete y si la organización lo activó.
`POST /api/curriculum-packages/:id/activate` y `/deactivate` son de administración; desactivar no toca los planes.
`GET /api/courses/:id/curriculum-packages` responde los paquetes activos con lo que el curso ya tomó (`outcomeId`,
`competencyId`) y `canLink`. `POST /api/courses/:id/curriculum-packages/:pkg` recibe `{ codes, version }`: solo la
persona responsable del curso (403). Cada indicador elegido se agrega como resultado de aprendizaje dentro de su
competencia, creada una sola vez y con la fuente como evidencia. Lo ya tomado se omite (`skipped`); no hay duplicados.
Responde 201 con `{ added, skipped, version }`, 400 si un código no es del paquete o se superan los límites del plan,
404 si el paquete no está activo y 409 si el curso cambió de versión.

### Bibliografía del curso (0050)

`GET /api/courses/:id/bibliography` responde `{ references, canManage }`. Cada referencia `{ id, itemId, kind, title,
status, fileName?, mediaType?, role, primary, citation }` apunta a un recurso de la biblioteca del curso: un material
o un archivo de `COURSE_FILES` (R2). No hay copia ni segundo almacenamiento. `role` es `text`, `support` u `other`
(texto, apoyo u otro). La leen quienes llegan al curso. La gestionan administración y el equipo del curso (responsable y
colaboradores) mientras el curso está activo (403 en otro caso). `POST` recibe `{ itemId, role, citation?, primary? }`
(201; 400 si el recurso no es de la biblioteca de este curso; 409 si ya está o está archivado). `PUT
/api/courses/:id/bibliography/:refId` recibe `{ role, citation, primary }` y `DELETE` la quita sin tocar el recurso.
Solo hay un libro principal por curso: debe tener el rol `text` (400) y estar publicado (409). Marcar otro lo reemplaza
en la misma transacción. La actividad lo registra. `GET /api/courses/:id/bibliography?format=apa7` responde `{ text, html,
entries }`: la bibliografía en APA 7 agrupada por rol. Una cita escrita a mano se marca.

### Recursos didácticos (0068)

Un recurso es un elemento de la biblioteca con su ficha. `course_bibliography` deja de leerse; su rol vive en
`course_resources`. `GET` y `POST /api/courses/:id/resources`, `GET`, `PUT` y `DELETE /api/courses/:id/resources/:id`.
`POST /api/courses/:id/resources/lookup` recibe `{ isbn }` o `{ doi }` y consulta Open Library o Crossref con un límite
de 3 s, sin datos personales (504 si se agota el tiempo; la ficha queda para llenarla a mano). El índice es `GET`,
`PUT` y `POST /api/courses/:id/resources/:id/index` (`outline` desde el PDF en el navegador, `detected` desde el texto
por página, o capítulos escritos a mano). `PUT …/text` guarda el texto por página de cualquier PDF, no solo del libro
principal. `GET` y `POST /api/courses/:id/book-map?resourceId=` mapean ese recurso; sin `resourceId` sigue siendo el
libro principal. Las lecturas son `GET` y `POST /api/courses/:id/readings`. `GET /api/sections/:id/readings` incluye las
propias de la sección y el porcentaje de lecturas obligatorias. Un estudiante ve `GET /api/student/readings` (solo
recursos compartibles de sus lecturas) y marca la suya con `POST /api/student/readings/:id/mark`.

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

`PUT …/schedule` recibe `{ weekdays, startsAt, durationMinutes, from, until }` (la misma hora cada día) o, desde la
1.2.4, `{ meetings: [{ weekday, startsAt, durationMinutes }], from, until }` con una hora por día (una clase por día:
un periodo doble es una clase más larga). Si todas las reuniones coinciden se guarda la forma simple; si no, el horario
devuelve `meetings` y `startsAt`/`durationMinutes` repiten la primera reunión de la semana. Cada clase generada toma la
hora de su día.

**Jornadas (0057).** `GET /api/bell-schedules` lista las jornadas de la organización para todas las personas: `{ id,
name, weekdays, config: { startsAt, periodMinutes, passingMinutes, periods, breaks: [{ after, minutes, label }] },
blocks }`. Los `blocks` (periodos de clase y recesos con su hora) se generan en el servidor: tras cada periodo va el
receso que se haya puesto después de él o el tiempo entre periodos. Solo administración crea (`POST`), edita (`PUT
/api/bell-schedules/:id`) y quita (`DELETE`) jornadas: periodos de 20 a 180 minutos, de 0 a 30 entre periodos, hasta
14 periodos y recesos de 5 a 120 minutos antes del último periodo, terminando antes de la medianoche (400); un nombre
por organización (409). Quitar una jornada no cambia los horarios de las secciones.

`PUT …/educators` recibe `{ userIds, conflictReason? }`. Si una persona agregada imparte otra sección activa con
clases próximas a la misma hora, responde 409 con `conflicts` y no cambia nada; con `conflictReason` (3 a 300
caracteres) guarda la asignación y registra la confirmación, que ya no se vuelve a pedir para esa persona en ese par
de secciones.

### Notas de la sección (libreta, 0049)

`GET /api/sections/:id/grades[?year=]` responde `{ gradebook }`: la sección, el ciclo (el vigente o el cerrado que se
pida), sus periodos con `weight` y si sus notas están cerradas (`locked`, `lockedAt`, `lockedBy`), los estudiantes activos
del listado de la sección (por su id, nunca por el nombre), las notas `{ learnerId, periodId, score }`, el resultado de
cada estudiante `{ average, letter, passed, complete }` y la configuración que aplica (`policy`). La leen quienes ven la
sección. `PUT` recibe `{ grades: [{ learnerId, periodId, score }] }` (hasta 500): `score` de 0 a 100 con un decimal
como máximo, o `null` para quitarla. Solo administración y quienes imparten la sección escriben (403), solo en el ciclo
vigente (409 sin ciclo vigente) y en periodos sin cerrar (409). `POST /api/sections/:id/grades/periods/:periodId/lock`
aprueba y cierra las notas de un periodo en la sección (desde 1.2.3, coordinación o administración; quien imparte lo
entrega para revisión); `DELETE` las reabre (solo administración). Una nota vacía nunca cuenta como cero: el promedio usa solo los periodos con nota y, si es ponderado,
divide entre la suma de los pesos de esos periodos; `complete` dice si todos tienen nota. La escala (`gradeScale`), la
nota mínima (`passingGrade`), los umbrales de las letras (`letterThresholds`, mínimos de A, B, C y D) y el promedio
(`gradeAverage`) son ajustes del curso que el programa puede fijar. Un periodo con notas no se quita del ciclo (409) y
cerrar el ciclo congela sus notas sin promover a nadie. La actividad registra que hubo cambios, nunca las notas.

### Plan de evaluación, revisión de cierre y boletas (0055, 1.2.3)

El `gradebook` incluye además el plan de evaluación del curso para los periodos del ciclo (`activities`: `{ id, periodId,
position, title, kind, points, dueOn }`, con `kind` entre `task`, `project`, `quiz`, `exam`, `participation` y `other`),
los punteos de la sección (`scores`: `{ activityId, learnerId, points }`), los comentarios (`comments`), la revisión de
cada periodo (`reviews`: `submitted`, `returned` con su `note` o `approved`) y `canSubmit`.

- `PUT /api/sections/:id/grades/periods/:periodId/plan` recibe `{ activities: [{ id?, title, kind, points, dueOn? }] }`
  (hasta 20, en orden) y reemplaza el plan del curso para ese periodo: lo comparten todas sus secciones. Los puntos van
  de 0,1 a 100 con un decimal y suman como máximo 100 (400). No cambia si alguna sección del curso tiene el periodo
  cerrado o entregado (409), una actividad con punteos no se quita ni baja de su punteo más alto (409), y no se crea si
  el periodo ya tiene notas escritas sin plan (409).
- `PUT /api/sections/:id/grades` acepta, además de `grades`, `scores: [{ activityId, learnerId, points }]` (de 0 a los
  puntos de la actividad, o `null`) y `comments: [{ learnerId, periodId, body }]` (hasta 600 caracteres; vacío lo quita),
  hasta 500 cambios entre todos. En un periodo con plan, la nota es la suma de los puntos ganados hasta ahora y no se
  escribe a mano (400). Ningún cambio entra en un periodo entregado (409) o cerrado (409). Cada cambio de una nota o de un
  punteo queda en el historial.
- `GET /api/sections/:id/grades/history?learner=` responde `{ changes }` del estudiante: periodo, actividad, antes,
  después, quién y cuándo (los 200 más recientes).
- `POST …/periods/:periodId/submit` entrega el periodo para revisión (quien imparte o administración; el plan, si lo
  hay, debe sumar 100). `POST …/periods/:periodId/return` con `{ note }` lo devuelve, y `POST …/periods/:periodId/lock`
  lo aprueba y lo cierra: ambos son de coordinación (con `sections.assign` en el curso) o administración. `DELETE
  …/lock` lo reabre (solo administración).
- `GET /api/sections/:id/grades/report.pdf[?year=&learner=]` es la boleta en PDF: una página por estudiante con cada
  periodo, sus actividades, el comentario, el promedio, el resultado y los espacios para firmas. Dice que es informativa
  y no sustituye el certificado oficial del Ministerio de Educación.

### Evaluación agnóstica: esquemas, marcas y tribunal (0060, 1.3.1)

`GET /api/grading-schemes` responde `{ schemes }` de la organización. Administración crea uno con `POST`, lo actualiza
con `PUT /api/grading-schemes/:id` y lo elimina con `DELETE`: si está elegido por un curso o programa, queda archivado.
`POST /api/grading-schemes/templates/:templateId` copia una plantilla (`colegio`, `universidad`, `idiomas`, `tecnica`,
`artes`, `seminario` o `doctorado`). Los cuerpos siguen `GradingScheme`; pesos, niveles y umbrales se validan antes de
guardar. Las demás personas pueden consultar los esquemas, pero no cambiarlos.

`gradingSchemeId` es un ajuste heredable del curso y del programa. Al guardarlo debe ser un esquema activo de la misma
organización: uno inexistente o de otra organización responde 400, y uno archivado responde 409. Sin elegirlo, la libreta
conserva exactamente su cálculo anterior de puntos, escala, mínimo, letras y promedio. Con un esquema elegido, el
`gradebook` agrega `scheme`, `marks`, `evaluators` y los campos `display`, `level`, `reasons` y `final` de cada estudiante.

- El plan acepta además `categoryId`, `grading` (`points`, `rubric`, `pass-fail`, `level` o `panel`), `extra`,
  `retakeOf`, `rubric` y `panel`. Las actividades anteriores siguen siendo `points` en `general`.
- `PUT /api/sections/:id/grades` acepta `marks: [{ activityId, learnerId, mark }]` para rúbrica, nivel,
  aprobado/no aprobado y exoneración. Los punteos continúan en `scores`.
- `PUT …/grades/activities/:activityId/evaluators` recibe
  `{ evaluators: [{ userId, chair }] }`; exige integrantes distintos, una presidencia y que aún no existan marcas.
- `PUT …/grades/activities/:activityId/panel` recibe `{ learnerId, mark }`. Cada integrante escribe solo su marca.
  Antes de completar el tribunal ve únicamente la propia; administración y quienes imparten ven todas.
- Una exoneración (`{ kind: "exempt" }`) también vale en una actividad de puntos. `mark: null` la quita.
- `GET /api/me/panels` responde `{ panels }` con las actividades de tribunal asignadas a quien consulta, una por
  sección activa del ciclo vigente. Cada estudiante trae solo la marca propia (`marked`, `mark`) y `combined` (el
  punteo ya combinado) cuando todas las personas del tribunal marcaron. Otra persona recibe una lista vacía.
- `GET …/grades/report.csv[?year=]` exporta los mismos resultados mostrados por la boleta PDF. Ambos usan el texto del
  esquema (letra, GPA, nivel o aprobado/no aprobado) e incluyen las razones que impiden aprobar.

### Evaluación del curso (0062)

La evaluación se diseña en el curso y la califica cada sección. Quien puede ver el curso la consulta. Administración y el equipo docente con permiso de edición (`edit`) la cambian. Un colaborador que ve el curso y no lo edita recibe 403. Un curso de otra organización recibe 404.

`GET /api/courses/:id/assessment?year=` responde el esquema efectivo, `explanation` (las mismas tres líneas en todas partes), `canEdit`, el ciclo, los periodos con `status` (`complete`, `missing` con `faltan N pts` o `faltan actividades`, `weights` con `pesos que no suman`) y las actividades. Cada actividad dice si `graded` y qué nota máxima ya tiene.

`PUT …/assessment/scheme` recibe `{ gradingSchemeId }` (o `null` para volver a puntos acumulados). El esquema tiene que estar activo en la organización. Si el programa lo fija, responde 409.

`POST …/assessment/activities` crea una actividad. `PUT …/assessment/activities/:activityId` la edita. `DELETE` la quita. El cuerpo lleva `periodId`, `title`, `kind`, `categoryId`, `points`, `dueOn`, `grading`, y según el caso `rubric` (cada nivel puede traer `description`), `panel`, `evaluators`, `groupMode` (`individual` o `group`), `peerMin`, `peerMax`, `extra` y `retakeOf`. No elige conjunto: cada sección lo hace en Grupos.

Si la actividad ya tiene notas, se puede cambiar el nombre y la fecha. Cambiar la forma de calificar responde 409: `«título» ya tiene notas: puedes cambiar su nombre y su fecha, no su forma de calificar ni sus puntos por debajo de una nota dada.` Bajar los puntos bajo una nota dada, o quitar la actividad, conserva los mensajes anteriores.

`POST …/assessment/periods/:periodId/template` recibe `{ templateId? }`. Con puntos usa una plantilla (`zona-60` si no se indica); con categorías, niveles o aprobado/no aprobado agrega una actividad por categoría. `POST …/periods/:periodId/copy-from/:sourceId` copia las actividades de otro periodo, sin notas. Si el periodo de destino ya tiene actividades, responde 409.

`PUT /api/sections/:id/grades/periods/:periodId/plan` sigue aceptando el plan completo, incluido `workGroupSetId`. Además de la columna anterior, guarda el conjunto en `section_activity_sets` de esa sección. La libreta y la calificación grupal leen esa tabla, no la columna.

### Libertad de cátedra por sección (0065)

El ajuste `sectionFreedom` del curso (o del programa, si lo fija) vale `shared`, `flexible` o `free`. Con `shared` las respuestas de contenido, cronograma, notas, PDF de entrega y espacio del estudiante no cambian. Con otra política devuelven el plan efectivo de la sección.

- `GET /api/sections/:id/plan` responde el contenido y la evaluación efectivos, su origen, la cobertura del núcleo y `canEdit`. Con `shared` responde 404: «Esta sección sigue el contenido del curso.»
- `POST /api/sections/:id/lessons` crea una lección propia (el mismo cuerpo que una lección del curso, con `courseUnitId`). La publica quien imparte la sección.
- `POST /api/sections/:id/activities` crea una actividad propia. Con `free`, `replaces` señala la actividad del núcleo que sustituye, de la misma categoría y los mismos puntos.
- `PUT /api/sections/:id/content-overrides` guarda un ajuste `{ itemType, itemId, position, hidden, replaces }`. `DELETE` lo quita. No se oculta una lección del núcleo, una lección ya impartida en la sección ni una actividad con notas.
- `PUT /api/courses/:id/core` marca o quita del núcleo lecciones, unidades y actividades. Solo el responsable, y solo si la política no es `shared`. Responde cuántas secciones vuelven a mostrar lo marcado.
- `GET /api/courses/:id/sections/differences` lo consultan el responsable, coordinación y administración. Con `shared` responde 404. El detalle incluye propuestas al curso y lo propio que está en revisión.

Cambiar `sectionFreedom` en el curso o en el programa se rechaza con 409 y `affected` (sección y actividad) cuando hay notas en lo que dejaría de contar.

### Unidades propias, revisión y propuestas (0066)

`sectionFreedomReview` (heredable y fijable) hace que lo propio quede en revisión hasta que el responsable lo apruebe. Sin ese ajuste, quien imparte la sección lo publica.

- `POST /api/sections/:id/units` crea una unidad propia `{ name, objective }`.
- `PUT /api/sections/:id/content-overrides` con `itemType: "unit"` oculta o reordena una unidad. No se oculta una unidad del núcleo ni una que contenga lecciones del núcleo.
- `POST /api/sections/:id/copies` copia una lección, unidad o actividad propia a otras secciones del curso (`{ itemType, itemId, sectionIds }`). Cada copia es independiente. Si el destino pide revisión, la copia queda en revisión.
- `POST /api/sections/:id/proposals` propone lo propio al curso. `GET /api/courses/:id/section-proposals` lo lista. `POST /api/courses/:id/section-proposals/:id` decide `{ decision: "accept"|"reject", comment?, core?, keepOwn? }`. Aceptar copia al curso (no es núcleo salvo `core`). Si lo propio ya tiene notas, la sección lo conserva.
- `POST /api/sections/:id/reviews` aprueba o devuelve lo propio (`{ itemType, itemId, decision: "approve"|"return", comment? }`). Una actividad en revisión no entra en la nota y un reemplazo en revisión no aplica.

### Conjuntos de grupos y calificación grupal (0061, 0062)

Los grupos que no pertenecían a un conjunto pasan al conjunto **Grupos de la sección**. Un conjunto nuevo es otro reparto, reutilizable, de esa misma sección. `set_id` sigue pudiendo quedar vacío: un grupo insertado sin conjunto conserva el nombre único de ese cubo.

`GET /api/sections/:id/group-sets` lista los conjuntos activos (primero «Grupos de la sección»), cada uno con sus grupos, sus reglas, `graded`, `usedIn` («Se usa en») y `activities`: la lista única de actividades en grupos, de lección y de evaluación, con el `setId` que eligió esta sección.

`PUT …/group-sets/assignments` recibe `{ kind: "lesson"|"assessment", activityId, setId, lessonId?, workGroupIds? }`. En una evaluación guarda el conjunto de esta sección. En una lección guarda el conjunto y qué grupos de ese conjunto la trabajan (`activity_work_groups` no cambia de forma).

`GET /api/sections/:id/group-sets` lista los conjuntos activos de la sección: cada uno con sus grupos, sus reglas y `graded` (si alguna actividad que lo usa ya tiene nota de grupo, ajuste o coevaluación). `graded` mira `section_activity_sets`, no la columna anterior.

`POST /api/sections/:id/group-sets` recibe `{ name, rules, sessionId? }`. `rules` indica si se forma por `size` (2 a 30)
o por `count` (1 a 30), `how` (`random`, `balanced` o `mixed`), la `seed`, y de forma opcional mínimo, máximo, parejas
`together` y `apart`, un `prefix`, `scores` y `attributes`. Con `?preview=1` no guarda nada y responde
`{ preview, groups, unmet }`. Sin eso responde 201 `{ set }` con los grupos, sus estudiantes y las restricciones que no
pudo cumplir. Si envías `sessionId`, el reparto usa solo quienes están presentes o llegaron tarde en esa clase; sin
clase, usa la lista activa. La misma semilla y la misma lista producen el mismo reparto.

`PUT …/group-sets/:setId` cambia el nombre, archiva (`archived: true`) o reemplaza los miembros (`groups`). `DELETE` en
la misma ruta archiva. `POST …/group-sets/:setId/regenerate` recibe `{ seed }` y vuelve a formar el conjunto. Si una
actividad que lo usa ya tiene nota de grupo, ajuste o coevaluación, responde 409 y el reparto no cambia.

El plan de evaluación puede marcar una actividad con `groupMode: "group"`, `workGroupSetId` y el rango `peerMin` y
`peerMax` (de 0 a 2, un decimal; si no se envían, 0,5 y 1,5). Las anteriores siguen siendo individuales. Quien imparte
la sección, o administración, califica así:

- `PUT …/grades/activities/:activityId/groups` con `{ workGroupId, mark }` guarda una marca para el grupo (puntos,
  rúbrica, nivel o aprobado/no aprobado) y la copia a cada integrante.
- `PUT …/adjustments` con `{ learnerId, kind, value, note? }` aplica un `factor` de 0 a 2, un `override` (nota propia)
  o un `peer`. El factor explícito gana sobre la coevaluación. `{ learnerId, clear: true }` quita el ajuste.
- `PUT …/peer-ratings` con `{ ratings: [{ raterId, rateeId, score }] }` reemplaza la coevaluación. El factor de cada
  estudiante es su promedio recibido dividido por el promedio del grupo, limitado al rango de la actividad (0,5 a 1,5
  si no se cambió).

La copia queda en `scores` o `marks` con `source: "group"`. Una marca escrita a mano (`source: "individual"`) no se
pisa. Una exoneración se queda. Quien no está en ningún grupo del conjunto no recibe nota, ni siquiera un cero. La
libreta, en una actividad grupal, agrega `workGroups`, `groupMarks`, `groupAdjustments`, `peerRatings` y el `source` de cada nota. Un
periodo cerrado o entregado a revisión responde 409. La actividad registrada no incluye el valor de la nota.

Otra persona que no imparte la sección recibe 403. Una sección de otra organización recibe 404.

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

## Notificaciones por correo (ST-124, DEC-042)

Tipos: `course_assignment` (al llegar al equipo de un curso o cambiar de papel en él), `section_assignment` (al empezar
a impartir una sección), `review_submitted` (a la persona responsable del curso y a quien tiene `lessons.review` por
coordinación o grupo en su programa), `review_returned` y `review_approved` (a quien envió la lección; aprobar es
publicar una lección con revisión pendiente), `class_changed` (cambio de fecha, hora o duración de una clase pendiente
con `PUT /api/courses/:id/sessions/:sid`, o `restore`) y `class_cancelled` (`cancel`), ambos a quienes imparten la
sección. Un cambio solo de lecciones o comentarios de la clase no avisa. Nunca se avisa a quien actúa ni a cuentas sin
acceso. Los avisos se escriben después de la escritura que los causa y nunca la hacen fallar.

`GET /api/notifications/preferences` responde `{ settings: [{ type, label, description, audience, mandatory, enabled }],
history, hasAddress }`: `history` son los 20 avisos más recientes de la persona. `PUT` con `{ preferences: { <tipo>:
boolean } }` guarda uno o varios tipos (400 si un tipo es desconocido; 409 si intenta desactivar uno obligatorio) y
responde igual. Todo tipo está activo hasta que la persona lo desactiva; desactivado, no se escribe registro.

`GET /api/notifications/policy` (administración) responde `{ settings }` sin `enabled`; `PUT` con `{ mandatory: [tipos] }`
fija la lista completa de obligatorios (400 si hay tipos desconocidos o repetidos) y queda en la actividad. Un tipo
obligatorio llega aunque la persona lo haya desactivado.

`GET /api/notifications/log?person=&type=&status=&limit=` (administración, hasta 200, por defecto 100) responde
`{ notifications: [{ id, type, userId, personName, recipient, reason, targetId, status, mandatory, attempts, error,
createdAt, sentAt }], people, mailConfigured }`. `status` es `queued`, `sent`, `failed`, `not_configured` (sin
`BREVO_API_KEY`/`MAIL_FROM`), `deferred` o `no_address` (sin `users.email` ni `staff_profiles.contact_email`;
`recipient` es `null`). `reason` es el motivo en español, de hasta 240 caracteres.

Cada aviso es una fila de `mail_outbox` con `kind = 'notification'`, `reference_id = '<tipo>:<id>'`, `user_id`,
`notification_type`, `reason` y `mandatory`; el cuerpo no se guarda. Se envía mientras la solicitud espera, con un
reintento, como las invitaciones; como máximo 20 por solicitud y el resto queda `deferred`. Tope diario (DEC-042,
250 por organización): los avisos opcionales quedan `deferred` desde 200 correos enviados ese día, para reservar los
últimos 50 a invitaciones y avisos obligatorios; los obligatorios quedan `deferred` (con `mandatory: true`) desde 250.
No hay reenvío automático de los diferidos. El correo lleva un enlace a la página del curso, la sección, la lección o la
clase (origen de la solicitud) y a **Mi perfil**. El respaldo incluye `notification_preferences` y
`notification_policies` y omite `mail_outbox`, como en ST-121.

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

## Incorporación guiada (ST-122)

| Método | Ruta | Quién |
| --- | --- | --- |
| GET | `/api/onboarding` | La persona con sesión: su estado (`pending`, `in_progress`, `complete`), los pasos con `done` y `optional`, el siguiente (`next`), lo que falta del perfil (`profileGaps`), el acuerdo por firmar y sus cursos y secciones |
| POST | `/api/onboarding/steps/:step` | La persona: marca `welcome`, `tour` o deja para después un `agreement` opcional; sin cuerpo |
| GET | `/api/onboarding/people` | Administración: cada persona con su estado, fechas (`startedAt`, `completedAt`), pasos y los que faltan (`missing`) |

Orden de los pasos: `password` → `legal` → `welcome` → `profile` → `agreement` (solo educadores con un acuerdo de
voluntariado publicado) → `tour`. `password`, `legal`, `profile` y el acuerdo firmado se derivan de los datos (contraseña
temporal, aceptaciones vigentes, `staff_profiles`, firmas) y declararlos responde 409 `ONBOARDING_DERIVED`. Un paso
desconocido o que no aplica responde 404; uno cuyos pasos anteriores faltan, 409 `ONBOARDING_ORDER`; dejar para después
el acuerdo cuando la persona ya imparte una sección activa, 409 `ONBOARDING_REQUIRED`. Marcar `tour` completa la
incorporación (`completed_at`, evento `updated`/`account` «Completó su incorporación»); una incorporación completa no se
reabre y otro POST responde 409. Con contraseña temporal o documentos pendientes, estas rutas responden 403 como las demás.

«Perfil completo»: un teléfono o un correo de contacto y, para educadores, al menos una especialidad; foto, formación y
disponibilidad son opcionales. Mientras falta, `GET /api/session` incluye `onboarding: true`. Las cuentas que existían
antes de la migración 0041 cuentan como incorporadas; las nuevas (`POST /api/members`, invitación aceptada) empiezan
pendientes. La tabla `onboarding` entra en el respaldo.

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

## Uso de IA y revisión de lecciones (1.4.0)

Migración `0070_ai_runs.sql`. Toda llamada a un modelo (o al generador local) pasa por el harness (`apps/api/src/ai-runs.ts`)
y deja una fila en `ai_runs`: persona, curso, tarea (`lesson-proposal`, `book-map`, …), versión del prompt, generador,
modelo, caracteres de entrada, tokens de entrada y salida (de `usage` de la Responses API), duración y estado (`ok`,
`error`, `transient`, `refused`, `incomplete`). **Nunca** el texto de la entrada ni de la respuesta.

`GET /api/organization/ai-usage?mes=YYYY-MM` (solo administración; 403 al resto) devuelve `summary` del mes (total y por
tarea, curso y persona: ejecuciones, errores, tokens, costo estimado y duración media), `previous` (total del mes anterior),
`prices`, `unpriced` (modelos usados sin precio) y `recent` (las 50 últimas ejecuciones con su costo). El costo usa el
precio vigente en la fecha de cada ejecución; `null` si el modelo no tiene precio o faltan los tokens; 0 con el generador
local.

`POST /api/organization/ai-prices` `{ model, effectiveFrom: "YYYY-MM-DD", inputPerMillion, outputPerMillion }` (USD por
millón de tokens, de 0 a 1000; acepta coma decimal) registra o reemplaza el precio de ese modelo en esa fecha y devuelve
`prices`. 400 con el mensaje de validación.

La revisión de una lección no tiene ruta: el puntaje se calcula en el navegador con `lessonReview` del dominio, a partir
de la lección, la secuencia, la cantidad de resultados del plan, si el curso tiene recursos indexados y la duración de
sus clases (`classMinutesOf` sobre los horarios de sus secciones). No se guarda.

`npm run ai:eval` corre `tests/ai-evals.test.ts` contra el modelo configurado (`OPENAI_API_KEY`, `OPENAI_MODEL` en el
entorno) y deja el informe en `.release-evidence/ai-evals/`; sin `AI_EVAL_LIVE` usa el generador local y forma parte de
`./scripts/verify`.

### Mejora asistida y redacción (1.4.1)

`POST /api/lessons/:id/improve` con el borrador del editor `{ objective, activities, sequence, outcomeIds, materials }`
(equipo del curso con edición; 403 al resto; 404 si la lección no existe; 400 si el borrador no tiene la forma de una
lección, aunque una actividad puede estar vacía). Revisa el borrador con las mismas reglas que el navegador y devuelve
`{ review, changes }`: cambios revisados (`objective`, un campo de una actividad o `new-activity`), cada uno con `before`,
`after` y `reason`; los que nombran una actividad inexistente o un valor imposible se descartan. **No guarda nada**: el
editor aplica al borrador lo que la persona acepta (los textos de los bloques, a través de la sala de colaboración).
503 si la IA no está configurada; 502 si no respondió.

`POST /api/ai/write` `{ field, action, text, context, courseId? }` con `field` en `lesson-objective`, `course-objective`,
`unit-objective`, `report-comment`, `resource-description` o `notice` y `action` en `draft`, `improve` o `shorten`.
Devuelve `{ text }`; 400 con un campo o una acción desconocidos; 422 si la propuesta no cabe en el campo; 403 si
`courseId` es de un curso ajeno. Del contexto, de un estudiante solo pasa el nombre de pila y solo en `report-comment`.
Ambas rutas dejan su ejecución en `ai_runs` (`lesson-improve`, `write`).

### Cronograma propuesto (1.4.2)

`POST /api/courses/:id/groups/:gid/lessons` `{ mode: "fit" }` (quien imparte la sección) devuelve `{ proposal }` sin cambiar
nada: las lecciones pendientes del contenido efectivo de la sección, en orden, repartidas en sus clases futuras
planificadas y sin lecciones, tantas como quepan en los minutos de cada clase (`proposeTimetable` del dominio; una
lección más larga que su clase va sola con `overflow`; sin duración, 45 min). `{ mode: "fit", expected: [{ sessionId,
lessonIds }] }` la aplica solo si sigue siendo la misma; si algo cambió, 409. El modo anterior `{ perClass }` sigue igual.

### Horarios con reglas (1.4.3)

Solo administración (403 al resto). `GET /api/timetables` devuelve las jornadas (`bellSchedules`, con sus periodos y
recreos), las secciones activas con sus docentes y clases por semana actuales, los docentes y las fechas del ciclo
vigente. `POST /api/timetables/solve` `{ bellScheduleId, sections: [{ id, meetingsPerWeek 1–7, blocksPerMeeting 1–4 }],
rules }` resuelve con `solveTimetable` del dominio (los horarios de las demás secciones quedan fijos) y devuelve `{ result,
names }`: `solved` con las clases, o `impossible` con lo que sí se ubicó y, por sección, las razones que bloquean cada
espacio. Reglas: `unavailable`, `max-daily`, `shared-students`, `not-on`, `preferred-days` (400 si nombran algo que no
existe). `POST /api/timetables/apply` `{ from, until, meetings }` guarda el horario de cada sección como `PUT …/schedule`
y devuelve el resultado por sección (207 si alguna falló). `POST /api/timetables/rules` `{ text }` interpreta una regla
escrita con la IA (tarea `rules-to-constraints`, en el harness) y devuelve las reglas válidas con su texto para
confirmarlas, y cuántas partes se omitieron.

**Aulas (1.5.3).** Migración `0074_classrooms.sql` (`classrooms`, `course_groups.classroom_id`). `GET /api/timetables`
agrega `classrooms` (activas: `id`, `name`, `capacity`) y, por sección, `learners` (estudiantes activos) y `classroomId`
(aula habitual). `POST /api/timetables/classrooms` `{ name, capacity 1–500 }` crea un aula (409 si el nombre ya existe
entre las activas); `PUT /api/timetables/classrooms/:id` la edita; `DELETE` la archiva y deja sin aula habitual a las
secciones que la usaban. `PUT /api/timetables/sections/:id/classroom` `{ classroomId | null }` fija el aula habitual.
Con aulas, `solve` da a cada sección una sola aula para la semana (la habitual, o la más pequeña con capacidad para sus
estudiantes), nunca dos clases en la misma aula a la vez (las secciones no incluidas ocupan su aula habitual), y cada
reunión trae `classroomId`; la respuesta agrega `classrooms` (id → nombre). `apply` asigna a la sección sin aula
habitual la que recibió. Sin aulas, nada cambia.

## Constructor de documentos (1.5.0)

Migración `0071_report_templates.sql`. Solo administración (403 al resto). `GET /api/report-templates` lista las plantillas
activas y el catálogo de tipos (`kinds`: campos y conjuntos de datos de la boleta y la constancia). `POST` `{ kind,
programId?, name? }` crea una plantilla con el diseño por omisión (409 si ya hay una de ese tipo y alcance). `GET|PUT|DELETE
/api/report-templates/:id` lee, guarda el borrador `{ draft, name }` (validado contra los campos, conjuntos y columnas del
tipo, y las imágenes de la organización) o la archiva. `POST …/publish` crea la versión siguiente (inmutable); `POST
…/restore?version=n` devuelve el borrador a esa versión; `POST …/preview` `{ draft?, sectionId, learnerId? }` devuelve el
PDF con los datos reales de la sección sin registrar el documento. `GET|POST /api/report-images`: imágenes JPEG de hasta 1 MB
(el diseñador convierte PNG a JPEG en el navegador), cuerpo binario con `X-File-Name`.

La boleta (`GET /api/sections/:id/grades/report.pdf`) usa la versión publicada de la plantilla del programa del curso o,
si no hay, la de la organización; sin ninguna, conserva su formato anterior. `GET /api/sections/:id/grades/certificate.pdf
?learner=&tipo=inscripcion|finalizacion` genera la constancia (plantilla publicada o la de por omisión). Cada documento
generado desde una plantilla queda en `generated_documents` con su versión y su huella SHA-256.

### Actas de tribunal (1.5.1)

Migración `0072_panel_minutes.sql` (además reconstruye las tablas de plantillas para el tipo `panel-minutes`).
`POST /api/panel-minutes/sign` `{ activityId, sectionId, learnerId, signature: { fullName, password } }` firma el acta del
estudiante cuando todo el tribunal ya lo calificó: la primera firma crea el acta con su contenido congelado (marca de
cada integrante y resultado) y su huella SHA-256; la contraseña se verifica como en ST-153 (cinco intentos cada 15
minutos). Quien preside firma al final (409 mientras falten integrantes); 403 a quien no integra el tribunal. Firmada por
todos, queda `signed`. Desde la primera firma, `…/panel` responde 409 para ese estudiante y `…/evaluators` 409 para la
actividad. `GET /api/panel-minutes/:id.pdf` (tribunal, docentes de la sección y administración) dibuja el acta con la
plantilla publicada «Acta de tribunal» o la de por omisión. `GET /api/me/panels` agrega `chair` y, por estudiante,
`minute: { id, status, signed, mine }`. `POST /api/ai/write` admite `document-text` (conserva los campos `{{…}}`).

### Reporte de avance y «Sugerir campos» (1.5.2)

Migración `0073_progress_report.sql`: reconstruye las tablas de plantillas para el tipo `progress-report` y `ai_runs`
para la tarea `suggest-fields`, conservando sus filas. `GET /api/sections/:id/grades/progress.pdf` (quien ve la sección)
es el reporte de avance: clases dadas de las programadas, cobertura del plan por unidad (lecciones dadas en clases
completadas sobre las del plan de la sección), asistencia (presentes y tardanzas sobre las marcas no justificadas) y
lecturas obligatorias leídas, por estudiante. Usa la plantilla publicada «Reporte de avance» del programa o de la
organización, o la de por omisión; queda registrado en `generated_documents` y en la actividad.
`POST /api/report-templates/:id/suggest-fields` `{ text, sectionId? }` (administración) propone campos para el texto de
un bloque: `{ suggestions: [{ original, field, label }], ai }`. Las partes iguales a un dato real de la sección (curso,
sección, docentes, ciclo, fecha y, si el documento lo tiene, el nombre de un estudiante) se encuentran sin IA; con la IA
configurada, el modelo agrega las demás (si no responde, `notice` lo dice y quedan las encontradas). Cada propuesta se comprueba (la parte está en el texto, el campo existe para el
documento, sin solaparse) y se acepta una por una en el diseñador. Los nombres de estudiantes no se envían al modelo
como ejemplos.

