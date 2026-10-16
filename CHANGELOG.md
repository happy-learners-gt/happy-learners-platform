# Changelog

## Sin publicar

- ST-125: **Agenda → Sincronizar con mi calendario** crea un enlace de suscripción privado con las clases de las secciones que impartes, compatible con Google Calendar (Desde URL), Outlook (Suscribirse desde la web) y Apple Calendar (Nueva suscripción a calendario). Las cancelaciones, reprogramaciones y cambios aparecen en la siguiente actualización del calendario. **Regenerar enlace** pide confirmación y el anterior deja de funcionar. `GET, POST /api/feeds/calendar` y `GET /api/feeds/calendar/:token.ics`; `0033_calendar_feeds.sql` guarda solo el SHA-256 del token y el respaldo no lo copia.
- ST-121: **Educadores → Invitar por correo** invita con correo, nombre y rol. El resultado dice si el correo salió y muestra el enlace con **Copiar enlace**; la lista **Invitaciones** muestra estado, caducidad y envío, con **Reenviar** (o **Reintentar envío**) y **Revocar** con confirmación. La persona abre `/invitacion/<token>`, elige usuario y contraseña y entra con sesión; el enlace caduca a los 7 días, sirve una vez y reenviar lo reemplaza. Crear, reenviar, revocar y aceptar quedan en la actividad sin enlaces. Correo transaccional según DEC-042: puerto `MailSender` con Brevo por HTTP (secreto `BREVO_API_KEY` y variable `MAIL_FROM`, opcionales; sin ellos el mensaje queda `not_configured`), bandeja de salida por organización con un reintento y tope de 250 correos diarios (`deferred`). `GET, POST /api/invitations`, `POST /api/invitations/:id/resend|revoke` y `GET, POST /api/invitations/accept/:token`. `0034_invitations.sql` agrega `users.email` (solo visible para administración), `invitations` (solo el SHA-256 del token), `mail_outbox` y reconstruye `activity_events` para eventos de invitación. El respaldo copia `users.email` y omite invitaciones y bandeja de salida.
- ST-123: **Educadores → Registrar salida** registra la fecha en que una persona deja el equipo y un motivo opcional que solo ve administración. Antes de confirmar exige elegir una nueva persona responsable para cada curso que dirige y quien imparta cada sección que solo ella imparte; lo demás (colaboraciones y secciones compartidas) se retira sin reasignar. Al confirmar, la persona pierde el acceso, su historial se conserva, la lista muestra **Salió el …** y la salida y cada reasignación quedan en la actividad. `GET, POST /api/members/:id/departure`; `0035_departures.sql` crea la tabla `departures`, que entra en el respaldo.
- ST-153, ST-151: los términos y condiciones se aceptan con una **firma electrónica simple** (DEC-043): nombre completo escrito y contraseña de la cuenta, con la versión, la huella SHA-256 del documento, la fecha y la cuenta; cada firma tiene una constancia descargable y **Organización → Términos y privacidad → Firmas** lista quién firmó qué versión y cuándo (también personas que ya no tienen acceso) y verifica una constancia, detectando si fue modificada o si el documento no coincide. Administración publica y versiona el **Acuerdo de voluntariado ad honorem**: cada educador lo firma antes de iniciar, pasar lista o completar una clase, desde el aviso de la aplicación o desde Ayuda. Las contraseñas incorrectas al firmar se limitan a cinco cada 15 minutos. Migración 0038; no es una firma electrónica avanzada con certificado de un prestador acreditado.
- ST-149: **Mi perfil** (en el menú de tu nombre) edita el nombre, la foto (JPG, PNG o WebP de hasta 2 MB, en almacenamiento privado), el teléfono, el correo de contacto, la formación, las especialidades y la disponibilidad por día y horario. Teléfono y correo de contacto solo los ven administración y la persona; el equipo de sus cursos ve el resto y los estudiantes nada. Cada cambio queda en la actividad sin sus valores. `0037_profile_and_staff_file.sql` agrega `staff_profiles`.
- ST-150: **Educadores → Perfil y expediente** muestra el perfil y el **Expediente** de cada persona: administración agrega documentos (Identificación, Hoja de vida, Antecedentes penales y policíacos, Constancia de estudios, Certificado u Otro) con su emisión y vencimiento, los descarga y los retira; la persona los ve y descarga en **Mi expediente** y puede agregar los suyos. Los archivos son privados (PDF, JPG o PNG de hasta 10 MB en R2) y cada carga, consulta y retiro queda en la actividad. **Documentos vencidos o por vencer** reúne lo que vence en 30 días o ya venció. Retirar conserva el registro y el expediente se mantiene tras la salida. Tabla `staff_documents` en `0037`.
- ST-128, ST-135: **Roles y accesos** (administración) muestra la matriz de permisos por área para Administración, Educador, Coordinación académica y cada grupo de seguridad, crea grupos, les otorga permisos del catálogo con alcance de programas y agrega educadores; el **Historial de cambios** registra cada cambio, que se aplica en la siguiente solicitud. En **Educadores**, **Asignar coordinación académica** da a un educador el perfil de DEC-041 con alcance de todos o de algunos programas: consulta los cursos, secciones, cronogramas, asistencia y avance del alcance, revisa, devuelve y publica lecciones y asigna equipo y educadores de sección, sin configurar ni administrar cuentas, respaldo, términos o accesos. Asignarlo, cambiarlo o retirarlo cierra sus sesiones y queda en la actividad. `PUT /api/members/:id/coordination`, `GET /api/access/matrix` y `/api/access/groups[/:id[/permissions|/members]]`; `GET /api/session` incluye los permisos efectivos. `0036_access_matrix.sql` crea `coordination_scopes`, `security_groups`, `security_group_grants`, `security_group_members` y `access_events`, que entran en el respaldo.
- ST-124: **Avisos por correo** de los cambios que afectan a cada persona: asignación a un curso (al equipo o cambio de papel) o a una sección, lección enviada a revisión (a la persona responsable y a quien revisa por coordinación o grupo en su alcance), revisión devuelta y aprobada (a quien la envió), y cambio de fecha, hora o duración, reprogramación o cancelación de una clase (a quienes imparten la sección). Nunca se avisa a quien hizo el cambio y un problema de correo nunca hace fallar la acción. **Mi perfil → Notificaciones por correo** activa o desactiva cada tipo (todos activos por defecto) y muestra los avisos recientes; **Notificaciones** (administración) marca los obligatorios, que no se pueden desactivar, y lista cada envío con destinatario, motivo y estado, con filtros por persona, aviso y estado. Se usa el correo de acceso o, si no hay, el de contacto del perfil; sin correo queda registrado `no_address`. Tope de DEC-042: los avisos opcionales se difieren desde 200 correos del día y los obligatorios desde 250, y como máximo 20 salen por solicitud; los diferidos quedan registrados y no se reenvían. `GET, PUT /api/notifications/preferences`, `GET, PUT /api/notifications/policy` y `GET /api/notifications/log`. `0039_notifications.sql` crea `notification_policies` y `notification_preferences` (entran en el respaldo) y reconstruye `mail_outbox` (copia cada fila sin cambios) con `kind = 'notification'`, `no_address`, persona, tipo, motivo y si era obligatorio; el respaldo sigue omitiendo la bandeja de salida.
- ST-152: **Horas efectivas** (administración) y **Mis horas** (cada educador), en el menú principal, suman las horas de cada clase impartida, desde que se comienza hasta que se finaliza, atribuidas a quien la comenzó, con filtros por periodo (en la zona horaria de la organización), curso, sección y persona, totales por educador, curso y sección, y **Exportar CSV** (UTF-8 con BOM, encabezados en español). Una clase cancelada o sin finalizar no suma; una sin registro de inicio (las finalizadas antes de esta versión) o de más de 8 h suma 0 hasta que administración la **corrige** con minutos, persona y un motivo obligatorio que queda en la actividad. API `GET /api/hours`, `GET /api/hours/export`, `POST /api/hours/:sessionId/adjustment`; migración `0040_effective_hours.sql` (tabla `class_hour_adjustments`, incluida en el respaldo).

