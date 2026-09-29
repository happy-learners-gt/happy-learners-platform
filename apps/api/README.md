# API

Punto de composición del backend. Orquesta casos de uso, autorización, persistencia e integraciones sin trasladar dependencias técnicas al paquete de dominio.

ST-043: Worker TypeScript con `GET`/`HEAD /api/health` (`{"status":"ok"}`) y `/api/version` (`{"sha":"<SHA completo>"}`). Las respuestas no se cachean. Las rutas API inexistentes responden 404 y los métodos no permitidos 405. Wrangler genera los tipos desde `infrastructure/wrangler.jsonc`; el build genera el módulo de versión, que no se versiona.
## Producto v0.2.0

El Worker expone el catálogo y las lecciones de demostración. `AppState` es el
único almacenamiento persistente y se crea con la migración `v1` de Wrangler.
El acceso de educador usa una sesión HttpOnly; la actividad del estudiante solo
incrementa un contador agregado. El código de demostración es `san-gaspar` y no
debe usarse como autenticación de producción.

Rutas principales: `POST /api/login`, `GET /api/state`, `POST /api/resource`,
`POST /api/lesson`, `POST /api/lesson/:id/publish` y
`POST /api/lesson/:id/complete`.
