# Cola de aprobaciones del dueño del producto

Solo lo que el equipo de desarrollo no debe decidir solo. Cada entrada: decisión, recomendación, alternativas, riesgo, qué bloquea
y qué sigue avanzando mientras tanto.

| Id | Decisión | Estado |
| --- | --- | --- |
| AP-01 | R1: nombres de estudiantes visibles con el código de sección | **Resuelto 02-nov:** el dueño autorizó la recomendación; paso 1 hecho en 1.6.1 |
| AP-02 | Fusionar y desplegar el PR de cada hito | **Autorizado 02-nov** («sigue adelante con el merge y también todo lo demás»): #103 en producción (`54fd626`) |
| AP-03 | Monitor externo de `/api/health` | Pendiente |
| AP-04 | Escáneres obligatorios en `main` desde el 13-nov | Autorizado 02-nov; se aplica el 13-nov (SEC-04) |
| AP-05 | Prueba de penetración externa | Pendiente (antes de instituciones de pago) |
| AP-06 | Nombre, marca, empresa y mesa de ayuda (carril D) | Pendiente |
| AP-07 | Tope mensual de IA por organización y plan | Pendiente (sin urgencia; hay guarda por persona) |

## AP-01 · R1: qué ve un estudiante al entrar con el código de su sección

- **Hoy:** con el código (~40 bits, 30 intentos cada 15 min por dirección) se ve la lista completa de nombres de la
  sección para elegirse. Son menores; el código circula en el aula y puede salir de ella.
- **Recomendación:** dos pasos. (1) Ya: mostrar **nombre de pila + inicial del apellido** («Ana L.»), con un número si
  dos coinciden; es reversible, no cambia el flujo y reduce lo que expone un código filtrado. (2) Después, una opción
  por sección: **código personal por estudiante** (tarjeta impresa o QR por el docente) que entra directo sin lista,
  para secciones de estudiantes mayores o con mayor riesgo.
- **Alternativas:** solo el código personal (el más seguro; más fricción para niños pequeños y para el docente);
  escribir el nombre en lugar de elegirlo (adivinable; peor para niños); dejarlo igual (riesgo aceptado por escrito).
- **Riesgo si no se decide:** exposición de nombres completos de menores a quien obtenga un código.
- **Bloquea:** solo el cambio de R1. Todo lo demás sigue.

## AP-02 · Fusionar y desplegar cada hito

- Fusionar a `main` despliega producción (regla del repositorio). El equipo de desarrollo abre el PR con evidencia y espera la
  autorización explícita. **Bloquea:** solo el despliegue; el siguiente hito se apila en otra rama.

## AP-03 · Monitor externo de `/api/health`

- **Recomendación:** un servicio con plan gratuito (por ejemplo UptimeRobot, comprobación cada 5 min, alerta por
  correo al dueño). Costo 0; ~288 peticiones al día. Verificado (SEC-02): `/api/health` lee una fila del Durable Object,
  288 al día de 5 M, y así detecta también la cuota agotada. Configuración en `docs/operations/slo.md`. **Requiere al usuario:** crear la cuenta (credenciales propias).
  **Alternativa:** el cron diario de GitHub Actions ya existente (detecta caídas tarde: hasta 24 h).
- **03-nov (dueño):** pidió explicación. Es un servicio externo que cada 5 min abre `/api/health` desde fuera de
  Cloudflare y avisa por correo si la plataforma no responde (como el 30-oct, cuando nadie se enteró hasta entrar).
  Sigue pendiente solo la cuenta gratuita (UptimeRobot, Better Stack o similar), que va a nombre del dueño. Un cron de
  GitHub Actions cada 5 min no conviene: en un repositorio privado gastaría ~8 600 min/mes de los 2 000 gratuitos.

## AP-04 · Escáneres obligatorios en `main`

- Desde el 13-nov (dos semanas sin falsos positivos), marcar `secrets`, `dependencies` y `code` como requeridos en la
  protección de la rama. Es un cambio de configuración del repositorio en GitHub. **Recomendación:** autorizar al
  equipo de desarrollo a hacerlo con `gh api` ese día, tras revisar el historial de corridas.

## AP-05 · Prueba de penetración externa

- Requisito antes de incorporar instituciones de pago. Implica contratar un tercero (gasto). Alcance listo en
  `docs/security/alcance-pentest.md` (SEC-03): superficies (web, API, códigos públicos, archivos, IA, respaldo), cuentas de prueba en una
  organización aislada, reglas de enfrentamiento y criterio de cierre. **Bloquea:** la preparación comercial, no el
  desarrollo.