## 1.0.0 — 2026-10-07

Versión 1.0 de REL-006 (DEC-034, DEC-035), aceptada por la Product Owner el 7 de octubre de 2026 sobre la candidata 1.0.0-rc.2 desplegada en producción (ST-078). Reúne las dos candidatas: respaldo y restauración de cada organización, ensayo de publicación y reversión, validación de accesibilidad y seguridad, retiro de las rutas heredadas, el tiempo de las lecciones conectado con el de las clases, los choques de horario confirmados y registrados, el programa de inglés por niveles en la demostración y la zona horaria IANA.

- ST-078: aceptación con los guiones de demostración de SPR-002 y de la versión 1.0; guía de uso en `docs/guia-de-uso.md`.
- Sin cambios de código ni migraciones respecto de 1.0.0-rc.2. Se mantiene la autorización de v0.8.1.

## 1.0.0-rc.2 — 2026-10-06

Segunda candidata de REL-006 (DEC-035): el tiempo de las lecciones se conecta con el de las clases, los choques de horario de quien imparte se confirman y quedan registrados, la demostración trae inglés por niveles y la zona horaria se elige por su identificador.

- ST-117: la duración de una lección es la suma de los minutos de sus actividades. El editor la muestra calculada y ya no tiene un campo aparte; el servidor ignora la duración enviada cuando las actividades tienen minutos. `0029_lesson_time_and_conflicts.sql` corrige las lecciones guardadas cuya duración no coincidía.
- ST-117: al planificar, la barra de tiempo compara los minutos de las lecciones con la duración de la clase: cabe, casi llena o **excede por X**. Se puede guardar igual. El Cronograma avisa cuántas clases próximas exceden su horario y cada fila dice **Excede X** o **X de Y**; el detalle de la clase muestra la misma barra.
- ST-118: asignar a quien ya imparte otra sección activa a la misma hora responde 409 con los choques y abre **Choque de horario**, que pide el motivo de la excepción. Al confirmar, se guarda quién lo aceptó, cuándo y por qué (tabla `educator_conflict_overrides`), queda en la actividad y la sección lo muestra. No se vuelve a pedir para esa persona en ese par de secciones.
- ST-119: `0030_english_program.sql` agrega a la demostración **Inglés por niveles (MCER)**, de A1 a C2, con requisitos en cadena, lecciones publicadas, secciones con horario y clases planificadas que muestran el aviso de tiempo y un choque para confirmar. Suma a Tomás Aguilar (`tomas.aguilar`).
- ST-120: **Organización → Zona horaria** lista las zonas IANA agrupadas por región, con su desfase actual (por ejemplo `America/Guatemala (UTC−06:00)`), en lugar de países. La API acepta cualquier zona IANA válida.
- ST-044: la restauración solo recrea los disparadores de las tablas restauradas y, si falla, responde 503 con `Retry-After` sin cambiar datos; el ensayo de publicación reintenta mientras el Durable Object termina de actualizarse.
- Se mantiene la autorización de v0.8.1.

## 1.0.0-rc.1 — 2026-10-06

Versión candidata de REL-006 (DEC-034): la organización se respalda y se restaura, la publicación se ensaya con reversión, la accesibilidad y la seguridad quedan validadas, y se retiran las rutas heredadas.

- ST-044: **Organización → Respaldo → Descargar respaldo** y `GET /api/organization/backup` (solo administración) entregan una copia JSON de todas las tablas de la organización con un resumen SHA-256 por tabla. No incluye contraseñas, sesiones ni límites de inicio de sesión. `POST /api/organization/restore` reemplaza los datos en una transacción, rechaza copias alteradas (400) o de otra organización o esquema (409), conserva las contraseñas del espacio y verifica cada tabla; solo existe donde `RESTORE_ENABLED=true` (vista previa y pruebas), no en producción.
- ST-095: el workflow `Release drill` publica en la vista previa el release anterior y la candidata, restaura un respaldo de la demostración tomado de producción, revierte con `wrangler rollback` y vuelve a la candidata, con flujos críticos en cada paso y evidencia en el artefacto `release-drill-<sha>`.
- ST-077: páginas y API envían `Strict-Transport-Security`. La auditoría de accesibilidad cubre también una clase, Organización y Educadores; en móvil, las migas de la clase tienen 24 px de alto mínimo por enlace (WCAG 2.5.8). Hallazgos y decisiones en `docs/operations/validacion-1.0.md`.
- ST-076: `/api/curriculum`, `/api/levels`, `/api/units` y la escritura de `/api/resources` responden 410; la biblioteca compartida es de solo lectura y los recursos se agregan en la biblioteca de cada curso. Las pruebas usan los módulos de curso. Rutas vigentes en `docs/api.md`.
- ST-078: guía breve de uso en `docs/guia-de-uso.md`.
- Sin migraciones de datos. Se mantiene la autorización de v0.8.1.

## 0.8.17 — 2026-10-06

Parche de REL-004 (DEC-033): el menú en niveles se lee sin sangría y responde igual en cada clic, y la demostración trae tres rutas de programa.

- ST-116: elegir de nuevo un curso, una sección o Secciones en su propia página lo pliega y lo despliega cada vez, no solo la primera; desde otra página lo abre y navega.
- ST-116: los niveles ya no se desplazan a la derecha. Cada nivel abierto es una superficie redondeada con un tinte que se intensifica con la profundidad, así los nombres largos conservan el ancho del menú. En modo de alto contraste cada nivel lleva borde.
- ST-116: el chevron y el **+** son botones sutiles de Fluent: el chevron apunta hacia abajo cerrado y hacia arriba abierto; el **+** aparece al pasar el puntero, con el foco o cuando el nivel está abierto, y siempre en pantallas táctiles. El **+** de Cursos queda centrado.
- ST-116: `0028_program_routes.sql` agrega a la organización de demostración **Ruta de lectura y escritura** (4 cursos), **Programación creativa** (4 cursos, a tu ritmo) e **Iniciación musical** (3 cursos). Cada curso requiere el anterior y tiene plan curricular, módulos y lecciones publicadas. No se aplica si ya existe un programa con alguno de esos nombres.
- Sin cambios de API. Se mantiene la autorización de v0.8.1.

