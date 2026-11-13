import "server-only";

import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import { VISIT_LOOKAHEAD_DAYS, type VisitCalendar } from "@/modules/whatsapp/domain/helper-visit";
import { addDays } from "@/platform/dates";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * The school-visit booking's read (D-592): the calendar for the days a visit
 * can be booked. The booking itself is a suggestion the office decides
 * (D-598); only applying it puts an enquiry on the Admissions board.
 * Service role, as every helper read is; nothing here is reached by a
 * signed-in person.
 */

type Db = ReturnType<typeof whatsappDb>;

/** The calendar's own word for the next three weeks, for the session the family is in; null when unreadable. */
export async function readVisitCalendar(sessionLabel: string, today: string, db: Db = whatsappDb()): Promise<VisitCalendar | null> {
  try {
    const { data, error } = await db
      .from("academic_calendar_days")
      .select("day, kind")
      .eq("session_label", sessionLabel)
      .gt("day", today)
      .lte("day", addDays(today, VISIT_LOOKAHEAD_DAYS))
      .returns<Array<{ day: string; kind: CalendarDayKind }>>();
    if (error) return null;
    return { today, kinds: new Map((data ?? []).map((row) => [String(row.day).slice(0, 10), row.kind])) };
  } catch {
    return null;
  }
}
