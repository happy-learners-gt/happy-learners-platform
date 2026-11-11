import { useState } from "react";
import type { Course } from "@happy-learners/contracts";
import { CourseCard } from "../ui/cards";
import { Modal, useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { moveItem, SortHandle } from "../ui/Sortable";
import { classLoad } from "@happy-learners/domain";
import { StatusSteps } from "../ui/StatusSteps";
import { Tabs } from "../ui/Tabs";
import { TimeFit } from "../ui/TimeFit";
import { Button, EmptyState, Field, PageHeader, PrimaryAction, Progress, Section, StatTiles, StatusBadge } from "../ui/primitives";

const demoCourse: Course = { id: "course-demo-guide", title: "Ciencias para curiosos", objective: "Observar, preguntar y comprobar con experimentos sencillos.", educationType: "formal", level: "primary", format: "laboratory", modality: "in-person", pacing: "scheduled", area: "05", settings: {}, status: "active", version: 1, updatedAt: new Date().toISOString() };
const tones = ["violet", "sky", "teal", "green", "amber", "coral", "pink"] as const;
const depth = [["xs", "2", "Superficies en reposo dentro de otra superficie"], ["sm", "4", "Tarjetas y paneles en reposo"], ["md", "8", "Tarjetas al pasar el cursor; formularios en línea"], ["flyout", "16", "Menús, toasts y paneles emergentes"], ["lg", "28", "Cajón lateral en móvil"], ["dialog", "64", "Diálogos"]] as const;
const ramp = [["Título 1", "--text-3xl", "32/40 · semibold"], ["Título 2", "--text-2xl", "28/36 · semibold"], ["Título 3", "--text-xl", "24/32 · semibold"], ["Subtítulo 1", "--text-lg", "20/28 · semibold"], ["Subtítulo 2", "--text-md", "16/22"], ["Cuerpo 1", "--text-base", "14/20"], ["Leyenda 1", "--text-xs", "12/16"]] as const;
const motion = [["Entrar", "--ease-enter", "Desacelera: lo que aparece llega rápido y se asienta."], ["Salir", "--ease-exit", "Acelera: lo que se va no estorba."], ["Cambiar", "--ease", "Suave en ambos extremos: hover, presionado, selección."]] as const;

/**
 * Living style guide: every Fluent principle and component of the platform, rendered with the real
 * components and tokens. New modules start here; see docs/design/fluent.md.
 */
export function StyleGuide() {
  const { toast } = useFeedback();
  const [dialog, setDialog] = useState(false), [replay, setReplay] = useState(0), [segment, setSegment] = useState("a"), [order, setOrder] = useState(["Inicio", "Desarrollo", "Cierre"]), [tab, setTab] = useState<"plan" | "notas">("plan");
  return <>
    <PageHeader crumbs={[{ label: "Ayuda", href: "/ayuda" }, { label: "Guía de estilo" }]} title="Guía de estilo Fluent"
      description="Los principios de Fluent Design —luz, profundidad, movimiento, material y escala— aplicados a los componentes de Acervum. Todo lo que ves aquí usa los mismos componentes y tokens que el resto de la plataforma."/>

    <Section title="Luz">
      <p className="muted">Las superficies interactivas se iluminan bajo el puntero y el foco del teclado siempre es visible: un contorno oscuro con un anillo claro interior. Pasa el cursor sobre la tarjeta o recorre los botones con Tab.</p>
      <div className="guide-row">
        <div className="panel lit guide-light"><Icon name="sparkles" size={24}/><strong>Superficie iluminada</strong><span className="muted small">El brillo sigue al puntero (desactivado con movimiento reducido o en pantallas táctiles).</span></div>
        <div className="guide-stack"><Button icon="eye">Foco visible</Button><Button variant="ghost" icon="link">Enlace sutil</Button></div>
      </div>
    </Section>

    <Section title="Profundidad">
      <p className="muted">La elevación indica jerarquía: cuanto más arriba, más sombra. Rampa oficial de Fluent.</p>
      <div className="guide-depth">{depth.map(([token, value, use]) => <div key={token} className="guide-elevation" style={{ boxShadow: `var(--shadow-${token})` }}><strong>shadow{value}</strong><code>--shadow-{token}</code><span className="muted small">{use}</span></div>)}</div>
    </Section>

    <Section title="Movimiento">
      <p className="muted">Animaciones breves con las curvas de Fluent; se apagan cuando el sistema pide movimiento reducido.</p>
      <div className="guide-row">
        <ul className="guide-list">{motion.map(([name, token, use]) => <li key={token}><strong>{name}</strong> <code>{token}</code><span className="muted small"> · {use}</span></li>)}</ul>
        <div className="guide-stack"><div key={replay} className="panel guide-motion"><Icon name="play" size={20}/>Entrada con desaceleración</div><Button icon="redo" onClick={() => setReplay(replay + 1)}>Repetir animación</Button></div>
      </div>
    </Section>

    <Section title="Material">
      <p className="muted">Acrílico para lo que se superpone al contenido (barra superior, menús, cajón): translúcido y desenfocado. Mica para la capa base de la aplicación. Sin soporte de desenfoque o con transparencia reducida, el acrílico se vuelve sólido.</p>
      <div className="guide-material"><div className="guide-blobs" aria-hidden="true"><span/><span/><span/></div><div className="guide-acrylic"><strong>Acrílico</strong><span>Fondo translúcido con desenfoque y saturación.</span></div></div>
    </Section>

    <Section title="Escala y tipografía">
      <p className="muted">Segoe UI Variable en Windows 11 y la fuente del sistema en los demás. Rampa tipográfica de Fluent, cuadrícula de 4 px y controles de 36 px (44 px en pantallas táctiles).</p>
      <ul className="guide-type">{ramp.map(([name, token, spec]) => <li key={token}><span style={{ fontSize: `var(${token})`, fontWeight: token === "--text-base" || token === "--text-xs" || token === "--text-md" ? 400 : 600 }}>{name}</span><code>{token}</code><span className="muted small">{spec}</span></li>)}</ul>
    </Section>

    <Section title="Color">
      <p className="muted">Neutros de Fluent y la marca violeta. Cada familia de tono tiene tinta (texto), suave (fondo), sólido (relleno con texto blanco) y vivo (solo decoración).</p>
      <ul className="guide-swatches">{tones.map(tone => <li key={tone} className={`tone-${tone}`}><span className="swatch solid"/><span className="swatch soft"/><span className="swatch vivid"/><strong>{tone}</strong></li>)}</ul>
    </Section>

    <Section title="Componentes">
      <div className="guide-grid">
        <div className="guide-block"><h3>Botones</h3><div className="guide-stack">
          <PrimaryAction icon="plus">Principal</PrimaryAction><Button icon="edit">Secundario</Button><Button variant="ghost" icon="copy">Sutil</Button><Button variant="danger" icon="archive">Peligro</Button><Button disabled>Deshabilitado</Button>
          <button type="button" className="icon-button" aria-label="Botón de icono"><Icon name="settings"/></button>
        </div></div>
        <div className="guide-block"><h3>Campos</h3><div className="stack">
          <Field label="Campo de texto" hint="La línea inferior se vuelve de marca al enfocar."><input placeholder="Escribe aquí"/></Field>
          <Field label="Lista"><select defaultValue="b"><option value="a">Primaria</option><option value="b">Secundaria</option></select></Field>
          <label className="switch"><input type="checkbox" defaultChecked/><span>Casilla</span></label>
          <fieldset className="segmented"><legend className="sr-only">Selector segmentado</legend>{[["a", "Lista"], ["b", "Cuadrícula"]].map(([value, label]) => <label key={value}><input type="radio" name="guide-seg" checked={segment === value} onChange={() => setSegment(value)}/><span>{label}</span></label>)}</fieldset>
        </div></div>
        <div className="guide-block"><h3>Estados</h3><div className="guide-stack">
          <StatusBadge tone="success">Publicada</StatusBadge><StatusBadge tone="warning">Borrador</StatusBadge><StatusBadge tone="info">Cambios sin publicar</StatusBadge><StatusBadge tone="danger">Error</StatusBadge><StatusBadge>Archivada</StatusBadge>
        </div>
          <Progress value={3} max={5} label="Progreso"/>
          <p className="notice"><Icon name="info" size={18}/>Aviso informativo.</p>
        </div>
        <div className="guide-block"><h3>Ordenar</h3>
          <ol className="lesson-picker-list sortable-list">{order.map((item, index) => <li key={item}>
            <SortHandle id={`guide-${item}`} label={`Reordenar «${item}», elemento ${index + 1} de ${order.length}`} index={index} count={order.length} onMove={to => setOrder(moveItem(order, index, to))}/>
            <span className="lesson-picker-title">{item}</span>
          </li>)}</ol>
          <p className="muted small">Arrastra el asa o enfócala y usa las flechas, Inicio y Fin.</p>
        </div>
        <div className="guide-block"><h3>Pestañas</h3>
          <Tabs label="Pestañas de ejemplo" value={tab} onChange={setTab} items={[{ value: "plan", label: "Plan" }, { value: "notas", label: "Notas", badge: <StatusBadge tone="info">2</StatusBadge> }]}>
            <p className="muted small">{tab === "plan" ? "Contenido de «Plan»." : "Contenido de «Notas»."}</p>
          </Tabs>
        </div>
        <div className="guide-block"><h3>Pasos y tiempo</h3><div className="stack">
          <StatusSteps label="Pasos de ejemplo" steps={[{ id: "a", label: "Borrador", state: "done" }, { id: "b", label: "En revisión", state: "current" }, { id: "c", label: "Publicada", state: "todo" }]}/>
          <TimeFit load={classLoad(45, [30, 25])}/>
          <TimeFit load={classLoad(45, [20, 15])} compact/>
        </div></div>
        <div className="guide-block"><h3>Menús, diálogos y toasts</h3><div className="guide-stack">
          <Menu label="Menú de ejemplo" text="Menú" icon="more" items={[{ label: "Editar", icon: "edit", onSelect: () => undefined }, { label: "Duplicar", icon: "copy", onSelect: () => undefined }, "separator", { label: "Archivar", icon: "archive", danger: true, onSelect: () => undefined }]}/>
          <Button icon="expand" onClick={() => setDialog(true)}>Abrir diálogo</Button>
          <Button icon="check" onClick={() => toast({ message: "Así se ve una notificación de éxito." })}>Mostrar toast</Button>
        </div></div>
      </div>
      <StatTiles items={(["Lecciones", "Recursos", "Grupos"] as const).map((label, index) => ({ label, value: [12, 8, 3][index], icon: (["content", "library", "users"] as IconName[])[index], hue: (["violet", "teal", "pink"] as const)[index] }))}/>
      <div className="card-grid"><CourseCard course={demoCourse} stats={{ units: 4, lessons: 12, published: 9, drafts: 3, changes: 1 }}/><EmptyState compact icon="spark" title="Estado vacío">Explica qué falta y ofrece la acción para resolverlo.</EmptyState></div>
    </Section>
    {dialog && <Modal title="Diálogo de ejemplo" onClose={() => setDialog(false)} footer={<><Button onClick={() => setDialog(false)}>Cancelar</Button><PrimaryAction onClick={() => setDialog(false)}>Aceptar</PrimaryAction></>}>
      <p>Esquinas de 8 px, sombra 64 y fondo atenuado. Entra escalando desde 96 % con desaceleración. Escape lo cierra y el foco vuelve al botón que lo abrió.</p>
    </Modal>}
  </>;
}
