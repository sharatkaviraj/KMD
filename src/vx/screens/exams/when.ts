import type { Pair } from "@/vx/text";

/*
 * When something happened, the way the Exams design says it: "Today 9:40 am",
 * "Yesterday 7:58 pm" ("Yest." in a tight log), "Mon 5 Oct" within the week,
 * else "18 Sep". School time (IST), whatever the device's zone.
 */

const TZ = "Asia/Kolkata";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

export function when(at: string | Date, opts: { short?: boolean; now?: Date } = {}): Pair {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return { en: "—" };
  const now = opts.now ?? new Date();
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(d).toLowerCase();
  const key = dayKey(d);
  if (key === dayKey(now)) return { en: `Today ${time}`, hi: `आज ${time}` };
  if (key === dayKey(new Date(now.getTime() - 86_400_000))) return { en: `${opts.short ? "Yest." : "Yesterday"} ${time}`, hi: `कल ${time}` };
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days > 0 && days < 6) {
    const label = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(d).replace(",", "");
    return { en: label, hi: label };
  }
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" }).format(d);
  return { en: label, hi: label };
}

/** "14–18 Jul", "23 Sep – 3 Oct", "14 Jul"; empty without a first day. */
export function dateSpan(from: string | null, to: string | null): string {
  if (!from) return "";
  const parts = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    return { day: d.getUTCDate(), month: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(d), ym: iso.slice(0, 7) };
  };
  const a = parts(from);
  if (!to || to.slice(0, 10) === from.slice(0, 10)) return `${a.day} ${a.month}`;
  const b = parts(to);
  return a.ym === b.ym ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/** "Sat 10 Oct". */
export function dueDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(",", "");
}
