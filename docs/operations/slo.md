# SLO y observabilidad

Hoja de ruta, carril B.4 (1.5.6). Producción sigue en Cloudflare Workers y Durable Objects, plan gratuito (decisión del
usuario, 30-oct-2026). Este documento define qué se promete, cómo se mide y qué hacer cuando se incumple.

## 1. Objetivos (SLO)

| Indicador (SLI) | Cómo se mide | Objetivo |
| --- | --- | --- |
| Disponibilidad de la API | Respuestas `/api/*` con estado < 500 sobre el total, en 30 días | **99,5 %** (presupuesto de error: ~3 h 36 min al mes) |
| Latencia | Percentil 95 de `ms` por ruta, en 7 días | **< 500 ms** en `/api/session`, `/api/courses`, `/api/sections`, `/api/classes`, `/api/agenda`, lecciones y notas |
| Cuota de lecturas | Suma de `rowsRead` en el día (UTC) | **< 4 millones** (80 % de los 5 millones del plan gratuito) |

La disponibilidad empieza en 99,5 % y no en 99,9 %: en el plan gratuito, agotar la cuota diaria de lecturas deja la API
en 503 hasta las 00:00 UTC (pasó el 30-oct, ~3 h). Al pasar al plan de pago, el objetivo sube a 99,9 %.

## 2. Qué se registra

Cada petición a `/api/*` deja una línea JSON en Workers Logs (`apps/api/src/telemetry.ts`):

```json
{"event":"api","route":"/api/sections/:id/grades","method":"GET","status":200,"ms":19,"rowsRead":546,"rowsWritten":0,"queries":11,"organization":"org-demo","sha":"…","ray":"…"}
```

- `route` es una plantilla: los segmentos con dígitos o de más de 24 caracteres (identificadores, tokens, códigos) se
  vuelven `:id`. No se registran parámetros de consulta, nombres, correos ni cuerpos.
- `rowsRead` y `rowsWritten` suman lo que leyó y escribió la base de la organización en esa petición (lo que cuenta la
  cuota). Los fallos también dejan su línea con estado 503, además de `request_failed` con la causa.
- Workers Logs está activo en `infrastructure/wrangler.jsonc` (`observability`). El plan gratuito incluye un límite
  diario de eventos de registro; si el tráfico se acerca a él, bajar `head_sampling_rate` (por ejemplo a `0.2`) y
  multiplicar las sumas por el inverso al leerlas.

## 3. Cómo consultarlo

En el panel de Cloudflare › Workers › `happy-learners-demo` › Observability › Query builder:

- **Disponibilidad:** filtro `event = api`; contar por `status >= 500` frente al total.
- **Latencia:** filtro `event = api`; agrupar por `route`; calcular `p95(ms)`.
- **Cuota:** filtro `event = api`; `sum(rowsRead)` del día; agrupar por `route` para ver quién lee más.
- **Fallos:** filtro `event = request_failed`; la causa viene en `cause` (así se vio el
  `Exceeded allowed rows read in Durable Objects free tier` del 30-oct).

## 4. Lecturas por pantalla (medido el 31-oct-2026)

Con los datos de demostración, en el Worker local; las respuestas son idénticas antes y después (se comparó su huella):

| Ruta | Docente antes | Docente en 1.5.7 | Administración antes | Administración en 1.5.7 |
| --- | ---: | ---: | ---: | ---: |
| `/api/progress` (Inicio) | 3 083 | 1 132 | 5 275 | 3 324 |
| `/api/sections` | 2 169 | 689 | 4 812 | 1 848 |
| `/api/sections/:id` | 360 | 198 | 708 | 553 |
| `/api/classes` | 931 | 931 | 11 | 11 |
| `/api/sections/:id/grades` | 546 | — | — | — |
| `/api/session` | 17 | — | — | — |
| `/api/agenda` (7 semanas, 1.6.0) | 503 → 294 | — | 6 483 → 1 829 (organización) | — |

Qué se cambió en 1.5.7: cada clase guarda cuántas marcas de asistencia tiene y cuántas son presente o tarde
(migración 0075, con disparadores que las mantienen exactas), así que Inicio y Secciones ya no leen las marcas; las
secciones visibles se resuelven una vez y las demás consultas van por su índice; las lecciones publicadas se leen desde
sus unidades; la última actividad de cada curso se lee por su índice.

Queda: `/api/classes` de una docente (lee todas las clases de sus secciones para mostrar las próximas; separar la
condición no ayudó, el costo está en las uniones de lecciones) y las ~60 consultas de Inicio para administración
(unidades y currículo por curso).

## 5. Alertas y página de estado

El plan gratuito de Workers no envía alertas por errores. Mientras tanto:

- **Monitor externo** (lo configura el usuario, gratuito): UptimeRobot o Better Stack sobre
  `https://happy-learners-demo.lfmendoza-alvarez.workers.dev/api/health` cada 5 minutos, con aviso por correo y su
  página de estado pública. `/api/health` responde 503 si la base no contesta, así que también avisa de la cuota.
- **Tras cada despliegue,** `critical-flows` en CI recorre los flujos críticos contra producción.
- **Revisión semanal** del panel (§3): disponibilidad, p95 de las rutas del SLO y el día de más lecturas.

## 6. Qué hacer cuando se incumple

| Síntoma | Causa probable | Acción |
| --- | --- | --- |
| 503 en todas las rutas; `request_failed` con `Exceeded allowed rows read` | Cuota diaria de lecturas agotada | Esperar a las 00:00 UTC; no correr `Release drill` ni la vista previa ese día; ver qué ruta leyó más (§3) |
| 503 tras un despliegue | Error del código nuevo | Revertir según `publicacion-y-reversion.md` |
| p95 alto en una ruta | Consulta que crece con los datos | Medir `rowsRead` y `queries` de la ruta; agregar índice o juntar consultas |
| Presupuesto de error del mes gastado | Varias de las anteriores | Congelar funciones nuevas y dedicar la siguiente entrega a confiabilidad |

## 7. Siguientes pasos

1. ~~Reducir las lecturas de Inicio y Secciones~~ (1.5.7, −37 % a −68 %); queda `/api/classes` y las consultas por
   curso de Inicio (§4).
2. Configurar el monitor externo y su página de estado (usuario).
3. Al pasar al plan de pago: objetivo 99,9 %, alertas de Cloudflare y Analytics Engine para métricas sin muestreo.
