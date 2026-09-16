# Flujo de implementación con Codex

## Preparación

Desde `happy-learners-platform`:

```bash
./scripts/prepare-ticket ST-###
```

El comando extrae únicamente la historia, sus criterios, dependencias, preguntas y decisiones relacionadas. Inicia una conversación nueva para cada resultado coherente.

## Prompt mínimo

```text
Implementa únicamente ST-###. Sigue AGENTS.md y usa .codex/context.md como alcance autorizado.
Inspecciona primero el código relacionado, satisface los criterios aplicables y ejecuta ./scripts/verify.
No resuelvas preguntas OQ pendientes ni publiques cambios externos.
Al terminar, resume cambios, pruebas, límites y acciones externas pendientes.
```

No copies el Product Brief, el backlog completo ni los documentos de arquitectura al prompt. Si el paquete de contexto revela un conflicto o una pregunta abierta que impide implementar, detén el cambio y registra el bloqueo en lugar de inventar una decisión.

## Después de validar el resultado

Actualiza la fuente correspondiente en `happy-learners-ops`, ejecuta `./hlops plan` y revisa su `plan_id`. Solo entonces aplica la publicación o prepara una actualización de Jira. Los worklogs describen trabajo real y nunca se generan por adelantado.
