# API

Punto de composición del backend. Orquesta casos de uso, autorización, persistencia e integraciones sin trasladar
dependencias técnicas al paquete de dominio.

El Worker atiende solo `/api/*`; las páginas se sirven como activos estáticos. `GET`/`HEAD /api/health` responde
`{"status":"ok"}` y `/api/version` el SHA desplegado. Las respuestas de la API no se cachean, las rutas inexistentes
responden 404, los métodos no permitidos 405 y las rutas heredadas retiradas 410.

| Módulo | Responsabilidad |
| --- | --- |
| `index.ts` | Enrutamiento, cabeceras de seguridad, sesiones y límite de intentos de acceso. |
| `auth.ts`, `access.ts`, `roles.ts`, `accounts.ts`, `team.ts` | Sesiones, contraseñas, permisos por organización, curso y sección, roles, cuentas del equipo y equipo docente. |
| `courses.ts`, `content.ts`, `prerequisites.ts`, `duplicate.ts` | Programas, cursos, plan curricular, módulos, lecciones y requisitos. |
| `collaboration.ts`, `collaboration-awareness.ts`, `rich-text.ts` | Coedición en vivo de las lecciones mediante un Durable Object por lección. |
| `files.ts` | Archivos privados de cada curso en R2. |
| `sections.ts`, `classes.ts`, `attendance.ts`, `workgroups.ts`, `conflicts.ts` | Secciones, horario, clases, asistencia, grupos de trabajo y choques de horario. |
| `legal.ts` | Términos, política de privacidad y acuerdo de voluntariado ad honorem versionados, aceptaciones y consentimiento (ST-126, ST-127, ST-151); firma electrónica simple con constancia y verificación, y el bloqueo de impartir clases sin el acuerdo firmado (ST-153, ST-151). |
| `backup.ts` | Respaldo y restauración de cada organización. |
| `invitations.ts`, `mail.ts` | Invitaciones por correo (ST-121) y adaptadores del puerto de envío: Brevo por HTTP y envío deshabilitado (DEC-042). |
| `notifications.ts` | Avisos por correo (ST-124): `notify` después de cada escritura que afecta a alguien (equipo, sección, revisión, clase), preferencias, avisos obligatorios y registro en `mail_outbox`. |
| `calendar-feed.ts` | Enlace de suscripción al calendario de clases (iCalendar) de cada educador. |
| `permissions.ts` | Roles y accesos: permisos efectivos de cada solicitud, perfil de coordinación académica y grupos de seguridad con su auditoría (ST-128, ST-135). |
| `departures.ts` | Salida de una persona del equipo: reasignación de sus cursos y secciones, fin del acceso y registro (ST-123). |
| `profiles.ts` | Perfil de cada persona (ST-149) y expediente laboral con documentos privados en R2 y vencimientos (ST-150). |
| `hours.ts` | Horas efectivas impartiendo clases: consulta por periodo, curso, sección y persona, exportación CSV y correcciones con motivo (ST-152). |
| `onboarding.ts` | Incorporación guiada del primer ingreso: pasos derivados y declarados, estado propio y vista de administración (ST-122). |
| `account.ts`, `account-notices.ts` | Configuración de la cuenta bajo `/api/me/account`: cambio de correo verificado por enlace de un solo uso (24 h, solo el hash, aviso al correo anterior; confirmación pública en `/api/account/email/<token>`), sesiones activas con dispositivo y país (cerrar una o las demás) e historial de accesos; avisos de seguridad obligatorios (`mail_outbox.kind = 'account'`) (ST-158). |
| `personal-data.ts`, `closures.ts` | «Exportar mis datos» (`/api/me/export`, JSON solo con registros propios) y solicitudes de cierre de la cuenta (`/api/me/closure`; administración en `/api/closures`), que se completan al registrar la salida (ST-159, ST-123). |
| `preferences.ts` | Preferencias propias bajo `/api/me`: región, idioma y apariencia (ST-160), matriz de avisos por canal, frecuencia y horario de silencio (ST-161) y la campana (`/api/me/inbox`). |
| `notify.ts` | Envío de avisos (ST-124, ST-161): campana, correo inmediato o programado (`scheduled`) y `deliverScheduled`, que envía lo vencido como aviso o como resumen. |
| `storage.ts` | Almacenamiento SQLite de cada organización en su Durable Object. |

El correo transaccional usa el puerto `MailSender` del dominio. Con el secreto `BREVO_API_KEY` y la variable
`MAIL_FROM` (dirección verificada como remitente en Brevo) se usa `BrevoMailSender`; sin ellos, `DisabledMailSender` deja
cada mensaje en `mail_outbox` como `not_configured` y administración comparte el enlace. Ambos son opcionales: el
desarrollo local, las pruebas y el dry-run no los necesitan. Cómo configurarlos: `infrastructure/README.md`.

Resúmenes y horario de silencio (ST-161, DEC-045): `infrastructure/wrangler.jsonc` no declara ningún cron trigger, así
que no hay disparador programado. El correo que espera un resumen o el fin del horario de silencio queda en `mail_outbox`
como `scheduled` con `deliver_after`; `deliverScheduled` lo envía en el siguiente acceso (`GET /api/session` o
`GET /api/me/inbox`, con `waitUntil`, sin demorar la respuesta), como máximo cada 5 minutos por organización
(`mail_schedule_runs`), con el tope de DEC-042 (un resumen cuenta como un correo opcional; lo que no cabe espera al
siguiente acceso). Si en el futuro se agrega un cron gratuito de Workers, basta con llamar a `deliverScheduled` desde él.

El contrato de cada ruta está en `docs/api.md`; la arquitectura, los datos y la seguridad, en el Manual técnico
(`happy-learners-ops/docs/deliverables/manuals/technical-manual.md`).
