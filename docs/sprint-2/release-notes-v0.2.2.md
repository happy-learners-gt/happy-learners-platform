# v0.2.2 · Un espacio de trabajo compartido

Esta versión amplía Studio para que el equipo prepare y conduzca sus clases desde un mismo lugar. La release v0.2.1 permanece intacta.

## Edición y colaboración

- El contenido de una lección usa texto enriquecido: títulos, listas, enlaces y formato básico.
- Dos o más educadores con acceso al curso pueden editar a la vez. Los cambios y la presencia se sincronizan en vivo y se guardan al desconectarse.
- La estructura de la lección se sigue guardando como borrador y se publica de forma explícita.

## Materiales Office

- Educadores pueden cargar DOCX, PPTX y XLSX de hasta 15 MB en el espacio privado del curso. El límite acumulado es 4 GiB por organización.
- La vista previa se procesa en el navegador. La descarga y la vista requieren acceso al curso; una publicación solo expone los archivos que contiene.
- Se pueden archivar materiales; el archivo no se elimina de forma implícita.

## Seguridad y operación

- Los archivos se validan por formato, tamaño y estructura OOXML, se verifican con SHA-256 y se guardan en R2 privado. Al leerlos, el sistema vuelve a comprobar tamaño, organización y hash.
- Las sesiones de colaboración requieren una sesión educativa vigente y el mismo curso y organización.
- Los datos previos se conservan; la migración añade el catálogo de archivos sin reescribir lecciones existentes.

## Límites

La coedición simultánea cubre el texto de una lección, no la edición concurrente del título ni de su estructura. La vista previa Office está limitada a documentos de hasta 15 MB y se realiza en el dispositivo. No se guardan archivos privados en enlaces públicos salvo que una persona educadora los incluya en una lección publicada.
