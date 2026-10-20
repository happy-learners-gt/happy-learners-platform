import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { EffectivePreferences, UserPreferences } from "@happy-learners/contracts";
import { homePages, interfaceLanguages, maxTextScale, minTextScale, suggestedLocales, textScaleStep, timezoneGroups, utcOffset, weekdays } from "@happy-learners/domain";
import { api, message } from "../api";
import { useNavigation } from "../navigation";
import { useSession } from "../session";
import { systemDark, systemReducedMotion } from "../appearance";
import { formatInstantTime, formatNumber, zoneName } from "../regional";
import { useFeedback } from "../ui/feedback";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { Field, Loading, PageHeader, Section } from "../ui/primitives";

/**
 * «Preferencias» in Mi cuenta (ST-160): how the application reads and looks for this person.
 * Two tabs — Región e idioma, Apariencia y accesibilidad — whose address is the hash. The notices live in
 * «Notificaciones». Each choice saves on its own and applies at once; the account keeps it.
 */
const tabs: { id: "region" | "apariencia"; label: string; icon: IconName }[] = [
  { id: "region", label: "Región e idioma", icon: "globe" },
  { id: "apariencia", label: "Apariencia y accesibilidad", icon: "accessibility" },
];
type Tab = typeof tabs[number]["id"];

