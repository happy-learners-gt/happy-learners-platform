# Auditoría del producto · línea base (31-oct-2026)

Hecha por Claude Code sobre `6651930` (producción, 1.5.9), recorriendo la aplicación compilada en local
(`wrangler dev --local`, datos de demostración, cuenta `admin-demo`, escritorio 1440 px), además del código. Las
capturas viven en el scratchpad de la sesión, no en el repositorio: se regeneran con `scripts/ui-audit.mjs`.

## 1. Línea base verificada

| Aspecto | Estado verificado |
| --- | --- |
| Producción | `origin/main` = `6651930`, merge de #102 (31-oct 18:49 UTC). La salud de `/api/health` no se consultó desde aquí para no gastar cuota; la hoja de ruta registra `ok` tras el despliegue. |
| PR #102 | Auditoría de seguridad (H1–H3 corregidos, R1–R4), registro por petición con `rowsRead` (`telemetry.ts`), −37 % a −68 % de lecturas en Inicio y Secciones (migración 0075), contextos y patrones, componentes por niveles. |
| Pila | React 19 + Vite (SPA propia, enrutador propio en `navigation.tsx`), Worker de Cloudflare con un Durable Object con SQLite por organización, dominio puro en `packages/domain`, contratos en `packages/contracts`. Fluent 2 con tokens propios (`docs/design/fluent.md`). |
| Tamaño | ~210 rutas de API; 75 migraciones (siguiente 0076); 72 archivos de Vitest y 49 de Playwright; la web suma ~20 000 líneas. |
| CI | `repository.yml` (verify + E2E escritorio y móvil en paralelo; `main` reutiliza la verificación del PR), `security.yml` (gitleaks, OSV, Semgrep; no obligatorios hasta el 13-nov), `release-drill.yml`, `cloudflare-audit.yml`, `traceability.yml`. |
| Observabilidad | Una línea `event=api` por petición (ruta plantilla, estado, ms, filas leídas y escritas); SLO en `docs/operations/slo.md`. Sin monitor externo todavía. |
| IA | Un proveedor (OpenAI, `openai.ts`) detrás de puertos del dominio; registro `ai_runs` sin textos; capacidades: propuestas de lecciones, revisión del mapa del libro, revisión con puntaje, mejora, redacción, campos sugeridos, interpretación de reglas de horario. |

## 2. Matriz de calidad (puntaje 1–5, ponderado)

Pesos: UX y flujo 25 %, visual 20 %, arquitectura de información 15 %, completitud funcional 15 %, coherencia 10 %,
accesibilidad y respuesta 5 %, confiabilidad y errores 5 %, seguridad y permisos 5 %. **Preliminar:** vista de
administración en escritorio; la vista docente, el móvil y el modo oscuro se puntúan al tocar cada módulo.
Accesibilidad y seguridad parten de 4 por las guardias existentes (axe en E2E, `route-matrix.test.ts`), no de una
medición por módulo.

