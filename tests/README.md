# Pruebas de producto

Ejecuta `npm ci` y `./scripts/verify` con Node.js 24. Para repetir solo las pruebas tras un build: `npm test`.

- `app.test.tsx`: disponibilidad, SHA completo y fallos HTTP, de red y de respuesta.
- `build.test.ts`: inicia Wrangler local con el paquete construido; comprueba health, versión exacta, navegación a la API, HTML y assets, 404, 405 y HEAD. No utiliza recursos remotos.
- `accounts.test.ts`: reglas de las cuentas del equipo y, sobre Wrangler local con una base nueva, los criterios de ST-093 (HL-137): alta con contraseña temporal y cambio obligatorio, cuenta desactivada que conserva su historial y restablecimiento registrado en la actividad.
- `delivery.test.ts`: comprueba los triggers, la dependencia obligatoria de verificación, ausencia de publicación en PRs, transferencia del artefacto y rechazo de SHA ajeno al checkout. Es una comprobación estática del workflow, no una ejecución del scheduler de GitHub.

`npm run test:e2e` inicia un servidor local con una base nueva por ejecución y recorre la aplicación en escritorio y móvil: `ux-flows` (login → curso → contenido, unidad y lección, autosave y publicación, estudiante, sección y asistencia, navegación móvil y ausencia de contaminación), `timetable` (horario de una sección, clases generadas, lecciones en orden y cobertura impartida), `studio` (coedición, lecciones antiguas, documentos Office, sesión expirada, archivo), `admin`, `accounts` (alta de una cuenta, primer acceso con cambio de contraseña, restablecimiento y desactivación), `api` y `accessibility` (axe WCAG 2.2 A/AA y teclado). Todo lo que crean empieza por `E2E ·`. Las pruebas reutilizan una sesión por cuenta para no agotar el límite de 30 inicios de sesión diarios. No admite `BASE_URL`: nunca debe escribir sobre la demo pública.

`npm run test:smoke` comprueba navegación, inicio/cierre de sesión y lectura de contenido. Admite `BASE_URL` para verificar producción. Bloquea escrituras de contenido y finalizaciones; solo permite las operaciones de sesión. La política se prueba en `target-policy.test.ts` y su selección en CI se verifica en `delivery.test.ts`.

Las capturas y resultados se escriben en `.release-evidence/`. El dry-run y los E2E locales no son evidencia de un despliegue. El workflow verifica cada PR; después de integrar, despliega el mismo artefacto y ejecuta el smoke de producción.