## 0.8.16 — 2026-10-06

Parche de REL-004 (DEC-032): el menú es un árbol de cursos y secciones, Docencia pasa a ser **Agenda**, y cada organización tiene su propia administración.

- ST-115: las secciones están dentro de su curso: **Cursos → curso → Secciones → sección**, cada nivel con sus páginas. Elegir un curso o una sección abre su Resumen y despliega sus páginas; elegirlo de nuevo en esa página lo pliega; el chevron pliega o despliega sin navegar. Cursos y Secciones abren su lista completa y también se despliegan en el menú. Solo un curso y una sección abiertos a la vez.
- ST-115: el menú se monta una sola vez y no se vuelve a dibujar al navegar; cada nivel se despliega con una transición de altura y respeta la reducción de movimiento. El nombre, el **+** y el chevron se alinean en columnas fijas en todos los niveles. **+** junto a Cursos abre Crear curso; **+** junto a las Secciones de un curso crea una sección de ese curso.
- ST-115: **Agenda** (`/agenda`, antes Docencia en `/secciones`) reúne las próximas clases, la semana y las secciones, con filtros. `/secciones` lleva a la Agenda. Las migas de una sección empiezan en su curso: **curso › Secciones › sección**.
- ST-115: nueva organización **Happy Learners**, sin datos ficticios, con una cuenta de administración y dos de docentes; la organización externa ficticia recibe `admin-externo`. El inicio de sesión busca la organización de cada cuenta; las sesiones, los códigos de lección (`H-`) y de sección (`HG-`) de Happy Learners se dirigen a su organización.
- Datos: `0027_organization_accounts.sql` crea las cuentas; cada organización nueva recibe su fila al iniciarse. Sin cambios de API. Se mantiene la autorización de v0.8.1.

## 0.8.15 — 2026-10-06

Parche de REL-004 (DEC-031): un solo menú en niveles, y Horario y Estudiantes que se entienden de un vistazo.

- ST-114: el menú lateral ya no se reemplaza al entrar a una sección o a un curso. **Docencia** (antes «Mis secciones» o «Secciones») y **Cursos** se expanden como un acordeón y muestran todas las secciones y cursos activos; al elegir uno, sus páginas se abren debajo. El chevrón muestra u oculta cada área y la pestaña recuerda cómo la dejaste; el área de lo que tienes abierto siempre se abre. El menú se actualiza solo al crear, renombrar, cerrar o archivar.
- ST-114: administración crea una sección desde cualquier página con **+** junto a Docencia, o con **Nueva sección** en Docencia: elige el curso, le da nombre y llega a ella. **+** junto a Cursos abre Crear curso.
- ST-114: **Horario** dice en una frase cuándo hay clase y muestra la semana, el periodo, la próxima clase y las clases pendientes e impartidas. **Editar horario** abre el formulario con días en botones, duración en una lista, la hora de salida, atajos de periodo (1, 3, 6 o 10 meses) y una vista previa con cuántas clases se programan, entre qué fechas, cuántas caen en días sin clase y qué pasa con las pendientes. Los días sin clase quedan al lado y se agregan con **Agregar**.
- ST-114: **Estudiantes** muestra la lista completa, sin desplazamiento interno, con búsqueda cuando pasa de ocho. **Agregar estudiantes** acepta uno o una lista pegada, un nombre por línea: quita numeración y viñetas, no repite nombres ya presentes y avisa cuántos agrega. **Cómo entran** muestra el código, la dirección para entrar, **Copiar código** y **Copiar invitación**.
- Las migas de las páginas de una sección empiezan en Docencia. Sin cambios de datos ni de API. Se mantiene la autorización de v0.8.1.

## 0.8.14 — 2026-10-06

Parche de REL-004 (DEC-027 y DEC-030): correcciones del avance a tu ritmo y de la coedición de la estructura de una lección.

- ST-110: `GET /api/sections/:id/progress` responde 403 con «Esta sección no está asignada a tu cuenta» a un educador que no imparte la sección, igual que `GET /api/sections/:id`; antes respondía 404. Una sección de otra organización o inexistente sigue respondiendo 404.
- ST-110: terminar una lección ya no puede fallar cuando su apertura quedó registrada con una hora posterior a la del cierre; la hora de finalización nunca es anterior a la de apertura.
- ST-113: un editor que todavía no recibía el último cambio de otra persona podía devolver la sala a su estado anterior al guardar el suyo, por ejemplo deshacer la organización recién elegida de una actividad. Ahora cada editor envía solo lo que cambió él desde lo último que compartió: en el título y el objetivo, su edición se aplica donde la hizo; en los demás campos, solo los que modificó; el orden, solo si lo movió, y una actividad eliminada por otra persona no reaparece.
- Sin cambios de datos ni de interfaz. Se mantiene la autorización de v0.8.1.

## 0.8.13 — 2026-10-05

Parche de REL-004 (DEC-030): la estructura de la lección se coedita en vivo, igual que su texto. Ya no hace falta recargar cuando otra persona guardó primero.

- ST-113: con la lección abierta por varias personas, el título, el objetivo, la secuencia didáctica, el módulo, la duración y los resultados de aprendizaje cambian en vivo para todos. También el orden de las actividades y, en cada una, su título, duración, momento, propósito, organización, resultados y bloques; una actividad nueva llega con su texto.
- ST-113: los cambios simultáneos se combinan: en el título y el objetivo se conservan las dos escrituras, el orden toma el último movimiento sin perder actividades, y en los demás campos queda el último cambio. El guardado automático envía la versión combinada y, si otra persona guardó antes, vuelve a guardarla sin pedir recargar.
- ST-113: la sala de edición toma la lección guardada al abrirse por primera vez, una sola vez aunque dos personas la abran a la vez, y la actualiza si la lección cambió mientras nadie la editaba. Ayuda explica la edición simultánea.
- Sin cambios de datos ni de API. Se mantiene la autorización de v0.8.1.

## 0.8.12 — 2026-10-05

Parche de REL-004 (DEC-029): requisitos entre los cursos de un programa. El programa se lee como una ruta: cada curso indica qué cursos del programa conviene terminar antes.

- ST-112: en **Configuración académica**, **Requisitos entre cursos** abre la ruta del programa. Administración elige, para cada curso, hasta 10 cursos del mismo programa que requiere; un curso no puede requerir a otro que ya depende de él, para que la ruta no forme ciclos. La ruta ordena los cursos en etapas: cada curso va una etapa después del último curso que requiere.
- ST-112: el **Resumen** de cada curso de un programa muestra **Ruta en el programa**: qué cursos requiere y cuáles le siguen, con enlace a cada uno; administración edita los requisitos desde ahí. Los requisitos orientan la planificación y no impiden abrir un curso.
- ST-112: un curso que sale de su programa pierde sus requisitos y deja de ser requisito de los demás. Guardar los mismos requisitos no registra actividad.
- Datos: `0026_course_prerequisites.sql` agrega `course_prerequisites`; un curso no puede requerirse a sí mismo.
- API: `GET`/`PUT /api/programs/:id/prerequisites {courseId, requiredIds}` (lectura para el personal de la organización; escritura solo administración, 403 para el resto; 400 con cursos de otro programa; 409 si se forma un ciclo); `GET /api/courses/:id` incluye `requirements`. Se mantiene la autorización de v0.8.1.

