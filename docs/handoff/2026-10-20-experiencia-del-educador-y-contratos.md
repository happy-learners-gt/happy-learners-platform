# Handoff: experiencia del educador y contratos (v1.2.0-rc, DEC-046)

Rama: `feat/HL-15-contratos-y-experiencia-del-educador` (base `main` = v1.1.1). Este documento es el encargo
completo para implementar con Cursor. El equipo de desarrollo ya dejó hecho, probado y en commits:

- **Tema oscuro** (`apps/web/src/theme.css`, bloque `:root[data-theme="dark"]`): rampa fría de bajo deslumbramiento,
  contraste medido (texto 13.5:1, secundario 9.7:1, atenuado 6.2:1 sobre `--color-surface`), tintes de tono al 14 %
  sobre la superficie y el brillo del puntero como token `--light-glow` (antes casi blanco en oscuro).
- **Backend de contratos** (migración `0045_contracts.sql`, `packages/domain/src/contracts.ts`,
  `apps/api/src/contracts.ts`, integración en invitaciones, incorporación, clases y documentos legales), con pruebas
  en `tests/contracts.test.ts`, `tests/signatures.test.ts` (ST-151 reescrita), `tests/onboarding.test.ts` y
  `tests/test_migrations.py`. `./scripts/verify` pasa con 306 pruebas de Vitest y 60 de Python.

Todo lo demás de este documento es de Cursor. Al terminar, el equipo de desarrollo revisa el diff, actualiza los manuales y publica.

## 0. Reglas de trabajo

1. Lee `AGENTS.md` del repo si existen, y estudia el estilo: componentes en `apps/web/src/ui`, páginas en
   `apps/web/src/pages`, estilos en `apps/web/src/style.css` que **solo** leen tokens semánticos de `theme.css`
   (`--color-*`, `--space-*`, `--radius-*`, `--text-*`). Nunca un color, radio o sombra fijo en un componente.
2. Interfaz en español neutro, tuteo como el resto de la app, sin anglicismos innecesarios.
3. Commits pequeños, uno por tarea, en español. **Cada mensaje empieza con `HL-15 `** (lo exige
   `scripts/check-traceability.py`) y termina con la línea `Co-Authored-By` que use tu herramienta.
4. **No** hagas push, PR ni despliegue; **no** toques `.github/`.
5. Verificación por tarea, rápida y enfocada (no corras la suite E2E completa en cada cambio, tarda ~17 min):
   - `npm run typecheck`
   - `npx vitest run tests/<archivo>.test.ts` de lo que tocaste
   - `npm run build && HL_E2E_PORT=8795 npx playwright test tests/e2e/<spec>.ts` de lo que tocaste
   - Capturas antes/después con `node scripts/ui-audit.mjs` (ver §4).
   Al final de todo: `./scripts/verify` una vez. La E2E completa la corre el CI.
6. Accesibilidad: cada control con etiqueta, foco visible, objetivos de 44 px en táctil, axe sin violaciones
   (`tests/e2e/accessibility.spec.ts`). Cada página nueva entra en ese spec.

## 1. Diagnóstico (auditoría visual del 19-oct, v1.1.1)

| Página | Problema | Severidad |
| --- | --- | --- |
| Mi perfil | Repite la matriz de notificaciones, la frecuencia del correo y «Tus avisos recientes», que ya viven en Preferencias. | Alta |
| Mi perfil | Ocho pestañas en una fila que se corta («C…» de Contacto); el medidor de completitud es una lista de 14 enlaces; las acciones flotan a la derecha sin alinearse con el título; «Publicación» es una tarjeta aparte que repite el estado. | Alta |
| Mi perfil | El expediente queda al fondo, después de las notificaciones, sin relación con lo de arriba. | Media |
| Menú de la persona | «Mi perfil», «Perfil público», «Cuenta» y «Preferencias» son cuatro destinos para una misma área; «Perfil público» duplica «Vista previa». | Alta |
| Tres patrones de navegación | Perfil usa pestañas subrayadas, Cuenta usa píldoras de anclas y Preferencias pestañas con icono. | Alta |
| Cuenta | Una columna larga de tarjetas; la contraseña ocupa todo el ancho con campos de 1000 px; «Mis datos» es un muro de texto. | Media |
| Educadores (admin) | Tabla con desbordamiento horizontal (la columna Incorporación se corta), y la página mezcla personas, invitaciones, cierres, documentos, «Avance por curso» (30 tarjetas) y actividad: 5 300 px de alto. | Alta |
| Organización (admin) | Términos, privacidad y acuerdo son `textarea` de texto plano apilados con aceptaciones, firmas y verificación: no hay texto enriquecido, vigencia ni historial visible. | Alta |
| Equipo | Vacío en la demostración; filtros con anchos desiguales. | Media |
| Tema oscuro | Corregido en los tokens; quedan por revisar componentes con estilos propios (§3, T11). | — |

