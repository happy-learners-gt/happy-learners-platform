# Happy Learners 0.1.0

Fuente documental canónica: happy-learners-ops. Producto de Sprint 1: HL-9, HL-10, HL-11, HL-12, HL-13, HL-14 y evidencia operativa de HL-15.

Producción del MVP: https://happy-learners-demo.lfmendoza-alvarez.workers.dev

Demostración funcional con cuentas y contenido sintéticos: `instructor-demo` consulta la lección publicada; `admin-demo` configura la organización; `externo-demo` demuestra el aislamiento de otra organización. Contraseña pública de demostración: `Aprender-2026!`. No introducir información personal.

Verificación: `npm ci`, `./scripts/verify`, `npx playwright install chromium`, `npm run test:e2e`. Se construye una vez y se prueba el Worker compilado con SQLite real. E2E reutiliza ese build. `BASE_URL` y `EXPECTED_SHA` permiten probar la versión publicada.

Cada organización tiene un Durable Object con SQLite. La migración `database/migrations/0001_sprint_one.sql` se aplica una vez en una transacción y conserva solo las semillas de esa organización. Las membresías, programas y lecciones tienen claves foráneas. No existe endpoint SQL público.

Sesiones opacas de ocho horas: solo su hash persiste y logout las revoca. Contraseñas sintéticas verificadas con PBKDF2-SHA256, sal individual y 100000 iteraciones. Registro, invitaciones, recuperación de contraseña y cuentas reales quedan fuera del alcance.

Actions verifica PR y despliega automáticamente desde main el artefacto verificado, comprobando SHA y hashes sin recompilar. Ejecuta E2E sobre la URL publicada y una comprobación cada hora de los flujos críticos.

No hay expedientes, fotografías, asistencia ni evaluaciones individuales. La lista de materiales vive en memoria del navegador. Los logs de aplicación usan códigos fijos y SHA. El limitador conserva un hash diario de la IP durante una ventana de quince minutos; las entradas vencidas se eliminan en la siguiente autenticación válida. Cloudflare mantiene su propia telemetría operativa.

Las guías completas, decisiones, trazabilidad y revisión de horas se generan en ops y se publican en OneDrive.
