import { weekdayName } from "@/platform/dates";

/**
 * Which block of the sheet today's periods are in.
 *
 * The day headers in `timetable_slots.day` are whatever the school wrote at
 * the top of each block — "Monday", "MONDAY", "Mon", "Monday " have all been
 * seen in the same file. Matching them with `=== "Monday"` works until the
 * term somebody retypes the sheet, and then the Today card silently shows a
 * teacher no periods at all, which reads as "you are free today".
 *
 * So the match is deliberately loose in one direction only: case and spacing
 * are ignored and a prefix counts, but nothing else does. "Mon" matches
 * Monday; "Monthly test" does not, because a header must be a prefix *of* the
 * weekday, not merely start with the same letters.
 */
export function matchDayHeader(
  headers: readonly string[],
  isoDay: string,
): string | null {
  const weekday = weekdayName(isoDay).toLowerCase();

  const exact = headers.find(
    (header) => header.trim().toLowerCase() === weekday,
  );
  if (exact) return exact;

  const abbreviated = headers.find((header) => {
    const text = header.trim().toLowerCase();
    return text.length >= 3 && weekday.startsWith(text);
  });

  return abbreviated ?? null;
}
