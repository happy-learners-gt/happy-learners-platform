# Web

Interfaz utilizada por coordinación, autores, revisores e instructores. Consume contratos publicados por `packages/contracts` y no contiene reglas de dominio que deban reutilizar otros procesos.

React con Vite. `App.tsx` mantiene el marco de navegación; `Workspace.tsx` contiene biblioteca, currículo y edición. `navigation.tsx` conserva rutas, filtros e historial y protege las ediciones sin guardar. `style.css` define los colores y el diseño responsive.

ST-041 / HL-44 implementa la primera entrega del [rediseño aprobado](../../docs/redesign/README.md). Las rutas de aplicación se sirven con Workers Static Assets. La autorización sigue en la API; ocultar controles en la interfaz no la sustituye.

`npm run build:web` produce `apps/web/dist`; el build raíz lo incorpora al paquete verificado. El editor enriquecido, la revisión editorial y la coedición son las siguientes entregas, no funcionalidades simuladas.
