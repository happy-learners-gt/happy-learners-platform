# Hoja de ruta de Happy Learners (desde el 29 de octubre de 2026)

Documento de arranque para cualquier sesión futura: dónde está el producto, qué falta, en qué orden y cómo se trabaja.
Reemplaza la necesidad de recordar el historial. Se actualiza al cerrar cada lote o decisión (sección «Bitácora»).

## 1. Estado actual

| Versión | Contenido | Estado |
| --- | --- | --- |
| 1.2.x | Piloto escolar, asistente de IA, notas profesionales, calendario académico, auditoría de diseño | En producción |
| 1.3.0 | Calendario institucional (motor de reglas de fechas, calendarios por nivel) | En producción |
| 1.3.1 | Evaluación agnóstica (esquemas, rúbricas, tribunal, niveles) | En producción |
| 1.3.2 | Grupos de trabajo y calificación grupal (WebPA) | En producción |
| 1.3.3 | Rediseño de la evaluación y grupos unificados (`docs/design/evaluacion.md`) | En producción (#86) |
| 1.3.4 | Agenda y calendario institucional rediseñados (`docs/design/agenda-y-calendario.md`) | En producción (#87) |
| 1.3.5 | Respaldo restaurable en cualquier espacio (invitaciones sin el hash de su enlace) | En producción (#88); `Release drill` verde |
| 1.3.6 | Libertad de cátedra por sección (`docs/design/libertad-de-catedra.md`, lotes 4a–4c) | En producción (#90) |
| 1.3.7 | Biblioteca de recursos didácticos (`docs/design/recursos-didacticos.md`, lotes 5a–5c) | En producción (#92) |
| 1.4.0–1.4.1 | Asistente como harness: registro y uso de IA, revisión con puntaje, mejora asistida, redacción (`docs/design/asistente-ia.md`) | En producción (#93, #94) |
| 1.4.2–1.4.3 | Cronograma propuesto y horarios con reglas | En producción (#95) |
| 1.5.0 | Constructor de documentos: boleta y constancia (`docs/design/constructor-de-reportes.md`) | En producción (#96) |
| 1.5.1 | Acta de tribunal firmada por cada integrante; Redactar con IA en el diseñador | En producción (#98) |
| 1.5.2 | Reporte de avance de una sección; «Sugerir campos» en el diseñador | En producción (#99) |
| 1.5.3 | Aulas en el modelo de datos y en los horarios (capacidad, una clase por aula a la vez) | En producción (#100) |
| 1.5.4 | wrangler 4.156.0; escáner de dependencias sin excepciones | En PR (#101) |
| 1.5.5 | Auditoría de seguridad manual y sus correcciones (`docs/security/auditoria-2026-11.md`) | En PR |
| 1.5.6 | SLO y observabilidad (`docs/operations/slo.md`): registro por petición con filas leídas | En PR |
| 1.5.7 | Menos lecturas en Inicio y Secciones (conteos de asistencia por clase, consultas por índice) | En PR |

Siguiente migración libre: **0076** (1.4.0 usa 0070; 1.5.0 usa 0071; 1.5.1 usa 0072; 1.5.2 usa 0073; 1.5.3 usa 0074; 1.5.7 usa 0075). Producción: `https://happy-learners-demo.lfmendoza-alvarez.workers.dev`.

## 2. Cómo se trabaja (no repetir errores)

- **Diseño primero.** Toda funcionalidad con interfaz tiene un documento en `docs/design/` (lugar, momento, flujo,
  pantallas en texto) antes de la ficha. Las fichas sin diseño produjeron interfaces mediocres (1.3.1–1.3.2).
- **Desde el 30-oct Claude Code implementa directamente** (decisión del usuario): los lotes 6 y 7 ya no pasan por
  Cursor. Se mantiene diseño primero y la misma revisión (pruebas, capturas, código) antes de cada PR.
- **Antes, Cursor implementaba y Claude Code supervisaba.** Fichas en `docs/handoff/cursor/`. Revisión en este orden: pruebas
  (aserciones flojas, pruebas existentes modificadas), capturas contra el diseño, código; migraciones aplicadas sobre una
  copia de producción. Los arreglos pequeños los hace Claude Code directamente.
- **Carpeta compartida.** Cursor trabaja en la misma carpeta: Claude Code nunca usa `git stash` ni cambia de rama ahí;
  para verificar otra rama usa `git worktree add` en su espacio temporal.
- **Verificación local.** Antes de `./scripts/verify`, cerrar servidores sobrantes de corridas E2E (`wrangler dev` y
  `workerd`); los fallos en paralelo por carga se confirman corriendo esos archivos en serie. La suite E2E completa la
  corre CI.
- **Minutos de Actions.** Integrar `main` en la rama antes del último push del PR: así `main` reutiliza la verificación
  del PR (52 s en lugar de unos 16 min, #91). Ensayar localmente lo que pueda fallar (Semgrep, E2E afectadas) antes de
  empujar; un push por PR cuando sea posible.
- **Cuota de Cloudflare (plan gratuito, decisión del usuario).** Producción y la vista previa comparten 5 millones de
  filas leídas de Durable Objects al día; agotarlas deja la API en 503 hasta las 00:00 UTC (pasó el 30-oct). La vista
  previa corre solo con la etiqueta `vista-previa`; el ensayo `Release drill` (lee la base completa varias veces) solo
  cuando haga falta; nada de pruebas contra producción salvo los flujos críticos.
- **Despliegue.** Fusionar a `main` despliega producción: requiere autorización explícita del usuario; tras fusionar,
  vigilar `verify`, `deploy` y `critical-flows` en `main`; un fallo intermitente se reintenta con `gh run rerun --failed`.
- **Pruebas sin fechas frágiles.** Nada de «todos los días desde hoy tienen clase»: la semilla tiene asuetos.
- **Trazabilidad.** PR con `HL-15 ST-049: …`, cuerpo con `Jira:`, `Source ID:`, `Release:`, `Criterios:`, `Evidencia:`.

## 3. Trabajo pendiente, en orden

Cuatro carriles. El A (producto) sigue su orden; B y C corren en paralelo cuando Cursor está ocupado; D es del usuario
con apoyo puntual.

### Carril A · Producto (plan 1.3 y 1.4, `docs/handoff/2026-10-29-plan-v1.3.md`)

1. ~~1.3.3 en producción~~ (hecho).
2. ~~1.3.4 Agenda y calendario~~ (hecho).
3. ~~1.3.6 Libertad de cátedra por sección~~ (hecho, #90) (lotes 4a–4c): diseño `docs/design/libertad-de-catedra.md` y ficha
   `docs/handoff/cursor/lote-4a-libertad-de-catedra.md` listos (incluye unidades propias, revisión opcional, copiar a
   otra sección y proponer al curso). Siguiente: Cursor implementa; revisar, PR, desplegar.
4. **1.3.7 Biblioteca de recursos didácticos** (lote 5, en producción #92; las lecturas dentro de cada unidad, como pide el diseño,
   llegan con 1.4.0): diseño `docs/design/recursos-didacticos.md` y ficha listos; tipos más allá del libro, metadatos y cita,
   índice por capítulos, mapeo a resultados, varias fuentes para la IA.
5. **1.4.0 Asistente pedagógico como harness** (lote 6): diseño primero; revisión con puntaje basado en hechos, mejoras,
   cronograma y horarios con reglas (solver determinista), redacción en toda la plataforma, registro de consumo de IA.
6. **1.4.1 Constructor de reportes** (lote 7): diseñador de documentos con membrete, firma de actas de tribunal por cada
   integrante (decisión del usuario), boleta configurable.

### Carril B · Seguridad y confiabilidad (empieza ya)

1. ~~Restauración de respaldos~~ (1.3.5, hecho; el ensayo `Release drill` restauró la copia de producción): las invitaciones se copian sin el hash de su enlace, así que un contrato
   que llegó con una se restaura en cualquier espacio. Tras desplegar: correr `Release drill` (restaura la copia de
   producción en la vista previa). Pendiente: simulacro en cada cambio con una copia anónima (requiere tocar `.github/`
   con autorización).
2. ~~Escáneres en CI~~ (hecho, #89): gitleaks, OSV-Scanner y Semgrep con la regla propia `sql-interpolated-text`
   (`docs/operations/escaneres.md`). Pendiente: hacerlos obligatorios tras dos semanas (desde el 13-nov); ~~actualizar wrangler~~ (1.5.4, sin excepciones); CodeQL: el usuario decidió no pagar GitHub Code Security por ahora (30-oct); se revisa al constituir la empresa.
3. ~~Auditoría de seguridad manual~~ (1.5.5, `docs/security/auditoria-2026-11.md`; queda la decisión R1) con modelo de amenazas: aislamiento entre organizaciones, permisos por ruta
   (matriz exhaustiva generada desde el enrutador), sesiones, archivos y PDF, datos de menores, IA (entradas del libro y
   salidas). Resultado: `docs/security/auditoria-2026-11.md` con hallazgos priorizados y lotes de corrección.
4. ~~SLO y observabilidad~~ (1.5.6, `docs/operations/slo.md`; quedan reducir las lecturas de Inicio y Secciones y el monitor externo): definir SLO (por ejemplo disponibilidad 99,9 % y p95 < 500 ms en las rutas principales),
   logs estructurados, métricas y alertas, página de estado; documentar en `docs/operations/slo.md`. Se mantiene
   Cloudflare Workers y Durable Objects (no hay razón para migrar de nube).
5. **Prueba de penetración externa** antes de incorporar instituciones de pago.

### Carril C · Arquitectura y calidad (incremental, nunca un refactor total)

1. **Contextos delimitados:** documento `docs/architecture/contextos.md` (identidad y accesos, contenido, plan
   curricular, secciones y calendario, evaluación, contratos y firmas, IA) con sus límites, datos de cada uno y
   dependencias permitidas; cada cambio de patrón se registra como DEC.
2. **Patrones por problema:** catálogo corto en `docs/architecture/patrones.md` (motores deterministas en el dominio,
   compare-and-write con `guardedBatch`, colas en alarmas del Durable Object, migraciones aditivas, etc.) y antipatrones
   detectados con su corrección.
3. **Refactor por contexto cuando duela:** primero los archivos grandes de la API (`gradebook.ts`, `classes.ts`),
   separando rutas, casos de uso y acceso a datos dentro de su contexto.
4. **Biblioteca de componentes:** formalizar `ui/` en niveles (átomos, moléculas, patrones) con la Guía de estilo como
   catálogo vivo y reglas en `docs/design/fluent.md`; migrar pantallas cuando se tocan.
5. **ORM:** prueba corta con Drizzle (compatible con SQLite de Durable Objects) en un módulo nuevo; decidir con datos.

### Carril D · Empresa y marca (lo lleva el usuario)

1. **Posicionamiento y nombre:** el producto ya no es solo escolar (instituciones de todo tipo con planificación por IA).
   Claude Code puede proponer opciones; verificar disponibilidad de marca en el Registro de la Propiedad Intelectual de
   Guatemala, dominio y redes antes de decidir.
2. **Constitución de la empresa:** con notario o abogado corporativo y contador (empresa individual o sociedad anónima,
   Registro Mercantil, SAT/RTU y facturación, IGSS si hay empleados, registro de la marca). Cubrir también contratos con
   instituciones y protección de datos de menores.
3. **Identidad:** logotipo y mascota con diseñador profesional; Claude Code puede preparar el brief creativo.
4. **Base de conocimientos y soporte:** artículos por rol y tarea a partir de la Ayuda y los manuales; mesa de ayuda con
   un servicio existente (Jira Service Management, Freshdesk o Zendesk) enlazada desde «Ayuda y soporte» en la app; no se
   construye una propia.

## 4. Calendario sugerido

| Semana | Carril A | Carril B/C (Claude Code mientras Cursor trabaja) | Carril D |
| --- | --- | --- | --- |
| 1 | 1.3.3 y 1.3.4 en producción | Restauración de respaldos; escáneres en CI | Posicionamiento y nombres |
| 2 | Diseño y lote 4a | Auditoría de seguridad manual | Consulta legal |
| 3 | Diseño y lote 5 | Correcciones de seguridad; contextos delimitados | Registro de marca y empresa |
| 4–5 | Lote 6 (IA) | SLO y observabilidad; refactor de `gradebook.ts` | Brief creativo y diseño |
| 6 | Lote 7 (reportes) | Base de conocimientos; mesa de ayuda | Lanzamiento con nombre nuevo |

## 5. Bitácora

- 2026-10-29: hoja de ruta creada. 1.3.3 integrado; 1.3.4 en corrección; carriles B, C y D definidos.
- 2026-10-29: 1.3.3 (#86) y 1.3.4 (#87) en producción. Correcciones de CI en #87: selector de fecha oculto que
  desbordaba y sección de prueba sin prefijo E2E. Diseño y ficha del lote 4 listos (4a–4c).
- 2026-10-29: carril B.1 en PR (1.3.5). La libertad de cátedra pasa a 1.3.6.
- 2026-10-30: 1.3.5 (#88) en producción y `Release drill` verde; escáneres (#89) integrados; se amplió el presupuesto
  de GitHub Actions (el de octubre se agotó). Lote 4 (1.3.6) revisado: pruebas, capturas y permisos; en PR.
- 2026-10-30: 1.3.6 (#90) en producción. #91: `main` reutiliza la verificación del PR (52 s). Lote 5 diseñado y entregado a
  Cursor en `feat/HL-15-recursos`. Las semillas nuevas declaran sus nombres para la prueba de contaminación.
- 2026-10-30: lote 5 (1.3.7) revisado y corregido (cita APA sin autoría, edición numérica, etiqueta «Editar ficha»); en PR.
  Desde hoy Claude Code implementa los lotes 6 (IA como harness) y 7 (constructor de reportes) sin Cursor. Sin CodeQL por ahora.
- 2026-10-30: 1.3.7, 1.4.0 y 1.4.1 en producción; 1.4.2–1.4.3 (#95) y 1.5.0 en PR, implementados por Claude Code. Pendiente 1.5.1
  (actas de tribunal firmadas con el constructor, reporte de avance, IA en el diseñador) y aulas en el modelo para horarios.
- 2026-10-30: producción sin servicio desde ~21:05 UTC por agotar la cuota diaria de lecturas de Durable Objects del plan
  gratuito (CI y vista previa comparten cuenta). El usuario decide seguir en el plan gratuito: la vista previa pasa a ser
  bajo pedido y se quitan las capturas de la vista previa y el smoke tras cada despliegue.
- 2026-10-31: producción repuesta a las 00:19 UTC. 1.5.0 (#96) y 1.5.1 (#98) en producción; un E2E móvil de #96 falló por
  `socket hang up` del servidor local y pasó al reintentar. 1.5.2 (reporte de avance, «Sugerir campos») en PR; las aulas
  pasan a 1.5.3 porque cambian el modelo de datos. El cuerpo del PR lleva `Release: REL-0NN`, no la versión.
