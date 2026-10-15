# Pruebas de producto

Ejecuta `npm ci` y `./scripts/verify` con Node.js 24. Para repetir solo las pruebas tras un build: `npm test`.

- `app.test.tsx`: disponibilidad, SHA completo y fallos HTTP, de red y de respuesta.
- `build.test.ts`: inicia Wrangler local con el paquete construido; comprueba health, versión exacta, navegación a la API, HTML y assets, 404, 405 y HEAD. No utiliza recursos remotos.
- `calendar-feed.test.ts`: ST-125. Valida el iCalendar (estructura, CRLF, plegado a 75 octetos, escapes, UTC), cancelaciones y reprogramaciones, y con Wrangler local que el enlace solo trae las clases de quien lo pidió, que regenerarlo invalida el anterior, que una cuenta desactivada recibe 404 y que el respaldo no lo copia.
- `delivery.test.ts`: comprueba los triggers, la dependencia obligatoria de verificación, ausencia de publicación en PRs, transferencia del artefacto y rechazo de SHA ajeno al checkout. Es una comprobación estática del workflow, no una ejecución del scheduler de GitHub.

`npm run test:e2e` inicia un servidor local con una base nueva por ejecución y recorre la aplicación en escritorio y móvil: `ux-flows` (login → curso → contenido, unidad y lección, autosave y publicación, estudiante, sección y asistencia, navegación móvil y ausencia de contaminación), `timetable` (horario de una sección, clases generadas, lecciones en orden y cobertura impartida), `session-filters` (historial de clases por sección y periodo, combinados y con el acceso del equipo del curso), `studio` (coedición, lecciones antiguas, documentos Office, sesión expirada, archivo), `admin`, `api`, `calendar-feed` (enlace de calendario desde la Agenda) y `accessibility` (axe WCAG 2.2 A/AA y teclado). Todo lo que crean empieza por `E2E ·`. Las pruebas reutilizan una sesión por cuenta para no agotar el límite de 30 inicios de sesión diarios. No admite `BASE_URL`: nunca debe escribir sobre la demo pública.

`npm run test:smoke` comprueba navegación, inicio/cierre de sesión y lectura de contenido. Admite `BASE_URL` para verificar producción. Bloquea escrituras de contenido y finalizaciones; solo permite las operaciones de sesión. La política se prueba en `target-policy.test.ts` y su selección en CI se verifica en `delivery.test.ts`.

Las capturas y resultados se escriben en `.release-evidence/`. El dry-run y los E2E locales no son evidencia de un despliegue. El workflow verifica cada PR; después de integrar, despliega el mismo artefacto y ejecuta el smoke de producción.
