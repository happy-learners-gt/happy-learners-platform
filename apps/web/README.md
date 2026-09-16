# Web

Interfaz utilizada por coordinación, autores, revisores e instructores. Consume contratos publicados por `packages/contracts` y no contiene reglas de dominio que deban reutilizar otros procesos.

ST-043: React con Vite. La página consulta `/api/health` y `/api/version`, muestra disponibilidad y el SHA completo, o un mensaje de error. `npm run build:web` produce `apps/web/dist`; el build raíz lo incorpora al paquete de Workers Static Assets.
