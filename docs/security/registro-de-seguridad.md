# Registro de seguridad y auditoría

REL-007 (SPR-004, DEC-058 de `happy-learners-ops`): ST-137 (registro), ST-068 (auditoría restringida), ST-184 (solo
administración), ST-186 (registro verificable) y ST-187 (privacidad). Desde 1.7.0.

## Qué se registra

Cada evento tiene tipo, resultado (correcto, fallido o registro), la persona a la que afecta, quién lo hizo, el método,
un detalle breve, el resumen del dispositivo, el país y la fecha. Los tipos están en
`packages/domain/src/security.ts` (`securityEventTypes`):

| Grupo | Eventos |
| --- | --- |
| Inicio de sesión | Correcto y fallido (también con un usuario desconocido, sin el nombre), bloqueo temporal tras 10 fallos en 15 minutos, cierre de sesión |
| Sesiones | Sesión cerrada por su dueño, todas las sesiones de una persona cerradas por administración |
| Contraseña y correo | Cambio, restablecimiento por administración, cambio del correo de acceso |
| Roles y permisos | Cuenta creada con su rol, cambio de rol, activación o desactivación, salida, coordinación académica y grupos de seguridad |
| Registro | Cada exportación del registro |

Los factores nuevos (enlace por correo, recuperación, segundo factor, passkeys, proveedores, tokens y proveedor
institucional) agregan sus eventos al entregarse.

## Qué no se registra nunca

Contraseñas, códigos, tokens, enlaces, direcciones IP ni el agente de usuario completo: solo el resumen del dispositivo
(«Firefox en Windows») y el país de `CF-IPCountry` que las sesiones ya guardaban (ST-158). Un fallo con un usuario que no
existe se registra sin el nombre escrito. La prueba `tests/security-log.test.ts` lo comprueba sobre el Worker construido.

## Cadena de sellos (ST-186)

- Cada evento se sella en la misma transacción de SQLite que lo escribe: `sealSecurityEvents`
  (`apps/api/src/security-chain.ts`) corre dentro del Durable Object de la organización cuando un lote inserta en
  `security_events` (`storage.ts`). El sello es el SHA-256 del sello anterior y de todos los campos del evento, en orden
  fijo (`sealText`). Ninguna petición ve un evento sin sellar.
- Un disparador impide cambiar un evento sellado. Si alguien cambiara, borrara, reordenara o agregara un evento por
  fuera de la aplicación, «Verificar la cadena» recalcula todos los sellos desde el ancla y señala el evento donde se
  rompe; si faltan los más recientes, lo detecta la cabeza guardada en `security_chain`.
- La exportación CSV incluye el sello de cada fila; administración puede guardar el último sello fuera de la
  plataforma como referencia.
- Alcance: la cadena hace evidente una alteración de los datos, no la impide a quien controle el código desplegado.
  Por eso el despliegue pasa por CI con revisión y escáneres (`docs/operations/escaneres.md`).

## Retención

365 días (`securityRetentionDays`). Una vez al día, al sellar, los eventos más antiguos salen en orden y la cadena guarda
el sello del último que salió como su ancla, así que sigue verificándose. El historial de accesos de cada persona en su
cuenta conserva 90 días, como antes.

## Quién lo ve

Solo administración (Gobierno › Seguridad). Cada ruta `/api/security/*` responde 401 sin sesión y 403 a quien no es
administración; la prueba lo recorre ruta por ruta. Cada persona ve sus propios inicios de sesión en su cuenta y recibe
sus eventos de seguridad, con sus sellos, en la copia de sus datos (sin quién más aparece en ellos).

## Auditoría (ST-068)

Gobierno › Seguridad › Auditoría muestra las acciones críticas de toda la organización (la actividad) y el historial de
cambios de rol y de acceso, filtrados por persona, objeto y fecha. A diferencia de la actividad que cada persona ve de
sus cursos, cubre toda la organización y solo la consulta administración.

## Respaldo

La copia de la organización no lleva el registro ni su cadena, ni ninguna credencial (segundo factor, códigos de
recuperación, passkeys, cuentas vinculadas, proveedor institucional, desafíos de inicio de sesión ni tokens): son del
espacio que los emitió, como las sesiones. La política de acceso sí se copia.
