# Web

Interfaz utilizada por coordinación, autores, revisores e instructores. Consume contratos publicados por `packages/contracts` y no contiene reglas de dominio que deban reutilizar otros procesos.

React con Vite, sin bibliotecas de componentes. `App.tsx` resuelve la sesión y las rutas; `navigation.tsx` conserva historial y filtros en la URL y protege lo que no se puede guardar. `ui/` contiene las primitivas (AppShell con el menú en niveles, PageHeader, Breadcrumbs, PrimaryAction, EmptyState, StatusBadge, ResourceCard, CourseCard, LessonOutline, ConfirmDialog, Toast, Skeleton y Menu). `pages/` contiene una pantalla por ruta y `pages/course/` el espacio del curso. `model.ts` deriva estados y valida borradores antes del autosave. `style.css` define los tokens del sistema visual.

La arquitectura de información (navegación, rutas y estados) está en `docs/product/information-architecture.md` de `happy-learners-ops`; la guía visual, en [docs/design/fluent.md](../../docs/design/fluent.md). Las rutas de aplicación se sirven con Workers Static Assets. La autorización sigue en la API; ocultar controles en la interfaz no la sustituye.

`npm run build:web` produce `apps/web/dist`; el build raíz lo incorpora al paquete verificado. `node scripts/screenshots.mjs` captura las rutas principales en 1440, 1024 y 390 px para la revisión visual.
