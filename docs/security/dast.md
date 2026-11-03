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

## Siguiente

- Escaneo autenticado (contexto de ZAP con inicio de sesión de las cuentas de prueba) para las páginas internas y la
  API; reglas activas solo contra el Worker local.
- Cabeceras de producción y TLS: Mozilla Observatory y SSL Labs a mano, una vez por versión mayor (una petición cada
  uno, sin carga).