## 2. Principios de diseño para todo lo nuevo

- **Un área personal, un patrón.** «Mi cuenta» es un hub con navegación lateral (≥ 1024 px) que en móvil pasa a una
  lista de secciones (patrón de Google Account / GitHub Settings). Secciones: **Perfil**, **Expediente**,
  **Contratos**, **Cuenta y seguridad**, **Preferencias**, **Notificaciones**. Rutas: `/mi-cuenta/<sección>`, con
  redirecciones desde `/perfil`, `/cuenta`, `/preferencias` y `/perfil#notificaciones`. El menú de la persona queda
  con: Mi cuenta, Ver mi perfil público (abre la vista previa), Ayuda, Cerrar sesión.
- **Encabezado de página único** (crear `ui/PageHeader.tsx`): título, descripción de máximo 60 caracteres por línea,
  insignia de estado junto al título y acciones primarias alineadas a la derecha en la misma fila; en móvil las
  acciones bajan debajo del título.
- **Ancho y rejilla.** Formularios: contenedor de 880 px, rejilla de 12 columnas con `gap: var(--space-4)`; campos
  cortos (idioma, país, zona, fechas) en 4 columnas, medianos en 6, textos largos en 12. Nunca un `select` de una
  palabra a todo el ancho. Páginas de datos: ancho completo del contenido.
- **Espaciado.** Tarjetas con `padding: var(--space-6)`, separación entre tarjetas `var(--space-5)`, entre grupos de
  campos `var(--space-6)`; encabezado de tarjeta `--text-md` semibold. Una sola barra de guardado por formulario,
  fija al pie de la tarjeta, que aparece solo con cambios sin guardar.
- **Controles adecuados.** Listas abiertas (áreas, especialidades) como campo de etiquetas con sugerencias; opciones
  cerradas de 2 a 5 valores (modalidades, formatos, públicos, 12/24 h, tema) como grupo segmentado o casillas en
  línea; niveles CINE como lista agrupada con casillas; idiomas como filas «idioma + dominio» con selector compacto;
  fechas con `input type=date`/`month`; importes con campo numérico y moneda ISO al lado.
- **Estados con su flujo.** Cada objeto con estados (perfil, credencial, contrato, invitación) muestra una línea de
  tiempo compacta de sus pasos y la acción siguiente como botón primario. Reutiliza un componente `ui/StatusSteps.tsx`.
- **Vacíos útiles.** Todo estado vacío explica qué es y ofrece la acción para llenarlo.
- **Nada repetido.** Una información vive en un solo lugar; los demás enlazan a ella.

## 3. Tareas

Orden sugerido: T1 → T2 → T6 → T7 → T8 → T9 → T3 → T4 → T5 → T10 → T12 → T11 → T13 → T14.

### T1. Hub «Mi cuenta» (UI)
- `pages/my-account.tsx` con navegación lateral y las seis secciones; mueve el contenido de `professional.tsx`
  (perfil), el expediente, `account.tsx`, `preferences.tsx` y la matriz de notificaciones a sus secciones.
- Elimina de Mi perfil el bloque de notificaciones, «Frecuencia del correo» y «Tus avisos por correo recientes»
  (pasan a Notificaciones). Elimina la entrada «Perfil público» del menú (queda «Ver mi perfil público»).
- Criterio: ninguna sección se repite; `/perfil`, `/cuenta`, `/preferencias` redirigen; E2E existentes de perfil,
  cuenta y preferencias siguen pasando con las rutas nuevas (ajusta selectores, no la intención de las pruebas).

### T2. Perfil profesional rediseñado
- Encabezado con estado del perfil (Borrador, En revisión, Publicado, Cambios solicitados, Oculto) e insignia, y
  acciones «Vista previa» y la acción del flujo (Enviar a revisión / Enviar cambios / Reenviar).
