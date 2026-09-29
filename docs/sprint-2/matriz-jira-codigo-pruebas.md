# Matriz de aceptación de Sprint 2

La directiva de ejecución fija dos roles autenticados, un currículo Nivel → Unidad → Lección y recursos de texto o enlace. Esta decisión sustituye programas múltiples, el término “módulo” y carga binaria dentro de estas historias. Conserva sus identidades Jira y source ID. No se atribuyen funciones de v0.2.1 al tag v0.2.0.

| Jira | Source ID | Criterio Given / When / Then | Código | Prueba |
| --- | --- | --- | --- | --- |
| [HL-19](https://lfmendoza.atlassian.net/browse/HL-19) | ST-003 | Dado un administrador, al cambiar permisos se registra el cambio y se revocan sesiones; un educador recibe 403. | `apps/api/src/roles.ts`, `Workspace.tsx` | `HL-19 roles are enforced and changing a role revokes sessions` |
| [HL-20](https://lfmendoza.atlassian.net/browse/HL-20) | ST-008 | Dado un educador, al crear un nivel del currículo queda en su organización y se puede guardar como borrador. | `curriculum.ts` | `HL-20 HL-22 HL-24 curriculum persists, rejects orphans and validates exact ordering` |
| [HL-21](https://lfmendoza.atlassian.net/browse/HL-21) | ST-007 | Dada otra organización, al pedir o vincular contenido ajeno se rechaza sin revelarlo. | `index.ts`, `storage.ts`, `content.ts` | `HL-11 published lessons are read-only and isolated from other organizations`; `HL-23–29 editing...` |
| [HL-22](https://lfmendoza.atlassian.net/browse/HL-22) | ST-009 | Dado un nivel, al crear una unidad se conserva su pertenencia; una unidad huérfana se rechaza. | `curriculum.ts`, migración 0004 | `HL-20 HL-22 HL-24 curriculum...` |
| [HL-23](https://lfmendoza.atlassian.net/browse/HL-23) | ST-012 | Dada una unidad activa, al crear una lección comienza en borrador y no aparece por el enlace público. | `content.ts` | `HL-23–29 editing...` |
| [HL-24](https://lfmendoza.atlassian.net/browse/HL-24) | ST-010 | Dada una secuencia completa, al reordenarla se guarda sin duplicados ni pérdida de elementos. | `curriculum.ts`, `content.ts` | `HL-20 HL-22 HL-24 curriculum...` |
| [HL-25](https://lfmendoza.atlassian.net/browse/HL-25) | ST-013 | Dada una lección publicada, al editar se conserva la revisión pública hasta republicar y aumentar revisión. | `content.ts`, migración 0005 | `HL-23–29 editing...`; E2E `SPR-002: educator creates...` |
| [HL-26](https://lfmendoza.atlassian.net/browse/HL-26) | ST-017 | Dado un recurso textual, al guardar se validan metadatos y límite; editarlo conserva el ID. | `content.ts`, `Workspace.tsx` | `HL-23–29 editing...`; E2E desktop y móvil |
| [HL-27](https://lfmendoza.atlassian.net/browse/HL-27) | ST-018 | Dado un enlace, al registrar se aceptan HTTP/HTTPS y se rechazan esquemas inseguros; el alumno lo abre desde la lección. | `content.ts`, `PublicLesson` | `HL-23–29 editing...` |
| [HL-28](https://lfmendoza.atlassian.net/browse/HL-28) | ST-014 | Dadas actividades válidas, al agregar, editar, retirar o mover se conservan posiciones consecutivas. | `packages/domain/src/index.ts`, `Workspace.tsx` | `HL-23–29 editing...`; E2E desktop y móvil |
| [HL-29](https://lfmendoza.atlassian.net/browse/HL-29) | ST-019 | Dado un recurso propio, al vincularlo aparece en la publicación; archivarlo no rompe la copia publicada. | `content.ts`, `Workspace.tsx` | `HL-23–29 editing...` |

Las pruebas API se ejecutan en `tests/build.test.ts` contra el Worker compilado. `tests/test_migrations.py` prueba la actualización desde la base anterior. `tests/e2e/sprint-two.spec.ts` verifica el flujo completo en dos tamaños de pantalla y guarda capturas reales.

Los artefactos de [v0.2.1](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.2.1) contienen la evidencia final de producción, PR y SHA. El reporte nativo está en [Jira](https://lfmendoza.atlassian.net/jira/software/projects/HL/boards/1/reports/burndown-chart?sprint=1).
