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
| `legal.ts` | Términos y política de privacidad versionados, aceptaciones y consentimiento (ST-126, ST-127). |
| `backup.ts` | Respaldo y restauración de cada organización. |
| `invitations.ts`, `mail.ts` | Invitaciones por correo (ST-121) y adaptadores del puerto de envío: Brevo por HTTP y envío deshabilitado (DEC-042). |
| `calendar-feed.ts` | Enlace de suscripción al calendario de clases (iCalendar) de cada educador. |
| `departures.ts` | Salida de una persona del equipo: reasignación de sus cursos y secciones, fin del acceso y registro (ST-123). |
| `profiles.ts` | Perfil de cada persona (ST-149) y expediente laboral con documentos privados en R2 y vencimientos (ST-150). |
| `storage.ts` | Almacenamiento SQLite de cada organización en su Durable Object. |

El correo transaccional usa el puerto `MailSender` del dominio. Con el secreto `BREVO_API_KEY` y la variable
`MAIL_FROM` (dirección verificada como remitente en Brevo) se usa `BrevoMailSender`; sin ellos, `DisabledMailSender` deja
cada mensaje en `mail_outbox` como `not_configured` y administración comparte el enlace. Ambos son opcionales: el
desarrollo local, las pruebas y el dry-run no los necesitan. Cómo configurarlos: `infrastructure/README.md`.

El contrato de cada ruta está en `docs/api.md`; la arquitectura, los datos y la seguridad, en el Manual técnico
(`happy-learners-ops/docs/deliverables/manuals/technical-manual.md`).
