import type { ClassLoad } from "@happy-learners/domain";
import { formatMinutes } from "@happy-learners/domain";
import { Icon } from "./icons";

const titles = { fits: "Cabe en la clase", full: "Ocupa toda la clase", over: "Excede la duración de la clase" } as const;

/**
 * Planned lesson time against the class duration. Exceeding it never blocks saving: what does not fit can continue
 * in the next class. The bar shows the class as the track and the excess beyond it.
 */
export function TimeFit({ load, compact }: { load: ClassLoad; compact?: boolean }) {
  if (load.state === "empty") return null;
  if (load.state === "unknown") return <p className="time-fit unknown" role="status"><Icon name="clock" size={16}/>Las lecciones suman {formatMinutes(load.planned)}. Indica la duración de la clase para compararla.</p>;
  const available = load.available!, total = Math.max(load.planned, available);
  const inside = Math.min(load.planned, available) / total, excess = load.excess / total;
  return <div className={`time-fit ${load.state}${compact ? " compact" : ""}`} role="status">
    <div className="time-fit-head">
      <Icon name={load.state === "over" ? "alert" : "clock"} size={16}/>
      <strong>{load.state === "over" ? `${titles.over} por ${formatMinutes(load.excess)}` : titles[load.state]}</strong>
      <span className="time-fit-total">{formatMinutes(load.planned)} de {formatMinutes(available)}</span>
    </div>
    <div className="time-meter" aria-hidden="true">
      <span className="time-meter-fill" style={{ width: `${inside * 100}%` }}/>
      {excess > 0 && <span className="time-meter-excess" style={{ width: `${excess * 100}%` }}/>}
      {excess > 0 && <span className="time-meter-limit" style={{ left: `${(available / total) * 100}%` }}/>}
    </div>
    {load.state === "over" && !compact && <p>Las lecciones planificadas suman {formatMinutes(load.planned)} y la clase dura {formatMinutes(available)}. Puedes guardar igual: lo que no alcance puede continuar en la siguiente clase, o quita una lección.</p>}
  </div>;
}