## 0.8.11 — 2026-10-05

Parche de REL-004 (DEC-028): grupos de trabajo dentro de cada sección. Los estudiantes de la sección son el universo; **Toda la sección** es el grupo predeterminado y quienes la imparten forman grupos más pequeños para las actividades en parejas o en equipos.

- ST-111: cada sección tiene **Grupos**, con **Toda la sección** y los grupos que forman administración y quienes la imparten con estudiantes de su lista (un estudiante puede estar en varios). La página lista las actividades **En parejas** y **En equipos** de las lecciones publicadas del curso y permite asignarles uno o varios grupos; sin asignación, las trabaja toda la sección. Eliminar un grupo conserva a sus estudiantes en la sección.
- ST-111: la clase muestra junto a cada actividad en grupo quién la trabaja. Con el código de la sección, la lección indica a los estudiantes qué grupos trabajan cada actividad; en un curso a tu ritmo, quien eligió su nombre ve también con quién está en su grupo.
- ST-111: la configuración del curso y del programa agrega **Grupos de trabajo** (activos por omisión fuera de la modalidad en línea; el programa puede fijarlos) y requiere secciones; el ajuste antes llamado «Grupos y asistencia» se llama **Secciones y asistencia**. Con los grupos desactivados, lo formado se consulta pero no cambia.
- Correcciones: las tablas con desplazamiento horizontal (cobertura, avance y actividades en grupo) ya no ensanchan la página en pantallas pequeñas.
- Datos: `0025_work_groups.sql` agrega `work_groups`, `work_group_members` y `activity_work_groups`.
- API: `GET`/`POST /api/courses/:id/groups/:gid/work-groups`, `PUT`/`DELETE …/work-groups/:wid` y `PUT …/activity-groups {lessonId, activityId, workGroupIds}` (administración y quienes imparten la sección; 403 para el resto, 409 con los grupos desactivados o la sección cerrada); `GET /api/share/:code` incluye `groups` con el código de la sección. Se mantiene la autorización de v0.8.1.

## 0.8.10 — 2026-10-05

Parche de REL-004 (DEC-027): el ritmo del curso define cómo se imparte. **Con calendario**, cada sección avanza junta con su horario y su cronograma de clases; **A tu ritmo**, la sección no tiene horario ni clases y cada estudiante recorre las lecciones publicadas en orden.

- ST-110: en un curso **a tu ritmo**, el espacio de estudiantes pregunta «¿Quién eres?» con la lista de la sección y luego muestra la ruta del curso por módulo (terminada, en curso o pendiente), la lección con la que sigue y cuántas lleva. Abrir y terminar una lección guarda el avance de esa persona; quien no aparece en la lista puede ver las lecciones sin guardar avance, y **No soy yo** cambia de persona. Las respuestas de las actividades siguen quedando solo en el dispositivo.
- ST-110: cada sección a tu ritmo muestra **Resumen** (estudiantes, quienes empezaron y terminaron, avance promedio y cómo entran sus estudiantes) y **Avance**, con el progreso, la siguiente lección y la última actividad de cada estudiante y cuántos abrieron y terminaron cada lección. Su menú omite Cronograma y Horario; las tarjetas de sección muestran el avance de la ruta. En un curso con calendario no cambia nada.
- ST-110: la Configuración explica cada ritmo y el ritmo de un programa sigue mandando sobre el de sus cursos.
- Datos: `0024_self_paced.sql` agrega `learner_progress` (lección abierta y terminada por estudiante) y `group_access_sessions.learner_id`. Los cursos y programas que ya tenían clases quedan con calendario para conservar su cronograma.
- API: `POST /api/student/identity` y `POST /api/student/progress` (solo en cursos a tu ritmo, 409 en los demás); `GET /api/sections/:id/progress`; las clases, el horario y la planificación de una sección a tu ritmo responden 409. Se mantiene la autorización de v0.8.1.

## 0.8.9 — 2026-10-05

Parche de REL-004 (DEC-026): un calendario con días sin clase, clases canceladas que recorren u omiten lo planificado y clases finalizadas que registran hasta dónde llegó cada lección.

- ST-108: **Días sin clase**. Administración registra feriados, asuetos y semanas completas para toda la organización en **Organización** o para una sección en su **Horario**. Los horarios no generan clases esos días: las clases pendientes que caían en ellos desaparecen y lo planificado pasa, en orden, a las siguientes. Al quitar un periodo vuelven sus clases. El cronograma muestra cada periodo entre las clases, con su motivo y su alcance.
- ST-108: **Cancelar clase** pregunta qué pasa con lo planificado cuando la clase tiene lecciones o comentarios: **Recorrer** lo pasa a la siguiente clase y cada clase pendiente avanza un lugar; **Omitir** lo salta y las demás clases no cambian.
- ST-109: **Finalizar clase** pide hasta dónde llegó cada lección: Completada, Parcial o No se alcanzó. Lo no completado abre la siguiente clase de la sección, salvo que se desactive. El cronograma muestra lo parcial y lo no alcanzado; el mapa de cobertura y los indicadores de la sección cuentan como impartido solo lo completado, y **Corregir lo trabajado** ajusta una clase ya finalizada. El espacio de estudiantes omite las lecciones que una clase no alcanzó.
- Datos: `0023_class_calendar.sql` agrega `calendar_breaks` (periodos sin clase de la organización o de una sección) y `class_session_lessons.outcome`; las clases finalizadas antes de esta versión cuentan todas sus lecciones como completadas.
- API: `GET`/`POST /api/calendar` y `DELETE /api/calendar/:id` (cambios solo para administración, 403 para el resto); `POST …/sessions/:sid/complete` acepta `{ lessons: [{ id, outcome }], carryOver }`; `POST …/sessions/:sid/cancel` acepta `{ plan: "shift" | "skip" }`; `PUT …/sessions/:sid/outcomes` corrige una clase finalizada. Se mantiene la autorización de v0.8.1.

## 0.8.8 — 2026-10-05

Parche de REL-004 (DEC-025): ordenar arrastrando, un resumen del curso que se lee en orden y documentación depurada.

- ST-107: las lecciones de una clase, las actividades y los bloques de una lección, los módulos y las lecciones del contenido se ordenan arrastrando su asa (Fluent «reordenar») o con el teclado: con el asa enfocada, flecha arriba o abajo mueve un lugar e Inicio o Fin lleva al principio o al final. Los menús dicen «Mover arriba» y «Mover abajo». En pantallas táctiles el asa crece a 44 px.
- ST-107: el **Resumen** del curso empieza con sus indicadores en una franja (lecciones publicadas, módulos, borradores, cambios sin publicar, resultados trabajados y secciones) y sigue en dos columnas: a la izquierda Contenido, con el avance de cada módulo, Plan curricular y Secciones; a la derecha Accesos rápidos en lista, Publicación pendiente, Equipo docente y Actividad reciente. El Resumen de cada sección usa la misma distribución.
- ST-107: el distintivo «Archivado» va bajo el nombre del curso y ya no lo parte en una columna; la pestaña Archivados cuenta los cursos archivados. Los íconos dentro de un texto (el reloj del horario, por ejemplo) se alinean con su línea. Cada evento de la actividad reciente indica qué registro cambió (Clase, Lección, Sección…).
- Correcciones: «Agregar clase» propone la fecha de hoy según la zona horaria de la organización, no la del navegador. El formulario de nuevo módulo enfoca su nombre al abrirse sin un temporizador que pudiera mover el foco mientras se escribe.
- Documentación: se retiran `docs/redesign/` y `docs/sprint-2/`, registros de incrementos anteriores que siguen disponibles en el historial (tag v0.8.7). La documentación canónica vive en `happy-learners-ops`; aquí quedan la guía visual Fluent, la organización de demostración y los README de cada capa.

