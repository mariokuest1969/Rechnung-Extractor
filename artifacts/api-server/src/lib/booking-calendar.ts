/** Calendar-only ISO dates; "today" alone depends on the Berlin timezone. */
export function berlinToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01") return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function occurrenceDate(start: string, intervalMonths: number, index: number): string {
  const [year, month, anchor] = start.split("-").map(Number);
  const total = year * 12 + month - 1 + intervalMonths * index;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(Math.min(anchor, lastDay)).padStart(2, "0")}`;
}

export function dueDates(start: string, interval: number, today: string): string[] {
  const dates: string[] = [];
  // Compare month offsets, not instants; the original anchor survives February.
  const monthCount = (Number(today.slice(0, 4)) - Number(start.slice(0, 4))) * 12
    + Number(today.slice(5, 7)) - Number(start.slice(5, 7));
  for (let i = 0; i <= Math.floor(monthCount / interval); i++) {
    const date = occurrenceDate(start, interval, i);
    if (date <= today) dates.push(date);
  }
  return dates;
}
