# Validación de accesibilidad y seguridad de la versión 1.0

Resultado de ST-077. Las comprobaciones son automáticas y se ejecutan en cada cambio; la verificación en producción
se repite después de cada publicación.

## Accesibilidad

`tests/e2e/accessibility.spec.ts` audita con axe-core las reglas WCAG 2.0, 2.1 y 2.2 de niveles A y AA, en escritorio
(1365 × 900) y en móvil (390 × 844, táctil):

- Sin sesión: inicio de sesión.
- Docencia: Inicio, Agenda, sección, Estudiantes, Horario, Cronograma, una clase, Cursos, Crear curso, Resumen del
  curso, Plan curricular, Contenido, editor de lección (también con una pregunta abierta), vista previa, biblioteca
  del curso y su diálogo de recurso, Secciones del curso, Configuración, Biblioteca, Buscar, Ayuda y Guía de estilo.
- Administración: Organización, Educadores, Configuración académica y el diálogo de programa.
- Estudiante: inicio de la lección compartida y una pregunta.

La misma prueba recorre con teclado el enlace para saltar al contenido, el foco visible, la búsqueda con `/`, los
menús con flechas y Escape, y un diálogo de confirmación que devuelve el foco.

## Seguridad

`tests/e2e/release.spec.ts` y `tests/build.test.ts` comprueban en páginas, enlaces profundos y API:

| Cabecera | Valor |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; …; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, idéntica en páginas y API |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

Se mantienen los controles de v0.8.1: sesiones en cookie `HttpOnly` y `SameSite=Strict`, escrituras solo del mismo
origen, límite de intentos de inicio de sesión, aislamiento por organización y revocación de sesiones al cambiar un
rol o salir de un equipo.

## Hallazgos y decisiones

| Hallazgo | Decisión |
| --- | --- |
| En móvil, las migas de la página de una clase ocupaban dos líneas y sus enlaces quedaban a menos de 24 px entre sí (WCAG 2.5.8). | Corregido: cada miga tiene 24 px de alto mínimo. |
| Las páginas no enviaban `Strict-Transport-Security`. | Corregido. El dominio `workers.dev` ya exige HTTPS por la lista de precarga de `.dev`; la cabecera cubre también un dominio propio futuro. |
| `style-src` incluye `'unsafe-inline'`. | Aceptado: la interfaz aplica estilos en línea (barras de avance, semana del horario y visor de documentos). Los scripts siguen limitados a `'self'`, sin código en línea. |
| `connect-src` admite `ws:` y `wss:` en general. | Aceptado para 1.0: la coedición usa WebSocket del mismo origen y la API de la sala lo verifica. Restringirlo al origen queda en la deuda técnica. |
| axe detecta una parte de los criterios WCAG; no reemplaza una prueba con lector de pantalla. | Aceptado: la navegación por teclado se prueba de forma automática; la prueba con NVDA y TalkBack queda en la deuda técnica. |
| Las cuentas de las organizaciones de demostración tienen contraseña pública. | Aceptado: sus datos son ficticios. La organización Happy Learners usa contraseñas privadas. |
| El respaldo no copia el contenido de los documentos en R2. | Aceptado: los documentos no se eliminan, solo se archivan, y el respaldo conserva su clave. Ver [respaldo-y-restauracion.md](respaldo-y-restauracion.md). |
| Restaurar reemplaza todos los datos de una organización. | La ruta de restauración no existe en producción; solo se activa de forma temporal y documentada. |
