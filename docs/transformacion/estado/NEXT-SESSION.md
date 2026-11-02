# Siguiente sesión

## Retomar

1. `cd happy-learners-platform && git status && git log --oneline -5` → rama `feat/HL-15-transformacion`. Si hay
   cambios sin commit, son de la sesión anterior: revisarlos, no descartarlos.
2. `git fetch && git log --oneline -3 origin/main`: si `main` avanzó, integrar `origin/main` en la rama.
3. Seguir con la tarea de abajo.

## Hecho

- M0: auditoría y espacio del programa. M1 (PR 1.6.0): IA-01 menú que escala, IA-03 Agenda por rol (+ lecturas),
  IA-02 migas. Commits `2165477`, `156704c` y siguientes en `feat/HL-15-transformacion`.

## Siguiente acción: M2

1. Si el PR 1.6.0 sigue abierto: revisar su CI (`gh pr checks`); un E2E intermitente se reintenta con
   `gh run rerun --failed` tras reproducirlo en local. No fusionar sin autorización (AP-02).
2. Crear `feat/HL-15-flujos-e-ia` desde esta rama (apilada) para M2.
3. **AI-01:** leer `apps/api/src/openai.ts`, `ai-runs.ts`, `ai-assist.ts`, `ai-usage.ts` y `docs/design/asistente-ia.md`;
   escribir `docs/transformacion/ia.md`: inventario de capacidades (entrada, contexto, permisos, salida, validación,
   aprobación humana, evaluación), brechas y el rediseño de «Uso de IA» como «Inteligencia artificial».
4. **WF-01:** recorrer en la app los 5 flujos (incorporar educador, configurar ciclo, armar horario, registrar horas,
   emitir boleta), contar pasos y páginas, y escribir `docs/transformacion/flujos.md`.

## Cómo verificar en local

- Servidor: `npm run build && node_modules/.bin/wrangler dev --local --config build/wrangler.json --port 8797
  --persist-to <scratchpad>/db` (datos de demostración; contraseña `Aprender-2026!`).
- Detenerlo por pid (`pgrep -f "port 8797"` y `kill <pid>`): `pkill -f` dentro del mismo comando se mata a sí mismo.
- E2E focalizadas: `npx playwright test <archivo>[:línea] --workers=2`; la suite completa la corre CI.
