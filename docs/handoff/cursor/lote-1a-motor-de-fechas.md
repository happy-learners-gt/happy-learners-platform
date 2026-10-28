# Ficha para Cursor: lote 1a, motor de reglas de fechas (1.3.0-a)

Parte del plan `docs/handoff/2026-10-29-plan-v1.3.md`, lote 1. Este sublote es **solo dominio y pruebas**: sin
migración, sin API, sin UI. El lote 1b (esquema, API e interfaz) usará este motor.

## Objetivo

Una función pura que, dadas reglas de días festivos o eventos y un año, devuelva sus fechas concretas. Agnóstica al
país: ninguna regla de un país vive en el código del motor. Guatemala es solo una **plantilla de datos** de referencia.

## Archivos

- Nuevo `packages/domain/src/calendar-rules.ts`; exportar lo público desde `packages/domain/src/index.ts`.
- Tipos que cruzan la API en `packages/contracts/src/index.ts` (`DateRule`, `DateRuleOccurrence`).
- Nueva prueba `tests/calendar-rules.test.ts` (Vitest, sin Worker).
- No toques otros archivos.

## Modelo

```ts
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo, como `weekdays` en schedule.ts
type DateAnchor =
  | { kind: "fixed"; month: number; day: number }                          // 15 de septiembre
  | { kind: "nth-weekday"; month: number; weekday: Weekday; n: 1 | 2 | 3 | 4 | 5 | -1 } // -1 = último del mes
  | { kind: "easter"; offset: number }                                      // Viernes Santo = -2
  | { kind: "relative"; to: string; offset: number; weekday?: Weekday }     // id de otra regla; con weekday: el primero en o después
  | { kind: "once"; date: string };                                         // solo ese día (YYYY-MM-DD)
type Shift = {                                                              // traslado de fecha
  when: Weekday[];                       // días de la semana en que, si cae, se mueve (p. ej. [0, 6] o [2, 3, 4])
  to: "previous" | "next" | "nearest";   // hacia dónde
  onto: Weekday[];                       // a qué días se puede mover (p. ej. [1] o [1, 5])
};
type DateRule = {
  id: string; title: string; anchor: DateAnchor;
  days?: number;                 // duración en días, 1 por omisión (p. ej. 3 para un periodo)
  part?: "full" | "morning" | "afternoon"; // medio día
  shift?: Shift;
  fromYear?: number; untilYear?: number;   // vigencia
  exceptYears?: number[];                  // años en que no aplica
  onlyYear?: number;                       // regla de un solo año (no se copia al siguiente)
};
type DateRuleOccurrence = { ruleId: string; title: string; from: string; until: string; part: "full" | "morning" | "afternoon"; shiftedFrom: string | null };
```

## Funciones

- `easterSunday(year)`: algoritmo gregoriano anónimo (Meeus/Jones/Butcher). Años 1583 a 4099.
- `ruleInput(input: unknown): DateRule | { error: string }`: validación completa con mensajes en español informal
  (tú), como el resto del dominio (ver `scheduleInput` en `schedule.ts`). Rechaza meses y días imposibles
  (31 de abril), `n` fuera de rango, `relative` a sí misma, `shift` con `onto` vacío o que incluya un día de `when`.
- `occurrences(rules: DateRule[], year: number): DateRuleOccurrence[]`: ordena por fecha; resuelve `relative`
  (con detección de ciclos: error claro, no bucle); aplica vigencia, excepciones y `onlyYear`; aplica `shift`
  (`nearest` empata hacia adelante; documenta la decisión); un `nth-weekday` con `n: 5` que no existe ese mes no genera
  fecha. Sin dependencias, sin `Date` local: todo en UTC con cadenas `YYYY-MM-DD`.
- `nextYearRules(rules)`: las reglas para copiar al año siguiente (quita las de `onlyYear` y las vencidas).
- `ruleSummary(rule)`: texto legible en español, por ejemplo «Segundo jueves de noviembre», «Último viernes de
  mayo», «2 días antes de Pascua», «15 de septiembre; si cae sábado o domingo, el lunes siguiente».
- `guatemalaTemplate`: arreglo de `DateRule` con los asuetos de Guatemala como **datos de referencia**: Año Nuevo,
  Miércoles Santo (medio día, tarde), Jueves y Viernes Santo, Sábado de Gloria, Día del Trabajo, Día del Ejército
  (30 de junio), Independencia, Revolución (20 de octubre), Todos los Santos, Nochebuena (medio día), Navidad y fin de
  año (medio día). Sin traslados por omisión: la institución decide. Agrega un comentario que diga que la plantilla no
  afirma la ley vigente.

## Pruebas obligatorias (`tests/calendar-rules.test.ts`)

1. Pascua: 2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28, 2038-04-25 (la más tardía) y 2285-03-22 (la más
   temprana); Viernes Santo 2026 = 2026-04-03.
2. `nth-weekday`: segundo jueves de noviembre 2026 = 2026-11-12; último viernes de mayo 2026 = 2026-05-29; quinto
   lunes de febrero 2027 no existe.
3. `relative`: «el lunes siguiente a Pascua» y un ciclo de dos reglas que se refieren entre sí → error.
4. `shift`: 15 de septiembre de 2029 (sábado) con `when [6,0] → next onto [1]` = 2029-09-17; `nearest onto [1,5]`
   desde un miércoles va al viernes (o documenta el empate); con `shiftedFrom` correcto.
5. Vigencia, `exceptYears` y `onlyYear`; `nextYearRules` no copia la de un solo año.
6. `days` y `part`: Semana Santa como periodo de 3 días; medio día conservado.
7. Plantilla de Guatemala 2026 y 2027: fechas completas comparadas con una tabla escrita en la prueba.
8. `ruleInput`: un caso válido por tipo de ancla y al menos 8 rechazos con su mensaje.
9. `ruleSummary` para cada tipo de ancla.

## Definición de terminado

- `npx vitest run tests/calendar-rules.test.ts` y `npm run typecheck` en verde; luego `./scripts/verify` completo.
- Funciones puras, sin dependencias nuevas, comentarios en inglés como el resto del dominio y textos visibles en
  español informal.
- Ninguna prueba debilitada: sin aserciones que acepten varios resultados.
- Un solo commit en una rama `feat/HL-15-motor-de-fechas`, con mensaje `HL-15 ST-049: motor de reglas de fechas (lote 1a)`.
  No abras PR ni hagas push: Claude Code revisa y abre el PR.
