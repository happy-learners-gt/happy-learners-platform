export type NoClassSpan = { from: string; until: string; part?: string };

const addIsoDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The next `count` days, from `start` inclusive, on which a morning class can be held. An afternoon-only closure does not block it. */
export function classDays(spans: NoClassSpan[], start: string, count: number) {
  const blocksMorning = (day: string) => spans.some(span => day >= span.from && day <= span.until && span.part !== "afternoon");
  const found: string[] = [];
  let cursor = start;
  for (let step = 0; found.length < count && step < 400; step += 1) {
    if (!blocksMorning(cursor)) found.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  if (found.length < count) throw new Error(`Solo hay ${found.length} días con clase desde ${start}; se pedían ${count}.`);
  return found;
}

/** Asks the calendar API for the days without class and returns the next `count` days with a morning class. */
export async function nextClassDays(load: () => Promise<{ breaks?: NoClassSpan[]; today: string }>, count: number) {
  const { breaks = [], today } = await load();
  return classDays(breaks, today, count);
}
