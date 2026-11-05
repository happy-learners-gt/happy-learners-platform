# Siguiente sesión

## Retomar (estado guardado el 05-nov-2026)

1. `cd happy-learners-platform && git fetch && git checkout main && git pull`. Todo el trabajo está en `main`
   (producción 1.7.5, `b39b004`, PR #133). No quedan PR abiertos ni cambios sin commit.
2. `cd ../happy-learners-ops && git checkout main && git pull` (último: #145, DEC-059, evidencia de SPR-004 al 4-nov).
3. Seguir con la acción de abajo.

## Hecho

- 1.6.0–1.6.36: programa de transformación (M0–M11). SPR-003 cerrado 27-oct y aceptado; SPR-004 aceptado, cierra el
  10-nov (DEC-057) con todo su objetivo de seguridad (DEC-058).
- REL-007 (SPR-004): 1.7.0 registro de seguridad y auditoría (#129), 1.7.1 identidad (#130), 1.7.2 «Identidad y acceso»
  rediseñado (#131), 1.7.3 puerta de seguridad en el despliegue (#132). Releases v1.7.2 y v1.7.3.
- Quinta ola M12 (AUD-05, auditoría §10): 1.7.4 y 1.7.5 (#133): Horas, Cursos, Educadores, Revisión de perfiles,
  Contratos, Horarios, Agenda, Identidad y acceso, IA, Configuración académica, y sin peticiones por curso en Cursos,
  Biblioteca y Buscar. 13 de 18 módulos en su meta.

## Siguiente acción

1. Quinta ola: Cursos 4.40 (meta 4.5), Inteligencia artificial 4.15 (4.2; la tabla de capacidades es larga en el
   teléfono, 3 025 px), Configuración académica 4.10 (4.2; el diálogo de programa es largo). Organización y Ayuda
   esperan la marca (AP-06).
2. **10-nov, cierre de SPR-004** (ops): `uv run python -m tools.sprint_evidence_github SPR-004 --delivery
   project/delivery/SPR-004-entregas.json --cut 2026-11-10`, gráficas (`tools.sprint_charts SPR-004`), evidencia con
   `provisional: false`, informe y presentación en versión final (agregar 1.7.4/1.7.5 y la quinta ola), `tools.planning_docs`,
   `./hlops all`, ruff, pytest, PR y publicación (si se agota el tiempo: `gh run rerun <id> --failed`).
3. SEC-04 ya está hecho (1.7.3) con la puerta de seguridad: la protección de rama pide GitHub Pro.
4. Por cada incremento: `rm -rf build && npm run build`, E2E afectadas (en local escritorio y móvil comparten un
   servidor: si chocan, correr `--workers=1`), Semgrep (`uvx semgrep scan --config .semgrep --baseline-commit origin/main`),
   versión y CHANGELOG, PR, **todos** los checks verdes → merge → vigilar `verify`, `deploy`, `critical-flows`.

## Pendiente del responsable del proyecto

Google y Microsoft (registrar la aplicación, `docs/security/identidad.md`), Apple (cuenta de pago, OQ-016), AP-06 marca,
AP-05 pentest, AP-09 Workers Observability, prioridad de MOAT-02 a 05 (PO).

## Lecciones de esta sesión

- Un localizador por clase que el propio paso quita (`.fold-on-phones` al abrir) salta al siguiente elemento:
  conservar el elemento. Lo que solo pasa con los datos acumulados de CI se comprueba en CI.
- En E2E con datos compartidos, no fijar umbrales que dependen de cuántos datos agregaron otras pruebas (alto
  total de una página): medir el bloque que cambia.

- Las pruebas sobre el Worker no deben usar fechas fijas cercanas: el Worker solo planifica clases desde hoy y
  `academic-years`/`availability` vencieron el 03-nov. Usar «el lunes siguiente a hoy».

- Un PR creado desde una base vieja puede quedar en conflicto y **sin ningún check**: el vigilante debe comprobar
  `mergeable` y que existan las ejecuciones antes de esperar (con un id vacío `gh run view` falla en bucle).

- Un `aria-label` que contiene la etiqueta de otro campo rompe `getByLabel` (substring sin distinguir mayúsculas):
  pasó con «Personas» y con «Incorporación». Regla en `docs/design/fluent.md`.
- Comprobar que un archivo no existe antes de crearlo (se sobrescribió `tests/roster.test.ts`) y que el conteo de
  pruebas sube lo esperado.
- Los «fallos por carga» al arrancar Workers de prueba eran choques de puertos (QA-05, corregido en 1.6.17): leer
  siempre el error real del registro antes de atribuirlo a la carga.

## Cómo verificar en local

- Servidor: `npm run build && node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
  --persist-to <scratchpad>/db` (datos de demostración; contraseña `Aprender-2026!`).
- Detenerlo por pid (`pgrep -f "port 8797"` y `kill <pid>`): `pkill -f` dentro del mismo comando se mata a sí mismo.
- E2E focalizadas: `npx playwright test <archivo>[:línea] --workers=2`; la suite completa la corre CI.
