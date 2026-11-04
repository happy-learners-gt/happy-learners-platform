# Activar los proveedores de identidad

REL-007 (ST-129, ST-131, ST-138). El código está en producción desde 1.7.x y probado contra un proveedor de prueba
(`tests/oidc.test.ts`). Cada proveedor aparece en la pantalla de inicio solo cuando sus credenciales están
configuradas. Registrar la aplicación es una acción de una cuenta del responsable del proyecto: el equipo de desarrollo no la hace.

Dirección de retorno de cada proveedor (sustituye el dominio por el de producción):

```text
https://<dominio>/api/auth/callback/google
https://<dominio>/api/auth/callback/microsoft
https://<dominio>/api/auth/callback/apple
https://<dominio>/api/auth/callback/sso
```

## Google (gratis)

1. En Google Cloud Console, crea un proyecto y una «pantalla de consentimiento de OAuth» (tipo Externo; datos: nombre,
   correo de soporte; ámbitos `openid` y `email`).
2. Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web. Agrega la dirección de retorno de Google.
3. Guarda el ID y el secreto como secretos del Worker:
   `npx wrangler secret put GOOGLE_CLIENT_ID --config build/wrangler.json` y `… GOOGLE_CLIENT_SECRET …`.

## Microsoft (gratis)

1. En Microsoft Entra ID (portal de Azure) → Registros de aplicaciones → Nuevo registro. Tipos de cuenta: «cuentas en
   cualquier directorio organizativo y cuentas personales de Microsoft». Dirección de retorno: web, la de Microsoft.
2. Certificados y secretos → Nuevo secreto de cliente (anota su vencimiento: hay que renovarlo, ver `controles.md`).
3. `wrangler secret put MICROSOFT_CLIENT_ID` y `MICROSOFT_CLIENT_SECRET`.

## Apple (de pago, OQ-016)

Requiere el Apple Developer Program (USD 99 al año). Sin esa cuenta el botón no aparece.

1. Identifiers → un App ID con «Sign in with Apple» y un Services ID (ese es el `APPLE_CLIENT_ID`) con el dominio y la
   dirección de retorno de Apple.
2. Keys → una clave con «Sign in with Apple»; descarga el archivo `.p8` (una sola vez).
3. `wrangler secret put` de `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` (el contenido del
   `.p8`). El Worker firma con ella su secreto de cliente en cada inicio.

## Proveedor institucional (Okta, Entra ID): lo hace administración de cada institución

En Gobierno › Seguridad › Proveedor institucional, con la aplicación registrada en el proveedor de la institución:

- **Entra ID:** registro de aplicación de un solo inquilino; emisor `https://login.microsoftonline.com/<id del
  inquilino>/v2.0`; para el rol por grupo, agrega el reclamo `groups` (Configuración del token) y usa el identificador
  del grupo como «Grupo de administración».
- **Okta:** aplicación OIDC web; emisor `https://<dominio>.okta.com/oauth2/default`; reclamo `groups` en el servidor de
  autorización si se usa el rol por grupo.

Después: **Guardar** → **Probar con una cuenta** de la institución (debe tener correo de los dominios) → **Activar**.
Cualquier cambio del emisor, el cliente, el secreto o los dominios exige una prueba nueva. Las personas entran con
«Entrar con la cuenta de tu institución» escribiendo su correo; solo entran las que ya son personas activas de la
organización con ese correo de acceso.
