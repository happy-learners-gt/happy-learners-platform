# Happy Learners Platform

Trabaja un solo ticket por sesión. Antes de editar, ejecuta `./scripts/prepare-ticket ST-###` o lee `.codex/context.md` si ya fue generado para el ticket actual.

Reglas:

1. Conserva los límites `web`, `api`, `domain`, `contracts`, `database` e `infrastructure`.
2. El dominio no depende de frameworks, persistencia ni transporte.
3. No cargues todo el backlog ni la documentación de operaciones; usa el paquete de contexto del ticket.
4. No inventes requisitos para resolver una pregunta `OQ-###` pendiente.
5. Las migraciones son acumulativas y versionadas. No reescribas una migración aplicada.
6. Los efectos externos requieren un plan validado contra el manifiesto semántico aprobado; esa aprobación cubre el ciclo y no se repite por operación.
7. Registra únicamente trabajo real en Jira.

Termina cada cambio con `./scripts/verify`. Resume los archivos modificados, las pruebas ejecutadas, los límites conocidos y las acciones externas pendientes.

## Autorización semántica de Happy Learners

La aprobación ocurre una sola vez sobre el manifiesto del sprint y cubre los efectos declarados hasta REVIEW_READY: Jira, ramas, implementación, pruebas, commits, push, PR, checks, squash, despliegue autorizado, worklogs aprobados, comentarios, transiciones, documentación, gráficas, publicación, release y cierre. Una prohibición expresa del manifiesto prevalece; REL-001 permanece prepare_only mientras no se autorice su publicación.

Regenerar IDs, hashes o planes técnicamente equivalentes, corregir pruebas, defectos, integración o documentación dentro del alcance no requiere otra aprobación. Reconcilia las aplicaciones parciales con el sistema externo y continúa sin duplicar efectos. No presentes una acción ya autorizada como pendiente de aprobación. Continúa hasta terminar o encontrar un bloqueo material real.

Los servicios externos se operan mediante el runner autorizado y sus repository secrets. 1Password se utiliza para bootstrap o rotación. No copies sesiones personales a CI. OneDrive utiliza Files.ReadWrite.AppFolder. Usa `hlops auth bootstrap` para agrupar los consentimientos inevitables.

No hagas force-push, reset destructivo, eliminación recursiva amplia, exposición de secretos, modificaciones ajenas a Happy Learners, contratación de recursos pagados, cambios DNS no autorizados ni movimiento de tags publicados. Las reglas de comandos son una defensa adicional, no sustituyen estas restricciones semánticas.

Detente únicamente por cambio material de alcance, ambigüedad funcional real, recurso pagado, operación destructiva no autorizada, riesgo de seguridad, credencial inexistente, consentimiento externo obligatorio o indisponibilidad persistente tras reintentos. Agrupa los bloqueos y continúa el trabajo independiente. Un fallo de prueba corregible no es un bloqueo material.
