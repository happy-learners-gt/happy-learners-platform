# Guía de usuario

Versión vigente: v0.2.3. La navegación y los nombres se describen en la [arquitectura de información](../redesign/arquitectura-informacion-v0.2.3.md).

## Entrar al espacio

Abre [Happy Learners](https://happy-learners-demo.lfmendoza-alvarez.workers.dev). La cuenta `educador-demo` prepara y publica cursos; `admin-demo` configura la organización y los permisos. Las credenciales sintéticas están en “Probar con cuentas de demostración”. Cierra la sesión desde el menú de perfil, arriba a la derecha.

Los estudiantes no necesitan cuenta: abren el enlace publicado o escriben el código en “¿Eres estudiante?”.

## Cómo se organiza

Curso → Unidades → Lecciones → Actividades → Recursos.

- La barra superior tiene la búsqueda (tecla `/`), la ayuda y tu perfil.
- Fuera de un curso, el menú lateral muestra Inicio, Cursos, Biblioteca y Ayuda.
- Dentro de un curso, el mismo menú cambia a: Todos los cursos, Resumen, Contenido, Biblioteca del curso, Grupos, Asistencia y Configuración.
- En teléfono y tableta, el menú se abre con el botón **Menú**.

## Preparar un curso

1. En **Cursos**, selecciona **Crear curso**, escribe el nombre y el objetivo.
2. En **Contenido**, crea una unidad y, dentro de ella, **Nueva lección** con su título y objetivo.
3. Cada fila tiene un menú **⋯** para renombrar, mover arriba o abajo, ver una vista previa o archivar. También puedes hacer doble clic en un nombre para renombrarlo.
4. **Mostrar archivadas** permite restaurar unidades o lecciones archivadas.

Desde el listado de cursos puedes **Duplicar** un curso (unidades, recursos y lecciones como borrador; no copia grupos ni asistencia) o archivarlo. Un curso archivado se consulta pero no se edita; sus lecciones publicadas siguen disponibles.

## Editar una lección

El editor muestra el título, el estado (Borrador, Publicada, Cambios sin publicar o Archivada) y el indicador de guardado.

- **Detalles**: objetivo, unidad, duración y, si ya está publicada, su código y enlace.
- **Actividades**: selecciona una en la columna izquierda para editarla. Usa las flechas para cambiar su orden y **Agregar actividad** para sumar Contenido, Recurso de la biblioteca o Pregunta.
- Los cambios se guardan solos un segundo después de escribir. Si falta algo obligatorio, el indicador dice qué falta y **Revisar** te lleva al lugar.
- Si otra persona abre la misma lección, el texto se sincroniza en vivo y aparece “También editando”.
- **Vista previa** muestra la lección como la verá el estudiante, sin registrar nada.
- **Publicar** guarda lo pendiente y publica. Después de publicar, puedes seguir editando: los estudiantes ven la versión anterior hasta que eliges **Publicar cambios**. **Copiar enlace** copia la dirección para compartir.

Las preguntas necesitan entre dos y seis opciones distintas y una respuesta correcta marcada.

## Biblioteca

**Biblioteca del curso** reúne textos, enlaces y documentos DOCX, PPTX o XLSX (hasta 15 MB). Usa **Agregar recurso**, busca, filtra por tipo y cambia entre lista y cuadrícula. Cada recurso indica en cuántas lecciones se usa. Los documentos son privados: el estudiante solo los recibe dentro de una lección publicada que los usa. Archivar un recurso conserva las publicaciones anteriores.

**Biblioteca**, en el menú principal, muestra los recursos de todos los cursos para encontrarlos rápido; se editan desde la biblioteca de su curso.

## Grupos y asistencia

1. En **Grupos**, crea un grupo y agrega a sus participantes con un nombre de lista o un código.
2. Selecciona **Registrar clase** en el grupo (o en **Asistencia**), confirma la fecha y, si quieres, la lección publicada.
3. Marca a cada participante: Presente, Tarde, Ausente o Justificada. **Marcar pendientes como presente** ayuda en grupos grandes. **Guardar asistencia** confirma el resumen.

Solo el equipo docente del curso ve estos registros. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.

## Para estudiantes

La lección muestra una actividad a la vez con su avance. Usa **Anterior** y **Siguiente**; al final, **Terminar lección**. No se guardan nombres ni respuestas; solo se cuenta cuántas veces se terminó.

## Administración

Con `admin-demo`, el menú muestra **Organización**, **Educadores** y **Clasificaciones**. Cambiar el rol o el acceso de una cuenta cierra sus sesiones abiertas.

## Si algo falla

Los mensajes explican cómo recuperarse. Si la sesión termina mientras trabajas, aparece un aviso para volver a entrar sin perder lo que tienes en pantalla; al continuar, el editor guarda lo pendiente.
