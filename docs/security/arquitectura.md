# Arquitectura de seguridad

REL-007, ST-185 (SPR-004, DEC-058). Cómo está protegida la plataforma desde 1.7.0: límites de confianza, cada forma de
entrar, dónde vive cada secreto y qué prueba sostiene cada control. Complementa la auditoría de noviembre
(`auditoria-2026-11.md`), el registro (`registro-de-seguridad.md`), la matriz de cumplimiento (`cumplimiento.md`) y la
matriz de accesos (`accesos.md`).

## 1. Límites de confianza

```text
Navegador ──HTTPS──▶ Worker (Cloudflare) ──RPC──▶ Durable Object de la organización (SQLite + clave propia)
   │                    │                              └─ una por organización; el Worker elige cuál por la letra
   │                    │                                 del token y la sesión existe solo si su hash está ahí
   │                    ├──HTTPS──▶ Brevo (correo), Have I Been Pwned (rango k-anonimato), OpenAI (IA)
   │                    └──HTTPS──▶ Google, Microsoft, Apple, proveedor institucional (OpenID Connect)
   └─ Integraciones ──HTTPS + Bearer hlt_…──▶ Worker (solo lectura)
```

| Límite | Qué lo cruza | Control |
| --- | --- | --- |
| Internet → Worker | Toda petición | HTTPS con HSTS; CSP sin orígenes externos; escrituras solo con `Origin` propio y sin `Sec-Fetch-Site: cross-site`; tamaño de cuerpo limitado por ruta |
| Worker → Durable Object | Consultas con parámetros | Una base por organización; la organización sale de la membresía, nunca del cliente (`storage.ts`, `index.ts`) |
| Worker → proveedores | Códigos de autorización, tokens de identidad | Solo `https` (un servidor local solo si el Worker también es local); el token de identidad se verifica completo antes de usarse |
| Worker → servicios | Correos, 5 caracteres de un SHA-1, textos de IA | Sin secretos en los registros; la IA nunca escribe sola (`docs/transformacion/ia.md`) |

## 2. Cómo se entra

Todas las formas terminan en `finishSignIn` (`apps/api/src/sign-in.ts`): abre una sesión con la duración de la política
y su cookie `HttpOnly; SameSite=Strict; Secure`, o pide el segundo paso si la persona tiene uno. Cada intento queda en el
registro de seguridad.

| Método | Prueba de identidad | Notas |
| --- | --- | --- |
| Contraseña | PBKDF2-SHA256, sal aleatoria, comparación en tiempo constante | 30 intentos por dirección y 10 fallos por cuenta cada 15 minutos (bloqueo registrado) |
| Enlace por correo (ST-130) | Posesión del correo de acceso confirmado | Un uso, 15 minutos; la solicitud no dice si la cuenta existe; abrir el enlace no lo usa |
| Recuperación (ST-134) | Posesión del correo | Un uso, 30 minutos; cierra todas las sesiones y levanta el bloqueo |
| Passkey (ST-132) | Firma WebAuthn con verificación de la persona | Cuenta como los dos factores; contador contra copias; parte de quien está en este sitio (`rpId`) |
| Google, Microsoft, Apple (ST-129, ST-131) | Token de identidad firmado por el proveedor | Solo cuentas vinculadas desde la propia sesión a una persona activa |
| Proveedor institucional (ST-138) | Token de identidad del emisor configurado | Por dominio de correo; activo solo después de una prueba correcta; el rol sigue el grupo configurado |
| Segundo paso (ST-133) | TOTP (RFC 6238) o un código de recuperación | Desafío de 5 minutos y 5 intentos; un código no se reutiliza |
| Token de integración (ST-136) | `Authorization: Bearer hlt_…` | Solo lectura (GET), nunca cuenta, seguridad, personas ni respaldo; caduca en 90 días como máximo |

Los viajes a un proveedor llevan `state` de un uso, `nonce`, PKCE (S256) y una cookie del navegador que los empezó, así
que nadie puede terminar en su navegador un inicio de sesión empezado en otro (`apps/api/src/oidc.ts`).

## 3. Dónde vive cada secreto

| Secreto | Dónde | Cómo se guarda |
| --- | --- | --- |
| Contraseñas | `users` | PBKDF2 (100 000 iteraciones, el máximo de workerd; riesgo R2 aceptado) |
| Sesiones, enlaces, desafíos, tokens | `sessions`, `auth_challenges`, `access_tokens` | Solo su SHA-256 |
| Secreto TOTP, secreto de cliente del proveedor institucional | `totp_factors`, `sso_connections` | AES-GCM con la clave de la organización |
| Clave de la organización | Almacenamiento clave-valor del Durable Object | Nunca en SQL: no sale en la copia ni en exportaciones (`storage.ts`, `securityKey`) |
| Códigos de recuperación | `recovery_codes` | Solo su SHA-256; se muestran una vez |
| Claves públicas de passkeys | `passkeys` | La clave pública COSE; la privada nunca sale del dispositivo |
| Credenciales de Google, Microsoft, Apple, Brevo, OpenAI | Secretos del Worker | Fuera del repositorio (`docs/security/identidad.md`) |

La copia de la organización no lleva ningún secreto ni el registro de seguridad (`backup.ts`, `SKIPPED`).

## 4. Modelo de amenazas de los factores nuevos

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Contraseña robada | Segundo factor exigible por rol; passkeys | `tests/mfa.test.ts`, `tests/passkeys.test.ts` |
| Adivinar contraseñas | Límites por dirección y por cuenta; bloqueo registrado; contraseñas comunes y filtradas rechazadas | `tests/security-log.test.ts`, `tests/sign-in-links.test.ts` |
| Enumerar cuentas por enlaces o passkeys | Misma respuesta exista o no; el correo sale después de responder | `tests/sign-in-links.test.ts`, `tests/passkeys.test.ts` |
| Reutilizar un enlace, desafío o código | Un uso con guardas en la misma transacción | Las tres pruebas anteriores |
| Phishing de una passkey | Origen y `rpId` verificados en cada firma | `tests/passkeys.test.ts` |
| Passkey copiada | Contador que no avanza se rechaza | `tests/passkeys.test.ts` |
| Token de identidad falso o de otra app | Firma con las claves del proveedor, emisor, audiencia, caducidad y `nonce` | `tests/oidc.test.ts` |
| CSRF de inicio de sesión con proveedor | Cookie de vínculo del navegador; `state` de un uso | `tests/oidc.test.ts` |
| Token de integración filtrado | Solo lectura, caducidad, revocación por su dueño y administración, uso registrado | `tests/tokens.test.ts` |
| Alterar el registro | Cadena de sellos verificable | `tests/security-log.test.ts` |
| Administración que abusa | Auditoría restringida; cada cambio de rol, permiso, política o proveedor en el registro | `tests/security-log.test.ts` |

## 5. Lo que no cubre

- La cadena de sellos hace evidente una alteración de los datos, no la impide a quien controle el código desplegado.
- PBKDF2 con 100 000 iteraciones (R2) mientras workerd no admita más o Argon2.
- Inicio con Apple exige una cuenta de pago de Apple Developer (OQ-016); Google, Microsoft y el proveedor institucional,
  registrar la aplicación. Sin eso, el código está probado pero el botón no aparece.
- SAML: el proveedor institucional se conecta por OpenID Connect, que Okta y Entra ID ofrecen.
- La prueba de penetración externa (AP-05) sigue pendiente.
