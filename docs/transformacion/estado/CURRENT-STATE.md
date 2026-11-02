# Estado actual

- **Fecha:** 02-nov-2026
- **Fase:** 1–2 · **Hito:** M1 en revisión (PR 1.6.0); siguiente M2 (flujos y arquitectura de IA)
- **Avance global:** M0 hecho; M1 implementado y verificado, espera AP-02 (fusionar/desplegar); M2 listo
- **Producción:** `6651930` (1.5.9, PR #102)
- **Rama:** `feat/HL-15-transformacion` (desde `origin/main`), con PR abierto (ver `gh pr list`)
- **Últimas verificaciones (02-nov):** `./scripts/verify` verde (72 archivos, 512 pruebas); E2E locales verdes en
  escritorio y móvil: ux-flows, admin, smoke, layout, accessibility (axe), hours, access, agenda, calendar,
  calendar-feed, institutional-calendar, ai-harness, documents, timetables. CI del PR: ver el PR.
- **En curso:** nada a medias
- **Bloqueos:** AP-02 (despliegue de M1), AP-01 (R1), AP-03 (monitor), AP-04 (13-nov), AP-05 (pentest), AP-06 (marca)
- **Siguiente acción:** M2 → WF-01 (flujos críticos) y AI-01 (arquitectura de IA) en una rama apilada sobre esta

| Carril | Estado |
| --- | --- |
| Navegación | IA-01, IA-02, IA-03 hechos (PR 1.6.0) |
| Auditoría y flujos | Línea base hecha; AUD-02 y WF-01 listos |
| IA | AI-01 listo |
| Seguridad | SEC-02/03 listos; SEC-01/04 bloqueados por aprobación |
| Rendimiento | Agenda −42 % a −72 % de lecturas (1.6.0) |
