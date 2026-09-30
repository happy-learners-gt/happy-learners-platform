import { Link } from "../navigation";
import { EmptyState, PageHeader } from "../ui/primitives";

export function Help() {
  return <>
    <PageHeader title="Ayuda" description="Cómo preparar, publicar e impartir una clase, y qué datos guarda Happy Learners."/>
    <div className="reading prose">
      <h2>Cómo se organiza un curso</h2>
      <p>Un <strong>curso</strong> tiene <strong>unidades</strong>; cada unidad tiene <strong>lecciones</strong>; cada lección tiene <strong>actividades</strong>, y una actividad puede usar un <strong>recurso</strong> de la biblioteca del curso.</p>
      <h2>Preparar y publicar una lección</h2>
      <ol>
        <li>En <Link href="/cursos">Cursos</Link>, abre un curso o crea uno nuevo.</li>
        <li>En <strong>Contenido</strong>, crea una unidad y después una lección dentro de ella.</li>
        <li>En el editor, escribe el objetivo y agrega actividades. Los cambios se guardan solos; el indicador muestra “Guardado”.</li>
        <li>Usa <strong>Vista previa</strong> para verla como estudiante y <strong>Publicar</strong> cuando esté lista. Comparte el enlace o el código.</li>
      </ol>
      <p>Después de publicar, puedes seguir editando: los estudiantes ven la versión publicada hasta que eliges <strong>Publicar cambios</strong>.</p>
      <h2>Grupos y asistencia</h2>
      <p>En <strong>Grupos</strong>, crea un grupo y agrega a sus participantes con un nombre de lista o un código. Desde el grupo o desde <strong>Asistencia</strong>, registra la clase del día y marca a cada participante.</p>
      <h2>Datos y privacidad</h2>
      <p>La asistencia guarda solo el nombre de lista, el grupo, la fecha y el estado. No pide correo, teléfono, fecha de nacimiento ni notas. Solo el equipo docente del curso la consulta.</p>
      <p>Las lecciones publicadas se abren sin cuenta. Solo se cuenta cuántas veces se terminó una lección; no se guardan nombres ni respuestas. La sesión del equipo dura hasta ocho horas.</p>
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
