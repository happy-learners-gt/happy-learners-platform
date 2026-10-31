# Patrones y antipatrones

Hoja de ruta, carril C.2. Catálogo corto: qué patrón usar para cada problema, dónde ya se usa y qué errores se
encontraron con su corrección. Complementa `contextos.md`.

## Patrones

| Problema | Patrón | Dónde se usa |
| --- | --- | --- |
| Una regla de negocio con muchos casos | **Motor determinista en el dominio:** función pura que recibe datos y devuelve el resultado; la API solo lee y escribe | `timetable-solver.ts`, `pdf.ts`, `lesson-review.ts`, `progress-report.ts`, `report-templates.ts` |
| Usar un modelo de lenguaje | **IA como propuesta verificada:** la llamada pasa por `tracked()` (registro en `ai_runs`, sin textos), su salida se comprueba con una función del dominio (`checkedChanges`, `checkedSuggestions`, `solverRule`) y la persona acepta; en pruebas, un generador `fixture` determinista | `ai-assist.ts`, `timetables.ts`, `reports.ts` |
| Dos personas editan lo mismo | **Comparar y escribir:** columna `version`; `guardedBatch` aplica las escrituras solo si la condición sigue siendo cierta, en una transacción | cursos, lecciones, notas, ciclos, invitaciones, perfiles (19 módulos usan `guardedBatch`) |
| Separar los datos de cada organización | **Una base por organización:** Durable Object con SQLite elegido por la sesión | `storage.ts` |
| Cambiar el esquema | **Migraciones numeradas y aditivas**, cada una en su transacción; nunca se reescribe una aplicada | `database/migrations/` |
| Cambiar un `CHECK` en SQLite | **Reconstruir la tabla en orden seguro:** tablas nuevas, copiar filas, borrar dependientes antes que la referida, renombrar | 0072, 0073 |
| Un conteo que se lee en cada pantalla | **Contador mantenido por disparadores** en la fila que se lee, exacto en cualquier ruta de escritura | 0075 (asistencia por clase) |
| Trabajo largo (propuestas, mapas de libros) | **Alarmas del Durable Object:** cada despertar procesa un lote pequeño y programa el siguiente | `storage.ts` (`alarm`) |
| Respaldo verificable | **Copia canónica con huellas** por tabla; restaurar compara y revierte ante cualquier diferencia | `backup.ts` |
| Saber qué cuesta cada ruta | **Una línea estructurada por petición** con filas leídas | `telemetry.ts` |
| Que ninguna ruta quede sin sesión | **Prueba generada desde el código** de rutas | `tests/route-matrix.test.ts` |

## Antipatrones encontrados y su corrección

| Antipatrón | Qué pasó | Corrección |
| --- | --- | --- |
| Leer para contar en cada petición | Inicio y Secciones leían todas las marcas de asistencia (miles de filas) | Contador por clase (0075): −37 % a −68 % de lecturas |
| `OR` o `IS NULL` que desvían el índice | `l.group_id IS NULL` hacía que SQLite recorriera todas las lecciones | Unir desde la tabla selectiva (`CROSS JOIN` fija el orden); medir `rowsRead` antes y después |
| Agrupar toda la tabla para un máximo por grupo | La última actividad de cada curso agrupaba todos los eventos | Subconsulta por curso con `ORDER BY … DESC LIMIT 1` sobre su índice |
| Consultas en bucle (N+1) | Inicio de administración hace ~60 consultas (unidades y currículo por curso) | Pendiente: una consulta por tipo para todos los cursos |
| Lista de rutas con cuerpo en una expresión del enrutador | Acciones como `…/restore` no reciben cuerpo; se perdió un parámetro | Las acciones sin cuerpo llevan sus datos en la dirección; documentado en el enrutador |
| Columnas tomadas de la entrada | La restauración ponía nombres de la copia en el SQL (auditoría H1) | Validar contra el esquema; Semgrep `sql-interpolated-text` marca cada interpolación |
| Módulo que hace de todo | `team.ts` (bitácora + equipos + progreso), `classes.ts` | `team.ts` partido en 1.5.8 (`activity.ts`, `home.ts`); el resto en `contextos.md` §5 |
| Importar tipos de Workers desde código que usan las pruebas | La verificación de tipos de las pruebas fallaba (`ai-runs`, `telemetry`) | Los tipos compartidos viven en módulos sin dependencias de Workers |
| Pruebas que dependen de la fecha | «La primera fila es una clase» falla el día anterior a un asueto | Filtrar por lo que se prueba (`hasNotText: "Sin clase"`), usar `nextClassDays` |

## Cómo decidir

- ¿Es una regla? Al dominio, con prueba unitaria. ¿Es E/S? A la API.
- ¿Se lee en cada pantalla? Medir `rowsRead` con la línea de registro antes de optimizar; guardar el dato derivado
  solo si la medición lo justifica, y mantenerlo con disparadores.
- ¿Cambia un patrón de esta tabla? Registrar la decisión (DEC) antes de extenderlo.
