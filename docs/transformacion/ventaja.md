# Ventaja difícil de copiar (MOAT-01)

Plan en incrementos de lo que la auditoría (`auditoria.md` §6) llamó diferenciación: no tener más módulos, sino que
**los datos ya están conectados** (plan curricular ↔ lecciones ↔ secciones ↔ clases ↔ asistencia ↔ horas ↔ contratos ↔
documentos oficiales), por organización y con una IA que propone y nunca escribe sola. Son **hipótesis**: cada
incremento nuevo espera la prioridad de la Product Owner y se valida con el piloto escolar antes de ampliarse.

## Estado de las hipótesis de la auditoría (al 03-nov-2026)

| Hipótesis | Estado | Dónde |
| --- | --- | --- |
| Inicio institucional por excepciones | Hecho | HOME-01 (1.6.1): cursos que necesitan atención, con la razón |
| Horario + calendario + agenda como una sola operación | Hecho en su mayor parte | CAL-01/CAL-02, SCH-01/SCH-02, IA-03, AGE-01 |
| Incorporación de punta a punta (contrato → firma → asignación → horas → pago) | Hecho, el pago como referencia | PPL-01/02, CON-01, HRS-01 a HRS-04 (montos según contrato por AP-08) |
| IA como capacidades institucionales con aceptación medida | Hecho | AIG-1 a AIG-6: «Inteligencia artificial», propuestas usadas, presupuesto |

## Incrementos propuestos

Ordenados por valor para una institución sobre lo que ya existe; ninguno pide datos nuevos de estudiantes.

| Id | Incremento | Por qué es difícil de copiar | Depende de |
| --- | --- | --- | --- |
| MOAT-02 | **Cierre del periodo en un paso:** al aprobar el periodo de una sección, emitir en el mismo paso su boleta (que ya sale en un PDF por sección) y las constancias de los estudiantes que terminan (hoy, una por estudiante) | Une la aprobación de la libreta, el ciclo lectivo y las plantillas por programa, que ya existen y están conectados | Prioridad de la PO |
| MOAT-03 | **Preparar el ciclo siguiente asistido:** un recorrido que copia jornadas, reglas de asuetos, secciones y horario vigente al ciclo nuevo y señala lo que falta | Reúne calendario, horarios y secciones con sus choques | Prioridad de la PO |
| MOAT-04 | **Más paquetes curriculares oficiales** (otros grados y áreas del CNB), con su fuente y su validador | El valor está en los datos curados y versionados, no en el código | Fuentes oficiales y validación con docentes |
| MOAT-05 | **IA con evidencia medida:** casos de evaluación en vivo por tarea (AIG-2) y la tendencia de propuestas usadas por mes | La calidad se demuestra con datos de uso propios, sin guardar texto | Costo de llamadas en vivo (bajo; AP-07) |

## Cómo se decide

Cada incremento entra a la cola (`estado/WORK-QUEUE.md`) cuando la Product Owner lo prioriza, con su criterio de
aceptación y su medida de éxito en el piloto (por ejemplo, minutos de administración para cerrar un periodo). Mientras
tanto la cola sigue con la calidad de los módulos.
