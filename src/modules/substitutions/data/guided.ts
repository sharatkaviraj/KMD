import "server-only";

import { listStaff } from "@/modules/staff/data/staff-repo";
import { planCoverDay, readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { coverCountsBetween, dutiesOn, liveOnly } from "@/modules/substitutions/data/cover-repo";
import { coverEligibleIds, distinctNames } from "@/modules/substitutions/domain/cover-view";
import { rankCandidates } from "@/modules/substitutions/domain/engine";
import { teachingEventsFor } from "@/modules/substitutions/domain/events";
import {
  affectedDuties,
  begunLessonPeriods,
  choicesFor,
  conflictOf,
  messagesByPerson,
  noticePlan,
  optionsFor,
  otherChanges,
  planFingerprint,
  reviewTally,
  workloadFor,
  type Conflict,
  type GuidedChoice,
  type GuidedOption,
  type OtherChange,
} from "@/modules/substitutions/domain/guided";
import { createAdminClient } from "@/platform/supabase/admin";
import { spanPeriods, weekDates, type LeaveSpan } from "@/vx/screens/timetable/domain/timetable";

/*
 * The guided cover flow's reads (review C01). Nothing here writes: the one
 * write is still the cover command, through `arrangeDay`.
 *
 * The preview is `planCoverDay` — the compute half of that command — with the
 * absence and the coordinator's choices applied, turned into what the screen
 * shows: the lessons the absence leaves in the chosen periods, everyone who
 * could take each, why the rest cannot, and how many covers each already has.
 */

export type GuidedLessonRef = { period: number; classLabels: string[]; subjectCode: string };

export type GuidedTeacher = {
  id: string;
  name: string;
  /** Their lessons on this day, by period. */
  lessons: GuidedLessonRef[];
  /** Periods the day already marks them away, or null. */
  away: number[] | null;
  /** Periods approved leave covers on this day, or null. */
  onLeave: number[] | null;
};

export type GuidedSetup = {
  day: string;
  dayRevision: number;
  /** Null when cover can be arranged; otherwise why not. */
  blocked: "no_timetable" | "no_timetable_day" | null;
  bells: { index: number; starts: string; ends: string }[];
  openPeriods: number[];
  teachers: GuidedTeacher[];
};

/** Approved leave on one day, as the periods it covers, per teacher. */
export async function approvedLeaveOn(sessionLabel: string, day: string): Promise<Record<string, number[]>> {
  const { data, error } = await createAdminClient()
    .from("teacher_leave")
    .select("staff_profile_id, span")
    .eq("session_label", sessionLabel)
    .eq("status", "approved")
    .lte("from_day", day)
    .gte("to_day", day)
    .limit(500)
    .returns<{ staff_profile_id: string; span: LeaveSpan }[]>();
  // A leave that could not be read is not "nobody is on leave".
  if (error) throw new Error(`Could not read approved leave: ${error.message}`);
  const out: Record<string, number[]> = {};
  for (const row of data) {
    out[row.staff_profile_id] = [...new Set([...(out[row.staff_profile_id] ?? []), ...spanPeriods(row.span)])].sort((a, b) => a - b);
  }
  return out;
}

/** Who can be named as away on a day, with their lessons that day, and the day's revision. */
export async function loadGuidedSetup(sessionLabel: string, day: string, now = new Date()): Promise<GuidedSetup> {
  const [cover, leave] = await Promise.all([readCoverDay(sessionLabel, day, now), approvedLeaveOn(sessionLabel, day)]);
  const names = distinctNames(cover.staff);
  const eligible = coverEligibleIds(cover.staff, cover.slots);
  const lessons = new Map<string, GuidedLessonRef[]>();
  if (cover.header) {
    for (const event of teachingEventsFor(cover.slots, cover.header).events) {
      for (const staffId of event.staffIds) {
        lessons.set(staffId, [
          ...(lessons.get(staffId) ?? []),
          { period: event.period, classLabels: event.classes.map((entry) => entry.label), subjectCode: event.subjectCode },
        ]);
      }
    }
  }
  const away = new Map(cover.absences.map((absence) => [absence.staffProfileId, absence.periods]));
  return {
    day,
    dayRevision: cover.dayRevision,
    blocked: !cover.versionId ? "no_timetable" : !cover.header ? "no_timetable_day" : null,
    bells: cover.bells.periods.map((period) => ({ index: period.index, starts: period.starts, ends: period.ends })),
    openPeriods: [...cover.openPeriods].sort((a, b) => a - b),
    teachers: cover.staff
      .filter((person) => eligible.has(person.id))
      .map((person) => ({
        id: person.id,
        name: names.get(person.id) ?? person.displayName,
        lessons: (lessons.get(person.id) ?? []).sort((a, b) => a.period - b.period),
        away: away.get(person.id) ?? null,
        onLeave: leave[person.id] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

export type GuidedLesson = {
  needKey: string;
  period: number;
  classLabels: string[];
  subjectCode: string;
  /** False for a team lesson: who supervises which children is a person's call. */
  automatic: boolean;
  status: "assigned" | "needs_help";
  coveringStaffId: string | null;
  /** Why it waits for a person (a `needsHelpReasons` key), or null. */
  reason: string | null;
  /** The coordinator chose this one in the flow (a person, or "nobody yet"). */
  chosen: boolean;
  options: (GuidedOption & { name: string })[];
};

export type GuidedPreview = {
  day: string;
  /** The day's revision the plan was worked out at — what Confirm must still find. */
  dayRevision: number;
  /** The whole plan, condensed — what Confirm must still find. */
  fingerprint: string;
  staffProfileId: string;
  periods: number[];
  /** The choices as applied: refused ones and ones for no lesson are dropped. */
  choices: GuidedChoice[];
  lessons: GuidedLesson[];
  /** Chosen periods the teacher teaches that have begun: not arranged here. */
  begun: GuidedLessonRef[];
  /** Everything else on the day this change moves. */
  others: (OtherChange & { fromName: string | null; toName: string | null })[];
  /** Choices the facts refused, with the reason. */
  refused: { needKey: string; period: number | null; name: string; conflict: Conflict }[];
  tally: { assigned: number; needsHelp: number; total: number };
  /**
   * Who will get a WhatsApp message when this is confirmed — one message per
   * lesson, through the staff outbox. A person without a WhatsApp number is
   * still assigned; their message is blocked and somebody must tell them.
   */
  messages: { staffId: string; name: string; hasPhone: boolean; lessons: (GuidedLessonRef & { kind: "assigned" | "updated" })[] }[];
  /** Covers taken from somebody: told it is cancelled only if they had already been told about it. */
  withdrawn: (GuidedLessonRef & { name: string })[];
};

/**
 * The day as the cover command would leave it with this absence and these
 * choices — and, for each lesson the absence leaves, everybody who could take
 * it. Writes nothing.
 */
export async function buildGuidedPreview(input: {
  sessionLabel: string;
  day: string;
  staffProfileId: string;
  periods: number[];
  choices: GuidedChoice[];
  now?: Date;
}): Promise<{ ok: true; preview: GuidedPreview } | { ok: false; reason: "no_timetable" | "no_timetable_day" }> {
  const leave = await approvedLeaveOn(input.sessionLabel, input.day);
  delete leave[input.staffProfileId];

  const planned = await planCoverDay({
    sessionLabel: input.sessionLabel,
    day: input.day,
    intent: { kind: "absence", staffProfileId: input.staffProfileId, periods: input.periods, choices: input.choices },
    onLeave: leave,
    now: input.now,
  });
  if (!planned.ok) return planned;
  const { plan } = planned;
  const { day } = plan;

  const week = weekDates(input.day);
  const weekAssigned = await coverCountsBetween(input.sessionLabel, week[0], week[week.length - 1]);
  const dayAssigned: Record<string, number> = {};
  for (const duty of day.live) {
    if (duty.status === "assigned" && duty.coveringStaffId) dayAssigned[duty.coveringStaffId] = (dayAssigned[duty.coveringStaffId] ?? 0) + 1;
  }

  const names = distinctNames(day.staff);
  for (const absence of day.absences) if (!names.has(absence.staffProfileId)) names.set(absence.staffProfileId, absence.staffName);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "—") : null);
  const eligible = coverEligibleIds(day.staff, day.slots);

  const affected = affectedDuties(plan.duties, input.staffProfileId, input.periods);
  const affectedKeys = new Set(affected.map((duty) => duty.need_key));
  const needByKey = new Map(plan.needs.map((need) => [need.key, need]));
  const applied = choicesFor(input.choices, affectedKeys).filter(
    (choice) => !plan.refused.some((refusal) => refusal.needKey === choice.needKey),
  );
  const chosenKeys = new Set(applied.map((choice) => choice.needKey));

  const lessons: GuidedLesson[] = affected.map((duty) => {
    const [first, ...rest] = duty.class_labels;
    const ranked = rankCandidates({
      day: day.header,
      teacherProfiles: plan.profiles.everyone,
      absenceIndex: plan.absenceIndex,
      coverHistory: plan.profiles.history,
      assignments: plan.duties
        .filter((other) => other.status === "assigned" && other.covering_staff_id && other.need_key !== duty.need_key)
        .map((other) => ({ slotId: other.need_key, teacher: other.covering_staff_id!, periodIndex: other.period })),
      vacancy: {
        slotId: duty.need_key,
        periodIndex: duty.period,
        className: first,
        alsoClassNames: rest,
        subject: duty.subject_code,
        excludeTeachers: [...(plan.excluded.get(duty.need_key) ?? [])],
      },
    });
    const onLeaveNow = new Set(Object.entries(leave).filter(([, periods]) => periods.includes(duty.period)).map(([id]) => id));
    const options = optionsFor(ranked, {
      eligible,
      onLeave: onLeaveNow,
      workload: (teacher) => workloadFor({ duties: plan.duties, weekAssigned, dayAssigned }, teacher, duty.need_key),
      proposedId: duty.covering_staff_id,
      absentId: input.staffProfileId,
    }).map((option) => ({ ...option, name: nameOf(option.id) ?? "—" }));
    const baseKey = duty.need_key.replace(/-\d+$/, "");
    return {
      needKey: duty.need_key,
      period: duty.period,
      classLabels: duty.class_labels,
      subjectCode: duty.subject_code,
      automatic: (needByKey.get(duty.need_key) ?? needByKey.get(baseKey))?.automatic ?? true,
      status: duty.status,
      coveringStaffId: duty.covering_staff_id,
      reason: duty.reason,
      chosen: chosenKeys.has(duty.need_key),
      options,
    };
  });

  const ownLessons = day.header
    ? teachingEventsFor(day.slots, day.header).events.filter((event) => event.staffIds.includes(input.staffProfileId))
    : [];
  const begunPeriods = new Set(begunLessonPeriods(ownLessons.map((event) => event.period), input.periods, day.openPeriods));
  const begun = ownLessons
    .filter((event) => begunPeriods.has(event.period))
    .map((event) => ({ period: event.period, classLabels: event.classes.map((entry) => entry.label), subjectCode: event.subjectCode }));

  const live = day.live.map((duty) => ({
    needKey: duty.needKey,
    period: duty.period,
    status: duty.status,
    coveringStaffId: duty.coveringStaffId,
    classLabels: duty.classLabels,
    subjectCode: duty.subjectCode,
    reason: duty.reason,
    absentStaffIds: duty.absentStaffIds,
  }));
  const others = otherChanges(live, plan.duties, affectedKeys, day.openPeriods).map((change) => ({
    ...change,
    fromName: nameOf(change.from),
    toName: nameOf(change.to),
  }));

  // Who the command will message on WhatsApp, said before Confirm (C01).
  const phoneOf = new Map(day.staff.map((person) => [person.id, person.hasPhone]));
  const notices = noticePlan(live, plan.duties, day.openPeriods);
  const messages = messagesByPerson(notices.messages).map((group) => ({
    staffId: group.staffId,
    name: nameOf(group.staffId) ?? "—",
    hasPhone: phoneOf.get(group.staffId) ?? false,
    lessons: group.lessons.map(({ period, classLabels, subjectCode, kind }) => ({ period, classLabels, subjectCode, kind })),
  }));
  const withdrawn = notices.withdrawn.map((entry) => ({
    name: nameOf(entry.staffId) ?? "—",
    period: entry.period,
    classLabels: entry.classLabels,
    subjectCode: entry.subjectCode,
  }));

  const choiceOf = new Map(input.choices.map((choice) => [choice.needKey, choice]));
  const refused = plan.refused.map((refusal) => {
    const staffId = choiceOf.get(refusal.needKey)?.coveringStaffId ?? null;
    const period = plan.duties.find((duty) => duty.need_key === refusal.needKey)?.period ?? null;
    const onLeave = Boolean(staffId && period !== null && leave[staffId]?.includes(period));
    return {
      needKey: refusal.needKey,
      period,
      name: nameOf(staffId) ?? "—",
      conflict: conflictOf(refusal.blocked, onLeave) ?? "unavailable",
    };
  });

  return {
    ok: true,
    preview: {
      day: input.day,
      dayRevision: day.dayRevision,
      fingerprint: planFingerprint(plan.duties),
      staffProfileId: input.staffProfileId,
      periods: input.periods,
      choices: applied,
      lessons,
      begun,
      others,
      refused,
      tally: reviewTally(affected),
      messages,
      withdrawn,
    },
  };
}

export type CommittedLesson = {
  period: number;
  classLabels: string[];
  subjectCode: string;
  status: "assigned" | "needs_help";
  coveringName: string | null;
};

/**
 * The lessons of one absence as the database holds them now — what the
 * result step shows, so it says what was saved and not what was asked for.
 */
export async function readCommitted(sessionLabel: string, day: string, staffProfileId: string, periods: readonly number[]): Promise<CommittedLesson[]> {
  const [duties, staff] = await Promise.all([dutiesOn(sessionLabel, day), listStaff()]);
  const names = distinctNames(staff.map((person) => ({ id: person.id, displayName: person.displayName, shortName: person.shortName })));
  const chosen = new Set(periods);
  return liveOnly(duties)
    .filter((duty) => chosen.has(duty.period) && duty.absentStaffIds.includes(staffProfileId))
    .map((duty) => ({
      period: duty.period,
      classLabels: duty.classLabels,
      subjectCode: duty.subjectCode,
      status: duty.status as "assigned" | "needs_help",
      coveringName: duty.coveringStaffId ? (names.get(duty.coveringStaffId) ?? "—") : null,
    }))
    .sort((a, b) => a.period - b.period);
}

/**
 * A saved suggestion the flow can open with — the entry point a later
 * "substitution draft" (an AI one, say) will use: `/substitutions/arrange?draft=<id>`.
 *
 * Nothing stores drafts yet, so this finds none. When something does, it
 * returns the draft only to a cover manager it may be shown to, for the day it
 * was made for, and the flow opens at the lessons step with those choices
 * applied — still worked out again by the server and still saved only by the
 * coordinator's own Confirm. A draft is a suggestion, never a write.
 */
export type CoverDraft = { day: string; staffProfileId: string; periods: number[]; choices: GuidedChoice[] };

export async function loadCoverDraft(draftId: string, actorStaffId: string): Promise<CoverDraft | null> {
  void draftId;
  void actorStaffId;
  return null;
}