## 0.8.7 — 2026-10-05

Parche de REL-004 (DEC-024): cada sección es una impartición propia del curso. El curso define qué se enseña (plan curricular, contenido, biblioteca y configuración); cada sección tiene sus educadores, estudiantes, horario, cronograma, asistencia, actividad e indicadores, y cada educador ve solo las secciones que imparte.

- ST-105: cada sección tiene su propio espacio en **Secciones › sección**, con **Resumen**, **Cronograma**, **Estudiantes** y **Horario**. El Resumen muestra sus indicadores (estudiantes, clases impartidas, asistencia promedio y clases sin registrar), el avance de las lecciones del curso impartidas y planificadas en esa sección, su próxima clase, quién la imparte y su actividad. El menú del curso queda en Resumen, Contenido, Plan curricular, Biblioteca del curso, Secciones y Configuración. Los enlaces anteriores a Clases, Asignaciones y Horario llevan a la sección correspondiente.
- ST-106: **Mis secciones** reúne las secciones de cada educador, cada una con su avance, sus clases y su asistencia, y **Mi semana** muestra sus horarios. Inicio muestra a cada educador sus secciones con sus indicadores. Administración ve todas las secciones de la organización, con búsqueda y filtro por curso.
- ST-102: los educadores de una sección se eligen solo del equipo docente del curso; para sumar a alguien, administración lo agrega antes al equipo en Configuración.
- ST-103: la persona responsable ve e imparte solo las secciones que tiene asignadas, igual que quien colabora, y conserva la publicación del contenido. Una sección ajena indica «Esta sección no está asignada a tu cuenta».
- Datos: `0022_section_instances.sql` agrega la sección a la actividad (`activity_events.group_id`, completada para los eventos existentes de secciones y clases) y a las aperturas de lecciones hechas con el código de una sección (`lesson_completions.group_id`). Las asignaciones actuales se conservan.
- API: `GET /api/sections` y `GET /api/sections/:id` entregan cada sección con sus indicadores. `GET /api/courses/:id/groups/:gid` entrega una sección con su lista. `GET /api/activity` acepta `section=`, y la actividad y el avance se limitan a las secciones de cada educador. `PUT /api/courses/:id/groups/:gid/educators` responde 400 si alguien no integra el equipo. Se mantiene la autorización de v0.8.1: quien no integra el equipo recibe 403 y salir del equipo retira el acceso.

## 0.8.6 — 2026-10-05

Parche de REL-004 (DEC-023): roles del curso. Administración prepara el curso y sus secciones, la persona responsable publica el contenido, y cada educador ve e imparte solo lo que tiene asignado.

- ST-102: solo **administración** crea cursos (con su responsable, que es obligatorio), cambia su configuración y su equipo, y crea secciones, inscribe estudiantes, gestiona códigos y configura horarios. En **Asignaciones** asigna a cada sección de una a seis personas que la imparten; quien no estaba en el equipo se suma como colaborador. Consulta todo el contenido, el plan y las clases en modo lectura, salvo que forme parte del equipo del curso.
- ST-103: cada educador ve en **Cursos** e **Inicio** solo los cursos de su equipo; fuera de ellos recibe «Este curso no está asignado a tu cuenta». La **persona responsable** ve e imparte todas las secciones, por ejemplo para cubrir una clase. **Quien colabora** ve e imparte solo sus secciones: planifica las lecciones y los comentarios de cada clase, mueve una clase puntual, agrega una clase adicional, la comienza, pasa lista, la finaliza o la cancela.
- ST-104: la persona responsable publica las lecciones y organiza los módulos, el orden y el archivo de lecciones y el plan curricular. Quien colabora edita borradores y recursos y elige **Enviar a revisión**, con una nota opcional. La persona responsable ve los envíos en **Por revisar** (Inicio), elige **Aprobar y publicar** o **Devolver** con comentarios, y quien envió ve el resultado en **Mis envíos a revisión** y en el editor. Los recursos no pasan por revisión.
- Duplicar un curso pasa al servidor y queda en manos de administración. Copia la configuración, el equipo, los módulos, el plan, los recursos y sus archivos en una sola operación, y deja las lecciones como borrador.
- Datos: `0021_roles_and_reviews.sql` agrega `section_educators` y `lesson_reviews`. Asigna cada sección existente a todo el equipo de su curso, así nadie pierde el acceso que tenía.
- API: `PUT /api/courses/:id/groups/:gid/educators`, `POST /api/lessons/:id/review`, `POST /api/lessons/:id/review/return`, `GET /api/reviews` y `POST /api/courses/:id/duplicate`. `GET /api/courses/:id` entrega `access` (qué puede hacer la persona en el curso). `POST /api/lessons/:id/publish` acepta `?draftVersion=` para publicar exactamente la versión revisada. `POST /api/courses` exige `leadId`. Se mantiene la autorización de v0.8.1: quien no integra el equipo recibe 403 y salir del equipo retira el acceso.

## 0.8.5 — 2026-10-05

Parche de REL-004 (DEC-022): Clases es el cronograma de la sección. Se planifica con el horario y los contenidos, y se sigue clase por clase con su asistencia.

- ST-101 / ST-097: **Clases** muestra el cronograma de cada sección como tabla: fecha (con semana del periodo y número de clase), módulo, lecciones, actividades, comentarios, recursos y seguimiento (estado y asistencia). En el celular cada clase se muestra como tarjeta. Filtros: todo el periodo, próximas e historial.
- ST-101: **Planificar** en cada fila elige las lecciones de la clase en orden y sus comentarios. La lección es opcional y una clase puede cubrir hasta seis. La fecha y la hora vienen del horario; una clase pendiente puede cambiarlas desde «Cambiar fecha u hora».
- ST-097 / ST-027: «Asignar lecciones en orden» admite de una a tres lecciones por clase. «Agregar clase» pide solo la sección y la fecha: toma la hora y la duración del horario de la sección.
- ST-035 / ST-071: la ejecución queda en la página de la clase: comenzar, pasar lista y finalizar. Una clase en curso conserva su fecha y hora; una impartida conserva sus lecciones, registra la publicación de cada una y solo cambia sus comentarios.
- ST-099: al cambiar el horario, lo planificado en las clases pendientes (lecciones y comentarios) pasa en orden a las nuevas fechas.
- ST-098 / ST-100: el espacio de la sección muestra todas las lecciones de cada clase y sus recursos; el mapa de cobertura cuenta todas las lecciones de las clases finalizadas.
- Datos: `0020_class_lessons.sql` agrega `class_session_lessons` (orden, publicación usada) y copia la lección de cada clase existente. `class_sessions.lesson_id` sigue reflejando la primera lección para poder restaurar v0.8.4.
- API: `PUT /api/courses/:id/sessions/:sid` recibe `lessonIds` y `POST /api/courses/:id/groups/:gid/lessons` recibe `perClass`; `GET /api/courses/:id/sessions` entrega las actividades y recursos de las lecciones planificadas. Se retira `PUT /api/courses/:id/sessions/:sid/lesson`. La autorización por equipo del curso (ST-096) se conserva.

