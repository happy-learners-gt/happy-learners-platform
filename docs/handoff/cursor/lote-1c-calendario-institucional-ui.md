# Ficha para Cursor: lote 1c, calendario institucional (interfaz)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 1. Usa la API del lote 1b (`docs/api.md`, sección del
calendario institucional) y el motor del lote 1a (`ruleSummary`, `occurrences`). Rama `feat/HL-15-motor-de-fechas`.
Sigue `docs/design/fluent.md` (puntos 1 a 9): `PageHeader` con una acción principal, `ui/primitives`, `Menu`, `Modal`,
ancho completo, rejillas y nada de `max-width` en contenedores.

## Pantallas

1. **Página «Calendario» (`/calendario`)** en el menú principal, debajo de Agenda. Todas las personas leen; quien
   puede escribir (administración; coordinación en sus programas) ve las acciones.
   - **Vista del año** por meses (rejilla de 12 meses en escritorio, lista por mes en móvil) con los eventos del
     calendario efectivo, coloreados por categoría (familias de tono existentes, sin colores literales) y con un filtro
     por categoría y por nivel (organización, programa, sección). Selector de año y de alcance (`?programa=`,
     `?seccion=`), que usa `GET /api/calendars/view`.
   - **Evento** (diálogo): categoría, título, fechas, día completo o medio día, «sin clase» (por omisión de la
     categoría). Al guardar uno sin clase, el aviso dice cuántas clases pendientes se movieron.
   - **Reglas** (panel lateral o pestaña): lista con `ruleSummary`; editor con el tipo de fecha (fija, n-ésimo día de la
     semana, último, relativo a Pascua, relativo a otra regla, fecha única), duración, medio día, traslado (cuándo,
     hacia dónde, a qué días), vigencia, excepciones y «solo este año»; **vista previa en vivo** de las fechas de ese año
     con `occurrences`.
   - **Plantilla de Guatemala** (acción del menú): agrega las reglas que falten; aviso de que no afirma la ley.
   - **Generar el año** (acción principal cuando hay reglas sin eventos en el año): diálogo con la vista previa
     (`?preview=1`) agrupada en «se crean», «se actualizan» y «se conservan (movidos o saltados a mano)», y confirmar.
   - Una ocurrencia generada se puede **mover** o **saltar** desde su menú ⋯ sin tocar la regla.
2. **Organización:** el panel «Días sin clase» se reemplaza por un resumen del calendario (próximos eventos sin clase y
   enlace a `/calendario`). **Ciclo lectivo:** al crear un ciclo se elige «De la organización» o un programa.
3. **Configuración académica › programa:** «Calendario del programa» abre `/calendario?programa=…`.
4. **Horario de la sección:** el panel «Días sin clase» muestra el calendario efectivo de la sección (de qué nivel viene
   cada evento) y agrega eventos de la sección; el editor ofrece **«Seguir un periodo»** (selector con los periodos del
   ciclo vigente que corresponde a su programa u organización) que fija `from`/`until` y envía `periodId`.

## Pruebas

- `tests/app.test.tsx`: la vista previa del editor de reglas muestra «Segundo jueves de noviembre» y la fecha
  2026-11-12; el diálogo «Generar el año» envía la confirmación tras la vista previa; el selector «Seguir un periodo»
  envía `periodId`. Las pruebas existentes de Días sin clase se adaptan solo si cambia su texto, sin aflojar aserciones.
- `tests/e2e/accessibility.spec.ts` y `tests/e2e/layout.spec.ts`: agrega `/calendario`.
- Prueba E2E nueva `tests/e2e/institutional-calendar.spec.ts` (escritorio y móvil): aplicar la plantilla, generar el año,
  saltar una ocurrencia y crear un evento de programa.

## Definición de terminado

`./scripts/verify` completo; las E2E nuevas y las de `calendar.spec.ts`, `accessibility.spec.ts` y `layout.spec.ts` en
escritorio y móvil; capturas de `/calendario` en escritorio (1440) y móvil (390) adjuntas en la conversación; ayuda
(`Help.tsx`) y `docs/api.md` al día; versión **1.3.0** en `package.json`/`package-lock.json` y entrada en `CHANGELOG.md`;
un commit `HL-15 ST-049: calendario institucional, interfaz (lote 1c)`, sin push ni PR.
