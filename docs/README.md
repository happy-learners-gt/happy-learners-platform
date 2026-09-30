# Happy Learners Studio

Happy Learners ayuda a los equipos docentes a organizar cursos, convertir materiales en lecciones y acompañar sus clases. La interfaz disponible en producción corresponde al último release integrado; los cambios de rediseño que estén en una rama solo estarán disponibles después de revisión, integración y despliegue.

## Abre según lo que necesites

- Producto y alcance: [modelo educativo genérico](redesign/modelo-educativo-generico.md).
- Flujos para educadores, estados y guía visual: [Happy Learners Studio](redesign/studio-flujos-y-diseno.md).
- Qué contiene el curso: [implementación de cursos](redesign/cursos-implementacion.md).
- Persistencia y relaciones: [diagramas de base de datos](redesign/base-de-datos.md).
- Prototipos de interacción: [prototipo de cursos](redesign/prototipo-cursos.html).
- Guía de usuario y demo: [guía de usuario](sprint-2/guia-de-usuario.md) · [guía de demostración](sprint-2/guia-de-demostracion.md).
- Cambios actuales: [release notes v0.2.2](sprint-2/release-notes-v0.2.2.md). La [v0.2.1](sprint-2/release-notes-v0.2.1.md) se conserva como registro histórico.

## Datos y demostraciones

Las cuentas compartidas y el contenido de demostración son sintéticos. No se deben cargar datos identificables de niños. La asistencia utiliza una lista mínima privada del curso; revisa sus límites y uso en el [flujo de Studio](redesign/studio-flujos-y-diseno.md).

## Verificación local

```bash
./scripts/verify
npm run test:e2e
```
