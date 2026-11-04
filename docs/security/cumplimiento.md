# Preparación para el cumplimiento

REL-007, ST-188 (SPR-004, DEC-058). Qué controles cumple la plataforma desde 1.7.0 frente a dos referencias públicas y
dónde está la evidencia, para responder a una institución con hechos.

> **Esto no es una certificación ni una auditoría independiente.** Es una autoevaluación del responsable técnico sobre
> el código y las pruebas de este repositorio. Happy Learners no está certificada en SOC 2, ISO/IEC 27001 ni ninguna
> otra norma, y no debe decirse que lo está. La prueba de penetración externa (AP-05) sigue pendiente.

Referencias: OWASP Application Security Verification Standard 4.0.3, nivel 2 (ASVS), y NIST SP 800-63B (autenticación).
Estado: **Cumple** (con evidencia), **Parcial** (cumple una parte; la brecha está en §3) o **Brecha**.

## 1. OWASP ASVS 4.0.3, nivel 2

| Capítulo | Requisito (resumen) | Estado | Evidencia |
| --- | --- | --- | --- |
| V2.1 Contraseñas | Mínimo 12, máximo 128 o más, sin reglas de composición, rechazar contraseñas comunes y filtradas | Cumple | `access-policy.ts` (`passwordProblem`), `sign-in.ts` (`breached`, k-anonimato); `tests/sign-in-links.test.ts` |
| V2.2 Autenticación general | Límites contra fuerza bruta; aviso al dueño de cambios de seguridad | Cumple | Límites por dirección y por cuenta, bloqueo registrado; avisos obligatorios (`account-notices.ts`); `tests/security-log.test.ts` |
| V2.4 Almacenamiento de credenciales | Hash con sal y función de derivación aprobada | Parcial | PBKDF2-SHA256 con 100 000 iteraciones (ASVS pide ≥ 600 000 para SHA-256): R2, límite de workerd |
| V2.5 Recuperación | Sin preguntas secretas; enlace de un uso que caduca; avisar al dueño | Cumple | `recoverPassword`; `tests/sign-in-links.test.ts` |
| V2.7–2.8 Segundo factor y OTP | TOTP con tiempo limitado, sin reutilización, códigos de recuperación de un uso | Cumple | `totp.ts`, `mfa.ts`; `tests/mfa.test.ts` (vectores RFC 6238) |
| V2.9 Autenticadores criptográficos | Passkeys con verificación de la persona y origen | Cumple | `webauthn.ts`, `passkeys.ts`; `tests/passkeys.test.ts` |
| V3.2–3.3 Sesiones | Token aleatorio de 256 bits; nuevo al entrar; se invalida al salir, al cambiar la contraseña o el factor | Cumple | `auth.ts`, `sign-in.ts`; cierre de sesiones propio y por administración |
| V3.3.2 Reautenticación | Duración máxima e inactividad | Parcial | Duración fija de 1 a 12 horas por política; sin cierre por inactividad (§3) |
| V3.4 Cookies | `Secure`, `HttpOnly`, `SameSite`, `Path` | Cumple | `cookie()` en `auth.ts` |
| V3.5 Tokens | Tokens de integración revocables y con caducidad | Cumple | `tokens.ts`; `tests/tokens.test.ts` |
| V4 Control de acceso | Mínimo privilegio, comprobado en el servidor en cada petición; rutas administrativas protegidas | Cumple | `route-matrix.test.ts`, `access-matrix.test.ts`, `security-log.test.ts` (401/403 por ruta); `docs/security/accesos.md` |
| V5 Validación | Entradas validadas; SQL con parámetros | Cumple | Semgrep (`sql-interpolated-text`) en cada PR; `auditoria-2026-11.md` §4 |
| V6 Criptografía almacenada | Secretos cifrados con claves fuera de los datos | Cumple | AES-GCM con la clave de la organización fuera de SQL (`mfa.ts`, `storage.ts`) |
| V7 Registro | Eventos de seguridad sin datos sensibles, con hora, protegidos contra alteración | Cumple | `registro-de-seguridad.md`; cadena de sellos; `tests/security-log.test.ts` |
| V8 Protección de datos | Mínimo de datos personales; exportación de los propios; caché desactivada en respuestas sensibles | Cumple | Sin IP ni agente de usuario; copia de mis datos con mis eventos; `Cache-Control: no-store` |
| V9 Comunicaciones | TLS en todo; HSTS | Cumple | Cloudflare; encabezados en `index.ts` y `_headers` |
| V10 Código malicioso | Dependencias revisadas | Cumple | OSV-Scanner y gitleaks en cada PR; sin dependencias nuevas en REL-007 |
| V13 API | Métodos permitidos por ruta; protección CSRF | Cumple | Tabla de métodos; `Origin` obligatorio en escrituras |
| V14 Configuración | Encabezados de seguridad, CSP | Cumple | CSP sin orígenes externos, COOP, CORP, `frame-ancestors 'none'`; DAST semanal (`dast.md`) |

## 2. NIST SP 800-63B

| Sección | Requisito | Estado | Evidencia |
| --- | --- | --- | --- |
| 5.1.1 Secretos memorizados | Al menos 8 caracteres (aquí 12); hasta 64 o más; comparar con listas de contraseñas comprometidas; sin pistas ni reglas de composición | Cumple | `passwordProblem`, `breached` |
| 5.1.3 Fuera de banda | Enlace por correo de un uso | Cumple para AAL1 | NIST no admite el correo como fuera de banda para AAL2; el enlace es un primer factor, y con TOTP activo se pide el segundo |
| 5.1.4 OTP de un factor | TOTP con secreto de 160 bits, ventana de ±1 paso, sin reutilización | Cumple | `totp.ts` |
| 5.1.8 Criptográfico multifactor | Passkey con verificación de la persona | Cumple | `webauthn.ts` (exige UV) |
| 5.2.2 Límite de intentos | Como máximo 100 fallos consecutivos por cuenta | Cumple | 10 fallos por cuenta cada 15 minutos; 5 por desafío de segundo paso |
| 5.2.5 Resistencia al phishing | Autenticador ligado al origen | Cumple con passkeys | Verificación de origen y `rpId` |
| 5.2.8 Resistencia a la repetición | Desafíos de un uso | Cumple | `auth_challenges` de un uso; contador de passkeys |
| 7.1 Sesiones | Secretos de sesión de al menos 64 bits, aleatorios, en cookie segura | Cumple | 256 bits |
| 7.2 Reautenticación AAL2 | Cada 12 horas y tras 30 minutos de inactividad | Parcial | Máximo 12 horas por política; sin inactividad (§3) |

## 3. Brechas y plan

| Brecha | Riesgo | Plan |
| --- | --- | --- |
| PBKDF2 con 100 000 iteraciones (R2) | Bajo: límites por cuenta y dirección, segundo factor disponible | Subir cuando workerd lo permita o pasar a Argon2 con rehash al entrar |
| Sin cierre de sesión por inactividad | Medio en equipos compartidos | Inactividad configurable en la política (siguiente incremento de seguridad) |
| El enlace por correo no es un segundo factor | Bajo: con TOTP activo se pide igual | Documentado; la política puede desactivar el enlace |
| Prueba de penetración externa pendiente (AP-05) | Medio antes de instituciones de pago | Contratarla con `alcance-pentest.md` |
| Escáneres obligatorios en `main` (SEC-04) | Bajo | ST-189: protección de rama con los tres escáneres |
| Sin certificación (SOC 2, ISO 27001) | Comercial | Esta matriz es la base si una institución la pide; requiere un auditor externo |
