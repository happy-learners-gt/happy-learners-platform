# Estado actual

- **Fecha:** 02-nov-2026
- **Fase:** 1–3 · **Hitos:** M1 en revisión (PR #103, 1.6.0); M2 casi completo en `feat/HL-15-flujos-e-ia` (1.6.1)
- **Producción:** `6651930` (1.5.9, PR #102)
- **Ramas:**
  - `feat/HL-15-transformacion` → PR #103 (M1). Corregido en `2a12450` el fallo de CI (`notifications.spec.ts`: la
    etiqueta «Personas» del menú chocaba con `getByLabel("Persona")`). CI relanzado.
  - `feat/HL-15-flujos-e-ia` (apilada; integra #103), sin push: AI-01, AIG-1 (H4), WF-01, HRS-01.
- **Últimas verificaciones (02-nov):** `./scripts/verify` verde en ambas ramas (514 pruebas en la apilada; un fallo
  intermitente por carga en `section-freedom-api`, corregido con 60 s); E2E locales de horas, IA, documentos, horarios,
  avisos, ux-flows, admin, layout y axe.
- **En curso:** nada a medias
- **Bloqueos:** AP-02 (fusionar #103), AP-01 (R1), AP-03 (monitor), AP-04 (13-nov), AP-05 (pentest), AP-06 (marca), AP-07
- **Siguiente acción:** vigilar CI de #103; seguir la cola (HOME-01, AIG-2, PPL-01, AUD-02)

| Carril | Estado |
| --- | --- |
| Navegación | M1 hecho (PR #103) |
| Flujos | WF-01 hecho (`flujos.md`) |
| Operación | HRS-01 hecho; HRS-02, CAL-01, SCH-01 listos |
| IA | AI-01 y AIG-1 hechos; AIG-2 listo |
| Seguridad | H4 corregido; SEC-02/03 listos; SEC-01/04 bloqueados |
| Rendimiento | Agenda −42/−72 %; PERF-02 (horas) listo |
