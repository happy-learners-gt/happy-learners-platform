# Siguiente sesión

## Retomar

1. `cd happy-learners-platform && git status && git log --oneline -5` → rama `feat/HL-15-transformacion`. Si hay
   cambios sin commit, son de la sesión anterior: revisarlos, no descartarlos.
2. `git fetch && git log --oneline -3 origin/main`: si `main` avanzó, integrar `origin/main` en la rama.
3. Seguir con la tarea de abajo.

## Hecho

- 1.6.0–1.6.10 en producción (#103–#113, 02 y 03-nov): menú y Agenda por rol, Inicio por excepciones, Horas por
  periodo y con la mitad de lecturas, R1, límite de IA (H4), incorporación de educadores (con agregar a un curso),
  calendario unificado, horario vigente con choques, orden estable de la actividad, contraste AA en oscuro y
  segunda pasada de la auditoría (AUD-02). 1.6.8 (DOC-01, #111): empezar una plantilla de documento en un paso. 1.6.9 (AIG-4/5): propuestas usadas e
  «Inteligencia artificial».

## Siguiente acción

1. `git status` y `git fetch && git merge origin/main` si avanzó. Confirmar que el PR de 1.6.11 está fusionado.
2. Siguiente de la cola: **AIG-4b** (aceptación de propuestas de lecciones y mapa), HOME-02 y Configuración
   académica (3.15). HRS-03 espera AP-08.
3. Por cada hito: `rm -rf build && npm run build`, E2E afectadas, `./scripts/verify`, versión y CHANGELOG, push, PR,
   **todos** los checks verdes (también `code`/Semgrep; correr `uvx semgrep scan --config .semgrep` antes) →
   `gh pr merge <n> --merge` (autorizado) → vigilar `verify`, `deploy`, `critical-flows` en `main`.
4. **13-nov:** SEC-04, escáneres obligatorios en `main` (protección de rama con `secrets`, `dependencies`, `code`),
   revisando antes que no hubo falsos positivos.

## Lecciones de esta sesión

- Las pruebas sobre el Worker no deben usar fechas fijas cercanas: el Worker solo planifica clases desde hoy y
  `academic-years`/`availability` vencieron el 03-nov. Usar «el lunes siguiente a hoy».

- Un PR creado desde una base vieja puede quedar en conflicto y **sin ningún check**: el vigilante debe comprobar
  `mergeable` y que existan las ejecuciones antes de esperar (con un id vacío `gh run view` falla en bucle).

- Un `aria-label` que contiene la etiqueta de otro campo rompe `getByLabel` (substring sin distinguir mayúsculas):
  pasó con «Personas» y con «Incorporación». Regla en `docs/design/fluent.md`.
- Comprobar que un archivo no existe antes de crearlo (se sobrescribió `tests/roster.test.ts`) y que el conteo de
  pruebas sube lo esperado.
- `./scripts/verify` tiene fallos intermitentes por carga en pruebas sobre el Worker; se confirman corriendo esos
  archivos solos.

## Cómo verificar en local

- Servidor: `npm run build && node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
  --persist-to <scratchpad>/db` (datos de demostración; contraseña `Aprender-2026!`).
- Detenerlo por pid (`pgrep -f "port 8797"` y `kill <pid>`): `pkill -f` dentro del mismo comando se mata a sí mismo.
- E2E focalizadas: `npx playwright test <archivo>[:línea] --workers=2`; la suite completa la corre CI.
