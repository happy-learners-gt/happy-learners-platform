# Hitos

Un hito = un PR coherente. Se marca DONE solo con alcance implementado, pruebas y verificación pasadas, documentación al
día y limitaciones registradas. Fusionado a `main` ≠ resultado de producto logrado: se anota por separado.

| Hito | Objetivo | Entregables | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| M0 | Descubrimiento y sistema del programa | `docs/transformacion/` | DONE (31-oct) | Auditoría sobre la app en local; línea base `6651930` |
| M1 | Navegación que escala (Fase 2) | IA-01, IA-02, IA-03 | DONE · en producción 02-nov (`54fd626`) | verify 512/512; E2E locales de navegación, agenda, layout, axe, horarios, documentos e IA en escritorio y móvil; Agenda −42 % a −72 % de lecturas con respuestas idénticas |
| M2 | Flujos y arquitectura de IA especificados (Fase 1 restante) | AUD-02, WF-01, AI-01 | DONE (1.6.1 y 1.6.7) | `flujos.md`, `ia.md`, `auditoria.md` §7 |
| M3 | Inicio institucional por excepciones | HOME-01, HOME-02, HOME-03 | DONE (1.6.1, 1.6.18, 1.6.19) | `homeCourses` con pruebas; Inicio móvil 5 900 → 3 412 px |
| M4 | Operación: horas, calendario, horarios, agenda (Fase 3) | HRS-01–03, CAL-01, SCH-01, PERF-02–03 | DONE (1.6.1 a 1.6.12) | E2E institutional-calendar, timetables y hours; HRS-03 por AP-08 |
| M5 | Personas: incorporación de punta a punta (Fase 4) | PPL-01, PPL-02, IA-04, CON-01 | DONE (1.6.2, 1.6.5, 1.6.10) | E2E contracts, professional-profile |
| M6 | IA como plataforma (Fase 8) | AIG-1, AIG-3–6 | DONE salvo AIG-2 (1.6.1 a 1.6.16) | `ia.md`; `ai-budget.test.ts`; «Inteligencia artificial» 3.85 |
| M7 | Preparación empresarial (Fase 7/10) | SEC-01–07, monitor, pentest | En curso: SEC-01–03, 05–07 hechos; monitor operativo (AP-03); SEC-04 el 13-nov; pentest manual espera AP-05 | `docs/security/` |
| M8 | Segunda ola: módulos sin tocar (Fases 5–6) | AUD-03, CUR-01, ACC-01, DOC-02, NOT-01, LIB-01, TEAM-01 | DONE (1.6.20 a 1.6.26); siguen DOC-03 y LIB-02 | Cursos 4.20, Roles 4.00, Notificaciones 4.00, Equipo 4.05, Documentos 3.85, Biblioteca 3.85 |
| M9 | Tercera ola: módulos mejorados hasta la meta | HRS-04, AGE-01, ORG-01, CAL-02, ACA-02, CON-02, SCH-02, AIC-01 | BACKLOG | Puntaje ≥ 4.0–4.2 por módulo |
| M10 | Ayuda contextual y marca | HLP-01, BRAND-01 | BLOCKED (AP-06, nombre «Acervum» en discusión) | — |
| M11 | Ventaja difícil de copiar y observabilidad | MOAT-01, OBS-01 | BACKLOG | Plan de la ventaja; tablero de SLO desde `event=api` |

Lo hecho del 28-oct al 3-nov cuenta en SPR-004 del repositorio de operación (DEC-055 de `happy-learners-ops`); SPR-003
se cerró con fecha 27-oct (DEC-054). Un 1 de 18 módulos alcanza su meta al 03-nov: el programa no está completo.

## Fases del mandato → hitos

Fase 0 = M0 · Fase 1 = M0 + M2 · Fase 2 = M1 (y patrones compartidos dentro de cada hito) · Fase 3 = M4 ·
Fase 4 = M5 · Fases 5–6 (académico, documentos, ayuda) se planifican tras WF-01 · Fase 7 = M7 · Fase 8 = M6 ·
Fase 9 = M3 y sucesores · Fase 10 = cierre de cada hito + M7.
