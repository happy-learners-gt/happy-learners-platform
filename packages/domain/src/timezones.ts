/** IANA time zones (Region/City). Country names are not zones: a country may span several, and zones change rules. */
const zonePattern = /^[A-Z][A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/;

export function isTimezone(value: string) {
  if (!zonePattern.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}

/** The offset the zone applies at `now`, as UTC−06:00; daylight saving time changes it during the year. */
export function utcOffset(zone: string, now = new Date()) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(now).find(part => part.type === "timeZoneName")?.value || "GMT";
  const offset = name.replace("GMT", "") || "+00:00";
  return "UTC" + offset.replace("-", "−");
}

export interface TimezoneOption { id: string; city: string; offset: string }
/** Every zone the runtime knows, grouped by region and ordered by city; a stored zone outside the list is kept. */
export function timezoneGroups(current?: string | null, now = new Date()) {
  const ids = new Set(Intl.supportedValuesOf("timeZone").filter(isTimezone));
  if (current && isTimezone(current)) ids.add(current);
  const groups = new Map<string, TimezoneOption[]>();
  for (const id of ids) {
    const [region, ...rest] = id.split("/");
    const list = groups.get(region) || [];
    list.push({ id, city: rest.join(" / ").replaceAll("_", " "), offset: utcOffset(id, now) });
    groups.set(region, list);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([region, zones]) => ({ region, zones: zones.sort((a, b) => a.city.localeCompare(b.city, "es")) }));
}
