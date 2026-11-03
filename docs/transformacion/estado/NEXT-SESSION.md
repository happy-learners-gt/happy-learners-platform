# Siguiente sesión

## Retomar

1. `cd happy-learners-platform && git status && git log --oneline -5` → rama `feat/HL-15-transformacion`. Si hay
   cambios sin commit, son de la sesión anterior: revisarlos, no descartarlos.
2. `git fetch && git log --oneline -3 origin/main`: si `main` avanzó, integrar `origin/main` en la rama.
3. Seguir con la tarea de abajo.

## Hecho

- 1.6.0–1.6.3 en producción el 02-nov (#103–#106): menú y Agenda por rol, Inicio por excepciones, Horas por periodo,
  R1, límite de IA (H4), incorporación de educadores, calendario unificado. Documentación del programa al día.

## Siguiente acción

1. `git status`: rama `feat/HL-15-siguiente` con este estado sin push. `git fetch && git merge origin/main` si avanzó.
2. Siguiente de la cola: **SCH-01** (F3 en `flujos.md`: Horarios abre en el horario vigente por sección, docente o aula,
   con conflictos; el generador como acción secundaria). Diseño primero en `docs/design/`.
3. Por cada hito: `rm -rf build && npm run build`, E2E afectadas, `./scripts/verify`, versión y CHANGELOG, push, PR,
   CI verde → `gh pr merge <n> --merge` (autorizado) → vigilar `verify`, `deploy`, `critical-flows` en `main`.
4. **13-nov:** SEC-04, escáneres obligatorios en `main` (protección de rama con `secrets`, `dependencies`, `code`),
   revisando antes que no hubo falsos positivos.

## Lecciones de esta sesión

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
