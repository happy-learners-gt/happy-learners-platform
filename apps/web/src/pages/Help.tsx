import { Link } from "../navigation";
import { EmptyState, PageHeader } from "../ui/primitives";

export function Help() {
  return <>
    <PageHeader title="Ayuda" description="Cómo preparar, publicar e impartir una clase, y qué datos guarda Happy Learners."/>
    <div className="reading prose">
      <h2>Cómo se organiza un curso</h2>
      <p>Un <strong>programa</strong> (opcional) reúne cursos que comparten configuración. Un <strong>curso</strong> tiene <strong>módulos</strong>; cada módulo tiene <strong>lecciones</strong>; cada lección tiene <strong>actividades</strong>, y una actividad puede usar un <strong>recurso</strong> de la biblioteca del curso. Cada curso puede llamar a sus módulos de otra forma (unidades, semanas, sesiones…).</p>
      <h2>Configuración académica</h2>
      <p>Cada curso se describe con clasificaciones de la UNESCO: tipo de educación y nivel (CINE 2011) y área de conocimiento (CINE-F 2013), además de formato, modalidad y ritmo. Esa configuración decide su comportamiento: si tiene grupos y asistencia, con qué secuencia empiezan las lecciones y qué se exige para publicar. En <strong>Configuración</strong> del curso cada ajuste muestra de dónde viene su valor y se puede cambiar, salvo que el programa lo fije.</p>
      <h2>Preparar y publicar una lección</h2>
      <ol>
        <li>En <Link href="/cursos">Cursos</Link>, abre un curso o crea uno nuevo.</li>
        <li>En <strong>Contenido</strong>, crea un módulo y después una lección dentro de él.</li>
        <li>En el editor, escribe el objetivo y agrega actividades. Los cambios se guardan solos; el indicador muestra “Guardado”. Para organizar vocabulario, usa <strong>Insertar tabla</strong>: la primera fila es de encabezados, Tab avanza entre celdas y la barra agrega o quita filas y columnas.</li>
        <li>Usa <strong>Vista previa</strong> para verla como estudiante y <strong>Publicar</strong> cuando esté lista. Comparte el enlace o el código.</li>
      </ol>
      <p>Después de publicar, puedes seguir editando: los estudiantes ven la versión publicada hasta que eliges <strong>Publicar cambios</strong>.</p>
      <p>Para adaptar una lección sin tocar la original, usa <strong>Duplicar</strong> en el menú de la lección: la copia queda como borrador justo después, con las mismas actividades y recursos, y se publica por separado.</p>
      <h2>Asignaciones, horario y clases</h2>
      <p>Están disponibles en los cursos presenciales o híbridos, o cuando la configuración del curso los activa, para el equipo docente del curso. El trabajo sigue este orden:</p>
      <ol>
        <li>En <strong>Asignaciones</strong>, crea las secciones del curso y asigna a cada una sus estudiantes con un nombre de lista o un código. Un estudiante queda asignado al curso cuando está en la lista de una de sus secciones; si lo retiras, su asistencia anterior se conserva.</li>
        <li>En <strong>Horario</strong>, elige los días, la hora, la duración y el periodo de cada sección y usa <strong>Guardar horario</strong>. Se generan todas las clases del periodo. Si cambias el horario, solo se rehacen las clases generadas que aún no comienzan, y sus lecciones pasan en el mismo orden a las nuevas fechas.</li>
        <li>En <strong>Clases</strong>, elige la lección de cada clase en su fila o usa <strong>Asignar lecciones en orden</strong> para dar a las clases sin lección las lecciones publicadas en el orden de Contenido. Los recursos de la clase son los de su lección: se editan en la lección. Con <strong>Agregar clase</strong> programas una clase extra, como una recuperación.</li>
        <li>Al llegar la hora, abre la clase y elige <strong>Comenzar clase</strong>. Presenta la lección y pasa lista; los cambios se guardan con <strong>Guardar asistencia</strong>.</li>
        <li>Elige <strong>Finalizar clase</strong> cuando todos estén marcados. La clase pasa al <strong>Historial</strong>, y el mapa de cobertura del <strong>Plan curricular</strong> marca como <strong>Impartido</strong> los resultados que trabaja su lección.</li>
      </ol>
      <p>Si una lección programada se archiva, la clase muestra <strong>Requiere sustitución</strong> para que elijas otra. Una lección en borrador se puede programar, pero los estudiantes la ven cuando se publica.</p>
      <p>Cada sección tiene un <strong>código para estudiantes</strong>. Con él, los estudiantes ven la próxima clase de su sección, su lección y sus recursos, sin cuenta. Puedes cambiar o desactivar el código en cualquier momento.</p>
      <h2>Datos y privacidad</h2>
      <p>La asistencia guarda solo el nombre de lista, la sección, la fecha y el estado. No pide correo, teléfono, fecha de nacimiento ni notas. Solo el equipo docente del curso la consulta.</p>
      <p>Las lecciones publicadas y el espacio de la sección se abren sin cuenta. Solo se cuenta cuántas veces se terminó una lección; no se guardan nombres ni respuestas. La sesión del equipo dura hasta ocho horas.</p>
      <h2>Diseño</h2>
      <p>La interfaz sigue Fluent Design de Microsoft. La <Link href="/guia-de-estilo">guía de estilo</Link> muestra sus principios y todos los componentes.</p>
      <h2>Esta demostración</h2>
      <p>Las cuentas de demostración son compartidas. Usa datos ficticios y no escribas información personal real.</p>
      <h2>Si algo no responde</h2>
      <p>Comprueba tu conexión y vuelve a intentar. Si tu sesión terminó, aparecerá un aviso para entrar de nuevo sin perder lo que tienes en pantalla.</p>
    </div>
  </>;
}

export function NotFound() {
  return <EmptyState level={1} icon="search" title="No encontramos esta página" action={<Link className="button primary" href="/inicio">Ir a Inicio</Link>}>El enlace puede haber cambiado o no estar disponible para tu cuenta.</EmptyState>;
}
