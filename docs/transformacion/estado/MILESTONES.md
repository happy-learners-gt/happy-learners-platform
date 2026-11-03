# Hitos

Un hito = un PR coherente. Se marca DONE solo con alcance implementado, pruebas y verificación pasadas, documentación al
día y limitaciones registradas. Fusionado a `main` ≠ resultado de producto logrado: se anota por separado.

| Hito | Objetivo | Entregables | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| M0 | Descubrimiento y sistema del programa | `docs/transformacion/` | DONE (31-oct) | Auditoría sobre la app en local; línea base `6651930` |
| M1 | Navegación que escala (Fase 2) | IA-01, IA-02, IA-03 | DONE · en producción 02-nov (`54fd626`) | verify 512/512; E2E locales de navegación, agenda, layout, axe, horarios, documentos e IA en escritorio y móvil; Agenda −42 % a −72 % de lecturas con respuestas idénticas |
| M2 | Flujos y arquitectura de IA especificados (Fase 1 restante) | AUD-02, WF-01, AI-01 | WF-01, AI-01 (+ AIG-1, H4) hechos en rama 1.6.1; AUD-02 pendiente | `flujos.md`, `ia.md`, prueba del límite de IA |
| M3 | Inicio institucional por excepciones | HOME-01 | DONE · en producción 02-nov (1.6.1, `126fb0b`) | `homeCourses` con pruebas; E2E team sin depender de fechas; 25 → 6 tarjetas |
| M4 | Operación: horas, calendario, horarios, agenda (Fase 3) | HRS-01, CAL-01, SCH-01 | BACKLOG | — |
| M5 | Personas: incorporación de punta a punta (Fase 4) | PPL-01, PPL-02 | PPL-01 en PR (1.6.2); PPL-02 listo | E2E PPL-01 en contracts.spec con axe |
| M6 | IA como plataforma (Fase 8) | según AI-01 | BACKLOG | — |
| M7 | Preparación empresarial (Fase 7/10) | SEC-01…04, pentest | BLOCKED en parte (AP-01, AP-03–05) | — |

## Fases del mandato → hitos

Fase 0 = M0 · Fase 1 = M0 + M2 · Fase 2 = M1 (y patrones compartidos dentro de cada hito) · Fase 3 = M4 ·
Fase 4 = M5 · Fases 5–6 (académico, documentos, ayuda) se planifican tras WF-01 · Fase 7 = M7 · Fase 8 = M6 ·
Fase 9 = M3 y sucesores · Fase 10 = cierre de cada hito + M7.
