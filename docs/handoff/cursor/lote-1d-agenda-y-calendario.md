# Ficha para Cursor: lote 1d, agenda y calendario institucional rediseñados (1.3.4)

Rama nueva `feat/HL-15-agenda` desde `main` (con 1.3.3 integrado). **El diseño manda:** implementa exactamente
`docs/design/agenda-y-calendario.md`. Si algo no se puede hacer como está escrito, detente y explícalo en lugar de
improvisar otra interfaz. No reutilices clases CSS de otras pantallas; crea las tuyas con prefijo `agenda-`.

## Alcance

1. **API `GET /api/agenda`** (nuevo `apps/api/src/agenda.ts`): elementos con fecha de un rango (máximo 400 días) y un
   alcance (`mine` por omisión; `organization`, `program:<id>` y `section:<id>` para administración y coordinación en su
   alcance). Tipos: `class` (fecha y hora reales de `class_sessions`, estado, sección, curso, lecciones planificadas,
   enlace), `no-class` (eventos sin clase del calendario efectivo, con su origen en palabras), `event` (demás
   categorías) y `due` (actividades de evaluación con fecha de las secciones del alcance). Cada uno con las acciones
   permitidas a quien llama. Pruebas sobre el Worker: alcance, permisos, clase cancelada y movida, asueto que sombrea, entrega.
2. **Agenda** (`apps/web/src/pages/agenda/`, reemplaza `Agenda` de `SectionList.tsx`): vistas Día, Semana, Mes y Año;
   navegación (Hoy, anterior, siguiente, selector de fecha en el título); selector «Ver» (solo si la persona puede
   ampliar el alcance) y filtros «Mostrar»; panel lateral (`Drawer`) para cada tipo de elemento con sus acciones; riel
   «Hoy» y «Próximos días sin clase» en escritorio; Día por omisión en móvil y Semana en escritorio; la vista y los
   filtros se recuerdan en las preferencias de la persona; «Suscribirme» en el menú de la página (reutiliza
   `CalendarSync` en un diálogo). Las tarjetas de secciones salen de la agenda.
3. **Calendario institucional como configuración:** `Organización › Calendario institucional` (`/organizacion/calendario`)
   con los tres bloques del diseño, reutilizando el editor de reglas, la plantilla y la generación del año de 1.3.0 (en
   paneles laterales, no en la página principal); `Configuración académica › programa › Calendario` con la misma página
   para el programa. **«Calendario» sale del menú principal**; `/calendario` redirige a `/agenda?vista=año`
   (y `?programa=` a la configuración del programa para quien la administra).
4. **Seed `0063_demo_calendar_events.sql`** con generador en `scripts/seed/` (como `calendar.mjs`): solo org-demo y
   tolerante a lo existente; plantilla de Guatemala aplicada y 2026 generado, exámenes del cuarto bimestre, admisiones e
   inscripciones 2027, una actividad extracurricular y la clausura; con prueba en `tests/seed.test.ts`.
5. **Ayuda y `docs/api.md`.**

## Pruebas

- `tests/app.test.tsx`: navegación de la semana, cambio de vista, filtro que oculta un tipo, panel de una clase con «Abrir
  la clase», asueto sombreado, la vista recordada.
- E2E nueva `tests/e2e/agenda.spec.ts` (escritorio y móvil): la semana con una clase, un asueto y una entrega; abrir la
  clase desde el panel; configurar un asueto en Organización y verlo en la agenda con la clase movida.
- Las E2E existentes que usan `/calendario` o la agenda se actualizan **solo en la navegación**; sus aserciones de
  negocio no cambian. `/agenda` y `/organizacion/calendario` en `accessibility.spec.ts` y `layout.spec.ts`.

## Definición de terminado

`./scripts/verify` completo sin servidores sobrantes; E2E nuevas y afectadas en escritorio y móvil; **capturas** en 1440
y 390 de la agenda en Semana, Mes y Día, el panel de una clase y la página de configuración, en
`.release-evidence/screenshots/lote-1d/`; versión 1.3.4 y `CHANGELOG.md`; un commit
`HL-15 ST-049: agenda y calendario institucional rediseñados (lote 1d)`, sin push ni PR.
