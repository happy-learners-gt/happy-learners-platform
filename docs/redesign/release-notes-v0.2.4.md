# v0.2.4 · Un espacio con color

HL-44 · ST-041 · REL-003. Renovación visual sobre v0.2.3; la API, los contratos y los datos no cambian.

## Qué cambia

- **Tema completo** en `apps/web/src/theme.css`: todos los colores, tipografías, espaciados, radios, sombras, movimientos y breakpoints son tokens; `style.css` solo los usa. Detalle en [Studio: sistema visual](studio-flujos-y-diseno.md#sistema-visual).
- **Paleta multicolor:** violeta de marca y seis tonos (cielo, turquesa, rosa, coral, ámbar, verde). Cada sección del menú, cada curso y unidad, y cada tipo de actividad y recurso tiene su tono; el color siempre acompaña a texto o icono.
- **Tipografía:** Inter para texto y Plus Jakarta Sans para títulos, alojadas en la propia aplicación.
- **Inicio:** encabezado en degradado con el resumen del día y contadores de colores. Tarjetas de curso con portada, outline con franjas de color, asistencia y lección del estudiante con el mismo lenguaje.
- **Editor tipo Docs:** barra de iconos agrupada (deshacer, rehacer, texto, título, subtítulo, negrita, cursiva, subrayado, tachado, listas, cita, enlace), navegación con flechas, enlace sin ventanas emergentes, hoja blanca con ancho de lectura, marcador de posición y contador de palabras.
- **Espaciado** más compacto en paneles, encabezados y rejillas.

## Calidad

- Contraste de todo texto ≥ 4.5:1, incluidos tintes y rellenos de color; tonos vivos y ámbar solo decorativos.
- 36 E2E en escritorio y móvil con auditoría axe WCAG 2.2 A/AA; preview aislada revisada.

## Límite conocido

La limpieza de los registros E2E antiguos de la demo pública sigue pendiente de autorización explícita.