- Navegación interna por secciones en una columna izquierda (Identidad, Sobre mí, Idiomas, Enseñanza, Trayectoria,
  Credenciales, Enlaces, Contacto) con marca de completitud por sección, en vez de pestañas que se cortan.
- Completitud: anillo con porcentaje y los **tres** pasos siguientes; «Ver todo» abre la lista completa.
- Si hay cambios pedidos por administración, banner arriba con el comentario y botón a la sección afectada.
- Trayectoria y credenciales como listas de tarjetas con agregar/editar en un panel lateral (drawer), no formularios
  apilados.
- Criterio: a 1365 px no hay desplazamiento horizontal ni elementos cortados; a 390 px todo es una columna.

### T3. Cuenta y seguridad
- Secciones en tarjetas compactas: Correo (resumen + «Cambiar»), Contraseña (en un diálogo, no un formulario
  permanente), Sesiones activas (tabla con «Cerrar» por fila y «Cerrar las demás»), Historial de accesos (tabla
  paginada de 10), Mis datos (botón + lista de lo que incluye en 2 columnas), Cerrar la cuenta (zona de peligro al
  final, con diálogo de confirmación).

### T4. Preferencias y Notificaciones
- Preferencias mantiene su contenido; usa la rejilla de §2 (selects cortos a 4 columnas).
- Notificaciones: la matriz evento × canal, frecuencia (grupo segmentado), horario de silencio (dos `time`) y avisos
  recientes en una tabla.

### T5. Equipo
- Barra de filtros de altura uniforme (búsqueda flexible + 4 selects de ancho fijo), rejilla de tarjetas de 3
  columnas (2 en tableta, 1 en móvil) con foto, nombre, titular, áreas (máx. 3 + «+n»), idiomas e insignia
  «Verificada». Página de perfil con encabezado tipo italki: foto grande, titular, idiomas, video y secciones.

### T6. Educadores (administración)
- Pestañas: **Personas**, **Invitaciones**, **Contratos** (enlace al módulo de T7 filtrado), **Incorporación**,
  **Cierres de cuenta**, **Documentos por vencer**. Quita «Avance por curso» y «Actividad reciente» de esta página
  (el inicio de administración ya los muestra; si no, muévelos allí).
- Tabla de personas sin desbordamiento: columnas Persona, Rol, Carga (cursos y secciones en una línea), Contrato
  (fase), Incorporación, Acceso y un menú de acciones por fila.

### T7. Módulo «Contratos y políticas» (administración, ruta `/contratos`)
Pestañas:
1. **Plantillas**: tarjetas por plantilla (nombre, tipo de relación, versión vigente, contratos). Editor a pantalla
   completa: título, cláusulas con `RichText` (de `apps/web/src/RichText.tsx`, con barra), panel lateral de
   **variables** que inserta `{{persona.nombre}}`… (lista en `contractVariables` del dominio), formulario de
   **condiciones por omisión** según el tipo (oculta la remuneración en voluntariado; la exige en laboral y servicios),
   casillas de **campos editables por contrato**, **vista previa** con datos de ejemplo, **publicar** con fecha de
   vigencia y **historial de versiones** (solo lectura).
2. **Contratos**: tabla filtrable por fase (Pendiente de firma, Vigente, Empieza después, Por terminar, Vencido,
   Terminado, Rechazado, Anulado, Reemplazado), persona y plantilla. Detalle en un panel: documento, condiciones,
   huella, firmas y línea de tiempo; acciones según la fase: Enviar (firma de la organización), Anular, Terminar,
   Enmendar, Descartar borrador. «Nuevo contrato» para una persona del equipo.
3. **Políticas**: Términos y condiciones y Política de privacidad con `RichText` (envía `bodyJson`), fecha de
   vigencia al publicar (`effectiveAt`), historial de versiones, aceptaciones y firmas, y «Verificar una
   constancia». Todo esto **sale** de la página Organización.
4. **Ajustes**: «Exigir un contrato vigente para impartir clases» (`PUT /api/contract-settings`).

### T8. Invitar con contrato y aceptar firmando
- Diálogo de invitación en tres pasos: Persona (correo, nombre, rol) → Contrato (plantilla, condiciones editables,
  inicio y fin, vista previa del documento ya combinado) → Firmar y enviar (nombre completo y contraseña de quien
  invita). Si la organización exige contrato y el rol es educador, el paso 2 es obligatorio.
