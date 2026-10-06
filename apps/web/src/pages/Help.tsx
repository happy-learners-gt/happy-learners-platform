import { Link } from "../navigation";
import { EmptyState, PageHeader } from "../ui/primitives";

export function Help() {
  return <>
    <PageHeader title="Ayuda" description="Cómo preparar, publicar e impartir una clase, y qué datos guarda Happy Learners."/>
    <div className="reading prose">
      <h2>Cómo se organiza un curso</h2>
      <p>Un <strong>programa</strong> (opcional) reúne cursos que comparten configuración. Un <strong>curso</strong> tiene <strong>módulos</strong>; cada módulo tiene <strong>lecciones</strong>; cada lección tiene <strong>actividades</strong>, y una actividad puede usar un <strong>recurso</strong> de la biblioteca del curso. Cada curso puede llamar a sus módulos de otra forma (unidades, semanas, sesiones…).</p>
      <h2>Quién hace qué</h2>
      <ul>
        <li><strong>Administración</strong> crea los cursos y su configuración, sus secciones, sus horarios y su equipo docente; inscribe a los estudiantes y asigna quién imparte cada sección. Consulta todo el contenido, el plan y las clases sin modificarlos, salvo que forme parte del equipo del curso.</li>
        <li><strong>Responsable del curso</strong>: prepara y publica las lecciones, organiza los módulos, mantiene el plan curricular, revisa lo que envía su equipo y puede impartir cualquier sección del curso.</li>
        <li><strong>Colaborador</strong>: prepara y edita lecciones y recursos, y envía las lecciones a revisión. Ve e imparte solo las secciones que tiene asignadas: planifica sus clases, las comienza, pasa lista, las finaliza o las cancela.</li>
      </ul>
      <p>Cada educador ve únicamente los cursos en los que participa.</p>
      <h2>Configuración académica</h2>
      <p>Cada curso se describe con clasificaciones de la UNESCO: tipo de educación y nivel (CINE 2011) y área de conocimiento (CINE-F 2013), además de formato, modalidad y ritmo. Esa configuración decide su comportamiento: si tiene secciones con asistencia y grupos de trabajo, con qué secuencia empiezan las lecciones y qué se exige para publicar. En <strong>Configuración</strong> del curso cada ajuste muestra de dónde viene su valor; administración puede cambiarlo, salvo que el programa lo fije.</p>
      <p>Dentro de un programa, un curso puede <strong>requerir</strong> otros cursos del mismo programa. Administración los define en <strong>Configuración académica › Programas › Requisitos entre cursos</strong>, donde la ruta se ordena en etapas y no se permiten ciclos. El resumen de cada curso muestra en <strong>Ruta en el programa</strong> qué requiere y qué cursos le siguen. Los requisitos orientan la planificación; no impiden abrir un curso.</p>
      <h2>Preparar y publicar una lección</h2>
      <ol>
        <li>En <Link href="/cursos">Cursos</Link>, abre uno de tus cursos.</li>
        <li>En <strong>Contenido</strong>, crea una lección dentro de un módulo. Los módulos los crea y ordena la persona responsable.</li>
        <li>En el editor, escribe el objetivo y agrega actividades. Los cambios se guardan solos; el indicador muestra “Guardado”. Para organizar vocabulario, usa <strong>Insertar tabla</strong>: la primera fila es de encabezados, Tab avanza entre celdas y la barra agrega o quita filas y columnas.</li>
        <li>Usa <strong>Vista previa</strong> para verla como estudiante. Cuando esté lista, la persona responsable elige <strong>Publicar</strong>; quien colabora elige <strong>Enviar a revisión</strong> y puede dejar una nota.</li>
        <li>La persona responsable ve los envíos en <strong>Por revisar</strong>, en Inicio. Abre la lección y elige <strong>Aprobar y publicar</strong>, o <strong>Devolver</strong> con comentarios. Quien la envió ve el resultado en <strong>Mis envíos a revisión</strong>.</li>
      </ol>
      <p>Después de publicar, se puede seguir editando: los estudiantes ven la versión publicada hasta que se publican los cambios. Los recursos de la biblioteca no pasan por revisión.</p>
      <p>Para adaptar una lección sin tocar la original, usa <strong>Duplicar</strong> en el menú de la lección: la copia queda como borrador justo después, con las mismas actividades y recursos, y se publica por separado.</p>
      <h2>Secciones, horario y clases</h2>
      <p>Están disponibles en los cursos presenciales o híbridos, o cuando la configuración del curso los activa. El curso define qué se enseña; cada sección es una impartición del curso con sus propios educadores, estudiantes, horario, clases, asistencia y avance. Administración prepara las secciones; quien imparte cada sección planifica y registra sus clases:</p>
      <ol>
        <li>En <strong>Secciones</strong>, dentro del curso, administración crea una sección y la abre. En su <strong>Resumen</strong> asigna a quienes la imparten, elegidos del equipo docente del curso, y en <strong>Estudiantes</strong> inscribe a sus estudiantes con un nombre de lista o un código. Si se retira un estudiante, su asistencia anterior se conserva.</li>
        <li>Cada educador encuentra en <Link href="/secciones">Mis secciones</Link> solo las secciones que imparte, con su avance, sus clases, su asistencia y su semana.</li>
        <li>En el <strong>Horario</strong> de la sección, administración elige los días, la hora, la duración y el periodo de cada sección y usa <strong>Guardar horario</strong>. Se genera el cronograma de la sección: todas sus clases del periodo, con fecha, hora y duración. Si cambias el horario, solo se rehacen las clases generadas que aún no comienzan, y lo planificado en ellas (lecciones y comentarios) pasa en el mismo orden a las nuevas fechas. En <strong>Días sin clase</strong> registra feriados, asuetos o semanas completas de la sección; los de toda la organización se registran en <Link href="/organizacion">Organización</Link>. Esos días no se generan clases y lo planificado pasa a las siguientes.</li>
        <li>En el <strong>Cronograma</strong> de la sección ves sus clases como una tabla: fecha, módulo, lecciones, actividades, comentarios, recursos y seguimiento. Usa <strong>Planificar</strong> en una fila para elegir sus lecciones en orden y escribir comentarios; la lección es opcional y una clase extensa puede cubrir varias. <strong>Asignar lecciones en orden</strong> da a las clases sin lecciones las lecciones publicadas en el orden de Contenido, de una a tres por clase. Las actividades y los recursos llegan de las lecciones y se editan en ellas. Con <strong>Cambiar fecha u hora</strong> mueves una clase puntual y con <strong>Agregar clase</strong> sumas una clase adicional, como una recuperación: basta con la fecha, porque toma la hora del horario.</li>
        <li>Al llegar la hora, abre la clase desde su fecha y elige <strong>Comenzar clase</strong>. Presenta sus lecciones y pasa lista; los cambios se guardan con <strong>Guardar asistencia</strong>. Una clase que ya comenzó conserva su fecha y hora.</li>
        <li>Elige <strong>Finalizar clase</strong> cuando todos estén marcados e indica hasta dónde llegó cada lección: <strong>Completada</strong>, <strong>Parcial</strong> o <strong>No se alcanzó</strong>. Lo que no se completó abre la siguiente clase de la sección, salvo que lo desactives. El cronograma la muestra como <strong>Impartida</strong> con su asistencia y conserva sus lecciones y la publicación que usó; el mapa de cobertura del <strong>Plan curricular</strong> marca como <strong>Impartido</strong> solo lo que trabajaron las lecciones completadas. Si te equivocas, usa <strong>Corregir lo trabajado</strong>.</li>
        <li>Si una clase no se puede dar, usa <strong>Cancelar clase</strong>. Cuando tiene algo planificado eliges qué pasa con ello: <strong>Recorrer</strong> lo pasa a la siguiente clase y cada clase pendiente avanza un lugar; <strong>Omitir</strong> lo salta y las demás clases no cambian.</li>
      </ol>
      <p>Si una lección planificada se archiva, el cronograma muestra <strong>Requiere sustitución</strong> para que elijas otra. Solo se planifican lecciones publicadas; los estudiantes ven siempre su publicación vigente.</p>
      <p>Cada sección tiene un <strong>código para estudiantes</strong>. Con él, los estudiantes ven la próxima clase de su sección, sus lecciones y sus recursos, sin cuenta. Administración puede cambiarlo o desactivarlo en cualquier momento.</p>
      <h2>Cursos a tu ritmo</h2>
      <p>El <strong>ritmo</strong> se elige al crear el curso o su programa. <strong>Con calendario</strong>, cada sección avanza junta con su horario, su cronograma y sus clases. <strong>A tu ritmo</strong>, las secciones no tienen horario ni clases: cada estudiante entra con el código de la sección, elige su nombre de la lista y recorre las lecciones publicadas en orden, cuando quiere. La lección cuenta como terminada en su avance al llegar al final.</p>
      <p>En el <strong>Avance</strong> de la sección ves cuántas lecciones terminó cada estudiante, con qué lección sigue y su última actividad, y por lección cuántos la abrieron y la terminaron. Si un curso cambia de ritmo, las clases ya registradas se conservan y vuelven a verse si regresa a <strong>Con calendario</strong>.</p>
      <h2>Grupos de trabajo</h2>
      <p>Los estudiantes de una sección son el universo de sus grupos. <strong>Toda la sección</strong> es el grupo predeterminado; en <strong>Grupos</strong>, quienes imparten la sección y administración forman grupos más pequeños con estudiantes de la lista (un estudiante puede estar en varios). Las actividades que una lección organiza <strong>En parejas</strong> o <strong>En equipos</strong> aparecen ahí para asignarles uno o varios grupos; sin asignación, las trabaja toda la sección.</p>
      <p>La clase muestra junto a cada actividad en grupo quién la trabaja, y al abrir la lección con el código de la sección los estudiantes ven qué grupos la trabajan; en un curso a tu ritmo, quien eligió su nombre ve además con quién está en su grupo. Se activan con <strong>Grupos de trabajo</strong> en la configuración del curso o de su programa y requieren secciones.</p>
      <h2>Datos y privacidad</h2>
      <p>La asistencia guarda solo el nombre de lista, la sección, la fecha y el estado. No pide correo, teléfono, fecha de nacimiento ni notas. La consultan administración y quienes imparten la sección.</p>
      <p>Las lecciones publicadas y el espacio de la sección se abren sin cuenta. Solo se cuenta cuántas veces se terminó una lección; no se guardan nombres ni respuestas. En un curso a tu ritmo, el avance de cada estudiante se guarda con el nombre que elige de la lista de su sección, nunca sus respuestas. La sesión del equipo dura hasta ocho horas.</p>
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
