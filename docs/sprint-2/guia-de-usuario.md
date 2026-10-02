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

1. En **Cursos**, selecciona **Crear curso**, escribe el nombre y el objetivo y elige un **punto de partida** (Curso libre, Taller, Primera infancia, Primaria, Secundaria o Educación superior). Ajusta lo que necesites:
   - **Programa** (opcional): el curso hereda su tipo de educación, nivel, modalidad y ritmo.
   - **Tipo de educación** y **nivel educativo** según la CINE 2011 de la UNESCO. La educación formal siempre tiene nivel; "Sin nivel" es solo para educación no formal.
   - **Formato** (Asignatura, Curso libre, Taller, Laboratorio, Seminario), **modalidad** (Presencial, En línea, Híbrida), **ritmo** (Con calendario, A tu ritmo) y **área de conocimiento** (CINE-F 2013).
   - **Comportamiento del curso**: nombre de las partes (Módulos por defecto; también Unidades, Semanas, Sesiones, Temas o Bloques), secuencia didáctica de las lecciones nuevas, grupos y asistencia, y si publicar exige resultados de aprendizaje o una comprobación. Cada ajuste muestra su valor y de dónde viene (*Según el tipo de curso*, *Del programa*, *Fijado por el programa* o *Definido en el curso*).
2. En **Contenido**, crea un módulo y, dentro de él, **Nueva lección** con su título y objetivo.
3. Cada fila tiene un menú **⋯** para renombrar, mover arriba o abajo, ver una vista previa o archivar. También puedes hacer doble clic en un nombre para renombrarlo.
4. **Mostrar archivados** permite restaurar módulos o lecciones archivados.

En **Cursos**, los filtros por programa, nivel, formato, área y modalidad muestran cuántos cursos deja cada opción.

Grupos y asistencia aparecen cuando la configuración del curso los activa (por defecto, en cursos presenciales e híbridos).

Desde el listado de cursos puedes **Duplicar** un curso (configuración, módulos, plan curricular, recursos y lecciones como borrador; no copia grupos ni asistencia) o archivarlo. Un curso archivado se consulta pero no se edita; sus lecciones publicadas siguen disponibles.

## Plan curricular

El **Plan curricular** del curso responde qué se desarrolla y si el curso lo cubre:

1. **Competencias:** capacidades amplias que el curso desarrolla (por ejemplo, Comunicación oral).
2. **Resultados de aprendizaje:** lo que cada estudiante podrá demostrar al terminar, con su nivel de pensamiento (Recordar, Comprender, Aplicar, Analizar, Evaluar, Crear) y su evidencia. Reciben códigos en orden: RA1, RA2…
3. **Mapa de cobertura:** cada fila es un resultado y cada columna un módulo. Marca **Planificar** donde se trabajará. Una lección alineada cuenta como *trabajado*; una pregunta o una actividad con propósito Evaluar, como *evaluado*.
4. La columna **Estado** dice qué falta y ofrece la acción: **Crear lección** (queda alineada al resultado y en su módulo) o **Agregar evaluación** en la lección que ya lo trabaja. La fila **Pendiente** muestra lo planificado que ninguna lección del módulo trabaja todavía.

Archivar un resultado lo saca de la cobertura y de las lecciones nuevas; las lecciones que ya lo nombran lo conservan.

## Editar una lección

El editor muestra el título, el estado (Borrador, Publicada, Cambios sin publicar o Archivada) y el indicador de guardado.