## 0.8.4 — 2026-10-05

Parche de REL-004 (DEC-021): el aula sigue el orden de trabajo del equipo docente. Las secciones agrupan a los estudiantes asignados, el horario genera las clases y cada clase trabaja una lección con sus recursos.

- ST-026 / ST-070: **Asignaciones** reemplaza a Grupos. Cada sección del curso tiene sus estudiantes asignados, su código de acceso y su horario; `/cursos/:id/grupos` redirige.
- ST-099: **Horario** nuevo. Por sección se eligen días, hora, duración y periodo; al guardar se generan todas sus clases. Un cambio rehace solo las clases generadas que siguen pendientes, conserva las impartidas, en curso, canceladas y agregadas a mano, y mantiene el orden de sus lecciones.
- ST-097 / HL-141 y ST-027: **Clases** es el cronograma. La lección de cada clase se elige en su fila o con «Asignar lecciones en orden», que usa las lecciones publicadas en el orden de Contenido. Solo se asignan lecciones publicadas. Los recursos de la clase son los de su lección y ya no se eligen al planificar. «Agregar clase» programa una clase extra. La página Cronograma se retira y su ruta redirige a Clases.
- ST-029: una clase cuya lección se archivó muestra «Requiere sustitución».
- ST-098: el espacio de la sección muestra «Lecciones de tus clases» y entrega solo los archivos publicados en la lección de una de sus clases.
- ST-100: el mapa de cobertura del Plan curricular marca como **Impartido** lo que trabajan las lecciones de las clases finalizadas, con filtro por sección para el equipo del curso.
- Datos: `0019_section_schedule.sql` agrega el horario de cada sección y el origen de cada clase, recupera el horario de las secciones de la demostración y da a sus clases pendientes las lecciones publicadas en orden. `lesson_assignments` y `class_session_resources` dejan de leerse y se conservan para poder restaurar v0.8.3.
- API: `PUT|DELETE /api/courses/:id/groups/:gid/schedule`, `POST /api/courses/:id/groups/:gid/lessons` y `PUT /api/courses/:id/sessions/:sid/lesson`. Se retiran `/api/assignments` y `/api/courses/:id/assignments`. La autorización por equipo del curso (ST-096) cubre las rutas nuevas.

## 0.8.3 — 2026-10-04

Parche de REL-004 (DEC-020): nombres del aula alineados con el uso del equipo docente.

- ST-027 / HL-48: la página que programa qué lección publicada usa cada grupo y en qué fechas se llama Cronograma (`/cursos/:id/cronograma`). Los enlaces anteriores a Asignaciones redirigen. Inicio muestra «Tu cronograma vigente» y el espacio del grupo, «Lecciones del cronograma».
- Asignación significa ahora la inscripción de un estudiante en el curso: se asigna al agregarlo a la lista de un grupo. La Ayuda y la página Grupos lo explican.
- Sin cambios de datos, permisos ni API.

## 0.8.2 — 2026-10-04

Parche de REL-004 (DEC-019): el ciclo de una clase queda completo y el grupo la sigue con su código.

- ST-035 / HL-61 y ST-097: planificar una clase con grupo, fecha, hora, duración, lección publicada, hasta 20 recursos de la biblioteca y notas; comenzarla, pasar lista, finalizarla con la lista completa, cancelarla y reprogramarla. Solo el equipo del curso lo hace (ST-096 se conserva).
- ST-036 / HL-62 y ST-071: próximas clases con hora y estado en Inicio y en el curso; historial con asistencia, quién impartió y la publicación usada; indicadores de clases impartidas, asistencia promedio y clases sin registrar.
- ST-070: nombres de grupos y participantes editables.
- ST-098: cada grupo tiene un código. Sin cuenta ni datos personales, el estudiante ve su próxima clase, abre sus recursos y las lecciones asignadas; el código se rota o desactiva.
- Biblioteca general: agregar y editar recursos de cualquier curso activo, como antes de v0.2.3.
- La sección Asistencia se integra en Clases; los enlaces anteriores redirigen.
- Pruebas E2E del ciclo completo de la clase, del ciclo de vida del grupo, del espacio del grupo y de la biblioteca general, en escritorio y móvil.

## 0.8.1 — 2026-10-04

Parche de seguridad de REL-004 (DEC-018): dos defectos HIGH de autorización, corregidos en el servidor con denegación por defecto.

- ST-072 / HL-115: solo administración cambia el equipo docente de un curso. La persona responsable y los educadores lo ven en modo lectura; cada cambio queda en la actividad del curso.
- ST-096 / HL-140: solo el equipo docente del curso consulta y administra sus grupos, participantes, clases, asignaciones y asistencia. Un educador ajeno al equipo y administración reciben 403, y la interfaz no les ofrece esas secciones.
- Entrega: un commit solo de documentación ya no redespliega el Worker, y la verificación horaria compara producción con el último despliegue exitoso (HL-15 / ST-049).

## 0.8.0

El educador asigna y prepara contenido de principio a fin; el estudiante recibe la publicación vigente.

- ST-027 / HL-48: Asignar contenido publicado
- ST-032 / HL-41: Identificar la siguiente lección
- ST-016 / HL-45: Duplicar una lección
- ST-069 / HL-112: Insertar tablas en una lección
- ST-029 / HL-50: Resolver la publicación efectiva

Manifest: MNF-0ae9e87bc9028667bd8e

## 0.7.1 — 2026-10-02

- Corrección: al responder bien una pregunta, el mensaje «¡Correcto!» se mostraba en vertical. Heredaba la regla `.correct` del editor (el control de 44 px que marca la opción correcta). La regla queda limitada a ese control y una prueba E2E comprueba que el mensaje ocupa el ancho de la tarjeta.

## 0.7.0 — 2026-10-02

Organización de demostración completa, equipos docentes e historial de actividad (HL-44 / ST-041).

