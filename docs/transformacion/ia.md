# IA como plataforma · estado y arquitectura objetivo

Tarea AI-01. Basado en el código de 1.6.0 (`apps/api/src/openai.ts`, `ai-runs.ts`, `ai-assist.ts`, `proposals.ts`,
`book-map.ts`; `packages/domain/src/*`) y en el diseño `docs/design/asistente-ia.md` §6. Principio que se conserva:
**la IA propone, una persona decide; nada se escribe solo.**

## 1. Lo que ya existe (y se conserva)

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Puertos por tarea | `packages/domain` (`LessonDraftGenerator`, `BookMapper`, `LessonImprover`, `AiWriter`, `FieldSuggester`, `RulesTranslator`) | El dominio no conoce al proveedor; cada tarea tiene esquema, prompt versionado y validación propios |
| Adaptador OpenAI | `openai.ts` `structured()` | Responses API con JSON Schema estricto, `store: false`, tope de tokens y tiempo por tarea; distingue `transient`, `refused`, `incomplete`, `error` |
| Adaptador local | `fixture*` en el dominio | Mismas interfaces sin red; lo usan Vitest, E2E y CI |
| Registro | `ai-runs.ts` `tracked()` → `ai_runs` | Tarea, versión del prompt, modelo, caracteres, tokens, duración y estado. Nunca el texto |
| Costo | `ai_prices` + Uso de IA | Precio por modelo con vigencia, puesto por administración |
| Colas | Alarma del DO (`proposals.ts`, `book-map.ts`) | Lotes de 3; reintento de fallos transitorios hasta 3 intentos |
| Validación de salida | Dominio (`checkedChanges`, `verifiedPages`, `writtenText`, reglas de horario) | Descarta lo que no cumple: citas que no están en la página, cambios a actividades inexistentes |
| Permisos | `accessTo`/`access` antes de cada llamada | Solo quien puede editar el curso usa la IA sobre él |
| Evaluación | `tests/ai-evals/lesson-proposal.cases.json`, `npm run ai:eval` (manual, en vivo) | 3 casos de una tarea |

### Capacidades (skills) actuales

| Tarea (`AiTask`) | Dónde aparece | Entrada | Salida validada | Aprobación humana |
| --- | --- | --- | --- | --- |
| `lesson-proposal` | Curso › Planificar con IA | Indicadores + páginas confirmadas del libro | Borrador de lección | Revisión y publicación por el equipo |
| `book-map` | Curso › Mapa del libro | Indicador + páginas candidatas | Páginas con cita verificada | Confirmar el mapa |
| `lesson-review-explain` | Editor › Revisar | Revisión determinista con puntaje | Explicación | Solo lectura |
| `lesson-improve` | Editor › Mejorar | Borrador de la lección | Cambios por actividad | Aceptar uno por uno |
| `write` | «Redactar con IA» en campos de texto | Campo, contexto corto | Texto | Insertar o descartar |
| `suggest-fields` | Diseñador de documentos | Texto de la plantilla | Campos sugeridos | Aceptar uno por uno |
| `rules-to-constraints` | Horarios › Reglas | Regla en palabras | Reglas estructuradas | Confirmar antes de generar |

Esto ya es un modelo de skills razonable: cada uno tiene propósito, entrada, permiso, salida, validación y aprobación.
**No se introduce un marco de agentes:** todas las tareas son de un paso con validación determinista; un agente
multi-paso no mejora ninguna hoy (TD-007).

## 2. Brechas, priorizadas

| Id | Brecha | Riesgo / valor | Prioridad |
| --- | --- | --- | --- |
| AIG-1 | ✅ 1.6.1 · **Sin límite de uso en las tareas síncronas** (`write`, `lesson-improve`, `suggest-fields`, `rules-to-constraints`, `lesson-review-explain`): una cuenta puede llamar sin tope | Gasto del proveedor sin control (OWASP LLM10, consumo ilimitado) | **P0 (seguridad)** |
| AIG-2 | Evaluaciones solo de `lesson-proposal` (3 casos) | Un cambio de prompt o de modelo en las otras 6 tareas no tiene regresión | P1 |
| AIG-3 | Hecho en 1.6.15: `OPENAI_MODEL_SHORT` opcional para redactar y sugerir campos; falta que el dueño la configure. Antes: un solo modelo para todas las tareas (`OPENAI_MODEL`) | Tareas cortas (`write`, `suggest-fields`) pagan el modelo de las largas | P2 (costo) |
| AIG-4 | Hecho en 1.6.9 (TD-009) para las tareas síncronas y en 1.6.16 (AIG-4b) para propuestas y mapa, leído de los datos. No se medía la aceptación (cuánto de lo propuesto se usa) | «Respuesta 200» ≠ tarea lograda; sin esto no hay calidad medible | P1 |
| AIG-5 | Hecho en 1.6.9: «Inteligencia artificial» abre con qué hace la IA, dónde, quién decide, uso y propuestas usadas; consumo y costo debajo. Antes: Uso de IA era un panel técnico (contadores y precios) | No responde «qué puede hacer la IA aquí, quién la usa, cuánto sirve» | P1 (UX) |
| AIG-6 | Sin tope mensual por organización | Base del plan comercial; es decisión de negocio | P2, requiere aprobación (AP-07) |
| AIG-7 | Inyección de instrucciones desde el libro o la plantilla | Mitigado: salidas con esquema estricto, validación determinista y aceptación humana; la IA no tiene herramientas que escriban. Falta un caso de prueba con texto hostil por tarea | P2 (en AIG-2) |

## 3. Arquitectura objetivo (incremental)

```text
UI (en contexto: editor, curso, horarios, diseñador)
      │  petición con la tarea y la entrada mínima
      ▼
API  ── permiso (accessTo) ── límite de uso (AIG-1) ── tracked() → ai_runs (+ aceptación, AIG-4)
      │
      ▼
Puerto del dominio (prompt versionado, esquema, validación)  ◄── evaluaciones por tarea (AIG-2)
      │
      ▼
Adaptador: openai (modelo por tarea, AIG-3) │ fixture (CI)
```

AIG-6 (1.6.13, AP-07): presupuesto mensual por organización en USD; cada petición a la IA suma las ejecuciones del
mes (una fila leída por ejecución); las ejecuciones sin precio no cuentan y la página lo avisa.

Orden de trabajo: AIG-1 (hecho en 1.6.1: 60 por persona y hora) → AIG-2 y AIG-4 (M6) → AIG-5 rediseño de «Inteligencia artificial» (M6) → AIG-3
→ AIG-6 cuando el dueño decida el plan.

## 4. Contexto y memoria

Hoy cada tarea recibe solo el contexto que necesita, armado en el servidor desde la base de la organización (nunca
desde otra organización: un Durable Object por organización). No hay memoria entre ejecuciones ni conversación, y no se
guarda texto. **Se mantiene así** hasta que una capacidad concreta lo necesite; cuando llegue, la memoria vivirá en la
base de la organización, con retención y borrado definidos, y nunca con datos de estudiantes más allá del nombre de
pila que ya se usa en la boleta (`docs/security/auditoria-2026-11.md` §2).
