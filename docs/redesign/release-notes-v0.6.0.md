# v0.6.0 · Fluent Design

HL-44 · ST-041 · REL-003. Rediseño visual completo con Fluent 2 de Microsoft. No cambian la API ni los datos.

## Qué cambia

- **Base oficial.**
  - Los 459 tokens de `@fluentui/tokens` (tema web claro) con la marca violeta Happy Learners (#5b45e0, contraste 6,2:1 sobre blanco) se generan en `apps/web/src/fluent/tokens.css`.
  - `theme.css` traduce los tokens de la app a tokens Fluent, así que ningún componente usa valores literales.
  - Iconos: Fluent System Icons.
- **Los cinco principios:**
  - **Luz:** brillo bajo el puntero en superficies interactivas y foco de Fluent (contorno oscuro con anillo claro).
  - **Profundidad:** la rampa de sombras de Fluent según la jerarquía.
  - **Movimiento:** curvas de Fluent (entrar desacelera, salir acelera), sin rebotes, y se apaga con movimiento reducido.
  - **Material:** acrílico en la barra superior, los menús, el cajón y el inicio de sesión; mica en la capa base.
  - **Escala:** Segoe UI Variable, la rampa tipográfica, la cuadrícula de 4 px y controles táctiles de 44 px.
- **Componentes:**
  - Barra superior y panel de navegación con indicador de selección e icono relleno.
  - Tarjetas, paneles y mosaicos.
  - Botones principal, secundario, sutil y peligro.
  - Campos con subrayado de marca.
  - Menús, toasts y diálogos.
  - Insignias, progreso y pestañas segmentadas.
  - Estados vacíos.
- **Guía de estilo viva** en `/guia-de-estilo`, enlazada desde Ayuda, y **guía para módulos nuevos** en `docs/design/fluent.md`.

## Decisión técnica

No se usa `@fluentui/react-components`. Los componentes existentes ya cumplen WAI-ARIA (diálogo nativo, menús con teclado, regiones de estado) y leen solo tokens. Adoptar los tokens y los iconos oficiales da la apariencia de Fluent sin agregar un motor CSS-in-JS ni reescribir cada pantalla. El tema oscuro y el de alto contraste quedan preparados: basta generarlos desde el mismo script.

## Validación

- `tests/fluent.test.ts` comprueba que los tokens no se desvían del paquete, que cada token semántico apunta a uno de Fluent y que los componentes no tienen colores literales.
- Suite E2E completa en escritorio y móvil, con axe WCAG 2.2 A/AA en todas las rutas (incluida la guía de estilo) y el detector de CSP.
- Revisión visual de inicio, curso, contenido con menú, editor, diálogo, reproductor del estudiante y guía de estilo.
