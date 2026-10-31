# Siguiente sesión

## Retomar

1. `cd happy-learners-platform && git status && git log --oneline -5` → rama `feat/HL-15-transformacion`. Si hay
   cambios sin commit, son de la sesión anterior: revisarlos, no descartarlos.
2. `git fetch && git log --oneline -3 origin/main`: si `main` avanzó, integrar `origin/main` en la rama.
3. Seguir con la tarea de abajo.

## Hecho

- M0: auditoría sobre la app en local y espacio del programa (`docs/transformacion/`).
- IA-01: `menuCourses`/`rememberCourse` en `packages/domain/src/navigation.ts` (pruebas en `tests/navigation.test.ts`);
  `ui/Shell.tsx` (`useRecentCourses`, `administration`); estilos `.nav-group*`, `.nav-more` en `style.css`; E2E 8 de
  `ux-flows.spec.ts` adaptada al nuevo comportamiento.

## Siguiente acción: IA-03 · Agenda por rol

- Problema: `admin-demo` abre `/agenda` en «Mis secciones», vacía (T6 de la auditoría).
- Leer `apps/web/src/pages/agenda/Agenda.tsx` (filtro «Ver») y `docs/design/agenda-y-calendario.md` antes de cambiar.
- Criterio: administración (y coordinación con alcance) abre en la vista de toda la institución o de su alcance;
  docentes sin cambios; E2E de agenda en local.

Después: IA-02 (migas por grupo), cerrar M1 (versión 1.6.0 en `package.json`, PR con evidencia, pedir AP-02).

## Cómo verificar en local

- Servidor: `npm run build && node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
  --persist-to <scratchpad>/db` (datos de demostración; contraseña `Aprender-2026!`).
- Detenerlo por pid (`pgrep -f "port 8797"` y `kill <pid>`): `pkill -f` dentro del mismo comando se mata a sí mismo.
- E2E focalizadas: `npx playwright test <archivo>[:línea] --workers=2`; la suite completa la corre CI.
