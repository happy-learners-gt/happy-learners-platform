# Changelog

## 0.2.4 — 2026-09-30

Tema visual moderno (HL-44 / ST-041). Sin cambios de API ni datos.

- Tema completo en `theme.css`: neutros fríos, violeta de marca y seis tonos (cielo, turquesa, rosa, coral, ámbar, verde) con variantes de texto, tinte y relleno, degradado de marca, tipografía, espaciado, radios, sombras y motion.
- Color con sentido: cada sección, curso, unidad, tipo de actividad y tipo de recurso tiene su tono estable.
- Tipografías autoalojadas: Inter y Plus Jakarta Sans.
- Inicio con encabezado que resume el día y contadores de colores; tarjetas de curso con portada; espaciado más compacto.
- Editor de texto tipo Docs: barra de iconos agrupada, enlace en línea, hoja con ancho de lectura, marcador de posición y contador de palabras.

## 0.2.3 — 2026-09-30

Reconstrucción de la experiencia de producto (HL-44 / ST-041). La API, los contratos y los datos no cambian.

- Un solo sistema de navegación: barra superior (marca, organización, búsqueda, ayuda, perfil) y un sidebar que cambia de contexto al entrar en un curso; en móvil se abre como panel.
- Inicio útil: continuar trabajando, cursos recientes, próximas clases, estado de las lecciones, acciones rápidas y actividad reciente.
- Cursos con tarjetas compactas, progreso de publicación, búsqueda y menú para editar, duplicar o archivar.
- Contenido unificado: unidades y lecciones en un outline con expandir, crear, renombrar en línea, reordenar con teclado y archivar.
- Editor de lección con autosave visible, outline de actividades, vista previa y una acción principal por estado.
- Biblioteca del curso y biblioteca global con búsqueda, filtros, uso en lecciones y vista previa; grupos → clases → asistencia con confirmación inmediata.
- Lección del estudiante móvil primero: una actividad a la vez, avance y cierre claro.
- Sesión expirada sin perder el trabajo en pantalla; errores que explican cómo recuperarse.
- Corrección: las actividades antiguas sin ID ya no se vacían al guardar una lección colaborativa.
- Sistema visual con tokens y primitivas propias; auditoría axe WCAG 2.2 AA en las pruebas E2E.

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
# v0.2.1

Roles Administrador/Educador, currículo Nivel–Unidad–Lección, edición persistente, revisiones publicadas, actividades ordenables y recursos vinculados. Migración acumulativa con seed sintético. [Detalle](docs/sprint-2/release-notes-v0.2.1.md).
