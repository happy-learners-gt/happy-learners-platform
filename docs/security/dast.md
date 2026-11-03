# DAST gratuito con OWASP ZAP (SEC-06)

Decidido el 03-nov-2026 (AP-05): mientras no haya pentest manual de un tercero, un escaneo dinámico gratuito con
OWASP ZAP (Apache 2.0). Complementa los escáneres estáticos (`docs/operations/escaneres.md`); **no reemplaza** el
pentest, que sigue siendo requisito antes de instituciones de pago (`docs/security/alcance-pentest.md`).

## Cómo corre

- `.github/workflows/dast.yml`: semanal (lunes) y a pedido. Levanta el Worker **en el propio runner** con los datos de
  demostración y corre `zap-baseline.py` (araña de 3 min y reglas pasivas). Nunca contra producción ni contra la vista
  previa: ambas comparten la cuota de lecturas de Durable Objects de la cuenta (incidente del 30-oct).
- El resumen de la corrida lista los hallazgos; el informe HTML/JSON queda como artefacto. No falla la corrida: cada
  hallazgo se tría a mano aquí.
- En local (WSL con Docker Desktop): Worker con `--ip 0.0.0.0` y ZAP con
  `--add-host=host.docker.internal:host-gateway -t http://host.docker.internal:<puerto>`.

## Triaje del 03-nov-2026 (baseline, sin sesión)

| Hallazgo | Riesgo ZAP | Decisión |
| --- | --- | --- |
| CSP: directiva comodín (`connect-src 'self' wss: ws:`) | Medio | **Corregido en 1.6.13:** `connect-src 'self'` en `_headers` y en la API; CSP 3 ya permite el websocket del mismo origen (E2E `studio`, edición en vivo) |
| CSP: `style-src 'unsafe-inline'` | Medio | **Aceptado:** React aplica estilos en atributos `style` (barras de progreso, posiciones); sin scripts en línea (`script-src 'self'`), el riesgo es inyección de estilos, no de código. Revisar si se migra a clases |
| Falta Cross-Origin-Opener-Policy / Resource-Policy | Bajo | **Corregido en 1.6.13:** `same-origin` en ambas |
| Falta Cross-Origin-Embedder-Policy | Bajo | **Aceptado:** `require-corp` rompería visores de archivos y blobs; la plataforma no usa APIs que lo exijan |
| Divulgación de IP privada / marcas de tiempo en JS | Bajo | **Falso positivo:** cadenas del paquete de íconos y de la librería de fechas |
| Contenido almacenable / aplicación moderna | Informativo | Sin acción |

## Corrida en CI del 03-nov-2026 (`main` 1.6.13, run 41689429482)

Confirma las correcciones: ya no aparecen el comodín de CSP ni la falta de COOP/CORP. Quedan solo los aceptados o
falsos positivos de la tabla anterior (`style-src 'unsafe-inline'`, COEP, IP privada y marcas de tiempo en JS,
informativos). Sin hallazgos altos.

## Escaneo con sesión (SEC-07, 03-nov-2026)

- Plan `.zap/authenticated.yaml`, segundo trabajo de `dast.yml`: administración de la demostración con sesión, 24 rutas
  GET de la API sembradas (la SPA no tiene enlaces que la araña siga), araña, reglas pasivas y **activas** (inyección,
  XSS, recorrido de rutas…), solo contra el Worker local del runner. Quedan fuera cierre de sesión, contraseña, login,
  respaldo y restauración.
- **Trampa encontrada:** ZAP no expande variables de entorno en el `replacer`; la primera corrida mandó la cookie
  literal `${COOKIE}` y todo respondió 401 (resultado inválido, descartado). El flujo escribe la cookie sobre
  `__SESSION_COOKIE__` en una copia del plan y la borra antes de subir el informe. **Comprobar siempre** en el registro
  del Worker que hubo respuestas 200 y no solo 401: el paso «Check the scan was signed in» lo hace en CI y falla si
  no hay sesión. Primera corrida en CI (run 41701799418, rama de 1.6.14): ambos trabajos verdes, mismos hallazgos.
- **Resultado válido:** 198 respuestas 200 con sesión, 199 respuestas 400 (los intentos de inyección los rechaza la
  validación), 114 404, 20 405, 2 403 y **ningún 500**. Hallazgos: solo los ya aceptados (`style-src 'unsafe-inline'`) y
  falsos positivos (IP privada y marcas de tiempo en el JS). Sin inyección, XSS ni fuga de datos detectadas.
- **Límite:** las reglas activas atacan parámetros de URL de rutas GET; los cuerpos JSON de POST/PUT no se fuzzean.
  Siguiente paso posible: una lista de peticiones POST de ejemplo, o dejarlo al pentest manual (AP-05).

## Siguiente

- Fuzzing de cuerpos JSON de POST/PUT contra el Worker local (o en el pentest manual).
- Cabeceras de producción y TLS: Mozilla Observatory y SSL Labs a mano, una vez por versión mayor (una petición cada
  uno, sin carga).
