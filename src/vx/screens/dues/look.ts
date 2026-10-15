import type { DuesFamily } from "@/modules/defaulters/vx/domain/families";
import { addDays } from "@/modules/receipts/vx/domain/day-close";
import { rupees, shortDay } from "@/vx/format";

/*
 * How the design (`Dues.dc.html`) draws dues: lakh figures, masked phone
 * numbers, the overdue tone ladder, the avatar tones and the week line. Pure,
 * so the list, the family panel and the sheets agree.
 */

/** "₹6.4 L" — the design's lakh figure, one decimal, for tiles and aging. */
export function lakh(n: number): string {
  // Below a lakh the figure is rupees: ₹14,100 read as "₹0.1 L" (accountant UI).
  if (Math.max(0, n) < 100000) return rupees(Math.max(0, n));
  return `₹${(Math.max(0, n) / 100000).toFixed(1)} L`;
}

/** "98290 ••512": enough to recognise a family, not a number to copy off the screen. */
export function maskPhone(phone: string | null | undefined): string {
  const d = String(phone ?? "").replace(/\D/g, "").slice(-10);
  if (d.length < 8) return "—";
  return `${d.slice(0, 5)} ••${d.slice(-3)}`;
}

/** `tel:` for the Call buttons. */
export function telHref(phone: string | null | undefined): string | undefined {
  const d = String(phone ?? "").replace(/[^\d+]/g, "");
  return d ? `tel:${d}` : undefined;
}

/** Over 90 days red, over 40 amber, otherwise blue — the design's overdue pill. */
export function dayTone(days: number): { bg: string; fg: string } {
  if (days > 90) return { bg: "var(--bads)", fg: "var(--bad)" };
  if (days > 40) return { bg: "var(--warns)", fg: "var(--warnfg)" };
  return { bg: "var(--infos)", fg: "var(--info)" };
}

export const TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

/** "Thu 8 Oct" without the comma Intl puts in. */
export function day(iso: string): string {
  return shortDay(iso).replace(",", "").replace("Sept", "Sep");
}

/** "Mon 5 – Thu 8 Oct": the office's week, Monday to today (the receipts' `week` preset). */
export function weekLine(today: string): string {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, -((weekday + 6) % 7));
  if (monday === today) return day(today);
  const a = day(monday).split(" ");
  const b = day(today);
  return a[2] === b.split(" ")[2] ? `${a[0]} ${a[1]} – ${b}` : `${day(monday)} – ${b}`;
}

/** "Aarav · Class 7, Diya · Class 3" — first names, as the design lists children. */
export function kidsShort(f: Pick<DuesFamily, "kids">): string {
  return f.kids.map((k) => `${k.fullName.split(" ")[0]} · ${k.classLabel}`).join(", ");
}

export function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/** Two initials, from the first two words. */
export function ini(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Dot colour for a contact log entry, by the fee app's outcome. */
export function contactTone(outcome: string | null | undefined, channel?: string | null): string {
  if (outcome === "no_answer") return "var(--warn)";
  if (outcome === "dispute") return "var(--warn)";
  if (outcome === "promised_pay" || outcome === "reached") return "var(--info)";
  if (channel === "whatsapp") return "var(--info)";
  return "var(--sub)";
}
