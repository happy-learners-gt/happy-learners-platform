# Pruebas ST-043

Ejecuta `npm ci` y `./scripts/verify` con Node.js 24. Para repetir solo las pruebas tras un build: `npm test`.

- `app.test.tsx`: disponibilidad, SHA completo y fallos HTTP, de red y de respuesta.
- `build.test.ts`: inicia Wrangler local con el paquete construido; comprueba health, versión exacta, navegación a la API, HTML y assets, 404, 405 y HEAD. No utiliza recursos remotos.
- `delivery.test.ts`: comprueba los triggers, la dependencia obligatoria de verificación, ausencia de publicación en PRs, transferencia del artefacto y rechazo de SHA ajeno al checkout. Es una comprobación estática del workflow, no una ejecución del scheduler de GitHub.

El dry-run de Wrangler y estas pruebas son evidencia local. Quedan pendientes la ejecución en GitHub, la configuración de repository secrets y preflight manual de integración, el despliegue y la aceptación en workers.dev.
