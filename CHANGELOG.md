# Changelog

## 0.2.0 — 2026-09-29

Primera versión utilizable para organizar materiales y preparar una clase.

- Biblioteca persistente de recursos con título, descripción, nivel, habilidad, tema, etiquetas y contenido.
- Creación de lecciones en borrador y publicación con código de acceso.
- Consulta desde teléfono sin pedir datos personales al estudiante.
- Registro únicamente agregado de finalizaciones.
- Migración reversible `0002_catalog.sql`, aislamiento por organización y smoke test en producción.

## 0.1.0 — 2026-09-28

Primer espacio funcional de Happy Learners para preparar una lección publicada desde escritorio o móvil.

- HL-9 / ST-001: acceso con cuentas sintéticas autorizadas, sesiones opacas y revocación al salir.
- HL-10 / ST-004: organización inicial persistente, zona horaria y permisos de administración.
- HL-11 / ST-031: lección publicada de solo lectura con objetivo, actividades, materiales e impresión.
- HL-12 / ST-042: comprobación automática de los flujos críticos tras desplegar y cada hora.
- HL-13 / ST-043: el artefacto verificado se despliega automáticamente desde main, con SHA y hashes de contenido.
- HL-14 / ST-045: sin perfiles de niños, datos sintéticos, sesiones temporales y registros sin cuerpos de solicitudes.
- HL-15 / ST-049: trazabilidad y operación existentes conservadas; no se amplía el harness.

Persistencia: SQLite en un Durable Object por organización, dentro del plan gratuito. D1 no se creó porque la credencial existente carece de acceso; la decisión está documentada en ops.

Demo: https://happy-learners-demo.lfmendoza-alvarez.workers.dev

Cuentas públicas de demostración: `admin-demo`, `instructor-demo`; contraseña sintética `Aprender-2026!`. No introducir información personal. Las cuentas reales, invitaciones, edición/publicación de contenido y trabajo sin conexión quedan fuera de esta release.

Evidencia histórica: EXE-1c48bd9d391baa5d45ec y MNF-53e11fe0b6a1a0dac88d. Alcance actualizado por la directiva P0 del 28 de septiembre de 2026.
