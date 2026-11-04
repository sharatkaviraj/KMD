import { COVER_PHOTO_UNDO_MS, type CoverPhoto, type CoverPhotoIssue, type CoverPhotoReview } from "@/lib/ai/cover-photo-types";
import type { CoverDay } from "@/modules/substitutions/data/arrange-day";
import { distinctNames } from "@/modules/substitutions/domain/cover-view";
import { canonicalSubject, rankCandidates, type TeacherProfiles } from "@/modules/substitutions/domain/engine";
import { teachingEventsFor } from "@/modules/substitutions/domain/events";
import { isIsoDay } from "@/platform/dates";
import { isPeriodIndex, periodIndex } from "@/modules/timetable/domain/periods";

export type CoverPhotoAssignment = {
  index: number;
  absentId: string;
  coveringId: string;
  classId: string;
  period: number;
  needKey: string;
};

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function digits(value: string) {
  return value.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x966));
}

export function writtenCoverDate(value: string) {
  const text = digits(normalized(value));
  if (isIsoDay(text)) return text;
  const match = /^(\d{1,2})\s*([./-])\s*(\d{1,2})\s*\2\s*(\d{4})$/.exec(text);
  if (!match) return null;
  const day = `${match[4]}-${match[3].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isIsoDay(day) ? day : null;
}

const roman = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii"];

function writtenPeriod(value: string): number | null {
  const label = digits(normalized(value)).replace(/^(?:period|पीरियड)\s+/, "").replace(/[.)]$/, "");
  const index = /^\d{1,2}$/.test(label) ? periodIndex(Number(label)) : roman.indexOf(label);
  return isPeriodIndex(index) ? index : null;
}

function teacherLabel(value: string) {
  const label = normalized(value).replace(/\s+(?:sir|ma[’']?am|mam|madam|सर|मैम|जी)\.?$/, "");
  return /^(?:[a-z][. ]+)+[a-z]\.?$/.test(label) ? label.replace(/[. ]/g, "") : label;
}

function classLabel(value: string) {
  return digits(normalized(value)).replace(/^class\s+/, "")
    .replace(/^(\d{1,2})(?:st|nd|rd|th)\b/, "$1").replace(/^(\d{1,2})\s+([a-z])$/, "$1$2");
}

function matchesClassCell(cell: string, label: string, subject: string) {
  const expected = classLabel(label);
  const actual = classLabel(cell);
  if (actual === expected) return true;
  // A register may append the subject to the full class cell. Verify both;
  // a grade without its timetable section never matches a section by itself.
  const parts = actual.split(" ");
  return parts.some((_, index) => index > 0 &&
    classLabel(parts.slice(0, index).join(" ")) === expected &&
    canonicalSubject(parts.slice(index).join(" ")) === canonicalSubject(subject));
}

export function reviewCoverPhoto(input: {
  photo: CoverPhoto;
  day: CoverDay;
  teacherProfiles: TeacherProfiles;
  history: Record<string, number>;
  leave: Readonly<Record<string, readonly number[]>>;
  excluded: ReadonlyMap<string, ReadonlySet<string>>;
  now: Date;
}): { review: CoverPhotoReview; assignments: CoverPhotoAssignment[] } {
  const { day, photo, teacherProfiles, history, leave, excluded, now } = input;
  const names = distinctNames(day.staff);
  const scheduled = new Set(day.slots.map((slot) => slot.staffProfileId));
  const teachers = day.staff.filter((teacher) => teacher.isTeaching && scheduled.has(teacher.id));
  const teacherId = (label: string) => {
    const key = teacherLabel(label);
    if (!key) return null;
    const matches = day.staff.filter((teacher) => [teacher.shortName, teacher.displayName]
      .some((name) => teacherLabel(name) === key));
    return matches.length === 1 && teachers.includes(matches[0]) ? matches[0].id : null;
  };
  const { events, clashes } = teachingEventsFor(day.slots, day.header ?? "");
  const existing = day.live.flatMap((duty) => duty.status === "assigned" && duty.coveringStaffId
    ? [{ slotId: duty.needKey, teacher: duty.coveringStaffId, periodIndex: duty.period }] : []);
  const knownAbsences = { ...day.absenceIndex };
  for (const [teacher, periods] of Object.entries(leave)) {
    knownAbsences[teacher] = [...new Set([...(knownAbsences[teacher] ?? []), ...periods])];
  }
  const matched = photo.rows.map((source, index) => {
    const dateMatches = writtenCoverDate(source.sourceDate ?? "") === day.day;
    const absentId = teacherId(source.absentTeacher);
    const coveringId = teacherId(source.substitute);
    const period = writtenPeriod(source.period);
    const matches = events.filter((event) => event.period === period && absentId && event.staffIds.includes(absentId) &&
      event.classes.some((entry) => matchesClassCell(source.classLabel, entry.label, event.subjectCode)));
    const event = matches.length === 1 ? matches[0] : null;
    const needKey = event ? event.key + (event.kind === "team_block" ? "#team" : "#lesson") : null;
    if (dateMatches && absentId && event) {
      const away = knownAbsences[absentId] ?? [];
      if (!away.includes(event.period)) knownAbsences[absentId] = [...away, event.period];
    }
    return { source, index, dateMatches, absentId, coveringId, period, event, needKey };
  });
  const keyCounts = new Map<string, number>();
  const teacherCounts = new Map<string, number>();
  for (const { dateMatches, needKey, coveringId, period } of matched) {
    if (!dateMatches || !needKey) continue;
    keyCounts.set(needKey, (keyCounts.get(needKey) ?? 0) + 1);
    const slot = coveringId + ":" + period;
    if (coveringId) teacherCounts.set(slot, (teacherCounts.get(slot) ?? 0) + 1);
  }

  const assignments: CoverPhotoAssignment[] = [];
  const rows = matched.map(({ source, index, dateMatches, absentId, coveringId, period, event, needKey }) => {
    let issue: CoverPhotoIssue | null = null;
    let suggestions: string[] = [];
    if (!dateMatches) issue = "source_date";
    else if (period === null) issue = "period";
    else if (!absentId) issue = "teacher";
    else if (!event || !needKey || !day.header) issue = "lesson";
    else {
      const assigned = existing.find((duty) => duty.slotId === needKey);
      const isComplex = event.kind !== "ordinary" || clashes.some((clash) => clash.eventKeys.includes(event.key)) ||
        events.some((other) => other.key !== event.key && other.period === period &&
          other.classes.some(({ id }) => event.classes.some((entry) => entry.id === id)));
      const bells = day.bells.periods.find((entry) => entry.index === period);
      const starts = bells ? Date.parse(day.day + "T" + bells.starts + ":00+05:30") : NaN;
      const open = day.openPeriods.has(period) && starts > now.getTime() + COVER_PHOTO_UNDO_MS;
      const candidates = !open || assigned ? [] : rankCandidates({
        day: day.header,
        teacherProfiles,
        absenceIndex: knownAbsences,
        coverHistory: history,
        assignments: existing,
        vacancy: {
          slotId: needKey, periodIndex: period, className: event.classes[0].label,
          alsoClassNames: event.classes.slice(1).map((entry) => entry.label), subject: event.subjectCode,
          excludeTeachers: [...(excluded.get(needKey) ?? [])],
        },
      }).filter((candidate) => !candidate.blocked.length && scheduled.has(candidate.teacher));
      if (isComplex) issue = "complex";
      else if (source.unclear) issue = "unclear";
      else if (!open) issue = "closed";
      else if (assigned) issue = "existing";
      else if ((keyCounts.get(needKey) ?? 0) > 1) issue = "duplicate";
      else if (existing.some((duty) => duty.teacher === absentId && duty.periodIndex === period)) issue = "double_booked";
      else if (!coveringId) issue = "substitute";
      else if ((teacherCounts.get(coveringId + ":" + period) ?? 0) > 1) issue = "double_booked";
      else if (!candidates.some((candidate) => candidate.teacher === coveringId)) issue = "unavailable";
      else assignments.push({ index, absentId, coveringId, period, needKey, classId: event.classes[0].id });
      if (issue) suggestions = candidates.map((candidate) => candidate.teacher);
    }
    return { index, source, issue, suggestions };
  });

  // The suggested names are a review aid. Never suggest a teacher already
  // assigned by another row of this same photo in the same period.
  const withSuggestions = rows.map((row) => {
    const { period, needKey, absentId } = matched[row.index];
    const booked = new Set(assignments.filter((entry) => entry.period === period).map((entry) => entry.coveringId));
    const suggestions = period === null || !needKey || !absentId || row.issue === "complex" ? [] :
      row.suggestions.filter((id) => names.has(id) && !booked.has(id)).slice(0, 3).map((id) => ({
        label: names.get(id)!,
        href: "/substitutions/arrange?" + new URLSearchParams({
          day: day.day, staff: absentId, periods: String(period), photoNeed: needKey, photoCover: id,
        }).toString(),
      }));
    return { ...row, suggestions };
  });
  return { review: { rows: withSuggestions }, assignments };
}
