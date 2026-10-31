# Riesgos y presupuesto

## 1. Recursos y límites conocidos

| Recurso | Límite / plan | Consumo conocido | Regla del programa |
| --- | --- | --- | --- |
| Cloudflare Workers + Durable Objects | Plan gratuito (decisión del usuario, 30-oct): 5 M filas leídas de DO al día, compartidas por producción y la vista previa | Se agotó el 30-oct (~3 h de 503). Medido por ruta en `docs/operations/slo.md` §4; objetivo < 4 M/día | Validar en local (`wrangler dev --local`); vista previa solo con etiqueta; nada de smoke ni `Release drill` sin necesidad; todo cambio de lectura se mide antes y después |
| Workers Logs | Límite diario de eventos del plan gratuito | Una línea por petición | No agregar registros por petición; muestreo si se acerca al límite |
| GitHub Actions | Presupuesto mensual (octubre se agotó; el usuario lo amplió el 30-oct) | verify + E2E ≈ 16 min por PR; `main` reutiliza la verificación (52 s) | Un push por PR cuando se pueda; ensayar en local Semgrep y las E2E afectadas; un PR por hito |
| OpenAI | Pago por uso con la clave de HL | Sin medición mensual en el repositorio; `ai_runs` registra tokens | Las pruebas usan el generador `fixture`; nada de llamadas reales en CI salvo `ai:eval` bajo pedido |
| Tokens de IA | — | — | Lecturas focalizadas; sin subagentes por defecto; estado en `estado/` para no redescubrir |

No se ha consultado el consumo real del día en Cloudflare ni el saldo de Actions desde esta sesión: no hay acceso al
panel. Se asume conservadoramente que el margen es pequeño.

## 2. Registro de riesgos

| Id | Riesgo | Prob. | Impacto | Mitigación | Estado |
| --- | --- | --- | --- | --- | --- |
| RG-01 | Agotar la cuota diaria de DO deja producción en 503 | Media | Alto | Reglas de §1; medir lecturas por cambio; monitor externo (AP-03) | Abierto |
| RG-02 | Cambios de navegación desorientan a usuarios actuales | Media | Medio | Un cambio a la vez (nombres iguales, posición nueva); redirecciones; nota en el changelog | Abierto |
| RG-03 | E2E acopladas a textos y posiciones del menú | Alta | Bajo | Ajustar pruebas por diseño, sin debilitarlas; correr en local las afectadas | Abierto |
| RG-04 | Nombres de menores expuestos con el código de sección (R1) | Media | Alto | AP-01 | Abierto, espera decisión |
| RG-05 | Sin monitor externo: una caída se nota tarde | Media | Alto | AP-03 | Abierto |
| RG-06 | Un solo proveedor de IA | Baja | Medio | Puertos del dominio ya aíslan el proveedor; abstracción de modelo en AI-01 | Abierto |
| RG-07 | Alcance del programa muy grande para el ritmo de revisión del dueño | Alta | Medio | Hitos pequeños con PR y evidencia; la cola de aprobaciones agrupa lo que necesita su atención | Abierto |