export function PreferencesPage() {
  const { url, navigate } = useNavigation();
  const tab: Tab = tabs.find(item => `#${item.id}` === url.hash)?.id || "region";
  const base = useId(), refs = useRef<(HTMLButtonElement | null)[]>([]);
  const choose = (next: Tab) => navigate(`/mi-cuenta/preferencias#${next}`, true);
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    choose(tabs[next].id); refs.current[next]?.focus();
  }
  return <>
    <PageHeader title="Preferencias" description="Cómo se ven las fechas y la aplicación para ti."/>
    <div role="tablist" aria-label="Secciones de las preferencias" className="tabs preferences-tabs">
      {tabs.map((item, index) => <button key={item.id} ref={element => { refs.current[index] = element; }} type="button" role="tab" id={`${base}-${item.id}`} aria-controls={`${base}-panel`}
        aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className="tab" onClick={() => choose(item.id)} onKeyDown={event => onKey(event, index)}>
        <Icon name={item.icon} size={18} filled={tab === item.id}/><span>{item.label}</span></button>)}
    </div>
    <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-${tab}`} className="tab-panel form-sheet">
      {tab === "region" ? <RegionSettings/> : <AppearanceSettings/>}
    </div>
  </>;
}

const appearanceKeys = new Set(["theme", "textScale", "highContrast", "motion", "density", "homePage"]);
/**
 * Saves one change. Appearance applies before the answer (the screen changes as the control does); everything is then
 * replaced by what the account keeps, and on an error the screen returns to it.
 */
function useSave() {
  const { preferences, setPreferences } = useSession();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState("");
  async function save(change: Partial<UserPreferences>, done: string) {
    const key = Object.keys(change)[0] || "", before = preferences;
    if (before && Object.keys(change).every(name => appearanceKeys.has(name))) setPreferences({ ...before, ...change } as EffectivePreferences);
    setBusy(key);
    try { setPreferences((await api<{ preferences: EffectivePreferences }>("/me/preferences", "PUT", change)).preferences); toast({ message: done }); }
    catch (cause) { if (before) setPreferences(before); toast({ tone: "error", message: message(cause) }); }
    finally { setBusy(""); }
  }
  return { save, busy };
}

const displayNames = (() => { try { return new Intl.DisplayNames(["es"], { type: "language" }); } catch { return null; } })();
const capital = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
/** «Español (Guatemala) · es-GT». */
export const localeLabel = (tag: string) => `${capital(displayNames?.of(tag) || tag)} · ${tag}`;
const supported = suggestedLocales.filter(tag => { try { return Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0; } catch { return false; } });
/** How a format writes a sample date, time and number, so the choice is visible before saving. */
function sample(locale: string, hourCycle: "h12" | "h23", zone: string) {
  const at = new Date();
  try {
    const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: zone }).format(at);
    const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hourCycle, timeZone: zone }).format(at);
    return `${capital(date)} · ${time} · ${new Intl.NumberFormat(locale).format(1234.5)}`;
  } catch { return ""; }
}
const dayName = (iso: number) => weekdays.find(([day]) => day === iso % 7)![1];

function RegionSettings() {
  const { preferences } = useSession();
  const { save, busy } = useSave();
  const groups = useMemo(() => timezoneGroups(preferences?.chosen.timezone), [preferences?.chosen.timezone]);
  if (!preferences) return <Loading label="Cargando tus preferencias…" lines={4}/>;
  const { chosen, organization } = preferences;
  const device = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
  const locales = chosen.locale && !supported.includes(chosen.locale as typeof supported[number]) ? [chosen.locale, ...supported] : supported;
  return <div className="stack-lg">
    <Section title="Idioma y formato">
      <div className="form-grid-12">
        <div className="form-span-4"><Field label="Idioma de la interfaz" hint="Por ahora la aplicación está disponible en español; aquí aparecerán los demás idiomas cuando lo estén.">
          <select value={preferences.language} disabled={busy === "language"} onChange={event => void save({ language: event.target.value as UserPreferences["language"] }, "Idioma guardado.")}>
            {interfaceLanguages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </Field></div>
        <div className="form-span-4"><Field label="Formato regional" hint="Cómo se escriben las fechas, las horas y los números.">
          <select value={chosen.locale || ""} disabled={busy === "locale"} onChange={event => void save({ locale: event.target.value || null }, "Formato regional guardado.")}>
            <option value="">Como la organización ({localeLabel(organization.locale)})</option>
            {locales.map(tag => <option key={tag} value={tag}>{localeLabel(tag)}</option>)}
          </select>
        </Field></div>
        <div className="form-span-4"><Field label="Página de inicio" hint="La primera página que se abre al entrar.">
          <select value={preferences.homePage} disabled={busy === "homePage"} onChange={event => void save({ homePage: event.target.value as UserPreferences["homePage"] }, "Página de inicio guardada.")}>
            {homePages.map(page => <option key={page.value} value={page.value}>{page.label}</option>)}
          </select>
        </Field></div>
      </div>
      <p className="format-sample" aria-live="polite"><span className="muted small">Así se verá:</span> <strong>{sample(preferences.locale, preferences.hourCycle, preferences.timezone)}</strong></p>
    </Section>
    <Section title="Zona horaria y calendario">
      <div className="form-grid-12">
        <div className="form-span-4"><Field label="Zona horaria" hint={<>Hora local: {formatInstantTime(new Date().toISOString())} ({utcOffset(preferences.timezone)}).</>}>
          <select value={chosen.timezone || ""} disabled={busy === "timezone"} onChange={event => void save({ timezone: event.target.value || null }, "Zona horaria guardada.")}>
            <option value="">Como la organización ({organization.timezone.replaceAll("_", " ")})</option>
            {groups.map(group => <optgroup key={group.region} label={group.region}>{group.zones.map(zone => <option key={zone.id} value={zone.id}>{zone.city} ({zone.offset})</option>)}</optgroup>)}
          </select>
        </Field></div>
        <div className="form-span-4"><Field label="Primer día de la semana">
          <select value={chosen.weekStart ? String(chosen.weekStart) : ""} disabled={busy === "weekStart"} onChange={event => void save({ weekStart: event.target.value ? Number(event.target.value) : null }, "Primer día de la semana guardado.")}>
            <option value="">Según el formato regional ({dayName(preferences.weekStart).toLocaleLowerCase("es")})</option>
            {[1, 2, 3, 4, 5, 6, 7].map(day => <option key={day} value={day}>{dayName(day)}</option>)}
          </select>
        </Field></div>
        <div className="form-span-4"><fieldset className="choice-field">
          <legend>Formato de hora</legend>
          <div className="segmented" role="radiogroup" aria-label="Formato de hora">
            {([["", `Auto (${preferences.hourCycle === "h12" ? "12 h" : "24 h"})`], ["h12", "12 h"], ["h23", "24 h"]] as const).map(([value, label]) =>
              <label key={value || "auto"}><input type="radio" name="hour-cycle" value={value} checked={(chosen.hourCycle || "") === value} disabled={busy === "hourCycle"}
                onChange={() => void save({ hourCycle: (value || null) as UserPreferences["hourCycle"] }, "Formato de hora guardado.")}/><span>{label}</span></label>)}
          </div>
        </fieldset></div>
      </div>
      {device && device !== preferences.timezone && <p className="notice"><Icon name="info" size={18}/><span>Este dispositivo está en {zoneName(device)} ({device.replaceAll("_", " ")}).</span>
        <button type="button" className="button secondary small" disabled={!!busy} onClick={() => void save({ timezone: device }, "Zona horaria guardada.")}>Usar la de este dispositivo</button></p>}
    </Section>
  </div>;
}

function Choice<T extends string>({ legend, name, value, options, onChange, disabled }: { legend: string; name: string; value: T; options: [T, string, IconName?][]; onChange: (value: T) => void; disabled?: boolean }) {
  return <fieldset className="choice-field">
    <legend>{legend}</legend>
    <div className="segmented" role="radiogroup" aria-label={legend}>
      {options.map(([option, label, icon]) => <label key={option}><input type="radio" name={name} value={option} checked={value === option} disabled={disabled} onChange={() => onChange(option)}/>
        <span>{icon && <Icon name={icon} size={16}/>}{label}</span></label>)}
    </div>
  </fieldset>;
}

function AppearanceSettings() {
  const { preferences } = useSession();
  const { save, busy } = useSave();
  const [scale, setScale] = useState(preferences?.textScale || 100);
  useEffect(() => { if (preferences) setScale(preferences.textScale); }, [preferences?.textScale]);
  if (!preferences) return <Loading label="Cargando tus preferencias…" lines={4}/>;
  // The slider previews the size while it moves; releasing it saves.
  const preview = (value: number) => { setScale(value); document.documentElement.style.setProperty("--text-scale", String(value / 100)); };
  const commit = () => { if (scale !== preferences.textScale) void save({ textScale: scale }, `Tamaño del texto: ${formatNumber(scale)} %.`); };
  return <div className="stack-lg">
    <Section title="Tema">
      <Choice legend="Tema" name="theme" value={preferences.theme} disabled={busy === "theme"} onChange={theme => void save({ theme }, theme === "system" ? "Tema: como el sistema." : theme === "dark" ? "Tema oscuro activado." : "Tema claro activado.")}
        options={[["system", "Sistema", "settings"], ["light", "Claro", "sun"], ["dark", "Oscuro", "moon"]]}/>
      <p className="muted small">{preferences.theme === "system" ? `Sigue el tema de tu dispositivo (ahora ${systemDark() ? "oscuro" : "claro"}) y cambia con él.` : "Se usa siempre, sin importar el tema del dispositivo."}</p>
    </Section>
    <Section title="Lectura">
      <div className="text-scale">
        <label htmlFor="text-scale">Tamaño del texto</label>
        <div className="text-scale-control">
          <span aria-hidden="true" className="text-scale-small">A</span>
          <input id="text-scale" type="range" min={minTextScale} max={maxTextScale} step={textScaleStep} value={scale} aria-valuetext={`${formatNumber(scale)} %`}
            onChange={event => preview(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}/>
          <span aria-hidden="true" className="text-scale-large">A</span>
          <output htmlFor="text-scale">{formatNumber(scale)} %</output>
        </div>
        <p className="muted small">Agranda todo el texto de la aplicación, de {minTextScale} % a {maxTextScale} %, sin cambiar el zoom del navegador.</p>
      </div>
      <Toggle label="Alto contraste" hint="Texto y bordes más marcados y enlaces subrayados." checked={preferences.highContrast} busy={busy === "highContrast"}
        onChange={on => void save({ highContrast: on }, on ? "Alto contraste activado." : "Alto contraste desactivado.")}/>
      <Choice legend="Densidad" name="density" value={preferences.density} disabled={busy === "density"} onChange={density => void save({ density }, density === "compact" ? "Densidad compacta." : "Densidad cómoda.")}
        options={[["comfortable", "Cómoda"], ["compact", "Compacta"]]}/>
      <p className="muted small">La densidad compacta reduce los espacios para ver más en pantalla; en pantallas táctiles los controles conservan su tamaño.</p>
    </Section>
    <Section title="Movimiento">
      <Toggle label="Reducir el movimiento" checked={preferences.motion === "reduce"} busy={busy === "motion"}
        hint={preferences.motion === "reduce" ? "Sin animaciones ni transiciones." : `Apagado, se sigue la preferencia de tu dispositivo (ahora ${systemReducedMotion() ? "reduce el movimiento" : "permite animaciones"}).`}
        onChange={on => void save({ motion: on ? "reduce" : "system" }, on ? "Movimiento reducido." : "Movimiento como el sistema.")}/>
    </Section>
    <AppearancePreview/>
  </div>;
}

function Toggle({ label, hint, checked, busy, onChange }: { label: string; hint: ReactNode; checked: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return <div className="toggle-row">
    <label className="switch"><input type="checkbox" role="switch" checked={checked} aria-busy={busy || undefined} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.checked)}/><strong>{label}</strong></label>
    <p id={`${id}-hint`} className="muted small">{hint}</p>
  </div>;
}

/** A small sample of the screens with the current choices, so the effect is visible without leaving the page. */
function AppearancePreview() {
  return <section className="appearance-preview" aria-labelledby="appearance-preview">
    <h2 id="appearance-preview">Vista previa</h2>
    <div className="panel">
      <div className="panel-header"><h3>Matemáticas · 3.º A</h3><span className="badge">Próxima clase</span></div>
      <p>Así se ven el texto, los bordes y los botones con tus preferencias.</p>
      <div className="form-actions"><button type="button" className="button primary">Abrir la clase</button><button type="button" className="button secondary">Ver el cronograma</button></div>
    </div>
  </section>;
}