| Módulo | UX | Vis | AI | Func | Coh | A11y | Conf | Seg | Total | Meta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inicio | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **4.20** | 4.5 |
| Cursos | 4 | 5 | 4 | 4 | 4 | 4 | 4 | 4 | **4.20** | 4.5 |
| Educadores | 3 | 4 | 3 | 4 | 3 | 4 | 4 | 4 | **3.50** | 4.2 |
| Roles y accesos | 3 | 4 | 3 | 3 | 3 | 4 | 4 | 4 | **3.35** | 4.2 |
| Notificaciones | 3 | 4 | 2 | 3 | 3 | 4 | 4 | 4 | **3.20** | 4.0 |
| Biblioteca | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | **3.15** | 4.0 |
| Equipo | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | **3.15** | 4.0 |
| Configuración académica | 3 | 3 | 2 | 4 | 3 | 4 | 4 | 4 | **3.15** | 4.2 |
| Contratos y políticas | 3 | 4 | 2 | 3 | 2 | 4 | 4 | 4 | **3.10** | 4.2 |
| Revisión de perfiles | 3 | 4 | 2 | 3 | 2 | 4 | 4 | 4 | **3.10** | 4.0 (contextual) |
| Uso de IA | 2 | 4 | 2 | 3 | 3 | 4 | 4 | 4 | **2.95** | 4.2 |
| Horarios | 2 | 3 | 2 | 4 | 3 | 4 | 4 | 4 | **2.90** | 4.2 |
| Documentos | 3 | 3 | 2 | 3 | 2 | 4 | 4 | 4 | **2.90** | 4.0 |
| Organización | 2 | 3 | 2 | 4 | 2 | 4 | 4 | 4 | **2.80** | 4.2 |
| Agenda | 2 | 3 | 2 | 3 | 3 | 4 | 4 | 4 | **2.75** | 4.2 |
| Horas efectivas | 2 | 2 | 3 | 3 | 3 | 4 | 3 | 4 | **2.65** | 4.0 |
| Calendario institucional | 2 | 3 | 2 | 3 | 2 | 4 | 4 | 4 | **2.65** | 4.0 |
| Ayuda | 2 | 3 | 2 | 2 | 3 | 4 | 4 | 4 | **2.60** | 4.0 |

La evaluación inicial del dueño del producto coincide en orden con lo observado. La única diferencia: Educadores sale
algo mejor de lo esperado (tabla clara, estados legibles); su problema está en lo que comparte con Contratos.

## 3. Por qué funcionan Inicio y Cursos (principios a extraer)

1. **Una pregunta por pantalla:** «qué sigue» (Inicio) y «qué enseño» (Cursos). Cada bloque responde una parte.
2. **Jerarquía clara:** encabezado con una acción principal, columna principal y columna lateral de estado y atajos.
3. **Datos con significado:** barras de avance con «4 de 5» y no solo números; la actividad dice quién, qué y dónde.
4. **Densidad contenida:** tarjetas con 3 indicadores fijos, mismas columnas en todas, color por curso.
5. **Acción en contexto:** «Abrir contenido», «Crear curso», «Ver todos» junto al dato que los motiva.

Lo que les falta: Inicio lista **todos** los cursos (25 tarjetas, ~4 200 px en administración) en lugar de los que
necesitan atención; no hay KPIs institucionales (horas, cumplimiento de contratos, avance contra calendario).

## 4. Hallazgos transversales (la raíz de la mayoría de los problemas)

| Id | Hallazgo | Evidencia | Consecuencia |
| --- | --- | --- | --- |
| T1 | **El menú lateral no escala.** Los 25 cursos activos se listan completos dentro de «Cursos»; en 900 px de alto la sección «Administración» queda fuera de la vista y hay que desplazar el menú para llegar a ella. | `ui/Shell.tsx` `listedCourses`; captura de cualquier página de administración | La navegación principal compite con la de administración; con 100 cursos sería inutilizable. |
| T2 | **Administración es una lista plana de 11 páginas** sin agrupar, en un orden que no sigue ninguna tarea. | `Sidebar`, nav «Administración» | El usuario tiene que saber dónde vive cada cosa. |
| T3 | **Conceptos repartidos en varios lugares.** Contratos aparece en Educadores › Contratos, Contratos y políticas › Contratos y Mi cuenta; «Plantillas» significa plantilla de contrato en un lugar y de boleta en otro (dos botones «Nueva plantilla»); los asuetos se ven en Organización, en Calendario institucional (dos veces: reglas y eventos) y en Agenda; las jornadas están en Organización y se usan en Horarios. | Capturas de `/contratos`, `/educadores`, `/organizacion/documentos`, `/organizacion`, `/organizacion/calendario` | Duplicación cognitiva; cambios en un lugar sorprenden en otro. |
| T4 | **Organización es un cajón de sastre:** nombre y zona horaria, ciclo lectivo, jornadas, resumen del calendario y respaldo en una sola página; y `/organizacion/*` contiene además Calendario, Horarios, Documentos e IA, que en el menú aparecen como hermanos. | `App.tsx` `case "organizacion"` | La URL, las migas («Organización › Horarios») y el menú cuentan jerarquías distintas. |
| T5 | **Las páginas de administración son formularios largos sin estado ni siguiente paso.** Horarios abre un generador sin mostrar el horario vigente; Calendario abre una lista de reglas; Uso de IA muestra contadores en cero. | Capturas | No responden «¿está todo bien? ¿qué tengo que hacer?». |
| T6 | **Vistas vacías por rol.** La Agenda de administración abre en «Mis secciones», vacía (administración no imparte), con «No hay una clase próxima». | `/agenda` como `admin-demo` | La primera impresión de un módulo central es una semana en blanco. |
| T7 | **Tablas largas sin paginar ni agrupar.** Horas efectivas muestra cada clase (60 filas en la demo, ~5 200 px); Inicio, 25 tarjetas. | Capturas | No escala a una institución real. |