- **Equipo docente:** cada curso tiene una persona responsable y colaboradores. Se ve en las tarjetas y el resumen del curso, se gestiona en **Configuración → Equipo docente** y se filtra en **Cursos** por responsable. Quien crea un curso queda como responsable.
- **Historial de actividad:** se registra quién creó o actualizó cursos, programas, módulos, competencias, resultados, recursos y lecciones; quién planificó, publicó, archivó o subió archivos; y quién registró clases y pasó lista. Aparece con autor en Inicio (*Actividad en mis cursos*), en el resumen del curso y en Educadores.
- **Avance:** *Mis cursos* en Inicio muestra lecciones publicadas, resultados evaluados y asistencia de los cursos en que participas. **Educadores** muestra, por persona, cursos, lecciones creadas, publicaciones, clases registradas y última actividad, junto al avance de cada curso.
- **Nombres visibles** de las personas en la barra superior, los equipos y la actividad.
- **Seed de demostración** (`0015_demo_organization.sql`, generado por `scripts/seed/build.mjs`):
  - Colegio Horizonte con 6 personas (1 coordinación y 5 educadores) y 3 programas.
  - 6 cursos con plan curricular, módulos, 32 lecciones con actividades compuestas y notas docentes, y 15 recursos etiquetados.
  - 7 grupos con 102 participantes ficticios, 76 clases con 884 registros de asistencia, 447 finalizaciones y 224 eventos de historial.
  - Incluye estados variados: borradores, cambios sin publicar, un hueco curricular y un curso archivado.
  - Guía en `docs/demo/organizacion-demo.md`.
- **Migraciones:** `0014_course_teams_activity.sql` (nombres, `course_members` con un único responsable, `activity_events`). Las migraciones grandes se ejecutan por partes para respetar el límite de longitud SQL de Durable Objects.
- **Correcciones móviles:** las cuadrículas, pilas y paneles ya no desbordan en pantallas de 390 px.

## 0.6.0 — 2026-10-01

Rediseño con Fluent Design de Microsoft (HL-44 / ST-041). Sin cambios de API ni de datos.

- **Tokens oficiales de Fluent 2** (`@fluentui/tokens`) generados en `fluent/tokens.css` con la rampa de marca violeta. `theme.css` traduce cada token de la app a uno de Fluent: neutros, paletas, estados, rampa de sombras, radios, duraciones, curvas y tipografía.
- **Luz:** las tarjetas y los paneles se iluminan bajo el puntero, y el foco usa el indicador de Fluent.
- **Profundidad:** rampa de sombras 2/4/8/16/28/64 según la jerarquía.
- **Movimiento:** entradas que desaceleran, salidas que aceleran y cambios de estado suaves, sin rebotes. Respeta el movimiento reducido.
- **Material:** acrílico en la barra superior, los menús, el cajón móvil y el inicio de sesión; mica en la capa base. Se vuelve sólido sin soporte de desenfoque o con transparencia reducida.
- **Escala:** Segoe UI Variable con la fuente del sistema como respaldo, rampa tipográfica de Fluent, controles de 36 px (44 px táctiles) y esquinas de 4, 8 y 12 px. Se retiran las fuentes Inter y Plus Jakarta Sans.
- **Componentes Fluent:**
  - Botones: principal, secundario, sutil y peligro.
  - Campos con subrayado de marca al enfocar y pestañas segmentadas con indicador.
  - Menús y toasts como flyouts.
  - Diálogos con sombra 64.
  - Navegación con indicador de selección e icono relleno.
  - Insignias, barra de progreso, tarjetas y paneles.
- **Iconos:** Fluent System Icons (`@fluentui/react-icons`).
- **Guía de estilo** en la aplicación (`/guia-de-estilo`) y documentación en `docs/design/fluent.md`.
- **Pruebas nuevas:** los tokens generados no se desvían del paquete, cada token semántico apunta a uno de Fluent y los componentes no tienen colores literales. La guía de estilo entra en la auditoría axe.
- **Correcciones:** el menú de un módulo ya no se recorta dentro de su tarjeta y el diálogo queda centrado en móvil.

## 0.5.0 — 2026-10-01

Modelo académico (HL-44 / ST-041). La configuración del curso pasa de etiquetas libres a dimensiones estándar con consecuencias reales.

- **Dimensiones estándar:** tipo de educación y nivel según la CINE 2011 de la UNESCO (de primera infancia a doctorado; "Sin nivel" solo en no formal), área de conocimiento CINE-F 2013, formato (Asignatura, Curso libre, Taller, Laboratorio, Seminario), modalidad y ritmo. Sustituyen al "perfil" y a la clasificación "Disciplina" de los cursos.
- **Programas:** conjuntos de cursos que comparten tipo, nivel, modalidad y ritmo, dan valores a sus ajustes y pueden fijarlos. Los administra la organización en **Configuración académica**.
- **Comportamiento configurable con herencia:** nombre de las partes del curso, secuencia didáctica inicial, grupos y asistencia, y requisitos para publicar (resultados de aprendizaje y comprobación). Cada valor viene del tipo de curso, del programa o del propio curso, y la pantalla dice de dónde. El servidor aplica los requisitos al publicar y desactiva el registro de asistencia cuando corresponde.
- **Nomenclatura:** "Módulo" es el nombre estándar de las partes de un curso; cada curso o programa puede usar Unidades, Semanas, Sesiones, Temas o Bloques, con concordancia de género en toda la interfaz.
- **Plantillas de inicio** al crear un curso, filtros con conteos en **Cursos** (programa, nivel, formato, área, modalidad) y en **Biblioteca** (etiqueta, área).
- **Clasificaciones** se convierte en **Configuración académica**: programas, etiquetas de la biblioteca y estándares de referencia. La dirección anterior redirige.
- Migración `0013_academic_model.sql`: tabla `study_programs`, dimensiones y ajustes en `courses`, disparadores que impiden mezclar organizaciones y traducción de cada perfil anterior. Conserva el comportamiento de los cursos existentes; las columnas antiguas quedan como historial.

## 0.4.0 — 2026-10-01

Marco curricular (HL-44 / ST-041). Segunda fase del rediseño curricular.

- **Plan curricular** del curso: competencias, resultados de aprendizaje con nivel de pensamiento y evidencia, códigos RA1, RA2… en orden y archivado sin perder historial.
- **Mapa de cobertura:** resultados por unidad (planificado, trabajado en lecciones, evaluado), lo pendiente en cada unidad y una acción para cada hueco: crear una lección ya alineada o agregar evaluación donde ya se trabaja.
- **Alineación en el editor:** resultados de la lección (marcando los planificados en su unidad) y de cada actividad; recursos sugeridos por los resultados; recomendaciones antes de publicar con confirmación si quedan pendientes.
- **Estudiantes:** "Lo que aprenderás" muestra lo que podrán hacer al terminar, con el texto vigente al publicar.
- Resumen del curso con el estado del plan; duplicar un curso copia también su plan.
- Migración `0012_curricular_framework.sql`: tablas `course_competencies`, `course_outcomes` y `unit_outcomes`, limitadas al curso y su organización, y un plan de ejemplo para el curso de demostración (2 competencias y 3 resultados). No modifica lecciones.

## 0.3.0 — 2026-10-01

Secuencia didáctica y actividades compuestas (HL-44 / ST-041). Primera de dos fases del rediseño curricular.

