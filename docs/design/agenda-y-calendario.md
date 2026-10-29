# Diseño de la agenda y el calendario institucional (1.3.4)

Rediseño de cómo se consultan las fechas (la agenda) y cómo se configuran (el calendario institucional). Reemplaza la
interfaz de 1.3.0 y la agenda de DEC-031. Fecha: 29 de octubre de 2026.

## Diagnóstico

1. **Dos pantallas que no se hablan.** La Agenda muestra un **patrón semanal** de horarios (sin fechas reales: no ve
   asuetos, clases canceladas ni movidas) y el Calendario muestra **eventos institucionales** sin las clases. Nadie ve
   en un solo lugar «qué pasa esta semana».
2. **Consulta y configuración mezcladas.** `/calendario` es a la vez la vista de todos y el editor de reglas,
   plantillas y generación del año; expone el modelo interno («Alcance»: calendario de organización, de programa, de
   sección) a quien solo quiere saber si mañana hay clase.
3. **No hay vistas de calendario.** El año es una lista por mes; no hay mes en cuadrícula, semana con horas, día, «hoy»
   ni navegación entre fechas.
4. **La Agenda se queda en listas.** Solo 8 próximas clases, una semana que es un patrón y tarjetas de secciones que
   repiten lo que ya está en el menú del curso.
5. **La demostración está vacía:** sin asuetos ni eventos, el calendario no enseña nada.

## Principios

- **Un solo lugar para consultar fechas: la Agenda**, separada del resto (como hoy, sin ruido), con fechas **reales**.
- **La configuración vive donde se administra:** Organización (calendario institucional) y Configuración académica
  (calendario de cada programa). Quien consulta nunca ve reglas ni alcances internos.
- **Todo lo que tiene fecha entra en la agenda:** clases, días sin clase, eventos institucionales, del programa y de la
  sección, y entregas de evaluaciones.
- **Del evento a la acción en un paso:** cada elemento abre un panel con su detalle y lo que se puede hacer.

## 1. Agenda (`/agenda`, la única entrada del menú para fechas; «Calendario» desaparece del menú)

```
Agenda                         [Hoy] [‹] [›]  27 oct – 2 nov 2026   [Día][Semana][Mes][Año]   ⋯ (Suscribirme)
Ver: [Mis clases ▾]  (administración y coordinación: Toda la organización · un programa · una sección)
Mostrar: [✓ Clases] [✓ Días sin clase] [✓ Eventos] [✓ Evaluaciones]

┌ lun 27 ──┬ mar 28 ──┬ mié 29 · hoy ┬ jue 30 ──┬ vie 31 ──┐  ┌ Hoy ─────────────────────────┐
│ ░ Asueto ░│          │              │          │          │  │ 10:00 3.º B · Matemáticas     │
│ 08:00     │ 10:00    │ 08:00 3.º A  │ 10:00    │ 10:30    │  │ [Abrir la clase]              │
│ 3.º A ✓   │ 3.º B    │ 10:30 6.º A  │ 3.º B    │ 6.º A    │  ├ Próximos días sin clase ──────┤
│ (cancel.) │          │ Entrega:     │          │          │  │ 2 nov · Día de los Santos     │
│           │          │ Ensayo 6.º A │          │          │  │ 20 nov · Revolución (traslad.)│
└───────────┴──────────┴──────────────┴──────────┴──────────┘  └───────────────────────────────┘
```

- **Semana** (por omisión en escritorio): columnas por día con franjas de hora; las clases en su hora real con su estado
  (planificada, en curso, impartida ✓, cancelada tachada, movida); los días sin clase sombreados de lado a lado con su
  nombre; los eventos de día completo arriba de cada columna; las entregas como marcas.
- **Día** (por omisión en móvil): lista cronológica del día con las mismas piezas.
- **Mes:** cuadrícula de 7 columnas con chips por día y «+3 más»; los días sin clase sombreados.
- **Año:** 12 meses compactos con los días con eventos marcados (la vista anual de 1.3.0, en limpio).
- **Panel lateral al elegir un elemento:** una clase (curso, sección, lecciones planificadas, asistencia, «Abrir la
  clase» o «Iniciar»), un evento (categoría, fechas, alcance en palabras —«Toda la organización», «Programa Primaria
  bilingüe»—, si mueve clases y cuántas), una entrega (actividad, sección, «Ir a calificar»).
- **Riel derecho en escritorio:** «Hoy» (la próxima clase con su acción principal) y «Próximos días sin clase».
- Las tarjetas de secciones salen de la agenda (ya están en el menú de cada curso). «Suscribirme» (el feed .ics de
  ST-125) pasa al menú de la página.
- La agenda recuerda la vista y el filtro elegidos (preferencias de la persona).

## 2. Organización › Calendario institucional (administración)

Página de configuración con tres bloques, sin vista de calendario propia (para ver, «Ver en la agenda»):

- **Asuetos y fechas recurrentes:** lista de reglas con su resumen en palabras y sus fechas del año elegido; «Agregar»
  abre el editor de reglas (panel lateral, con vista previa en vivo); «Usar plantilla» (Guatemala como referencia,
  otros países después).
- **Eventos de este año:** lista por categoría (admisiones, inscripciones, exámenes, actividades, competencias…) con
  agregar, editar, mover y saltar una ocurrencia generada.
- **Preparar el año siguiente:** el flujo «Generar 2027» con su vista previa (se crean, se actualizan, se conservan).

Los programas tienen la misma página reducida en **Configuración académica › programa › Calendario** (coordinación de
ese programa). Una sección agrega sus días sin clase desde su **Horario** (como hoy), sin ver el modelo interno.

## 3. Datos de demostración

Seed `0063_demo_calendar_events.sql` para org-demo (tolerante a lo que ya exista): la plantilla de Guatemala aplicada y
2026 generado, un periodo de exámenes del cuarto bimestre, admisiones e inscripciones 2027, una actividad
extracurricular y un acto de clausura; para que la agenda y la configuración enseñen algo en la demostración.

## 4. API

- `GET /api/agenda?from&until&scope=mine|organization|program:<id>|section:<id>`: una sola lista de elementos con fecha
  (`class`, `no-class`, `event`, `due`), cada uno con su enlace y sus acciones permitidas; respeta permisos (quien
  imparte ve sus secciones; administración y coordinación pueden ampliar el alcance).
- La configuración usa la API del calendario institucional de 1.3.0 sin cambios de forma.
