# Flujos institucionales críticos (WF-01)

Recorridos de punta a punta tal como están en 1.6.0, trazados en el código de la web (`apps/web/src/pages`) y en la app
local con los datos de demostración. «Páginas» cuenta lugares distintos que la persona tiene que conocer. Cada flujo
termina con su fricción y la oportunidad que alimenta la cola.

## F1 · Incorporar a un educador

- **Persona:** administración. **Objetivo:** que alguien nuevo imparta sus secciones con contrato firmado.
- **Precondiciones:** plantilla de contrato publicada; cursos y secciones creados.

| # | Paso | Quién | Dónde |
| --- | --- | --- | --- |
| 1 | Invitar por correo o crear la cuenta | Administración | Educadores |
| 2 | Aceptar la invitación, contraseña, términos, bienvenida y perfil | Educador | Enlace de invitación → asistente |
| 3 | Aprobar el perfil y verificar credenciales | Administración | Revisión de perfiles |
| 4 | Crear el contrato desde una plantilla | Administración | Contratos y políticas › Contratos (la pestaña «Contratos» de Educadores **salta a otra página**) |
| 5 | Firmar el contrato | Educador | Mi cuenta › Contratos |
| 6 | Sumarlo al equipo de cada curso | Administración | Curso › Configuración › Equipo docente (**una vez por curso**) |
| 7 | Asignarlo a cada sección | Administración | Curso › Secciones › sección (**una vez por sección**) |
| 8 | Horas | Automático | Al iniciar y finalizar cada clase |

- **Reglas:** el educador de una sección sale del equipo del curso; el contrato vigente se ve en Educadores; la
  disponibilidad declarada en el perfil limita el horario (DEC-047).
- **Excepciones:** contrato que empieza después (estado «Firmado, empieza después»), vencido, pendiente de firma;
  credencial rechazada; cuenta sin incorporación completa.
- **Fricción:** 5 páginas de administración y 2N pasos para N cursos; nadie ve en un lugar «qué le falta a esta
  persona». La fila de Educadores ya muestra contrato e incorporación, pero sin acciones (solo perfil, contraseña y
  salida).
- **Oportunidad (PPL-01):** en el detalle de la persona, una lista de incorporación con acción en cada paso: aprobar
  perfil, crear contrato con la persona ya elegida, asignar cursos y secciones en un solo diálogo. Revisión de perfiles
  se vuelve la bandeja de esa lista (IA-04).

## F2 · Configurar el ciclo lectivo

- **Persona:** administración. **Objetivo:** que el año tenga periodos, jornadas y asuetos antes de armar horarios.

| # | Paso | Dónde |
| --- | --- | --- |
| 1 | Crear el ciclo y sus periodos; activarlo (cerrar el vigente antes) | Organización › Ciclo lectivo |
| 2 | Marcar las vacaciones entre periodos sin clase | Organización › «Marcar las vacaciones sin clase» |
| 3 | Definir jornadas y periodos de clase | Organización › Jornadas |
| 4 | Generar asuetos y eventos del año a partir de las reglas | Calendario institucional › «Generar 2027» |
| 5 | Revisar el año en la agenda | Agenda › Año |

- **Fricción:** 3 páginas para un mismo concepto (el calendario del año); los asuetos aparecen tres veces (reglas,
  eventos del año y resumen en Organización); «Generar 2027» no sabe del ciclo 2027 en borrador.
- **Oportunidad (CAL-01, IA-06):** un solo «Calendario institucional» con el año como vista principal y, al costado,
  ciclo y periodos, jornadas y reglas de asuetos; un asistente «Preparar el año siguiente» que copia ciclo, jornadas y
  asuetos en un paso. Candidato a tarea compuesta de IA (TD-007).

## F3 · Armar el horario

- **Persona:** administración o coordinación. **Precondiciones:** F2, secciones con educadores (F1.7), aulas.

| # | Paso | Dónde |
| --- | --- | --- |
| 1 | Elegir jornada y secciones; clases y periodos por semana | Horarios |
| 2 | Registrar aulas y reglas (en palabras, interpretadas por la IA y confirmadas) | Horarios |
| 3 | Generar; revisar la propuesta; aplicar a las secciones | Horarios |
| 4 | Ver el resultado | Agenda (o cada sección › Horario) |

- **Fricción:** Horarios no muestra el horario vigente: al volver, la página parece vacía; los conflictos se ven por
  sección, no en conjunto; no hay vista por docente ni por aula.
- **Oportunidad (SCH-01):** abrir en el horario vigente (cuadrícula por sección, docente o aula) con «Regenerar»
  como acción secundaria; conflictos en un panel.

## F4 · Registrar y revisar horas efectivas

- **Personas:** educador (registra), administración (revisa y corrige). **Base:** contrato por clase o mensual.

| # | Paso | Quién | Dónde |
| --- | --- | --- | --- |
| 1 | Iniciar la clase; asistencia; finalizar con lo cubierto | Educador | Sección › Cronograma › clase |
| 2 | Ver sus horas | Educador | Mis horas |
| 3 | Revisar, corregir con motivo y exportar CSV | Administración | Horas efectivas |

- **Fricción:** sin periodo por defecto, la página carga todas las clases (60 filas en la demo); una clase sin inicio
  suma 0 y se corrige de a una; el resumen no se cruza con el contrato (lo que se paga).
- **Oportunidad (HRS-01):** periodo = mes en curso; resumen por persona con su contrato y total a pagar; las clases
  «por revisar» como bandeja con corrección en lote; el detalle por clase bajo demanda.

## F5 · Emitir la boleta

- **Personas:** administración (plantilla), educador (notas y comentarios), coordinación (revisión).

| # | Paso | Dónde |
| --- | --- | --- |
| 1 | Diseñar y publicar la plantilla (opcional: sin ella sale el formato de siempre) | Organización › Documentos |
| 2 | Plan de evaluación, punteos y comentarios por periodo | Sección › Notas |
| 3 | Entregar a revisión; coordinación aprueba o devuelve | Sección › Notas |
| 4 | Descargar las boletas de la sección o de un estudiante | Sección › Notas |

- **Fricción:** baja; el flujo vive en Notas. Documentos se llama igual que «Documentos por vencer» (credenciales) y
  convive con plantillas de contrato en otra página.
- **Oportunidad:** renombrar a «Documentos oficiales» cuando se toque (cambio de nombre, va solo en su incremento).

## Resumen

| Flujo | Páginas de administración | Pasos repetidos | Prioridad |
| --- | --- | --- | --- |
| F1 Incorporar educador | 5 | 2 por curso | Alta (PPL-01) |
| F2 Configurar ciclo | 3 | — | Alta (CAL-01) |
| F3 Armar horario | 1 (+ agenda) | — | Media (SCH-01) |
| F4 Horas efectivas | 1 | 1 por clase sin registro | Alta (HRS-01) |
| F5 Boleta | 2 | — | Baja |
