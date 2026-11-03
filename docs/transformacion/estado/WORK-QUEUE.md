# Cola de trabajo

Estados: BACKLOG · READY · IN_PROGRESS · BLOCKED · REVIEW · DONE · DEFERRED. Prioridad: P0 (fundamento que bloquea
otros) a P3. Se toma la `READY` de mayor prioridad cuyas dependencias estén `DONE`.

| Id | Carril | Tarea | Prio | Depende | Estado | Criterio de aceptación |
| --- | --- | --- | --- | --- | --- | --- |
| PRG-01 | Programa | Descubrimiento, línea base, auditoría, arquitectura de información y espacio del programa | P0 | — | DONE | `docs/transformacion/` completo; estado retomable |
| IA-01 | Navegación | Menú: cursos más relevantes (8) + «Todos los cursos (n)»; Administración en 4 grupos; Horas efectivas de administración en Personas | P0 | PRG-01 | DONE | Con 25 cursos el menú muestra 8 + enlace; el curso abierto siempre aparece; grupos con encabezado; Vitest y E2E de navegación verdes; capturas claro/oscuro, escritorio/móvil |
| IA-02 | Navegación | Migas coherentes con el menú en administración (TD-006) | P1 | IA-01 | DONE | Ninguna página de administración muestra un padre que el menú no tiene |
| IA-03 | Navegación | Agenda por rol: administración abre en la vista institucional | P1 | IA-01 | DONE | `admin-demo` abre `/agenda` con clases visibles; docentes sin cambios |
| AUD-02 | Auditoría | Vista docente, móvil y oscuro de todos los módulos; Biblioteca y Equipo en detalle; puntajes actualizados | P1 | PRG-01 | READY | Matriz sin «preliminar» |
| WF-01 | Flujos | Especificar 5 flujos críticos: incorporar educador, configurar ciclo, armar horario, registrar horas, emitir boleta | P1 | PRG-01 | DONE | Documento con persona, pasos, reglas, excepciones y fricciones medidas en la app |
| AI-01 | IA | Arquitectura de IA: inventario de capacidades actuales (`openai.ts`, `ai-runs.ts`, puertos del dominio), modelo de skills, permisos, evaluación; rediseño de «Uso de IA» | P1 | PRG-01 | DONE | `docs/transformacion/ia.md` basado en el código, con brechas priorizadas |
| AIG-1 | IA / Seguridad | Límite de uso en tareas de IA síncronas (H4) | P0 | AI-01 | DONE | 429 tras 60 por persona y hora; prueba en `proposals.test.ts` |
| AIG-2 | IA | Casos de evaluación en vivo (`npm run ai:eval`, manual) para write, improve, suggest y rules, con un texto hostil cada uno. Revisado el 02-nov: los validadores ya tienen pruebas contra salidas erróneas (`lesson-improve`, `field-suggestions`, `book-map`, `timetable-solver`, `ai-write`); falta comparar modelos y prompts | P2 | AI-01 | READY | Un archivo de casos por tarea; el informe en vivo compara modelos |
| AIG-4 | IA | Medir la aceptación de lo propuesto (aceptado/descartado por ejecución) | P1 | AI-01 | BACKLOG | Columna o evento sin texto; visible en Uso de IA |
| AIG-5 | IA / UX | «Uso de IA» → «Inteligencia artificial»: capacidades, dónde se usan, aceptación, costo | P1 | AIG-4 | BACKLOG | Puntaje del módulo ≥ 4.0 |
| HOME-01 | Inicio | Inicio por excepciones: cursos que necesitan atención primero, el resto plegado | P1 | IA-01 | DONE | Administración ve ≤ 8 tarjetas + «Ver todos»; KPIs de excepción con datos existentes; lecturas medidas sin aumento |
| HRS-02 | Operación | Horas: corrección en lote de las clases sin registro y total por contrato (lo que se paga) | P2 | HRS-01 | READY | API de corrección múltiple con un motivo; columna de contrato en el resumen por persona |
| PERF-02 | Rendimiento | `/api/hours` lee hasta 5 000 clases y filtra en memoria: llevar el periodo a la consulta (cuidado: el día se calcula en la zona de la persona) | P2 | — | READY | Lecturas medidas antes/después con respuestas idénticas |
| HRS-01 | Operación | Horas efectivas: periodo por defecto, agrupación por persona, corrección en lote, sin tabla de 60+ filas | P1 | IA-01, WF-01 | DONE | `docs/transformacion/flujos.md` F4: periodo = mes; resumen por persona con contrato; bandeja «por revisar» con corrección en lote; detalle bajo demanda |
| CAL-01 | Operación | Calendario institucional unificado (IA-06) | P2 | WF-01 | READY | — |
| SCH-01 | Operación | Horarios: horario vigente visible, conflictos, vistas por docente/aula | P2 | WF-01 | READY | — |
| PPL-01 | Personas | Incorporación de educadores de punta a punta; Revisión de perfiles en Educadores (IA-04) | P2 | WF-01 | READY | — |
| SEC-01 | Seguridad | R1 paso 1: nombre e inicial con el código de sección | P1 | AP-01 | DONE | `shortLearnerNames` con pruebas; E2E `pacing` |
| SEC-05 | Seguridad | R1 paso 2 (opcional): código personal por estudiante como ajuste de la sección | P3 | SEC-01 | BACKLOG | Diseño primero; tarjetas imprimibles |
| SEC-02 | Seguridad | Verificar que `/api/health` no lea el DO; documentar configuración del monitor (AP-03) | P2 | — | DONE | Prueba que lo garantiza; guía en `docs/operations/slo.md` |
| SEC-03 | Seguridad | Alcance del pentest externo (AP-05) | P2 | — | DONE | `docs/security/alcance-pentest.md` |
| SEC-04 | Seguridad | Escáneres obligatorios el 13-nov (AP-04) | P2 | AP-04 | READY (13-nov) | Protección de rama con los tres checks |
| HLP-01 | Ayuda | Ayuda contextual por página (IA-05) | P3 | AP-06 | BACKLOG | — |