- Página pública `/invitacion/:token`: primero el contrato (documento, resumen de condiciones, firma de la
  organización), luego «He leído y acepto» + nombre completo, luego usuario y contraseña. Un solo envío
  (`signature: { fullName, accept: true }` junto a `username` y `password`).

### T9. Contratos de la persona
- Sección «Contratos» en Mi cuenta: tarjetas con fase, condiciones clave y fechas; documento completo; Firmar
  (nombre + contraseña) y Rechazar (motivo) cuando está pendiente.
- Banner global en `ui/Shell.tsx` y tarjeta en Inicio cuando hay un contrato pendiente de firma. El error
  `CONTRACT_REQUIRED` al iniciar una clase muestra un diálogo con enlace al contrato (`contractId`).
- En la incorporación, el paso «acuerdo» muestra el contrato pendiente (`onboarding.contract`) en vez del acuerdo de
  voluntariado antiguo.

### T10. Organización (administración)
- Queda solo con: datos de la organización, días sin clase y respaldo. Usa la rejilla de §2.

### T11. Tema oscuro: revisión de componentes
- Busca en `style.css` colores o fondos que no vengan de tokens (`grep -nE "#[0-9a-f]{3,6}|rgba?\(|colorNeutral|brand-1[0-9]0"`) y pásalos a tokens.
- Revisa en oscuro: tablas (encabezados y filas alternas), insignias, alertas, menús, diálogos, el editor de texto
  enriquecido, gráficos de avance y el héroe de Inicio (su degradado debe bajar de saturación en oscuro).
- Criterio: capturas oscuras de todas las páginas de §4 sin zonas blancas, sin texto por debajo de 4.5:1 y con el
  brillo del puntero imperceptible fuera de su tarjeta.

### T12. Datos de demostración completos (migración `0046_demo_educator_lifecycle.sql`)
Genera la migración con un script determinista nuevo `scripts/seed/lifecycle.mjs` (mismo estilo que `build.mjs`:
cada sentencia en una línea, condicionada a `org-demo`). Debe dejar, para cada educador de la demostración
(ana.lopez, carlos.mejia, diego.ramirez, lucia.herrera, sofia.castillo, tomas.aguilar, educador-demo):
- Perfil profesional completo y **publicado** (titular, biografía, enfoque, video de YouTube de ejemplo, 2–3 idiomas
  con dominio, áreas, niveles CINE, modalidades, formatos, públicos, años, 2 experiencias, 2 formaciones, enlaces);
  además un perfil **en revisión** (carlos.mejia) y uno con **cambios solicitados** (diego.ramirez) para mostrar el
  flujo.
- Credenciales en varios estados: verificadas, en verificación, rechazada con motivo y una vencida.
- Preferencias variadas (una persona en tema oscuro y 12 h, otra con texto 125 %), notificaciones en la campana.
- Términos y política de privacidad publicados en texto enriquecido con vigencia, y aceptados por todos.
- Tres plantillas publicadas: «Voluntariado docente ad honorem», «Prestación de servicios por clase impartida»
  (GTQ por clase) y «Relación laboral docente» (mensual, plazo fijo de 10 meses), cada una con cláusulas reales de
  varios párrafos y variables.
- Contratos en todas las fases: vigentes para la mayoría, uno que empieza el próximo mes, uno pendiente de firma
  (tomas.aguilar), uno vencido, uno terminado con motivo, una enmienda que reemplaza a otro y uno rechazado.
- Una invitación pendiente con su contrato y una solicitud de cierre de cuenta pendiente.
- `organizations.contract_required = 1` en `org-demo`.
Las huellas deben calcularse igual que la API: `contractCanonical` y `contractSignatureCanonical` de
`packages/domain/src/contracts.ts` (JSON canónico con claves ordenadas, `endDate` = `"indefinite"` si es nulo y
`partyEmail` = `""` si es nulo). Agrega `tests/demo-lifecycle.test.ts` que lea la base migrada (patrón de
`tests/account.test.ts` con `node:sqlite`) y **recalcule cada huella con las funciones del dominio**. Los
documentos del expediente necesitan archivos en R2: no los siembres (déjalo anotado).

