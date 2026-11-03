# Cola de trabajo

Estados: BACKLOG · READY · IN_PROGRESS · BLOCKED · REVIEW · DONE · DEFERRED. Prioridad: P0 (fundamento que bloquea
otros) a P3. Se toma la `READY` de mayor prioridad cuyas dependencias estén `DONE`.

| Id | Carril | Tarea | Prio | Depende | Estado | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- | --- |
| PRG-01 | Programa | Descubrimiento, línea base, auditoría, arquitectura de información y espacio del programa | P0 | — | DONE | `docs/transformacion/` completo; estado retomable |
| IA-01 | Navegación | Menú: cursos más relevantes (8) + «Todos los cursos (n)»; Administración en 4 grupos; Horas efectivas de administración en Personas | P0 | PRG-01 | DONE | Con 25 cursos el menú muestra 8 + enlace; el curso abierto siempre aparece; grupos con encabezado; Vitest y E2E de navegación verdes; capturas claro/oscuro, escritorio/móvil |
| IA-02 | Navegación | Migas coherentes con el menú en administración (TD-006) | P1 | IA-01 | DONE | Ninguna página de administración muestra un padre que el menú no tiene |
| IA-03 | Navegación | Agenda por rol: administración abre en la vista institucional | P1 | IA-01 | DONE | `admin-demo` abre `/agenda` con clases visibles; docentes sin cambios |
| AUD-02 | Auditoría | Vista docente, móvil y oscuro; puntajes tras 1.6.x | P1 | PRG-01 | DONE | `auditoria.md` §7; contraste en oscuro corregido (A2-1) con prueba |
| IA-04 | Navegación | Revisión de perfiles como pestaña de Educadores; `/perfiles` redirige; el menú pierde una entrada | P2 | IA-01 | DONE | E2E `professional-profile` (redirección y conteo en la pestaña) |
| HOME-02 | Inicio | Inicio del docente en móvil (~5 900 px): plegar bloques secundarios | P3 | — | BACKLOG | Alto en móvil ≤ 3 500 px sin perder información |
| WF-01 | Flujos | Especificar 5 flujos críticos: incorporar educador, configurar ciclo, armar horario, registrar horas, emitir boleta | P1 | PRG-01 | DONE | Documento con persona, pasos, reglas, excepciones y fricciones medidas en la app |
| AI-01 | IA | Arquitectura de IA: inventario de capacidades actuales (`openai.ts`, `ai-runs.ts`, puertos del dominio), modelo de skills, permisos, evaluación; rediseño de «Uso de IA» | P1 | PRG-01 | DONE | `docs/transformacion/ia.md` basado en el código, con brechas priorizadas |
| AIG-1 | IA / Seguridad | Límite de uso en tareas de IA síncronas (H4) | P0 | AI-01 | DONE | 429 tras 60 por persona y hora; prueba en `proposals.test.ts` |
| AIG-2 | IA | Casos de evaluación en vivo (`npm run ai:eval`, manual) para write, improve, suggest y rules, con un texto hostil cada uno. Revisado el 02-nov: los validadores ya tienen pruebas contra salidas erróneas (`lesson-improve`, `field-suggestions`, `book-map`, `timetable-solver`, `ai-write`); falta comparar modelos y prompts | P2 | AI-01 | READY | Un archivo de casos por tarea; el informe en vivo compara modelos |
| AIG-4 | IA | Medir la aceptación de lo propuesto (aceptado/descartado por ejecución) | P1 | AI-01 | DONE | 0076 con conteos sin texto (TD-009); «Propuestas usadas» en Uso de IA; pruebas en `proposals.test.ts`, `ai-usage.test.ts`, E2E `ai-assist` |
| AIG-4b | IA | Aceptación de las propuestas de lecciones (publicada o archivada sin publicar) y del mapa al plan (confirmado) | P2 | AIG-4 | BACKLOG | Derivada de datos existentes, sin escrituras nuevas |
| AIG-5 | IA / UX | «Uso de IA» → «Inteligencia artificial»: capacidades, dónde se usan, aceptación, costo | P1 | AIG-4 | DONE | Puntaje del módulo ≥ 4.0 |
| HOME-01 | Inicio | Inicio por excepciones: cursos que necesitan atención primero, el resto plegado | P1 | IA-01 | DONE | Administración ve ≤ 8 tarjetas + «Ver todos»; KPIs de excepción con datos existentes; lecturas medidas sin aumento |
| HRS-02 | Operación | Horas: corrección en lote de las clases sin registro y total por contrato (lo que se paga) | P2 | HRS-01 | READY | API de corrección múltiple con un motivo; columna de contrato en el resumen por persona |
| PERF-02 | Rendimiento | `/api/hours`: el periodo en la consulta (superconjunto con un día de margen) | P2 | — | DONE | 30 días: −51 % admin, −46 % docente, respuestas idénticas. Queda: el recorrido base de `class_sessions` (~290 filas en la demo) necesitaría un índice nuevo (migración); y el tope de 5 000 clases en «Todo el historial» (PERF-03) |
| PERF-03 | Rendimiento | «Todo el historial» de horas lee como máximo 5 000 clases: que nunca sume en silencio solo una parte | P2 | PERF-02 | DONE | 1.6.10: el informe marca `truncated` y la página lo avisa; la exportación pide un periodo. Sin prueba automática del caso (5 001 clases finalizadas) |
| PERF-04 | Rendimiento | Horas con paginación y totales en el servidor (el informe ya no manda todas las filas) | P3 | PERF-03 | BACKLOG | Antes de que una institución pase de ~5 000 clases finalizadas (~1 año con 50 secciones) |
| HRS-01 | Operación | Horas efectivas: periodo por defecto, agrupación por persona, corrección en lote, sin tabla de 60+ filas | P1 | IA-01, WF-01 | DONE | `docs/transformacion/flujos.md` F4: periodo = mes; resumen por persona con contrato; bandeja «por revisar» con corrección en lote; detalle bajo demanda |
| CAL-01 | Operación | Calendario institucional unificado (IA-06): ciclo, jornadas, asuetos y eventos en una página; cada asueto una vez | P2 | WF-01 | DONE | `docs/design/calendario-unificado.md`; E2E institutional-calendar sin duplicados |
| SCH-01 | Operación | Horarios: horario vigente por día, filtro por docente o aula, choques; generador debajo | P2 | WF-01 | DONE | `timetableConflicts` con pruebas; E2E timetables |
| PPL-01 | Personas | Incorporación de educadores de punta a punta; Revisión de perfiles en Educadores (IA-04) | P2 | WF-01 | DONE | — |
| PPL-02 | Personas | Agregar a un curso desde la incorporación (las secciones siguen en el curso por los choques de horario) | P2 | PPL-01 | DONE | Diálogo con curso y rol; E2E en contracts.spec |
| QA-02 | Calidad | Pruebas de horario con fechas fijas vencieron el 03-nov (`academic-years`, `availability`) | P1 | — | DONE | Parten del lunes siguiente a hoy |
| QA-01 | Calidad | `profiles.test.ts` CA3 fallaba bajo carga: la actividad desempataba por `id` (aleatorio) entre eventos del mismo milisegundo | P3 | — | DONE | `ORDER BY occurred_at DESC, rowid DESC` en `team.ts`; 3 corridas en paralelo sin fallo |
| SEC-01 | Seguridad | R1 paso 1: nombre e inicial con el código de sección | P1 | AP-01 | DONE | `shortLearnerNames` con pruebas; E2E `pacing` |
| SEC-05 | Seguridad | R1 paso 2 (opcional): código personal por estudiante como ajuste de la sección | P3 | SEC-01 | BACKLOG | Diseño primero; tarjetas imprimibles |
| SEC-02 | Seguridad | Verificar que `/api/health` no lea el DO; documentar configuración del monitor (AP-03) | P2 | — | DONE | Prueba que lo garantiza; guía en `docs/operations/slo.md` |
| SEC-03 | Seguridad | Alcance del pentest externo (AP-05) | P2 | — | DONE | `docs/security/alcance-pentest.md` |
| SEC-04 | Seguridad | Escáneres obligatorios el 13-nov (AP-04) | P2 | AP-04 | READY (13-nov) | Protección de rama con los tres checks |
| DOC-01 | Documentos | Empezar una plantilla en un paso desde el formato de siempre de cada documento | P2 | — | DONE | Estado vacío con un botón por tipo; `documents-start.test.tsx` |
| HLP-01 | Ayuda | Ayuda contextual por página (IA-05) | P3 | AP-06 | BACKLOG | — |