- Cada lección sigue una secuencia didáctica: Inicio · Desarrollo · Cierre, 5E, Presentación · Práctica · Producción, Demostración · Práctica guiada · Práctica independiente o Libre. Las lecciones nuevas toman la del perfil del curso; las existentes quedan en Libre hasta que se elija otra. Al cambiar de secuencia las actividades conservan su orden.
- El editor agrupa las actividades por momento, con su intención, número de actividades y minutos; cada momento termina con un botón para agregar ahí. Subir y bajar cruzan de un momento al siguiente; el menú mueve a cualquier momento.
- Una actividad tiene propósito (explicar, explorar, practicar, evaluar, reflexionar), organización (individual, parejas, equipos, toda la clase), minutos y hasta 12 bloques ordenados: texto, recurso, pregunta o nota para el docente.
- Las notas para el docente nunca se publican: se quitan de la versión publicada y de la vista previa.
- El estudiante ve los momentos de la lección al empezar, el momento de cada actividad, su propósito y organización, y todos los bloques en orden.
- Compatibilidad: las actividades anteriores se leen como un bloque que conserva su ID, su texto colaborativo y su recurso; no hay migración de datos.

## 0.2.7 — 2026-10-01

- Seguridad: las páginas HTML reciben la misma Content-Security-Policy y cabeceras de seguridad que la API (`apps/web/public/_headers`). Antes, Workers Static Assets servía las páginas sin CSP porque solo `/api/*` pasa por el Worker.
- `font-src 'self' data:` permite las subfuentes que el build incrusta.
- Las pruebas E2E fallan si el navegador bloquea algo por CSP, y una prueba del paquete exige que la política de páginas y API sea idéntica.

## 0.2.6 — 2026-10-01

- Editor de lección como lienzo continuo: todas las actividades una tras otra, con puntos para insertar contenido, recurso o pregunta en cualquier posición y una sola barra de formato fija. El autoguardado indica "Borrador guardado"; los estudiantes ven la versión publicada hasta que publiques.
- Visor de archivos que ocupa todo el espacio disponible, con paginado y pantalla completa; las presentaciones se muestran diapositiva a diapositiva.
- Nuevos formatos: PDF (hasta 25 MB) y video MP4/WebM (hasta 100 MB). Se suben en streaming y R2 verifica su huella SHA-256; la firma de cada formato se valida. Migración `0011_pdf_video_files.sql`.
- Diseño estándar de página: el contenido empieza junto al menú lateral con un margen compacto.

## 0.2.5 — 2026-10-01

- Migración `0010_remove_legacy_e2e_records.sql`: elimina de la demo pública los registros de una ejecución E2E antigua (2 unidades, 2 lecciones con sus 2 finalizaciones, 2 niveles, 2 módulos y 2 recursos con sufijo `desktop-1790700257067` / `mobile-1790700278802`). Borrado autorizado el 2026-10-01; la copia previa se adjunta a la release.

## 0.2.4 — 2026-09-30

Tema visual moderno (HL-44 / ST-041). Sin cambios de API ni datos.

- Tema completo en `theme.css`: neutros fríos, violeta de marca y seis tonos (cielo, turquesa, rosa, coral, ámbar, verde) con variantes de texto, tinte y relleno, degradado de marca, tipografía, espaciado, radios, sombras y motion.
- Color con sentido: cada sección, curso, unidad, tipo de actividad y tipo de recurso tiene su tono estable.
- Tipografías autoalojadas: Inter y Plus Jakarta Sans.
- Inicio con encabezado que resume el día y contadores de colores; tarjetas de curso con portada; espaciado más compacto.
- Editor de texto tipo Docs: barra de iconos agrupada, enlace en línea, hoja con ancho de lectura, marcador de posición y contador de palabras.

## 0.2.3 — 2026-09-30

Reconstrucción de la experiencia de producto (HL-44 / ST-041). La API, los contratos y los datos no cambian.

- Un solo sistema de navegación: barra superior (marca, organización, búsqueda, ayuda, perfil) y un sidebar que cambia de contexto al entrar en un curso; en móvil se abre como panel.
- Inicio útil: continuar trabajando, cursos recientes, próximas clases, estado de las lecciones, acciones rápidas y actividad reciente.
- Cursos con tarjetas compactas, progreso de publicación, búsqueda y menú para editar, duplicar o archivar.
- Contenido unificado: unidades y lecciones en un outline con expandir, crear, renombrar en línea, reordenar con teclado y archivar.
- Editor de lección con autosave visible, outline de actividades, vista previa y una acción principal por estado.
- Biblioteca del curso y biblioteca global con búsqueda, filtros, uso en lecciones y vista previa; grupos → clases → asistencia con confirmación inmediata.
- Lección del estudiante móvil primero: una actividad a la vez, avance y cierre claro.
- Sesión expirada sin perder el trabajo en pantalla; errores que explican cómo recuperarse.
- Corrección: las actividades antiguas sin ID ya no se vacían al guardar una lección colaborativa.
- Sistema visual con tokens y primitivas propias; auditoría axe WCAG 2.2 AA en las pruebas E2E.

## 0.2.0 — 2026-09-29

Primera versión utilizable para organizar materiales y preparar una clase.

- Biblioteca persistente de recursos con título, descripción, nivel, habilidad, tema, etiquetas y contenido.
- Creación de lecciones en borrador y publicación con código de acceso.
- Consulta desde teléfono sin pedir datos personales al estudiante.
- Registro únicamente agregado de finalizaciones.
- Migración reversible `0002_catalog.sql`, aislamiento por organización y smoke test en producción.

## 0.1.0 — 2026-09-28

Primer espacio funcional de Happy Learners para preparar una lección publicada desde escritorio o móvil.

- HL-9 / ST-001: acceso con cuentas sintéticas autorizadas, sesiones opacas y revocación al salir.
- HL-10 / ST-004: organización inicial persistente, zona horaria y permisos de administración.
- HL-11 / ST-031: lección publicada de solo lectura con objetivo, actividades, materiales e impresión.
- HL-12 / ST-042: comprobación automática de los flujos críticos tras desplegar y cada hora.
- HL-13 / ST-043: el artefacto verificado se despliega automáticamente desde main, con SHA y hashes de contenido.
- HL-14 / ST-045: sin perfiles de niños, datos sintéticos, sesiones temporales y registros sin cuerpos de solicitudes.
- HL-15 / ST-049: trazabilidad y operación existentes conservadas; no se amplía el harness.

Persistencia: SQLite en un Durable Object por organización, dentro del plan gratuito. D1 no se creó porque la credencial existente carece de acceso; la decisión está documentada en ops.

Demo: https://happy-learners-demo.lfmendoza-alvarez.workers.dev

Cuentas públicas de demostración: `admin-demo`, `instructor-demo`; contraseña sintética `Aprender-2026!`. No introducir información personal. Las cuentas reales, invitaciones, edición/publicación de contenido y trabajo sin conexión quedan fuera de esta release.

Evidencia histórica: EXE-1c48bd9d391baa5d45ec y MNF-53e11fe0b6a1a0dac88d. Alcance actualizado por la directiva P0 del 28 de septiembre de 2026.
# v0.2.1

Roles Administrador/Educador, currículo Nivel–Unidad–Lección, edición persistente, revisiones publicadas, actividades ordenables y recursos vinculados. Migración acumulativa con seed sintético. [Detalle](https://github.com/happy-learners-gt/happy-learners-platform/blob/v0.8.7/docs/sprint-2/release-notes-v0.2.1.md).
