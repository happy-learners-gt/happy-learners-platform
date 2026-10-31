# Cola de aprobaciones del dueño del producto

Solo lo que el equipo de desarrollo no debe decidir solo. Cada entrada: decisión, recomendación, alternativas, riesgo, qué bloquea
y qué sigue avanzando mientras tanto.

| Id | Decisión | Estado |
| --- | --- | --- |
| AP-01 | R1: nombres de estudiantes visibles con el código de sección | Pendiente |
| AP-02 | Fusionar y desplegar el PR de cada hito | Pendiente (M1 aún no tiene PR) |
| AP-03 | Monitor externo de `/api/health` | Pendiente |
| AP-04 | Escáneres obligatorios en `main` desde el 13-nov | Pendiente (fecha) |
| AP-05 | Prueba de penetración externa | Pendiente (antes de instituciones de pago) |
| AP-06 | Nombre, marca, empresa y mesa de ayuda (carril D) | Pendiente |

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
  correo al dueño). Costo 0; ~288 peticiones al día. Antes de activarlo, el equipo de desarrollo verifica que `/api/health` no lea
  filas del Durable Object (para no gastar cuota). **Requiere al usuario:** crear la cuenta (credenciales propias).
  **Alternativa:** el cron diario de GitHub Actions ya existente (detecta caídas tarde: hasta 24 h).

## AP-04 · Escáneres obligatorios en `main`

- Desde el 13-nov (dos semanas sin falsos positivos), marcar `secrets`, `dependencies` y `code` como requeridos en la
  protección de la rama. Es un cambio de configuración del repositorio en GitHub. **Recomendación:** autorizar al
  equipo de desarrollo a hacerlo con `gh api` ese día, tras revisar el historial de corridas.

## AP-05 · Prueba de penetración externa

- Requisito antes de incorporar instituciones de pago. Implica contratar un tercero (gasto). El equipo de desarrollo prepara el
  alcance (cola SEC-03): superficies (web, API, códigos públicos, archivos, IA, respaldo), cuentas de prueba en una
  organización aislada, reglas de enfrentamiento y criterio de cierre. **Bloquea:** la preparación comercial, no el
  desarrollo.

## AP-06 · Carril D (nombre, marca, empresa, mesa de ayuda)

- Material listo en `docs/empresa/marca-y-soporte.md`. El equipo de desarrollo no inventa identidad ni políticas. Mientras tanto se
  usa «Happy Learners» y la Ayuda actual.