## 5. Hallazgos por módulo (resumen; el detalle se amplía al trabajar cada uno)

- **Agenda (2.75):** buena base (día/semana/mes/año, filtros por tipo, panel «Hoy»), pero sin propósito por rol: para
  administración debería abrir en la vista institucional; no muestra conflictos ni huecos. Relación confusa con
  Calendario institucional y Horarios.
- **Horas efectivas (2.65):** tres tablas resumen + una tabla de todas las clases. En la demo todas las clases dicen
  «Sin registro de inicio» y suman 0 min: el dato principal es cero y la acción es «Corregir» 60 veces. Falta: periodo
  por defecto (este mes), agrupar por persona con detalle bajo demanda, corrección en lote, exportar por contrato.
- **Organización (2.80):** ver T4. Ciclo lectivo y jornadas son buenos componentes; deben vivir en «Calendario y
  jornadas» junto a los asuetos.
- **Calendario institucional (2.65):** las mismas 13 fechas aparecen dos veces (reglas recurrentes y eventos del año);
  «Generar 2027» es un botón de ancho completo al final. Debe ser una vista de calendario anual con las reglas como
  configuración secundaria.
- **Horarios (2.90):** el generador con reglas y aulas es un diferenciador real (solver determinista + interpretación
  con IA), pero la página no muestra el horario vigente, ni conflictos, ni por docente o aula.
- **Documentos (2.90):** solo plantillas de boleta y constancia; el estado vacío no ofrece empezar desde un modelo. El
  nombre choca con «Documentos por vencer» (credenciales) y con los contratos.
- **Uso de IA (2.95):** cuatro contadores y precios por modelo: es un panel técnico. Falta lo institucional: qué
  capacidades existen, dónde se usan, cuánto se aceptó de lo propuesto, quién puede usarlas.
- **Contratos y políticas / Educadores / Revisión de perfiles (3.10–3.50):** un flujo («incorporar a un educador»:
  invitar → perfil → contrato → firma → asignación) partido en tres páginas con pestañas que se solapan.
- **Configuración académica (3.15):** Programas y Etiquetas bien; Esquemas de evaluación aparecen como tarjetas de
  plantilla mezcladas con «sin esquemas propios»; Paquetes curriculares y Estándares de referencia son listas sin
  explicar qué hacer con ellos.
- **Roles y accesos (3.35):** matriz legible; grupos y coordinación están en tarjetas separadas al final, y la
  coordinación se asigna en otra página (Educadores).
- **Notificaciones (3.20):** configuración útil; el registro de envíos es de diagnóstico. Encaja en «Gobierno».
- **Ayuda (2.60):** 27 temas en una sola página de ~10 000 px. El destino acordado (carril D) es base de conocimientos
  por rol + mesa de ayuda externa; dentro de la app, ayuda contextual por página.
- **Biblioteca, Equipo (3.15):** sin inspección detallada todavía (cola: AUD-02).

