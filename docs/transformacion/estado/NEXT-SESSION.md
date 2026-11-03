# Siguiente sesión

## Retomar

1. `cd happy-learners-platform && git status && git log --oneline -5` → rama `feat/HL-15-transformacion`. Si hay
   cambios sin commit, son de la sesión anterior: revisarlos, no descartarlos.
2. `git fetch && git log --oneline -3 origin/main`: si `main` avanzó, integrar `origin/main` en la rama.
3. Seguir con la tarea de abajo.

## Hecho

- M0 y M1 (PR #103: menú, Agenda por rol y lecturas, migas; corrección `2a12450`).
- En `feat/HL-15-flujos-e-ia` (1.6.1, sin push): `ia.md` + límite de IA (H4), `flujos.md`, Horas efectivas (HRS-01),
  Inicio por excepciones (HOME-01), monitor documentado (SEC-02), alcance del pentest (SEC-03).

## Siguiente acción

1. `gh pr checks 103`: si `verify` falla, leer `gh run view <id> --log-failed | grep -E "✘|Error: "`, reproducir la
   prueba en local y corregir en `feat/HL-15-transformacion` (luego `git merge` en la rama apilada).
2. Con #103 verde: avisar al usuario (AP-02). No fusionar sin su autorización.
3. Siguiente tarea de la cola: **PPL-01** (F1 en `flujos.md`): lista de incorporación con acciones en el detalle de la
   persona en Educadores; empezar por `apps/web/src/pages/admin.tsx` (`Members`, `setDetail`) y `contracts.tsx` (`Nuevo contrato`).
4. El PR de 1.6.1 se abre cuando #103 esté fusionado (base `main`), para no gastar minutos en una base que cambia.

## Cómo verificar en local

- Servidor: `npm run build && node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
  --persist-to <scratchpad>/db` (datos de demostración; contraseña `Aprender-2026!`).
- Detenerlo por pid (`pgrep -f "port 8797"` y `kill <pid>`): `pkill -f` dentro del mismo comando se mata a sí mismo.
- E2E focalizadas: `npx playwright test <archivo>[:línea] --workers=2`; la suite completa la corre CI.
