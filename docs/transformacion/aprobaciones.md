# Cola de aprobaciones del dueño del producto

Solo lo que Claude Code no debe decidir solo. Cada entrada: decisión, recomendación, alternativas, riesgo, qué bloquea
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

- Fusionar a `main` despliega producción (regla del repositorio). Claude Code abre el PR con evidencia y espera la
  autorización explícita. **Bloquea:** solo el despliegue; el siguiente hito se apila en otra rama.

## AP-03 · Monitor externo de `/api/health`

- **Recomendación:** un servicio con plan gratuito (por ejemplo UptimeRobot, comprobación cada 5 min, alerta por
  correo al dueño). Costo 0; ~288 peticiones al día. Verificado (SEC-02): `/api/health` lee una fila del Durable Object,
  288 al día de 5 M, y así detecta también la cuota agotada. Configuración en `docs/operations/slo.md`. **Requiere al usuario:** crear la cuenta (credenciales propias).
  **Alternativa:** el cron diario de GitHub Actions ya existente (detecta caídas tarde: hasta 24 h).

## AP-04 · Escáneres obligatorios en `main`

- Desde el 13-nov (dos semanas sin falsos positivos), marcar `secrets`, `dependencies` y `code` como requeridos en la
  protección de la rama. Es un cambio de configuración del repositorio en GitHub. **Recomendación:** autorizar a
  Claude Code a hacerlo con `gh api` ese día, tras revisar el historial de corridas.

## AP-05 · Prueba de penetración externa

- Requisito antes de incorporar instituciones de pago. Implica contratar un tercero (gasto). Alcance listo en
  `docs/security/alcance-pentest.md` (SEC-03): superficies (web, API, códigos públicos, archivos, IA, respaldo), cuentas de prueba en una
  organización aislada, reglas de enfrentamiento y criterio de cierre. **Bloquea:** la preparación comercial, no el
  desarrollo.

## AP-06 · Carril D (nombre, marca, empresa, mesa de ayuda)

- Material listo en `docs/empresa/marca-y-soporte.md`. Claude Code no inventa identidad ni políticas. Mientras tanto se
  usa «Happy Learners» y la Ayuda actual.

## AP-07 · Tope de IA por organización

- **Hoy:** desde 1.6.1, 60 peticiones síncronas por persona y hora (guarda de seguridad). No hay tope mensual por
  organización ni por plan: el uso de OpenAI se paga con la clave de HL.
- **Recomendación:** decidirlo junto con los planes comerciales; técnicamente cuesta poco (sumar `ai_runs` del mes).
- **Bloquea:** nada hoy.

## AP-08 · ¿Horas efectivas muestra montos según contrato?

- **Hoy:** DEC-043 dice que las horas reconocen el voluntariado y equilibran la carga, «no son nómina». Desde los
  contratos (ST-15x) un contrato puede ser por hora o por clase, con monto y moneda.
- **Propuesta (HRS-03):** columna «Según contrato» en el resumen por persona, solo para administración: tarifa por
  hora × horas, o por clase × clases que suman, con el contrato vigente; los contratos fijos y sin remuneración se
  muestran como tales. Rotulada como referencia, no como cálculo de nómina.
- **Por qué pide decisión:** cambia el principio de DEC-043 y muestra montos de dinero por persona.
- **Bloquea:** HRS-03.
