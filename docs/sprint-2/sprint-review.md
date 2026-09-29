# Sprint 2 · Una clase lista para compartir

## Objetivo

Permitir que Cesia y su equipo preparen una clase de inglés, organicen sus materiales y la compartan para usarla desde un teléfono sin pedir datos personales al estudiante.

## Entrega

La base anterior permitía entrar, registrar recursos y publicar una lección sencilla. La corrección completa los permisos, el currículo, la edición, la secuencia de actividades y los recursos vinculados.

| Compromiso | Resultado de v0.2.1 |
| --- | --- |
| Acceso según responsabilidad | Administrador configura y gestiona permisos; Educador prepara el contenido. |
| Organización del material | Niveles, unidades y lecciones, con edición, orden y archivo. |
| Preparación y revisión | Borrador independiente de la publicación y republicación numerada. |
| Clase utilizable | Texto, recursos y preguntas ordenados; enlace y código móvil. |
| Conservación y privacidad | Persistencia, materiales publicados conservados y finalización agregada sin perfiles de estudiantes. |

## Demostración

[Greetings and Introductions](https://happy-learners-demo.lfmendoza-alvarez.workers.dev/?code=GREETINGS) reúne una instrucción, un recurso y una pregunta. La [guía de cinco minutos](guia-de-demostracion.md) permite repetir el recorrido sin acompañamiento técnico.

## Calidad

Las verificaciones cubren autorización, aislamiento entre organizaciones, migración de datos existentes, guardados concurrentes, edición y republicación, enlaces, archivo y persistencia. Los recorridos E2E comprueban escritorio y teléfono. La release reúne el resultado de CI, el SHA observado en producción y capturas reales.

## Ejecución y burndown

Jira se actualizó retrospectivamente para la implementación inicial de v0.2.0. La corrección v0.2.1 inicia el sprint y registra las transiciones en sus fechas reales. El [burndown nativo](https://lfmendoza.atlassian.net/jira/software/projects/HL/boards/1/reports/burndown-chart?sprint=1) representa esos eventos Jira.

El gráfico reconstruido del PDF utiliza commits, PR, checks, despliegues y transiciones comprobados. Se identifica como reconstrucción basada en evidencia. No es el gráfico nativo, no interpola una diagonal y no convierte fechas de commits en fechas de aceptación.

## Horas humanas

No se dispone de un registro humano verificable para esta ejecución. No se atribuyen horas a personas ni se generan worklogs. Las duraciones de pruebas, automatización y despliegue no se cuentan como trabajo humano.

## Aprendizaje y siguiente paso

Un despliegue exitoso no basta para aceptar una historia. La preparación debe demostrarse de principio a fin y conservar su estado entre sesiones. El siguiente sprint añade grupos y asignaciones sobre este recorrido, manteniendo el acceso del estudiante con datos mínimos.
