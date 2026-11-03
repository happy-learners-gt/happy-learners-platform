# Estado actual

- **Fecha:** 02-nov-2026
- **Fase:** 3–4 · Hitos M0, M1, M3 hechos; M2 casi (falta AUD-02); M4 en curso (HRS-01 y CAL-01 hechos); M5 en curso
  (PPL-01 hecho)
- **Producción:** 1.6.3 (PR #106). En el día: 1.6.0 #103 `54fd626`, 1.6.1 #104 `126fb0b`, 1.6.2 #105 `216af3a`,
  1.6.3 #106. Cada uno con `verify`, `deploy` y `critical-flows` verdes en `main`.
- **Rama:** `feat/HL-15-siguiente` (desde `main`), solo este estado, sin push: se publica con el próximo PR.
- **Últimas verificaciones:** `./scripts/verify` verde (75 archivos, 521 pruebas); E2E afectadas con build limpia en
  escritorio y móvil en cada PR; CI verde en cada PR.
- **Autorización vigente (02-nov, del usuario):** «sigue adelante con el merge y también todo lo demás»: fusionar y
  desplegar los PR de cada hito con CI verde; aplicar las recomendaciones de la cola que no requieren cuentas ni gasto.
- **En curso:** nada a medias
- **Requieren al usuario:** AP-03 cuenta del monitor; AP-05 proveedor y presupuesto del pentest; AP-06 marca y empresa;
  AP-07 tope de IA por organización
- **Siguiente acción:** fusionar 1.6.6 (PERF-02 y el marcado de Semgrep que #108 dejó en rojo en `main`); luego
  AUD-02, PERF-03, HRS-02; el 13-nov, SEC-04
- **Incidente 03-nov:** #108 se fusionó con el escáner `code` (Semgrep) en rojo porque la automatización solo miraba
  `verify`. Corregido en 1.6.6; desde ahora se exige que todos los checks pasen.

| Carril | Estado |
| --- | --- |
| Navegación | M1 en producción (1.6.0) |
| Inicio | HOME-01 en producción (1.6.1) |
| Personas | PPL-01 (1.6.2) y PPL-02 (1.6.5, `f39db63`) en producción |
| Operación | HRS-01, CAL-01, SCH-01 en producción (1.6.4, `d1efeb6`); HRS-02 listo |
| IA | AI-01 y AIG-1 en producción; AIG-2 P2 |
| Seguridad | H4 y R1 en producción; SEC-02/03 hechos; SEC-04 el 13-nov |
| Rendimiento | Agenda −42/−72 % en producción; PERF-02 listo |
