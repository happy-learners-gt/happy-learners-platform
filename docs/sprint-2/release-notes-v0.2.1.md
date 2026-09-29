# v0.2.1 · Preparar y compartir una clase

La corrección completa el flujo de Sprint 2. La versión v0.2.0 y su tag permanecen intactos.

## Funciones disponibles

- Administrador y Educador tienen permisos distintos en pantallas y API. Los cambios de permisos revocan las sesiones y quedan registrados.
- El currículo se organiza en niveles, unidades y lecciones. Niveles y unidades se crean, editan, ordenan y archivan.
- Los recursos admiten texto o enlace, metadatos, búsqueda, filtros, edición y archivo.
- Las lecciones guardan borradores separados de la última versión pública. Republicar incrementa la revisión y conserva el enlace.
- Las actividades admiten texto, recurso vinculado y pregunta de selección única. Se editan, retiran y ordenan con botones.
- Los materiales publicados quedan conservados aunque el recurso original se edite o archive.
- El estudiante accede sin cuenta y puede finalizar la lección. El educador ve el conteo agregado.

## Datos de muestra

Beginner → Greetings → Greetings and Introductions. Incluye tres recursos, instrucciones, un recurso vinculado y una pregunta. Todo el contenido es ficticio.

## Calidad

La entrega se verifica con pruebas de permisos, aislamiento, migración, edición, publicación, enlaces, orden y persistencia, además de recorridos de escritorio y móvil. Los resultados de CI y la comprobación de producción acompañan la [release](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.2.1).

## Límites

La demostración es compartida. No hay cuentas de estudiantes, expedientes de niños, carga de archivos binarios ni currículos múltiples. El conteo de finalizaciones no identifica personas. Grupos y asignaciones corresponden al siguiente sprint.
