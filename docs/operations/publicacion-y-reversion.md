# Publicación y reversión

Procedimiento para publicar una versión candidata y volver a la anterior (ST-095). Complementa el recorrido de un
cambio descrito en el manual de despliegue de `happy-learners-ops`.

## Entornos

| Entorno | Worker | Datos |
| --- | --- | --- |
| Producción | `happy-learners-demo` | Durable Objects y bucket R2 de producción |
| Vista previa | `happy-learners-demo-preview` | Durable Objects y bucket R2 propios; nunca lee ni escribe datos de producción |

## Publicación

1. El PR pasa `Platform delivery`: verificación, pruebas de navegador, accesibilidad y la vista previa aislada.
2. La integración en `main` construye un artefacto, lo verifica y lo publica en producción. Si el PR estaba al día con
   `main` (el commit de integración tiene el mismo árbol que la cabeza del PR) y esa cabeza pasó `Platform delivery`
   completo, no se repiten la verificación ni las pruebas de navegador: solo se reconstruye el artefacto con el SHA de
   `main` (ahorra unos 15 minutos de Actions por integración). Para aprovecharlo, integrar `main` en la rama antes del
   último push del PR.
3. El pipeline ejecuta `scripts/critical-flows.mjs` contra producción con `EXPECTED_SHA` igual al commit publicado:
   página, salud, versión, acceso anónimo denegado, inicio de sesión, organización, lección publicada, errores y cierre
   de sesión.
4. Se registra el release con el digest del artefacto y el SHA-256 de `worker/index.js`.

## Ensayo de publicación y reversión

El workflow `Release drill` (manual; `previous` es opcional y por defecto toma la última release publicada) repite la publicación y la reversión en la vista
previa, con flujos críticos en cada paso:

| Paso | Qué ocurre | Comprobación |
| --- | --- | --- |
| 1 | Publica el tag anterior | Flujos críticos con el SHA del tag |
| 2 | Publica la candidata | Flujos críticos con el SHA de la candidata |
| 3 | Restaura en la vista previa un respaldo de la organización de demostración tomado de producción | Resúmenes idénticos y flujos críticos |
| 4 | `wrangler rollback` a la versión del paso 1 | Flujos críticos con el SHA del tag |
| 5 | `wrangler rollback` a la versión del paso 2 | Flujos críticos con el SHA de la candidata |

```bash
gh workflow run release-drill.yml --ref main
```

El resumen queda en el artefacto `release-drill-<sha>` (`release-drill.json`, con cada paso, las versiones de Worker
y el resultado de la restauración). El workflow comparte el grupo de concurrencia de la vista previa, así que no se
superpone con la revisión de un PR.

## Reversión en producción

1. Identificar la versión anterior: `wrangler deployments list --name happy-learners-demo`, o el release anterior en
   GitHub.
2. Volver a ella: `wrangler rollback <version-id> --name happy-learners-demo --message "<motivo>"`. Alternativa
   equivalente: publicar desde `main` un commit que revierta el cambio, que además deja el historial alineado.
3. Ejecutar `node scripts/critical-flows.mjs` con `EXPECTED_SHA` igual al commit de esa versión.
4. Registrar el motivo y el resultado en el release afectado.

La reversión de código no revierte los datos. Las migraciones son acumulativas y compatibles hacia atrás dentro de
una versión menor: el código anterior ignora columnas y tablas nuevas. Si una migración cambia datos existentes, se
toma un respaldo antes de publicarla y la reversión de datos sigue [respaldo-y-restauracion.md](respaldo-y-restauracion.md).
