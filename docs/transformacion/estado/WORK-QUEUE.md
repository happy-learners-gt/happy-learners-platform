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
| WF-01 | Flujos | Especificar 5 flujos críticos: incorporar educador, configurar ciclo, armar horario, registrar horas, emitir boleta | P1 | PRG-01 | READY | Documento con persona, pasos, reglas, excepciones y fricciones medidas en la app |
| AI-01 | IA | Arquitectura de IA: inventario de capacidades actuales (`openai.ts`, `ai-runs.ts`, puertos del dominio), modelo de skills, permisos, evaluación; rediseño de «Uso de IA» | P1 | PRG-01 | READY | `docs/transformacion/ia.md` basado en el código, con brechas priorizadas |
| HOME-01 | Inicio | Inicio por excepciones: cursos que necesitan atención primero, el resto plegado | P1 | IA-01 | BACKLOG | Administración ve ≤ 8 tarjetas + «Ver todos»; KPIs de excepción con datos existentes; lecturas medidas sin aumento |
| HRS-01 | Operación | Horas efectivas: periodo por defecto, agrupación por persona, corrección en lote, sin tabla de 60+ filas | P1 | IA-01, WF-01 | BACKLOG | Ver WF-01 |
| CAL-01 | Operación | Calendario institucional unificado (IA-06) | P2 | WF-01 | BACKLOG | — |
| SCH-01 | Operación | Horarios: horario vigente visible, conflictos, vistas por docente/aula | P2 | WF-01 | BACKLOG | — |
| PPL-01 | Personas | Incorporación de educadores de punta a punta; Revisión de perfiles en Educadores (IA-04) | P2 | WF-01 | BACKLOG | — |
| SEC-01 | Seguridad | R1 según AP-01 | P1 | AP-01 | BLOCKED | — |
| SEC-02 | Seguridad | Verificar que `/api/health` no lea el DO; documentar configuración del monitor (AP-03) | P2 | — | READY | Prueba que lo garantiza; guía en `docs/operations/slo.md` |
| SEC-03 | Seguridad | Alcance del pentest externo (AP-05) | P2 | — | READY | `docs/security/alcance-pentest.md` |
| SEC-04 | Seguridad | Escáneres obligatorios el 13-nov (AP-04) | P2 | AP-04 | BLOCKED | Protección de rama con los tres checks |
| HLP-01 | Ayuda | Ayuda contextual por página (IA-05) | P3 | AP-06 | BACKLOG | — |
