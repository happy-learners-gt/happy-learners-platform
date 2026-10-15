# Respaldo y restauración

Política de respaldo de los datos de cada organización (ST-044). Aplica desde la versión 1.0.

## Qué se respalda

Cada organización guarda sus datos en su propia base SQLite dentro de un Durable Object. El respaldo es una copia
lógica en JSON de esa base:

| Incluye | No incluye |
| --- | --- |
| Organización, cuentas y membresías, cursos, programas y requisitos, módulos, lecciones y revisiones, recursos y materiales, clasificaciones, secciones, horarios, clases, asistencia, estudiantes, grupos de trabajo, calendario, actividad y metadatos de documentos. | Contraseñas (sal y hash), sesiones abiertas de educadores y estudiantes, límites de inicio de sesión y el registro de migraciones. |

El contenido de los documentos Office está en el bucket R2 privado y no forma parte del respaldo. El respaldo
conserva sus metadatos (curso, nombre, tamaño, clave del objeto y estado). Los documentos no se eliminan: archivarlos
solo cambia su estado, de modo que restaurar una copia vuelve a enlazar el mismo objeto.

Cada tabla lleva un resumen SHA-256 de su contenido normalizado (`digests`). El resumen no depende del orden de las
filas, así que un respaldo tomado después de restaurar coincide con la copia restaurada.

## Cómo se obtiene

- **Organización → Respaldo → Descargar respaldo** (solo administración) descarga `<organización>-<fecha>.json`.
- `GET /api/organization/backup` devuelve la misma copia; responde 401 sin sesión y 403 a quien no administra.

El archivo contiene nombres de estudiantes y datos de asistencia. Se guarda en almacenamiento privado de la
organización, nunca en un repositorio ni en un canal compartido.

## Frecuencia y retención

| Momento | Responsable | Retención |
| --- | --- | --- |
| Semanal, mientras haya clases | Administración de cada organización | Las cuatro últimas copias semanales |
| Antes de publicar una versión con migraciones de datos | Responsable de la publicación | Hasta la versión siguiente |
| Ensayo de publicación (`Release drill`) | Pipeline | 90 días, como artefacto `release-drill-<sha>` del workflow |

## Restauración

`POST /api/organization/restore` reemplaza todos los datos de la organización por los de la copia, en una sola
transacción. La restauración:

1. Responde 403 a quien no administra la organización.
2. Rechaza con 400 una copia cuyos resúmenes no coinciden con su contenido (alterada o incompleta).
3. Rechaza con 409 una copia de otra organización, de otra versión del esquema o con otras tablas.
4. Conserva las contraseñas que el espacio ya tenía, y con ellas si son temporales (ST-093). Una cuenta que solo
   existe en la copia queda sin contraseña utilizable hasta que administración la restablezca desde **Educadores**.
5. Cierra las sesiones de cuentas, secciones o estudiantes que ya no existen.
6. Compara cada tabla con la copia y revierte todo si alguna difiere.

La ruta solo existe donde la variable `RESTORE_ENABLED` vale `true`: la vista previa aislada y las pruebas locales.
En producción responde 404. Para restaurar producción ante una pérdida de datos:

1. Tomar un respaldo del estado actual, aunque esté dañado.
2. Publicar el artefacto verificado del commit vigente con la variable del Worker activada
   (`wrangler deploy --config build/wrangler.json --var RESTORE_ENABLED:true`).
3. Enviar la copia con una sesión de administración de la organización afectada y guardar la respuesta (`restored`
   y `digests`).
4. Ejecutar los flujos críticos (`scripts/critical-flows.mjs`).
5. Publicar de nuevo sin la variable y comprobar que la ruta responde 404.

## Prueba de restauración

`scripts/restore-drill.mjs` toma un respaldo de la organización de demostración en producción (solo lectura), lo
restaura en la vista previa, toma un segundo respaldo allí y compara los resúmenes tabla por tabla y la cantidad de
cursos. El resultado queda en `.release-evidence/restore-drill.json`. El workflow `Release drill` lo ejecuta como parte
del ensayo de publicación ([publicacion-y-reversion.md](publicacion-y-reversion.md)).

```bash
SOURCE_URL=https://happy-learners-demo.lfmendoza-alvarez.workers.dev \
BASE_URL=https://happy-learners-demo-preview.lfmendoza-alvarez.workers.dev \
node scripts/restore-drill.mjs
```

`tests/e2e/release.spec.ts` comprueba lo mismo en cada cambio: permisos, ausencia de contraseñas y tablas excluidas,
rechazo de copias alteradas o ajenas, y que respaldar después de restaurar da los mismos resúmenes.
