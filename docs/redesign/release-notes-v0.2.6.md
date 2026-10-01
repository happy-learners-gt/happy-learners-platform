# v0.2.6 · Lecciones como un documento

HL-44 · ST-041 · REL-003.

## Qué cambia

- **Lienzo continuo en el editor.** Todas las actividades se editan en una sola página, una tras otra. Entre cualquier par de actividades hay un punto para insertar contenido, un recurso o una pregunta, así el orden se construye de forma natural. Una barra de formato fija actúa sobre el texto activo; el índice lateral lleva a cada actividad.
- **Borradores explícitos.** El autoguardado muestra "Borrador guardado". Tras publicar, cualquier cambio queda en borrador y se avisa que los estudiantes ven la versión publicada hasta elegir **Publicar cambios**.
- **Visor a todo el espacio.** Presentaciones diapositiva a diapositiva con el mayor tamaño que cabe, PDF página a página, documentos y hojas con desplazamiento, video con reproductor. **Presentar** / **Pantalla completa** y flechas del teclado.
- **PDF y video.** PDF hasta 25 MB y MP4/WebM hasta 100 MB, privados como el resto de archivos. Se suben en streaming; el navegador calcula la huella SHA-256 y R2 la verifica al guardar; se valida la firma de cada formato. Migración `0011_pdf_video_files.sql` (la tabla se reconstruye conservando cada fila).
- **Diseño estándar.** Todas las páginas empiezan junto al menú lateral con el mismo margen compacto.

## Validación

33 pruebas Vitest, 21 de Python (incluida la migración 0011 con el límite GLOB de Durable Objects), 38 E2E en escritorio y móvil con axe WCAG 2.2 A/AA, y revisión visual del lienzo y del visor (incluida una presentación real en modo pantalla completa).
