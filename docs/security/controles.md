# Controles operativos de seguridad

REL-007, ST-189 (SPR-004, DEC-058). Lo que se hace, cuándo y quién, para detectar y responder a tiempo.

## 1. Controles automáticos

| Control | Frecuencia | Dónde |
| --- | --- | --- |
| Secretos (gitleaks), dependencias (OSV-Scanner) y código (Semgrep) | Cada PR y cada push a `main` | `.github/workflows/security.yml`; obligatorios para llegar a producción: el despliegue se detiene si el PR del commit no los pasó (`scripts/security-gate.py`). La protección de rama de GitHub pide un plan de pago en repositorios privados |
| DAST con OWASP ZAP, con sesión, contra un Worker local | Semanal | `.github/workflows/dast.yml`, `docs/security/dast.md` |
| Flujos críticos en producción | Cada despliegue | `scripts/critical-flows.mjs` |
| Monitor externo de disponibilidad | Cada 5 minutos | UptimeRobot (AP-03), `docs/operations/slo.md` |
| Registro de seguridad sellado | Cada evento | `docs/security/registro-de-seguridad.md` |
| Avisos de seguridad al dueño de la cuenta | Cada cambio de contraseña, correo o recuperación | `account-notices.ts` (obligatorios) |

## 2. Revisión periódica de accesos (mensual)

Administración, en Gobierno › Identidad y acceso:

1. **Revisiones de acceso › Iniciar una revisión**: persona por persona, mantener o quitar el acceso; al completarla
   se aplica cada «quitar» y queda registrado quién decidió qué. **Personas** muestra, para cada una, rol,
   coordinación, grupos, segundo factor, passkeys, cuentas vinculadas, tokens activos y último inicio de sesión.
2. Quitar el acceso a quien ya no debe tenerlo (en la revisión, o en Educadores › Quitar acceso o Registrar salida).
3. Revocar tokens que nadie reconozca (Identidad y acceso › Integraciones) y desvincular cuentas externas que no
   correspondan (panel de la persona).
4. **Verificar la cadena** del registro (Registros) y guardar el último sello fuera de la plataforma.
5. Revisar en el registro los bloqueos (`sign_in_locked`), los fallos del segundo paso (`mfa_failed`) y los cambios de
   política o de proveedor.

## 3. Respuesta a incidentes

| Paso | Qué hacer | Herramienta |
| --- | --- | --- |
| 1. Contener | Cuenta comprometida: cerrar sus sesiones, quitar el acceso, restablecer su contraseña y su segundo factor, revocar sus tokens | Educadores (menú de la persona), Seguridad › Tokens |
| 2. Entender | Filtrar el registro por persona y fechas; exportarlo; verificar la cadena | Seguridad › Registro |
| 3. Erradicar | Si se filtró un secreto del Worker, rotarlo (§4); si es un fallo del código, corregirlo con un PR y todos los checks | GitHub, Cloudflare |
| 4. Recuperar | Restaurar desde la copia de la organización si hubo pérdida de datos | `docs/operations/respaldo-y-restauracion.md` |
| 5. Avisar | A la Product Owner y a la institución afectada, con qué pasó, qué datos y qué se hizo; si hay datos de menores, de inmediato | Correo |
| 6. Aprender | Registrar el incidente en `docs/transformacion/estado/CURRENT-STATE.md` y la acción en la cola | Repositorio |

## 4. Rotación de secretos

| Secreto | Cuándo | Cómo |
| --- | --- | --- |
| `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_SECRET` | Antes de su vencimiento (Microsoft: máximo 24 meses) o si se expone | Nuevo secreto en el proveedor → `wrangler secret put` → borrar el anterior |
| `APPLE_PRIVATE_KEY` | Si se expone | Nueva clave en Apple → `wrangler secret put APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` → revocar la anterior |
| `BREVO_API_KEY`, `OPENAI_API_KEY` | Anual o si se expone | Igual, en el panel del servicio |
| Token de despliegue de Cloudflare (GitHub) | Anual o si se expone | Crear uno con los mismos permisos, actualizar el secreto del repositorio, revocar el anterior |
| Secreto del proveedor institucional | Cuando la institución lo renueve | Seguridad › Proveedor institucional → escribirlo y volver a probar |
| Clave de la organización (cifra TOTP y el secreto institucional) | No se rota en la aplicación | Si se sospecha exposición del almacenamiento: restablecer el segundo factor de todos y volver a guardar el proveedor |

Tras rotar cualquier secreto: un despliegue con `critical-flows` verde y un inicio de sesión de prueba con el proveedor.
