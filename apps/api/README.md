# API

Punto de composición del backend. Orquesta casos de uso, autorización, persistencia e integraciones sin trasladar
dependencias técnicas al paquete de dominio.

El Worker atiende solo `/api/*`; las páginas se sirven como activos estáticos. `GET`/`HEAD /api/health` responde
`{"status":"ok"}` y `/api/version` el SHA desplegado. Las respuestas de la API no se cachean, las rutas inexistentes
responden 404, los métodos no permitidos 405 y las rutas heredadas retiradas 410.

| Módulo | Responsabilidad |
| --- | --- |
| `index.ts` | Enrutamiento, cabeceras de seguridad, sesiones y límite de intentos de acceso. |
| `auth.ts`, `access.ts`, `roles.ts`, `team.ts` | Sesiones, permisos por organización, curso y sección, roles y equipo. |
| `courses.ts`, `content.ts`, `prerequisites.ts`, `duplicate.ts` | Programas, cursos, plan curricular, módulos, lecciones y requisitos. |
| `collaboration.ts`, `collaboration-awareness.ts`, `rich-text.ts` | Coedición en vivo de las lecciones mediante un Durable Object por lección. |
| `files.ts` | Archivos privados de cada curso en R2. |
| `sections.ts`, `classes.ts`, `attendance.ts`, `workgroups.ts`, `conflicts.ts` | Secciones, horario, clases, asistencia, grupos de trabajo y choques de horario. |
| `backup.ts` | Respaldo y restauración de cada organización. |
| `calendar-feed.ts` | Enlace de suscripción al calendario de clases (iCalendar) de cada educador. |
| `storage.ts` | Almacenamiento SQLite de cada organización en su Durable Object. |

El contrato de cada ruta está en `docs/api.md`; la arquitectura, los datos y la seguridad, en el Manual técnico
(`happy-learners-ops/docs/deliverables/manuals/technical-manual.md`).
