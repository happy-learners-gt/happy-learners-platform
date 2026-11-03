# Calendario institucional unificado (CAL-01)

Programa de transformación, flujo F2 (`docs/transformacion/flujos.md`). Extiende `agenda-y-calendario.md` §2 sin
cambiar sus principios: la configuración vive donde se administra y **se consulta en la Agenda** (esta página sigue
sin vista de calendario propia).

## Problema

Preparar el año pide tres lugares: Organización (ciclo lectivo, jornadas y un resumen de asuetos), Calendario
institucional (reglas y eventos) y la Agenda. Dentro del calendario, cada asueto aparece dos veces: como regla y como
evento del año, cada uno con sus propias acciones.

## Decisión

**Calendario institucional** reúne todo lo que tiene que ver con el año, en el orden en que se prepara:

1. **Año** (selector arriba de la página; vale para todos los bloques).
2. **Ciclo lectivo y periodos** (viene de Organización, sin cambios).
3. **Jornadas y periodos de clase** (viene de Organización, sin cambios).
4. **Asuetos y fechas recurrentes:** cada regla con **su fecha en el año elegido** tal como quedó guardada (con
   «movida» u «omitida» si se cambió), y en su menú las acciones de esa ocurrencia («Mover esta ocurrencia»,
   «Saltar/Restaurar esta ocurrencia») además de editar la regla. Si el año aún no se generó, la fecha calculada con
   «se crea al generar el año».
5. **Otros eventos del año:** solo los que no salen de una regla (feria de ciencias, exámenes, actos).
6. **Preparar el año siguiente** (sin cambios).

Los bloques 2 y 3 son de la organización: el calendario de un programa (Configuración académica › programa ›
Calendario) no los muestra.

**Organización** queda en identidad, región y respaldo, con una tarjeta «Calendario institucional» que dice qué
contiene (ciclo, jornadas, asuetos y eventos) y enlaza allí.

## Compatibilidad

`/organizacion` y `/organizacion/calendario` no cambian de dirección. Las rutas de la API no cambian. Las pruebas que
buscaban el ciclo o las jornadas en Organización pasan a buscarlos en el calendario (cambio por diseño).
