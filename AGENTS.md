# Happy Learners Platform

Trabaja un solo ticket por sesión. Antes de editar, ejecuta `./scripts/prepare-ticket ST-###` o lee `.codex/context.md` si ya fue generado para el ticket actual.

Reglas:

1. Conserva los límites `web`, `api`, `domain`, `contracts`, `database` e `infrastructure`.
2. El dominio no depende de frameworks, persistencia ni transporte.
3. No cargues todo el backlog ni la documentación de operaciones; usa el paquete de contexto del ticket.
4. No inventes requisitos para resolver una pregunta `OQ-###` pendiente.
5. Las migraciones son acumulativas y versionadas. No reescribas una migración aplicada.
6. No despliegues ni cambies servicios externos sin un plan revisado y aprobación explícita.
7. Registra únicamente trabajo real en Jira.

Termina cada cambio con `./scripts/verify`. Resume los archivos modificados, las pruebas ejecutadas, los límites conocidos y las acciones externas pendientes.
