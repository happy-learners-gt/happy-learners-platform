# Happy Learners Studio

Happy Learners ayuda a los equipos docentes a organizar cursos, convertir materiales en lecciones y acompañar sus clases. La interfaz disponible en producción corresponde al último release integrado; los cambios de rediseño que estén en una rama solo estarán disponibles después de revisión, integración y despliegue.

## Abre según lo que necesites

- Producto y alcance: [modelo educativo genérico](redesign/modelo-educativo-generico.md).
- Flujos para educadores, estados y guía visual: [Happy Learners Studio](redesign/studio-flujos-y-diseno.md).
- Qué contiene el curso: [implementación de cursos](redesign/cursos-implementacion.md).
- Persistencia y relaciones: [diagramas de base de datos](redesign/base-de-datos.md).
- Prototipos de interacción: [prototipo de cursos](redesign/prototipo-cursos.html).
- Guía de usuario y demo: [guía de usuario](sprint-2/guia-de-usuario.md) · [guía de demostración](sprint-2/guia-de-demostracion.md).
- Navegación y nombres: [arquitectura de información v0.2.3](redesign/arquitectura-informacion-v0.2.3.md).
- Versión en producción: [v0.8.5](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.5): Clases muestra el cronograma de cada sección como tabla de planificación y seguimiento (fecha, módulo, lecciones, actividades, comentarios, recursos y asistencia); la lección es opcional y una clase puede cubrir varias. Sobre [v0.8.4](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.4) (Asignaciones por sección, Horario que genera las clases y cobertura impartida), [v0.8.3](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.3) (asignar significa inscribir a un estudiante), [v0.8.2](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.2) (planificar, impartir y cerrar clases; la sección sigue su próxima clase con un código), [v0.8.1](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.1) (solo el equipo docente accede a secciones y asistencia) y [v0.8.0](https://github.com/happy-learners-gt/happy-learners-platform/releases/tag/v0.8.0) (flujo completo del educador).
- Cambios anteriores: [release notes v0.7.0](redesign/release-notes-v0.7.0.md) (organización de demostración; guía en [demo/organizacion-demo.md](demo/organizacion-demo.md)). Anteriores: [v0.6.0](redesign/release-notes-v0.6.0.md) (Fluent, [design/fluent.md](design/fluent.md)), [v0.5.0](redesign/release-notes-v0.5.0.md), [v0.4.0](redesign/release-notes-v0.4.0.md), [v0.3.0](redesign/release-notes-v0.3.0.md), [v0.2.6](redesign/release-notes-v0.2.6.md), [v0.2.4](redesign/release-notes-v0.2.4.md), [v0.2.3](redesign/release-notes-v0.2.3.md), [v0.2.2](sprint-2/release-notes-v0.2.2.md) y [v0.2.1](sprint-2/release-notes-v0.2.1.md).

## Planificación y documentación canónica

La planificación, el backlog, las decisiones y la trazabilidad viven en `happy-learners-gt/happy-learners-ops`. El
proyecto tiene seis sprints canónicos (DEC-017): SPR-001 corresponde al diseño, SPR-002 a la implementación hasta
v0.8.0 y sus parches v0.8.1 a v0.8.5, y SPR-003 a SPR-006 avanzan hacia v1.0.0. Los documentos de `sprint-2/` y `redesign/` son registros de
sus incrementos y no sustituyen esa planificación.

## Datos y demostraciones

Las cuentas compartidas y el contenido de demostración son sintéticos. No se deben cargar datos identificables de niños. La asistencia utiliza una lista mínima privada del curso; revisa sus límites y uso en el [flujo de Studio](redesign/studio-flujos-y-diseno.md).

## Verificación local

```bash
./scripts/verify
npm run test:e2e
```
