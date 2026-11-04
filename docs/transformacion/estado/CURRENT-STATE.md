# Estado actual

- **Fecha:** 03-nov-2026
- **Fase:** 3–4 · Hitos M0, M1, M3 hechos; M2 casi (falta AUD-02); M4 en curso (HRS-01 y CAL-01 hechos); M5 en curso
  (PPL-01 hecho)
- **Producción:** 1.6.26 (`d48d064`, PR #125, M8). SPR-004 cerró con la release v1.6.20 (`95f2ac3`, PR #123). Del 02 al 03-nov: #103–#125 (1.6.0–1.6.26), cada uno con todos los checks
  del PR, `verify`, `deploy` y `critical-flows` verdes en `main` (salvo #108, ver incidente). Escaneo completo de
  seguridad en `main` el 03-nov: verde.
- **Rama:** `feat/HL-15-horarios-tabs` con M9 en curso (AUD-04; 1.6.27 HRS-04, 1.6.28 SCH-02, 1.6.29 CAL-02).
  **Sprints (ops):** SPR-003 cerrado 27-oct, SPR-004 cerrado 3-nov; lo de desde el 4-nov cuenta en SPR-005 (DEC-056).
- **Últimas verificaciones:** `./scripts/verify` verde (77 archivos, 523 pruebas); E2E afectadas con build limpia en
  escritorio y móvil en cada PR; CI verde en cada PR.
- **Autorización vigente (02-nov, del usuario):** «sigue adelante con el merge y también todo lo demás»: fusionar y
  desplegar los PR de cada hito con CI verde; aplicar las recomendaciones de la cola que no requieren cuentas ni gasto.
- **En curso:** nada a medias
- **Requieren al usuario:** AP-05 pentest manual de pago (SEC-06 gratuito en curso); AP-06 marca
  («Acervum» en discusión); AP-07 y AP-08 decididos el 03-nov
- **Siguiente acción:** M8 hecho salvo DOC-03 y LIB-02; M9 según `auditoria.md` §9: AGE-01, CON-02, AIC-01, ACA-02 (ORG-01 espera AP-06); el 13-nov SEC-04. El programa
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