- **03-nov (dueño):** preguntó por opciones gratuitas. No hay pentest manual gratuito y seguro; lo gratuito automatiza
  parte del trabajo. **Decidido (SEC-06):** escaneo DAST con OWASP ZAP (Apache 2.0) en GitHub Actions contra la vista
  previa, nunca contra producción: primero pasivo (baseline), luego autenticado con las cuentas de prueba; hallazgos
  triados a mano. Más Mozilla Observatory y SSL Labs para cabeceras y TLS. El pentest manual de un tercero sigue
  siendo el requisito antes de instituciones de pago.

## AP-06 · Carril D (nombre, marca, empresa, mesa de ayuda)

- Material listo en `docs/empresa/marca-y-soporte.md`. El equipo de desarrollo no inventa identidad ni políticas. Mientras tanto se
  usa «Happy Learners» y la Ayuda actual.
- **03-nov (dueño):** en proceso con una diseñadora; el nombre más probable es «Acervum», aún en discusión. HLP-01
  sigue esperando. Cuando se decida, el cambio de nombre es un incremento propio (textos, metadatos, correo).

## AP-07 · Tope de IA por organización

- **Hoy:** desde 1.6.1, 60 peticiones síncronas por persona y hora (guarda de seguridad). No hay tope mensual por
  organización ni por plan: el uso de OpenAI se paga con la clave de HL.
- **Recomendación:** decidirlo junto con los planes comerciales; técnicamente cuesta poco (sumar `ai_runs` del mes).
- **Bloquea:** nada hoy.
- **03-nov (dueño):** pidió una recomendación con hechos. **Hechos:** cada tarea tiene un tope de salida en el código
  (`openai.ts`): redactar y sugerir campos 2 000 tokens, reglas 4 000, mejorar 8 000, propuestas 16 000 por defecto;
  la entrada de una propuesta tiene como máximo 6 000 caracteres del libro. Con GPT-5 mini a USD 0,25 / 2,00 por
  millón (entrada / salida), el peor caso por llamada es ~USD 0,004 (redactar), ~0,017 (mejorar) y ~0,033
  (propuesta). Un educador muy activo en un mes (40 redacciones, 20 mejoras, 12 propuestas) cuesta como máximo
  ~USD 0,9; lo real suele ser bastante menos porque las respuestas casi nunca llegan al tope.
- **Recomendación:** presupuesto mensual por organización en USD, no en tokens: USD 2 por educador activo, mínimo
  USD 20 al mes (cubre el doble del peor caso). Aviso a administración al 80 %; al 100 % la IA responde «se alcanzó el
  presupuesto del mes» y las propuestas en cola esperan al mes siguiente; HL puede subirlo. Se mantiene el límite de
  60 por persona y hora. Revisar al primer mes con datos reales en «Inteligencia artificial» (registrar el precio del
  modelo para que el costo no aparezca como «No disponible») y ajustar a 1,5 × lo usado por el educador del percentil
  95. Si el costo importa más que la calidad en tareas cortas, AIG-3 (modelo menor para redactar y sugerir).
- **Decidido 03-nov:** el dueño autorizó continuar con lo necesario; se implementa como AIG-6.

## AP-08 · ¿Horas efectivas muestra montos según contrato?

- **Hoy:** DEC-043 dice que las horas reconocen el voluntariado y equilibran la carga, «no son nómina». Desde los
  contratos (ST-15x) un contrato puede ser por hora o por clase, con monto y moneda.
- **Propuesta (HRS-03):** columna «Según contrato» en el resumen por persona, solo para administración: tarifa por
  hora × horas, o por clase × clases que suman, con el contrato vigente; los contratos fijos y sin remuneración se
  muestran como tales. Rotulada como referencia, no como cálculo de nómina.
- **Por qué pide decisión:** cambia el principio de DEC-043 y muestra montos de dinero por persona.
- **Bloquea:** HRS-03.
- **Decidido 03-nov (dueño):** el monto por horas registradas solo para contratos por hora que no son de empleo
  (asalariados), voluntariado (ad honorem) ni servicios profesionales con su propio convenio; esa persona lo ve en «Mis
  horas». Administración ve además una referencia del resto: por hora (otros contratos), por clase × clases, y un
  monto fijo mensual convertido a costo por hora efectiva cuando el filtro es un mes completo. **Hecho en 1.6.12
  (HRS-03).**