- La lección es un lienzo: **Detalles** (objetivo, secuencia didáctica, unidad, duración y publicación) y después los **momentos** de la secuencia con sus actividades.
- La **secuencia didáctica** ordena la clase: Inicio · Desarrollo · Cierre, 5E, Presentación · Práctica · Producción, Demostración · Práctica guiada · Práctica independiente, o Libre. Cada momento explica para qué sirve y suma sus minutos.
- Al final de cada momento puedes agregar una actividad que empieza con **Contenido**, **Recurso** o **Pregunta**. Las flechas del índice suben o bajan la actividad y la pasan al momento anterior o siguiente; el menú **⋯** la mueve a cualquier momento o la elimina.
- En **Detalles**, **Resultados de aprendizaje** alinea la lección con el plan del curso; se indica cuáles están planificados en su módulo.
- Cada actividad tiene **Propósito**, **Organización**, minutos y bloques. Si la lección tiene resultados, **Trabaja** indica cuáles desarrolla esa actividad (sin marcar: todos los de la lección). Con **Agregar bloque** sumas texto, un recurso, una pregunta o una **Nota para el docente**. Las notas nunca llegan a los estudiantes.
- La barra de formato de arriba actúa sobre el texto que estés editando.
- Todo se guarda solo como **borrador** ("Borrador guardado"). Si falta algo obligatorio, el indicador dice qué falta y **Revisar** te lleva al lugar.
- Si otra persona abre la misma lección, el texto se sincroniza en vivo y aparece “También editando”.
- **Vista previa** muestra la lección como la verá el estudiante, sin registrar nada.
- **Antes de publicar** revisa cuatro puntos; los que exige la configuración del curso aparecen como **Obligatorio** e impiden publicar hasta cumplirse. Los demás son recomendaciones: alineación a resultados, momentos con actividades, una forma de comprobar lo aprendido y minutos acordes a la duración. Si alguna está pendiente, al publicar se pregunta si continuar o revisar.
- Al elegir un recurso, primero aparecen los **sugeridos**: los que usan otras lecciones con los mismos resultados.
- **Publicar** guarda lo pendiente y publica. Después de publicar, puedes seguir editando: los estudiantes ven la versión anterior hasta que eliges **Publicar cambios**. **Copiar enlace** copia la dirección para compartir.

Las preguntas necesitan entre dos y seis opciones distintas y una respuesta correcta marcada.

## Biblioteca

**Biblioteca del curso** reúne textos, enlaces, documentos DOCX, PPTX o XLSX (hasta 15 MB), PDF (hasta 25 MB) y video MP4 o WebM (hasta 100 MB). El visor ocupa todo el espacio; **Presentar** o **Pantalla completa** muestran el archivo en toda la pantalla y las flechas ← → avanzan diapositivas o páginas. Usa **Agregar recurso**, busca, filtra por tipo y cambia entre lista y cuadrícula. Cada recurso indica en cuántas lecciones se usa. Los documentos son privados: el estudiante solo los recibe dentro de una lección publicada que los usa. Archivar un recurso conserva las publicaciones anteriores.

**Biblioteca**, en el menú principal, muestra los recursos de todos los cursos para encontrarlos rápido; se editan desde la biblioteca de su curso.

## Grupos y asistencia

1. En **Grupos**, crea un grupo y agrega a sus participantes con un nombre de lista o un código.
2. Selecciona **Registrar clase** en el grupo (o en **Asistencia**), confirma la fecha y, si quieres, la lección publicada.
3. Marca a cada participante: Presente, Tarde, Ausente o Justificada. **Marcar pendientes como presente** ayuda en grupos grandes. **Guardar asistencia** confirma el resumen.

Solo el equipo docente del curso ve estos registros. No agregues correos, teléfonos, fechas de nacimiento ni notas personales.

## Para estudiantes

La lección empieza con lo que aprenderás (el objetivo y, si la lección está alineada, lo que podrás hacer al terminar) y sus momentos, y después muestra una actividad a la vez con su momento, propósito y avance. Usa **Anterior** y **Siguiente**; al final, **Terminar lección**. No se guardan nombres ni respuestas; solo se cuenta cuántas veces se terminó.

## Administración

Con `admin-demo`, el menú muestra **Organización**, **Educadores** y **Configuración académica**. En esta última:

- **Programas**: conjuntos de cursos (un grado, una carrera, una ruta de idiomas) con tipo, nivel, modalidad y ritmo comunes, y ajustes para sus cursos. Un ajuste **fijado** no se puede cambiar desde los cursos del programa.
- **Etiquetas de la biblioteca**: grupos de etiquetas libres para encontrar y filtrar recursos en **Biblioteca**. No cambian la configuración de los cursos.
- **Estándares de referencia**: los niveles CINE 2011 y las áreas CINE-F 2013.

 Cambiar el rol o el acceso de una cuenta cierra sus sesiones abiertas.

## Si algo falla

Los mensajes explican cómo recuperarse. Si la sesión termina mientras trabajas, aparece un aviso para volver a entrar sin perder lo que tienes en pantalla; al continuar, el editor guarda lo pendiente.
