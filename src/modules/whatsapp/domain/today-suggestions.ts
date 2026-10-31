import type { NoticeSituation } from "@/modules/whatsapp/domain/campaigns";
import type { InstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import { WAIVER_WINDOW_DAYS } from "@/modules/whatsapp/domain/reminder-ladder";
import { addIsoDays, daysBetweenIsoDates } from "@/platform/helpers/date";

/**
 * What the calendar says is worth sending TODAY.
 *
 * The office opened the send screen on "Fee due" every morning and had to know
 * — from memory — that installment 3 went overdue six days ago, so this was the
 * week for the waiver note and not the fee-due one. This reads the same fee
 * calendar the tiles read and says it in a sentence, with one tap to the run
 * already set up: the right message, the right installment, the right date.
 *
 * Suggestions only. Nothing here sends, and nothing here changes the screen
 * the office is on until a card is tapped.
 *
 * Pure: the calendar and today in, cards out.
 */

export type TodaySuggestion = {
  key: string;
  situation: NoticeSituation;
  installmentNo: number;
  /** "Installment 3 — waiver window" */
  title: string;
  /** "6 days overdue · late fee set aside if paid by 30-10" */
  detail: string;
  /** The date the message prints, ISO. */
  messageDate: string;
  /** Narrowing the run should carry. */
  lateFee: "any" | "yes";
  skipOverdue: boolean;
  tone: "info" | "warning" | "danger";
};

/** Days, signed: negative before the due date, positive after it. */
function daysFromDue(dueDate: string, today: string): number | null {
  return daysBetweenIsoDates(dueDate, today);
}

export function suggestionsForToday(
  calendar: InstallmentCalendar,
  today: string,
  /** The pre-due window, so "due soon" means the same here as on the tiles. */
  windowDays = 10,
): TodaySuggestion[] {
  const out: TodaySuggestion[] = [];

  for (const timing of calendar.timings) {
    const n = timing.installmentNo;
    const since = daysFromDue(timing.dueDate, today);
    if (since === null) continue;
    const due = timing.dueDate;

    if (since < 0 && since >= -3) {
      out.push({
        key: `final-${n}`,
        situation: "upcoming_final",
        installmentNo: n,
        title: `Installment ${n} — last few days`,
        detail: `Due ${since === -1 ? "tomorrow" : `in ${-since} days`}. The late fee starts the day after.`,
        messageDate: due,
        lateFee: "any",
        skipOverdue: true,
        tone: "warning",
      });
    } else if (since < -3 && since >= -windowDays) {
      out.push({
        key: `soon-${n}`,
        situation: "upcoming",
        installmentNo: n,
        title: `Installment ${n} — due soon`,
        detail: `Due in ${-since} days. A polite note before the date.`,
        messageDate: due,
        lateFee: "any",
        skipOverdue: true,
        tone: "info",
      });
    } else if (since === 0) {
      out.push({
        key: `today-${n}`,
        situation: "upcoming_final",
        installmentNo: n,
        title: `Installment ${n} — due today`,
        detail: "Last day without the late fee.",
        messageDate: due,
        lateFee: "any",
        skipOverdue: true,
        tone: "warning",
      });
    } else if (since >= 1 && since < WAIVER_WINDOW_DAYS) {
      const waiveBy = addIsoDays(due, WAIVER_WINDOW_DAYS) ?? due;
      out.push({
        key: `waiver-${n}`,
        situation: "late_fee_waiver",
        installmentNo: n,
        title: `Installment ${n} — waiver window`,
        detail: `${since} day${since === 1 ? "" : "s"} overdue. The late fee is set aside if they pay by the waiver date.`,
        messageDate: waiveBy,
        lateFee: "yes",
        skipOverdue: false,
        tone: "warning",
      });
    } else if (since === WAIVER_WINDOW_DAYS) {
      out.push({
        key: `waiver-last-${n}`,
        situation: "waiver_last_call",
        installmentNo: n,
        title: `Installment ${n} — waiver last day`,
        detail: "Today is the last day the late fee can be set aside.",
        messageDate: today,
        lateFee: "yes",
        skipOverdue: false,
        tone: "danger",
      });
    } else if (since > WAIVER_WINDOW_DAYS && since <= 45) {
      out.push({
        key: `final-notice-${n}`,
        situation: "overdue_final",
        installmentNo: n,
        title: `Installment ${n} — final notice`,
        detail: `${since} days overdue. A firm notice with a final date a week out.`,
        messageDate: addIsoDays(today, 7) ?? today,
        lateFee: "any",
        skipOverdue: false,
        tone: "danger",
      });
    }
  }

  // Nearest first: the step closest to its own date is the one at risk of
  // being missed.
  return out.sort((left, right) => left.installmentNo - right.installmentNo).reverse();
}
