# Fluent Design en Happy Learners

La interfaz sigue [Fluent 2](https://fluent2.microsoft.design/), el sistema de diseño de Microsoft. Esta guía explica cómo está construido y cómo aplicarlo en módulos nuevos. La referencia viva está en la aplicación, en **Ayuda › Guía de estilo** (`/guia-de-estilo`): cada principio y componente se muestra con los componentes y tokens reales.

## Arquitectura en tres capas

| Capa | Archivo | Contenido | Regla |
|---|---|---|---|
| 1. Tokens Fluent | `apps/web/src/fluent/tokens.css` | Los 459 tokens oficiales de `@fluentui/tokens` (tema web claro) con la rampa de marca violeta (`--brand-10` … `--brand-160`, marca = 80, `#5b45e0`). | Generado por `scripts/fluent-tokens.mjs`. No se edita a mano. |
| 2. Tokens semánticos | `apps/web/src/theme.css` | Lo que significa cada valor en la app: `--color-surface`, `--color-primary`, `--shadow-flyout`, `--ease-enter`, familias de tono (`--teal-ink`, `--teal-soft`…), acrílico y mica. | Cada token apunta a un token Fluent. |
| 3. Componentes | `apps/web/src/style.css` y `apps/web/src/ui/*` | Recetas Fluent de botón, campo, menú, diálogo, toast, tarjeta, panel y navegación. | Solo leen tokens semánticos; nunca un color, radio, sombra o curva literal. |

Las pruebas (`tests/fluent.test.ts`) fallan si:

- `tokens.css` no coincide con lo que genera el paquete instalado;
- un token semántico apunta a un token Fluent que no existe;
- `style.css` contiene un color literal fuera de los permitidos (blanco o negro sobre superficies de marca o de video).

Iconos: **Fluent System Icons** (`@fluentui/react-icons`) a través de `ui/icons.tsx`. Se usan con `<Icon name="…"/>`, y con `filled` en el elemento seleccionado.

No se usa `@fluentui/react-components`. Los componentes propios ya cumplen WAI-ARIA (diálogo nativo, menú con teclado, anuncios de estado), así que adoptar los tokens y los iconos oficiales da la misma apariencia sin un motor CSS-in-JS ni reescribir cada pantalla.

## Los cinco principios y cómo se aplican

- **Luz.**
  - Las superficies interactivas (tarjetas, paneles, mosaicos) se iluminan bajo el puntero: `fluent/light.ts` y la clase `.lit` para superficies nuevas. No actúa en pantallas táctiles ni con movimiento reducido.
  - El foco es el de Fluent: contorno de 2 px `--color-focus` con anillo interior claro.
- **Profundidad.** Rampa de sombras oficial:

| Token | Sombra | Uso |
|---|---|---|
| `--shadow-xs` | 2 | dentro de otra superficie |
| `--shadow-sm` | 4 | tarjetas y paneles en reposo |
| `--shadow-md` | 8 | hover y formularios en línea |
| `--shadow-flyout` | 16 | menús y toasts |
| `--shadow-lg` | 28 | cajón |
| `--shadow-dialog` | 64 | diálogos |

  Más elevación significa más arriba en la jerarquía; no uses sombra para decorar.
- **Movimiento.**
  - Duraciones `--motion-fast` (100 ms), `--motion-base` (200 ms) y `--motion-slow` (300 ms).
  - Curvas: lo que aparece usa `--ease-enter` (desacelera), lo que se va usa `--ease-exit` (acelera) y los cambios de estado usan `--ease`.
  - Desplazamientos cortos (4 a 12 px), sin rebotes.
  - Con `prefers-reduced-motion` todo se apaga, también el desplazamiento programático del editor.
- **Material.**
  - **Acrílico** (`--acrylic-background`, `--acrylic-background-strong`, `--acrylic-filter`, `--acrylic-stroke`): solo para lo que se superpone al contenido, como la barra superior, los menús, el cajón y la tarjeta de inicio de sesión.
  - **Mica** (`--mica`): la capa base de la ventana.
  - Sin soporte de desenfoque, con `prefers-reduced-transparency` o en colores forzados, el acrílico se vuelve sólido.
- **Escala.**
  - Rampa tipográfica de Fluent: `--text-xs` 12, `--text-sm` y `--text-base` 14, `--text-md` 16, `--text-lg` 20, `--text-xl` 24, `--text-2xl` 28 y `--text-3xl` 32.
  - Segoe UI Variable con la fuente del sistema como respaldo.
  - Cuadrícula de 4 px y esquinas de 4 px en controles, 8 px en tarjetas y diálogos, y 12 px en superficies grandes.
  - Controles de 36 px, que pasan a 44 px en pantallas táctiles (`pointer: coarse`).

## Crear un módulo nuevo

1. **Estructura:** `PageHeader` (migas, título, una sola acción principal), después `Section`/`.panel` para cada bloque. El contenido empieza junto al menú lateral; no agregues márgenes propios.
2. **Componentes:** usa los de `ui/primitives.tsx`: `PrimaryAction` (una por pantalla), `Button` (`secondary`, `ghost`, `danger`), `Field`, `StatusBadge`, `EmptyState`, `Progress` y `StatTiles`. Además, `Menu` para acciones contextuales y `Modal` o `useFeedback().confirm` para diálogos y confirmaciones.
3. **Color:** pide significado, no colores. Estado con `StatusBadge tone`; categoría con una familia de tono (`className="tone-teal"`), cuyos hijos leen `--tone-ink`, `--tone-soft`, `--tone-solid` y `--tone-vivid`. `--tone-vivid` es solo decoración, nunca texto.
4. **CSS nuevo:** agrégalo a `style.css` en una sección con comentario y usa solo tokens semánticos. Si falta un token, créalo en `theme.css` apuntando a un token Fluent; si Fluent no lo tiene, derívalo de uno que sí exista (como los tintes `color-mix(… 10%, white)` de las paletas sin fondo claro) y explícalo en un comentario.
5. **Elevación y movimiento:** elige la sombra por jerarquía y anima solo entradas, salidas y cambios de estado con las curvas indicadas.
6. **Accesibilidad:** contraste de texto ≥ 4,5:1, foco visible, nombres accesibles en controles con solo icono, tamaño táctil ≥ 44 px en `pointer: coarse` y orden de tabulación lógico. Agrega la ruta a `tests/e2e/accessibility.spec.ts` para que axe la revise con WCAG 2.2 A/AA.
7. **Revisa en la guía:** si el módulo introduce un patrón nuevo, agrégalo a `pages/StyleGuide.tsx`.

## Ejemplos

```tsx
// Encabezado con acción principal, panel con tono y estados
<PageHeader title="Evaluaciones" description="Lo que se comprueba en cada unidad." primary={<PrimaryAction icon="plus">Nueva evaluación</PrimaryAction>}/>
<Section title="Pendientes">
  <ul className="link-list">…</ul>
</Section>
<div className="panel tone-teal lit">…</div>
<StatusBadge tone="success">Publicada</StatusBadge>
```

```css
/* Una superficie emergente nueva: acrílico, sombra de flyout, entrada con desaceleración */
.quick-panel { border: 1px solid var(--acrylic-stroke); border-radius: var(--radius-lg); background: var(--acrylic-background-strong);
  -webkit-backdrop-filter: var(--acrylic-filter); backdrop-filter: var(--acrylic-filter); box-shadow: var(--shadow-flyout);
  animation: flyout-in var(--motion-base) var(--ease-enter); }
```

## Actualizar Fluent

1. `npm install -w @happy-learners/web @fluentui/tokens@latest @fluentui/react-icons@latest`
2. `node scripts/fluent-tokens.mjs`
3. `./scripts/verify` y las pruebas E2E. Si un token cambió de nombre, la prueba de tokens semánticos lo señala.

El tema oscuro y el de alto contraste se agregan generando `webDarkTheme` o `createDarkTheme(brand)` en el mismo script, dentro de `@media (prefers-color-scheme: dark)`. Los componentes no cambian, porque solo leen tokens.
