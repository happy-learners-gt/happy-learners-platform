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
      <h2>Clases, grupos y asistencia</h2>
      <p>Están disponibles en los cursos presenciales o híbridos, o cuando la configuración del curso los activa, para el equipo docente del curso. En <strong>Grupos</strong>, crea un grupo y agrega a sus participantes con un nombre de lista o un código; desde el menú puedes renombrarlo, retirar participantes o cerrar el grupo al terminar el ciclo.</p>
      <ol>
        <li>En <strong>Clases</strong>, usa <strong>Planificar clase</strong>: elige el grupo, la fecha y la hora, la lección y los recursos de la biblioteca que usarás.</li>
        <li>Al llegar la hora, abre la clase y elige <strong>Comenzar clase</strong>. Presenta la lección y pasa lista; los cambios se guardan con <strong>Guardar asistencia</strong>.</li>
        <li>Elige <strong>Finalizar clase</strong> cuando todos estén marcados. La clase pasa al <strong>Historial</strong> y cuenta en los indicadores del curso.</li>
      </ol>
      <p>Cada grupo tiene un <strong>código para estudiantes</strong>. Con él, los estudiantes ven la próxima clase de su grupo, su lección y sus recursos, sin cuenta. Puedes cambiar o desactivar el código en cualquier momento.</p>
      <h2>Asignaciones</h2>
      <p>Un estudiante queda asignado a un curso cuando lo agregas a la lista de uno de sus grupos en <strong>Grupos</strong>. Si lo retiras del grupo, deja de estar asignado y su asistencia anterior se conserva.</p>
      <h2>Cronograma</h2>
      <p>En <strong>Cronograma</strong>, programa qué lección publicada usa cada grupo y desde qué fecha, con un término opcional. Solo se ofrecen lecciones publicadas. Si la lección se vuelve a publicar, verás su número de publicación nuevo y podrás confirmarlo; si se archiva, la lección programada muestra <strong>Requiere sustitución</strong> para que elijas otra lección publicada. En <strong>Inicio</strong>, “Tu cronograma vigente” abre siempre la publicación vigente de cada lección programada en tus cursos, nunca un borrador, y avisa si alguna quedó sin una versión válida.</p>
      <h2>Datos y privacidad</h2>
      <p>La asistencia guarda solo el nombre de lista, el grupo, la fecha y el estado. No pide correo, teléfono, fecha de nacimiento ni notas. Solo el equipo docente del curso la consulta.</p>
      <p>Las lecciones publicadas y el espacio del grupo se abren sin cuenta. Solo se cuenta cuántas veces se terminó una lección; no se guardan nombres ni respuestas. La sesión del equipo dura hasta ocho horas.</p>
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