## 6. Diferenciación (hipótesis a validar)

Lo defendible no es tener más módulos, sino que **los datos ya están conectados**: plan curricular ↔ lecciones ↔
secciones ↔ clases ↔ asistencia ↔ horas ↔ contratos ↔ documentos oficiales, todo por organización y con IA que propone
y nunca escribe sola. Oportunidades con mejor relación valor/costo:

1. **Inicio institucional con excepciones:** cursos sin avance, secciones sin horario, contratos por vencer, clases
   sin registro, lecciones en revisión. Todo es dato existente; sin IA.
2. **Horario + calendario + agenda como una sola operación** (planificar el ciclo): el solver ya existe.
3. **Incorporación de educadores de punta a punta** (contrato → firma → asignación → horas → pago).
4. **IA como capacidades institucionales** expuestas en contexto, con aceptación medida (ver cola AI-01).

## 7. Segunda pasada (AUD-02, 03-nov-2026, tras 1.6.0–1.6.6)

Vista docente (`lucia.herrera`) en móvil (390 px) y modo oscuro, y axe en oscuro en 15 rutas de administración y 6 del
docente. Métricas por ruta con `scratchpad/tools/audit.mjs` (alto, desborde horizontal, objetivos pequeños, estados
vacíos); capturas solo donde las métricas lo pidieron.

**Hallazgos**

| Id | Hallazgo | Estado |
| --- | --- | --- |
| A2-1 | **Contraste en modo oscuro:** la insignia de peligro sobre las tarjetas de sección (Inicio del docente, Resumen del curso) medía 3,97:1 (pide 4,5:1). La prueba de axe solo recorría el modo claro. | Corregido en 1.6.7: en oscuro `--color-danger` usa el rojo de primer plano de Fluent (≥ 4,9:1); prueba nueva en `accessibility.spec.ts` (oscuro, docente) |
| A2-2 | Sin desborde horizontal en ninguna ruta del docente en móvil. | Bien |
| A2-3 | Objetivos de menos de 24 px: enlaces en línea de las tarjetas (nombres de sección, fechas). Separados entre sí: cumplen la excepción de espaciado de WCAG 2.5.8 y axe (`target-size`) no los marca. | Aceptado |
| A2-4 | **Ayuda mide ~23 700 px en móvil** (27 temas en una página). | Abierto: HLP-01 (ayuda contextual) |
| A2-5 | Inicio del docente mide ~5 900 px en móvil (siete bloques). | Abierto, baja: plegar «Acciones rápidas» y «Estado de las lecciones» en móvil (HOME-02) |
| A2-6 | Uso de IA sigue siendo un panel técnico (AIG-5). | Abierto (M6) |

**Puntajes después de 1.6.x** (mismos pesos; solo los módulos que cambiaron)

| Módulo | Antes | Ahora | UX Vis AI Func Coh A11y Conf Seg |
| --- | --- | --- | --- |
| Inicio | 4.20 | **4.60** | 5 5 5 4 4 4 4 4 |
| Educadores | 3.50 | **4.00** | 4 4 4 4 4 4 4 4 |
| Horarios | 2.90 | **3.65** | 4 3 3 4 4 4 4 4 |
| Organización | 2.80 | **3.55** | 3 3 4 4 4 4 4 4 |
| Calendario institucional | 2.65 | **3.55** | 3 3 4 4 4 4 4 4 |
| Agenda | 2.75 | **3.50** | 4 3 3 3 4 4 4 4 |
| Horas efectivas | 2.65 | **3.40** | 3 3 4 3 4 4 4 4 |
| Uso de IA | 2.95 | **3.00** | 2 4 2 3 3 4 4 5 (límite de uso, H4) |

Lo que más pesa ahora en la meta (≥ 4.0): Ayuda (2.60), Uso de IA (3.00), Documentos (2.90), Contratos y Revisión de
perfiles (3.10), y lo visual de Agenda, Horas y Calendario (tarjetas y listas largas sin jerarquía).
