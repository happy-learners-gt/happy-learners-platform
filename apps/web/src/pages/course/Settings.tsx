import { useFeedback } from "../../ui/feedback";
import { Button, PageHeader, Section } from "../../ui/primitives";
import { CourseForm, useCourseActions } from "../Courses";
import { useCourse } from "./context";

export function Settings() {
  const { course, reload } = useCourse();
  const { toast } = useFeedback();
  const actions = useCourseActions(reload);
  const base = `/cursos/${course.id}`;
  const archived = course.status === "archived";
  return <>
    <PageHeader crumbs={[{ label: "Cursos", href: "/cursos" }, { label: course.title, href: base }, { label: "Configuración" }]} title="Configuración" description="Nombre, objetivo y clasificación del curso."/>
    <div className="reading stack-lg">
      {archived ? <p className="notice">Restaura el curso para editar sus datos.</p>
        : <CourseForm key={course.version} course={course} cancelHref={base} onSaved={async () => { await reload(); toast({ message: "Cambios del curso guardados." }); }}/>}
      <Section title="Copiar o archivar" className="danger-zone">
        <div className="setting-row"><div><h3>Duplicar curso</h3><p className="muted">Crea una copia con sus unidades, recursos y lecciones como borrador. No copia grupos ni asistencia.</p></div><Button icon="copy" onClick={() => void actions.duplicate(course)}>Duplicar</Button></div>
        <div className="setting-row"><div><h3>{archived ? "Restaurar curso" : "Archivar curso"}</h3><p className="muted">{archived ? "El curso vuelve a la lista de cursos activos y admite cambios." : "El curso deja de admitir cambios. Las lecciones publicadas siguen disponibles para estudiantes."}</p></div>
          {archived ? <Button icon="archive" onClick={() => void actions.setStatus(course, "active")}>Restaurar</Button> : <Button icon="archive" variant="danger" onClick={() => void actions.setStatus(course, "archived")}>Archivar</Button>}
        </div>
      </Section>
    </div>
  </>;
}
