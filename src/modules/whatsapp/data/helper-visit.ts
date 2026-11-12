import "server-only";

import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import { VISIT_LOOKAHEAD_DAYS, VISIT_NAME_NOT_GIVEN, type VisitBooking, type VisitCalendar } from "@/modules/whatsapp/domain/helper-visit";
import { addDays } from "@/platform/dates";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * The school-visit booking's reads and writes (D-592): the calendar for the
 * days a visit can be booked, and the booking as an enquiry on the
 * Admissions board. Service role, as every helper read is; nothing here is
 * reached by a signed-in person.
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

export type VisitRow = {
  sessionLabel: string;
  booking: VisitBooking;
  /** The parent's WhatsApp name, as WhatsApp gives it. */
  parentName: string | null;
  fromE164: string;
  /** The hand-off the office was given, in Messages. */
  parentReplyId: string;
};

/** "+919000000001" -> "9000000001", the way the Admissions board keeps a phone. */
export function boardPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
}

/**
 * The visit as an enquiry on the Admissions board, at its first stage, with
 * the day and the hand-off it came with. The parent's words stay in the
 * hand-off; the enquiry carries only what it always carries. One enquiry per
 * hand-off, so a repeated turn adds nothing. True when kept.
 */
export async function saveVisitEnquiry(row: VisitRow, db: Db = whatsappDb()): Promise<boolean> {
  try {
    const { error } = await db.from("enquiries").upsert(
      {
        session_label: row.sessionLabel,
        stage: "enquiry",
        child_name: row.booking.childName ?? VISIT_NAME_NOT_GIVEN,
        class_label: row.booking.classLabel,
        parent_name: row.parentName?.replace(/\s+/g, " ").trim().slice(0, 80) || null,
        phone: boardPhone(row.fromE164),
        source: "whatsapp",
        visit_on: row.booking.day,
        visit_part: row.booking.part,
        parent_reply_id: row.parentReplyId,
      },
      { onConflict: "parent_reply_id", ignoreDuplicates: true },
    );
    return !error;
  } catch {
    return false;
  }
}
