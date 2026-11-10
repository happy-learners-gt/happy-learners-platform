# Estado actual

- **Fecha:** 10-nov-2026
- **Fase:** 3–4 · Hitos M0, M1, M3 hechos; M2 casi (falta AUD-02); M4 en curso (HRS-01 y CAL-01 hechos); M5 en curso
  (PPL-01 hecho)
- **Producción:** 1.7.5 (`b39b004`, PR #133) el 04-nov; antes 1.7.0–1.7.3 (#129–#132, REL-007) y 1.6.x. Todos con los checks del PR, `verify`, `deploy` y `critical-flows` verdes; desde 1.7.3 el despliegue exige los escáneres de seguridad del PR.
- **Rama:** `main` (sin trabajo pendiente fuera de `main`).
  **Sprints (ops):** SPR-003 cerrado 27-oct y aceptado; SPR-004 cerrado el 10-nov y aceptado (DEC-057, DEC-060; ops #146; release v1.7.5 de cierre) con todo su objetivo de seguridad: 10 historias de REL-007 más ST-184 a ST-189 (DEC-058, ops #144).
- **Últimas verificaciones:** `./scripts/verify` verde (77 archivos, 523 pruebas); E2E afectadas con build limpia en
  escritorio y móvil en cada PR; CI verde en cada PR.
- **Autorización vigente (02-nov, del usuario):** «sigue adelante con el merge y también todo lo demás»: fusionar y
  desplegar los PR de cada hito con CI verde; aplicar las recomendaciones de la cola que no requieren cuentas ni gasto.
- **En curso:** quinta ola M12 (13 de 18 módulos en su meta); SPR-005 desde el 11-nov
- **Requieren al usuario:** AP-05 pentest manual de pago (SEC-06 gratuito en curso); AP-06 marca
  («Acervum» en discusión); AP-07 y AP-08 decididos el 03-nov; AP-09 lectura de Workers Observability (OBS-01)
- **Siguiente acción:** M8 hecho salvo DOC-03 y LIB-02; M9 hecho salvo ORG-01 (espera AP-06); M11: MOAT-01 hecho (`ventaja.md`), OBS-01 espera AP-09 (MOAT-01, OBS-01); el 13-nov SEC-04. El programa
  no está completo: 1 de 18 módulos en su meta (ver MILESTONES)
- **Incidente 03-nov:** #108 se fusionó con el escáner `code` (Semgrep) en rojo porque la automatización solo miraba
  `verify`. Corregido en 1.6.6 (#109, todos los checks verdes);
  desde ahora la fusión automática exige que todos los checks pasen.

| Carril | Estado |
| --- | --- |
| Navegación | M1 en producción (1.6.0) |
| Inicio | HOME-01 en producción (1.6.1) |
| Personas | PPL-01 (1.6.2) y PPL-02 (1.6.5, `f39db63`) en producción |
| Operación | HRS-01, CAL-01, SCH-01 en producción (1.6.4, `d1efeb6`); HRS-02 listo |
| IA | AI-01 y AIG-1 en producción; AIG-2 P2 |
| Seguridad | H4 y R1 en producción; SEC-02/03 hechos; SEC-04 el 13-nov |
| Rendimiento | Agenda −42/−72 % y Horas −46/−51 % en producción; PERF-03 listo |