### T13. Constancia y verificación de contratos (backend pequeño)
- `GET /api/contracts/:id/receipt`: HTML descargable como `receiptHtml` de `apps/api/src/legal.ts`, con el
  documento, las condiciones, ambas firmas y sus huellas, y un bloque JSON canónico.
- `POST /api/contracts/verify` (admin): recalcula la huella del documento y de cada firma y responde
  `valid` / `document_mismatch` / `receipt_mismatch` / `unknown`, como `verify` de `legal.ts`.
- Regístralas en `contractMethods` y prueba ambas en `tests/contracts.test.ts`.

### T14. E2E
- Actualiza `tests/e2e/signatures.spec.ts` y `tests/e2e/onboarding.spec.ts` (hoy publican el acuerdo de
  voluntariado por la ruta retirada, que responde 410).
- Nuevo `tests/e2e/contracts.spec.ts`: administración crea y publica una plantilla, invita con contrato, la persona
  acepta firmando, el contrato aparece vigente en ambos lados; y una persona sin contrato vigente ve el diálogo al
  iniciar una clase.
- Ajusta los selectores de perfil, cuenta y preferencias a las rutas de Mi cuenta.

## 4. Cómo comprobar el diseño

```bash
npm run build
node_modules/.bin/wrangler dev --local --config build/wrangler.json --ip 127.0.0.1 --port 8797 --inspector-port 0 --persist-to "$(mktemp -d)" &
node scripts/ui-audit.mjs http://127.0.0.1:8797 ui-audit
```

Genera capturas claras y oscuras, de escritorio y móvil, de cada página. Antes de cada commit de UI compara antes y
después. Criterios: nada cortado ni con desplazamiento horizontal; alineación a la rejilla; una sola acción primaria
por vista; en oscuro, sin destellos ni bloques claros. La carpeta `ui-audit/` no se versiona.

## 5. Referencia de la API de contratos

| Método | Ruta | Quién | Cuerpo / respuesta |
| --- | --- | --- | --- |
| GET, POST | `/api/contract-templates` | admin | POST `{ template: { name, engagement, description? }, version: { title, body, defaults, editable, effectiveFrom? } }` → `{ template }` |
| GET, PUT | `/api/contract-templates/:id` | admin | GET `{ template, history }`; PUT `{ name?, description?, status? }` |
| PUT | `/api/contract-templates/:id/draft` | admin | mismo cuerpo que `version` |
| POST | `/api/contract-templates/:id/publish` | admin | `{ effectiveFrom? }` (hoy o después) |
| GET, POST | `/api/contracts` | admin | POST `{ templateId, userId, startDate, endDate?, terms? }` (solo campos editables) → borrador |
| GET, PUT, DELETE | `/api/contracts/:id` | admin; GET también la persona | PUT/DELETE solo en borrador |
| POST | `/api/contracts/:id/send` | admin | `{ signature: { fullName, password } }` |
| POST | `/api/contracts/:id/sign` | la persona | `{ signature: { fullName, password } }` |
| POST | `/api/contracts/:id/decline` | la persona | `{ reason }` |
| POST | `/api/contracts/:id/void` | admin | `{ reason }` (borrador o enviado) |
| POST | `/api/contracts/:id/terminate` | admin | `{ terminationDate, reason }` |
| POST | `/api/contracts/:id/amend` | admin | como crear; al firmarse reemplaza al original |
| GET, PUT | `/api/contract-settings` | admin | `{ required }` |
| GET | `/api/me/contracts` | sesión | `{ contracts, required }` |
| POST | `/api/invitations` | admin | además `contract: { templateId, startDate, endDate?, terms? }` y `signature` |
| GET, POST | `/api/invitations/accept/:token` | público | GET incluye `contract`; POST exige `signature: { fullName, accept: true }` si hay contrato |
| PUT, POST | `/api/legal/documents/:kind`, `/publish` | admin | `bodyJson` (texto enriquecido) y `effectiveAt` al publicar; `volunteer` responde 410 |

Tipos en `packages/contracts/src/index.ts` (`Contract`, `ContractTemplate`, `ContractTerms`, `ContractPhase`…);
etiquetas en español en `packages/domain/src/contracts.ts` (`engagementLabels`, `contractPhaseLabels`,
`compensationLabels`, `locationLabels`, `periodLabels`) y `compensationSummary` para mostrar la remuneración.
