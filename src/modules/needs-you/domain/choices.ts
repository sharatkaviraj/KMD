import { addDays, schoolToday } from "@/platform/dates";
import { p, type Pair } from "@/vx/text";

import { istIso } from "./format";

/**
 * The ready-made times on "Remind me later" (D-632): a tap each, in the
 * school's day. Only times still ahead are offered; a person who wants
 * another says or types it. Pure: the caller passes the clock.
 */
export type RemindChoice = { key: "hour" | "lunch" | "evening" | "morning"; label: Pair; at: string };

const IST_MINUTES = 330;

function minutesNow(now: Date): number {
  const d = new Date(now.getTime() + IST_MINUTES * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function remindChoices(now: Date): RemindChoice[] {
  const today = schoolToday(now);
  const m = minutesNow(now);
  const out: RemindChoice[] = [{ key: "hour", label: p("In 1 hour", "1 घंटे बाद"), at: new Date(now.getTime() + 60 * 60_000).toISOString() }];
  // Lunch break is about 12:30; "after lunch" is 1:30, offered until 1 pm.
  if (m < 13 * 60) out.push({ key: "lunch", label: p("After lunch", "लंच के बाद"), at: istIso(today, 13 * 60 + 30) });
  // After school, when the office is quieter: 5 pm, offered until half past 4.
  if (m < 16 * 60 + 30) out.push({ key: "evening", label: p("This evening", "आज शाम"), at: istIso(today, 17 * 60) });
  out.push({ key: "morning", label: p("Tomorrow morning", "कल सुबह"), at: istIso(addDays(today, 1), 8 * 60) });
  return out;
}
