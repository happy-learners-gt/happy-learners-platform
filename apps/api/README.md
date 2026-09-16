# API

Punto de composición del backend. Orquesta casos de uso, autorización, persistencia e integraciones sin trasladar dependencias técnicas al paquete de dominio.

ST-043: Worker TypeScript con `GET`/`HEAD /api/health` (`{"status":"ok"}`) y `/api/version` (`{"sha":"<SHA completo>"}`). Las respuestas no se cachean. Las rutas API inexistentes responden 404 y los métodos no permitidos 405. Wrangler genera los tipos desde `infrastructure/wrangler.jsonc`; el build genera el módulo de versión, que no se versiona.
