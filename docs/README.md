# Happy Learners Studio

Happy Learners ayuda a los equipos docentes a organizar cursos, convertir materiales en lecciones y acompañar sus clases. Producción corresponde al último release integrado; los cambios de una rama solo están disponibles después de revisión, integración y despliegue.

## Documentos de la plataforma

- Sistema visual, tokens y componentes: [design/fluent.md](design/fluent.md).
- Organización de demostración, cuentas y recorridos: [demo/organizacion-demo.md](demo/organizacion-demo.md).
- Guía breve de uso para el equipo: [guia-de-uso.md](guia-de-uso.md).
- Rutas de la API y rutas retiradas: [api.md](api.md).
- Respaldo y restauración: [operations/respaldo-y-restauracion.md](operations/respaldo-y-restauracion.md).
- Publicación, ensayo y reversión: [operations/publicacion-y-reversion.md](operations/publicacion-y-reversion.md).
- Validación de accesibilidad y seguridad: [operations/validacion-1.0.md](operations/validacion-1.0.md).
- Cambios por versión: [CHANGELOG](../CHANGELOG.md) y [releases](https://github.com/happy-learners-gt/happy-learners-platform/releases).
- Código por capa: los README de `apps/web`, `apps/api`, `packages/domain`, `packages/contracts`, `database/migrations`, `infrastructure` y `tests`.

## Documentación canónica

El producto, los flujos, la arquitectura de información, el modelo de datos, la planificación, el backlog, las
decisiones y la trazabilidad viven en `happy-learners-gt/happy-learners-ops`. El proyecto tiene seis sprints canónicos
(DEC-017): SPR-001 corresponde al diseño, SPR-002 a la implementación de v0.8.0, sus parches y la versión 1.0 (DEC-034), y SPR-003 a
SPR-006 a las versiones posteriores. Las guías e informes de incrementos anteriores se conservan en el historial del repositorio,
por ejemplo en el tag [v0.8.7](https://github.com/happy-learners-gt/happy-learners-platform/tree/v0.8.7/docs).

## Datos y demostraciones

Las cuentas compartidas y el contenido de demostración son sintéticos. No se deben cargar datos identificables de niños. La asistencia utiliza una lista mínima privada de cada sección, visible solo para su equipo docente.

## Verificación local

```bash
./scripts/verify
npm run test:e2e
```
