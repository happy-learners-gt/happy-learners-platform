import type { ReactNode } from "react";
import type { Course, Material } from "@happy-learners/contracts";
import { Link } from "../navigation";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Menu } from "./Menu";
import type { MenuItem } from "./Menu";
import { Progress, StatusBadge, Updated } from "./primitives";
import { hueFor, plural, resourceHue, resourceKindLabel, resourceStatusLabel } from "../model";
import type { CourseStats } from "../model";

export function CourseCard({ course, stats, menu }: { course: Course; stats?: CourseStats; menu?: MenuItem[] }) {
  const href = `/cursos/${course.id}`;
  return <article className={`course-card tone-${hueFor(course.id)}`}>
    <div className="course-cover" aria-hidden="true"><span/><span/><span/></div>
    <div className="course-card-top">
      <span className="course-avatar" aria-hidden="true">{course.title.trim().charAt(0).toUpperCase()}</span>
      <div className="course-card-title">
        <h3><Link href={href} className="card-link">{course.title}</Link></h3>
        <p className="course-card-meta">{stats ? `${plural(stats.units, "unidad", "unidades")} · ${plural(stats.lessons, "lección", "lecciones")}` : "Cargando contenido…"}</p>
      </div>
      {course.status === "archived" && <StatusBadge>Archivado</StatusBadge>}
      {menu && <Menu label={`Acciones del curso ${course.title}`} items={menu}/>}
    </div>
    {course.objective && <p className="course-card-objective">{course.objective}</p>}
    {stats && <Progress value={stats.published} max={stats.lessons} label="Lecciones publicadas"/>}
    <Updated value={course.updatedAt}/>
  </article>;
}

const kindIcon: Record<Material["kind"], IconName> = { text: "text", link: "link", file: "file" };
export type LibraryItem = Material & { usedIn: number; courseTitle?: string; legacy?: boolean };
export function ResourceCard({ item, menu, onOpen, extra }: { item: LibraryItem; menu?: MenuItem[]; onOpen: () => void; extra?: ReactNode }) {
  const kind = item.legacy ? "Texto" : item.kind === "file" && item.fileName ? item.fileName.split(".").pop()!.toUpperCase() : resourceKindLabel[item.kind];
  return <article className={`resource-card kind-${item.kind} tone-${resourceHue[item.kind]}`}>
    <span className="resource-icon" aria-hidden="true"><Icon name={kindIcon[item.kind] || "text"}/></span>
    <div className="resource-main">
      <h3><button type="button" className="card-link" aria-label={`Vista previa de ${item.title}`} onClick={onOpen}>{item.title}</button></h3>
      <p className="resource-meta"><span>{kind}</span>{item.courseTitle && <span>{item.courseTitle}</span>}<span>{item.usedIn ? `Usado en ${plural(item.usedIn, "lección", "lecciones")}` : "Sin usar"}</span></p>
      {item.description && item.kind !== "file" && <p className="resource-description">{item.description}</p>}
      {extra}
    </div>
    <div className="resource-side">
      <StatusBadge tone={item.status === "published" ? "success" : item.status === "draft" ? "warning" : "neutral"}>{item.legacy ? "Recurso general" : resourceStatusLabel(item.status)}</StatusBadge>
      <Updated value={item.updatedAt}/>
    </div>
    {menu && <Menu label={`Acciones del recurso ${item.title}`} items={menu}/>}
  </article>;
}
