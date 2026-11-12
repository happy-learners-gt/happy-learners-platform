# Infraestructura y entrega

## Componentes

- Workers Static Assets sirve la aplicación y el Worker atiende `/api/*`.
- `OrganizationStore` mantiene los datos del curso y verifica las sesiones.
- `LessonCollaborationRoom` conserva la edición compartida de cada lección en SQLite y sincroniza el texto con WebSockets.
- El bucket R2 `happy-learners-demo-course-files` es privado. Guarda documentos Office; no se habilita el dominio público de R2.

Las cargas admitidas son DOCX, PPTX y XLSX de hasta 15 MiB por archivo y 4 GiB por organización. El Worker valida la estructura antes de guardarlas. Las descargas privadas requieren sesión de educador; una lección publicada solo permite abrir los archivos incluidos en su contenido.

## Desarrollo y comprobación

```bash
npm ci
./scripts/verify
npm run test:e2e
```

La verificación construye la web y el Worker, genera los tipos de los bindings, ejecuta pruebas TypeScript/Python y hace un dry-run de Wrangler. Playwright inicia un Worker local y comprueba los recorridos de escritorio y móvil. No usa el bucket remoto ni despliega.

## Correo transaccional (ST-121, DEC-042)

Las invitaciones se envían con la API HTTP de Brevo en su plan gratuito (300 correos al día por cuenta). Sin
configuración el Worker no envía nada: cada mensaje queda en la bandeja de salida de la organización como
`not_configured` y administración copia el enlace de la invitación. Para activar el envío:

1. En Brevo, verifica como remitente la dirección que se usará (mientras no haya dominio propio) y crea una clave de API v3.
2. Guarda la clave como secreto del Worker; nunca en `wrangler.jsonc`, en variables de Actions visibles ni en el código:

   ```bash
   npx wrangler secret put BREVO_API_KEY --config build/wrangler.json
   ```

3. Define la dirección verificada como `MAIL_FROM`. Como `wrangler.jsonc` no la declara (no lleva valores reales) y
   `wrangler deploy` reemplaza las variables de texto del panel, guárdala también con
   `npx wrangler secret put MAIL_FROM --config build/wrangler.json`; el Worker la lee igual que una variable.
   El nombre del remitente es siempre «Acervum».

No hay plan de pago: cada organización envía como máximo 250 correos por día UTC; al alcanzarlo, los mensajes quedan
`deferred` y la invitación conserva su enlace para compartirlo. Si se agregan organizaciones, recuerda que el límite de
300 es de la cuenta de Brevo. Estos pasos no forman parte del workflow y requieren aprobación antes de ejecutarse.

## Publicación

El workflow `Platform delivery` verifica los PR y genera un paquete identificado con el SHA. Tras integrar a `main`, el job de despliegue publica exactamente ese artefacto y ejecuta las comprobaciones de producción. Los PR no reciben secretos y no despliegan. El workflow no activa facturación ni crea el bucket.

Antes de publicar, el job consulta si existe el bucket fijo y solo lo crea si falta. El secreto de Cloudflare usado por Actions debe permitir publicar Workers y administrar únicamente el bucket R2 de curso. No expongas credenciales en variables de configuración ni en el código. Si R2 no está habilitado en la cuenta o falta permiso, el job se detiene y deja que Actions registre el error; no deshabilita el bucket ni activa un plan de pago.

R2 es privado por defecto. No habilites `r2.dev` ni un dominio público para este bucket. Controla consumo y permanece dentro de la cuota de producto documentada; R2 aplica límites gratuitos mensuales y factura el exceso según el uso de la cuenta.

## Migración y recuperación

Las migraciones 0008 y 0009 son acumulativas. La primera crea listas de clase y asistencia sintéticas; la segunda añade metadatos de archivo. El contenido permanece en el bucket R2 y se referencia desde SQLite. Archivar no borra objetos ni publicaciones. No borres el bucket para recuperar un despliegue. Para revertir la interfaz se puede publicar el artefacto anterior; conserva estas migraciones y el bucket para evitar pérdida de datos.

Antes de aceptar una release, compara `/api/version` con el SHA del artefacto, revisa `/api/health` y ejecuta el smoke test alojado. La release v0.2.1 no se modifica; esta ampliación se publica como v0.2.2.
