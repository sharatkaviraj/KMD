import { addDays, dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { p, type Pair } from "@/vx/text";

/** Times and days as Needs you says them, in the school's time (IST). Pure. */

const IST_MINUTES = 330;

function istParts(iso: string): { day: string; h: number; m: number } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + IST_MINUTES * 60_000);
  return { day: d.toISOString().slice(0, 10), h: d.getUTCHours(), m: d.getUTCMinutes() };
}

/** "9:30 am" / "सुबह 9:30". */
export function clockP(iso: string): Pair {
  const parts = istParts(iso);
  if (!parts) return p("");
  const { h, m } = parts;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(m).padStart(2, "0");
  const part = h < 4 ? "रात" : h < 12 ? "सुबह" : h < 16 ? "दोपहर" : h < 20 ? "शाम" : "रात";
  return p(`${h12}:${mm} ${h < 12 ? "am" : "pm"}`, `${part} ${h12}:${mm}`);
}

/** "17 Nov" / "17 नवंबर". */
export function dayP(isoDay: string): Pair {
  const d = dayLabel(isoDay);
  const [date, month] = d.en.split(" ");
  return p(`${date} ${(month ?? "").slice(0, 3).replace("Sep", "Sep")}`, d.hi);
}

/** "Today, 3:00 pm", "Tomorrow, 9:00 am", "Mon 17 Nov, 8:00 am" / "आज दोपहर 3:00", "कल सुबह 9:00". */
export function whenP(iso: string, now: Date): Pair {
  const parts = istParts(iso);
  if (!parts) return p("");
  const today = schoolToday(now);
  const c = clockP(iso);
  if (parts.day === today) return p(`Today, ${c.en}`, `आज ${c.hi}`);
  if (parts.day === addDays(today, 1)) return p(`Tomorrow, ${c.en}`, `कल ${c.hi}`);
  const w = weekdayLabel(parts.day);
  const d = dayP(parts.day);
  return p(`${w.en.slice(0, 3)} ${d.en}, ${c.en}`, `${w.hi} ${d.hi ?? d.en}, ${c.hi}`);
}

/** "8:00" → minutes after midnight; null when the bell time is missing. */
export function minutesOf(hhmm: string | null | undefined): number | null {
  const m = hhmm ? /^(\d{1,2}):(\d{2})/.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A school day and a bell time as an instant, ISO. */
export function istIso(day: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`).toISOString();
}

/** Whole minutes from `now` to an instant (negative when it has passed). */
export function minutesUntil(iso: string, now: Date): number {
  return Math.round((Date.parse(iso) - now.getTime()) / 60_000);
}
