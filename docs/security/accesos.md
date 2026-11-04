# Roles y accesos de seguridad

REL-007, ST-184 (SPR-004, DEC-058). Quién ve y cambia la seguridad de la organización. Se aplica en el servidor en cada
petición; las pruebas recorren cada ruta sin sesión (401), con un educador (403) y con administración.

| Capacidad | Ruta | Administración | Educador (también con coordinación o grupos) | Sin sesión |
| --- | --- | --- | --- | --- |
| Registro de seguridad, exportación y cadena | `/api/security/events`, `/events/export`, `/chain` | Sí | No | No |
| Auditoría de acciones críticas y roles | `/api/security/audit` | Sí | No | No |
| Política de acceso | `/api/security/policy` | Sí | No | No |
| Revisión de accesos | `/api/security/access-review` | Sí | No | No |
| Cerrar las sesiones de una persona | `DELETE /api/security/people/:id/sessions` | Sí, no las propias | No | No |
| Restablecer el segundo factor de una persona | `DELETE /api/security/people/:id/mfa` | Sí, no el propio | No | No |
| Desvincular la cuenta externa de una persona | `DELETE /api/security/people/:id/identities/:proveedor` | Sí | No | No |
| Tokens de toda la organización | `/api/security/tokens` | Sí | No | No |
| Proveedor institucional | `/api/security/sso`, `/test`, `/activate` | Sí | No | No |
| Resumen, personas, revisiones de acceso (Identidad y acceso) | `/api/identity/*` | Sí | No | No |
| Confirmar mi identidad (modo de confirmación) | `/api/me/confirm`, `/api/me/confirm/options` | La propia | La propia | No |
| Mi segundo factor, passkeys, cuentas vinculadas, tokens | `/api/me/mfa`, `/me/passkeys`, `/me/identities`, `/me/tokens` | Las propias | Las propias | No |
| Pedir un enlace, recuperar, segundo paso, passkey, proveedor | `/api/login/*`, `/api/account/recovery*`, `/api/auth/callback/*` | Público, con límites | Público | Sí |

Reglas:

- Los permisos de seguridad no se otorgan a grupos de seguridad ni a la coordinación: son de administración
  (`permissionCatalog`, «Solo administración»).
- Un token de integración nunca abre `/api/me`, `/api/security`, `/api/account`, `/api/members`, `/api/access`,
  `/api/session`, `/api/invitations`, `/api/legal` ni el respaldo, aunque su dueño sea administración.
- Mientras la política exija el segundo factor y la persona no lo tenga, solo responden su sesión y su configuración.
- Cada cambio de rol, acceso, permiso, política, proveedor o factor queda en el registro de seguridad.
- Agregar o quitar un método, crear un token o vincular una cuenta exige que la sesión esté en su ventana de
  confirmación (10 minutos después de entrar o de confirmar con passkey, código o contraseña).
- Nadie puede exigir el segundo factor a administración sin tenerlo: quedaría sin poder seguir.

Evidencia: `tests/security-log.test.ts` (ST-184 CA2), `tests/mfa.test.ts`, `tests/tokens.test.ts`, `tests/oidc.test.ts`,
`tests/route-matrix.test.ts`.
