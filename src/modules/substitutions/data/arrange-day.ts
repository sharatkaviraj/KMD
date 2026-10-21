import "server-only";

import { createHash } from "node:crypto";

import { listStaff } from "@/modules/staff/data/staff-repo";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { isArrangeable, periodTiming, type BellSchedule } from "@/modules/timetable/domain/bells";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { absencesOn, toAbsenceIndex } from "@/modules/substitutions/data/absences-repo";
import {
  commitCoverCommand,
  commitLateCover,
  coverCountsBetween,
  coverDayRevision,
  currentBells,
  dutiesOn,
  exclusionsFrom,
  findCommand,
  liveOnly,
  teamRules,
  type CommandOutcome,
  type CoverDuty,
  type LateCoverOutcome,
} from "@/modules/substitutions/data/cover-repo";
import { listCoverPolicies } from "@/modules/substitutions/data/policies-repo";
import { arrangeCover, type DutyOverride } from "@/modules/substitutions/domain/arrange";
import {
  buildTeacherProfiles,
  rankCandidates,
  type AbsenceIndex,
  type Candidate,
  type PolicyOverride,
  type TeacherProfiles,
} from "@/modules/substitutions/domain/engine";
import {
  coverNeedsFor,
  teachingEventsFor,
  type CoverNeed,
  type TimetableClash,
} from "@/modules/substitutions/domain/events";
import { teacherDetailsFrom, type PlanSlot } from "@/modules/substitutions/domain/plan";
import { isFullDay, splitByRole, type TeacherAbsence } from "@/modules/substitutions/domain/policies";
import { addDays } from "@/platform/dates";

/**
 * Everything a cover decision for one day is made from, read once (P3).
 *
 * The screen and the command build it the same way, so the plan a coordinator
 * looks at is the plan the command would make — and the command still
 * recomputes it rather than trusting anything the browser sends back.
 */
export type CoverDay = {
  sessionLabel: string;
  day: string;
  versionId: string | null;
  /** The sheet's day header for this date; null on a day the sheet has none. */
  header: string | null;
  slots: PlanSlot[];
  absences: TeacherAbsence[];
  absenceIndex: AbsenceIndex;
  bells: BellSchedule;
  dayRevision: number;
  duties: CoverDuty[];
  live: CoverDuty[];
  needs: CoverNeed[];
  clashes: TimetableClash[];
  openPeriods: Set<number>;
  staff: { id: string; displayName: string; shortName: string; isTeaching: boolean; hasPhone: boolean; hasLogin: boolean }[];
};

const HISTORY_DAYS = 30;

export async function readCoverDay(sessionLabel: string, day: string, now = new Date()): Promise<CoverDay> {
  const [published, absences, bells, dayRevision, duties, rules, allStaff] = await Promise.all([
    getPublishedVersion(sessionLabel),
    absencesOn(sessionLabel, day),
    currentBells(sessionLabel),
    coverDayRevision(sessionLabel, day),
    dutiesOn(sessionLabel, day),
    teamRules(sessionLabel),
    listStaff(),
  ]);

  const slots = published ? ((await listSlots(published.id)) as PlanSlot[]) : [];
  const days = [...new Set(slots.map((slot) => slot.day))];
  const header = matchDayHeader(days, day);
  const absenceIndex = toAbsenceIndex(absences);
  const { events, clashes } = header ? teachingEventsFor(slots, header) : { events: [], clashes: [] };

  const openPeriods = new Set(
    bells.periods.map((period) => period.index).filter((index) => isArrangeable(bells, day, index, now)),
  );

  return {
    sessionLabel,
    day,
    versionId: published?.id ?? null,
    header,
    slots,
    absences,
    absenceIndex,
    bells,
    dayRevision,
    duties,
    live: liveOnly(duties),
    needs: coverNeedsFor(events, absenceIndex, rules),
    clashes,
    openPeriods,
    staff: allStaff
      .filter((person) => person.isActive)
      .map((person) => ({
        id: person.id,
        displayName: person.displayName,
        shortName: person.shortName,
        isTeaching: person.isTeaching,
        hasPhone: Boolean(person.whatsappPhone ?? person.phone),
        hasLogin: Boolean(person.userId),
      })),
  };
}

/**
 * The engine's view of the staff for one day.
 *
 * `teacherProfiles` is who the app may choose by itself: teaching staff only.
 * An active office profile is not positive evidence of classroom eligibility
 * (PLAN §7), so a non-teacher is only ever chosen by a person. `everyone` is
 * every active profile, for judging and ranking a person's choice.
 */
export async function profilesFor(day: CoverDay): Promise<{
  teacherProfiles: TeacherProfiles;
  everyone: TeacherProfiles;
  history: Record<string, number>;
}> {
  const [policies, history] = await Promise.all([
    listCoverPolicies(day.sessionLabel),
    coverCountsBetween(day.sessionLabel, addDays(day.day, -HISTORY_DAYS), addDays(day.day, -1)),
  ]);

  const policyOverrides: Record<string, PolicyOverride> = {};
  for (const policy of policies) {
    const override: PolicyOverride = { maxAutoSubstitutions: policy.maxAutoCovers };
    if (!isFullDay(policy.allowedPeriods)) {
      override.availability = { allowedPeriodIndexes: policy.allowedPeriods };
    }
    policyOverrides[policy.staffProfileId] = override;
  }
  const { reserveStaff, dutyStaff } = splitByRole(policies);
  const days = [...new Set(day.slots.map((slot) => slot.day))];
  const build = (roster: string[]) =>
    buildTeacherProfiles({
      teacherDetails: teacherDetailsFrom(day.slots, days),
      roster,
      policyOverrides,
      reserveStaff,
      dutyStaff,
    });

  return {
    teacherProfiles: build(day.staff.filter((person) => person.isTeaching).map((person) => person.id)),
    everyone: build(day.staff.map((person) => person.id)),
    history,
  };
}

/**
 * Everybody a coordinator could put on a duty, best first, with the reason
 * the unavailable ones are unavailable — so the list never looks smaller than
 * the staff room, and never offers a person who is in two rooms.
 */
export function candidatesFor(
  day: CoverDay,
  everyone: TeacherProfiles,
  history: Record<string, number>,
  duty: CoverDuty,
): Candidate[] {
  if (!day.header) return [];
  const [first, ...rest] = duty.classLabels;
  return rankCandidates({
    day: day.header,
    teacherProfiles: everyone,
    absenceIndex: day.absenceIndex,
    coverHistory: history,
    assignments: day.live
      .filter((other) => other.status === "assigned" && other.coveringStaffId && other.id !== duty.id)
      .map((other) => ({ slotId: other.needKey, teacher: other.coveringStaffId!, periodIndex: other.period })),
    vacancy: {
      slotId: duty.needKey,
      periodIndex: duty.period,
      className: first,
      alsoClassNames: rest,
      subject: duty.subjectCode,
      excludeTeachers: [...(exclusionsFrom(day.duties).get(duty.needKey) ?? [])],
    },
  });
}

/** What the operator asked for — the part a repeated submission must match. */
export type CoverIntent =
  | { kind: "absence"; staffProfileId: string; periods: number[] }
  | { kind: "clear_absence"; staffProfileId: string }
  | { kind: "assign"; needKey: string; coveringStaffId: string }
  | { kind: "release"; needKey: string }
  | { kind: "refresh" };

function payloadHash(day: string, intent: CoverIntent): string {
  const normalized =
    intent.kind === "absence"
      ? { ...intent, periods: [...new Set(intent.periods)].sort((a, b) => a - b) }
      : intent;
  return createHash("sha256").update(JSON.stringify({ day, intent: normalized })).digest("hex");
}

export type ArrangeOutcome =
  | CommandOutcome
  | { ok: false; reason: "refused_override"; blocked: string[] }
  | { ok: false; reason: "no_timetable_day" };

/**
 * Save an operator's cover decision for one day, atomically.
 *
 * In order: a submission already committed returns its receipt (the
 * lost-response case); the day is read; the operator's intent is applied in
 * memory; the arranger works out the whole day; the database commits it or
 * refuses it as one transaction. Nothing is written before the last step.
 */
export async function arrangeDay(input: {
  actorStaffId: string;
  sessionLabel: string;
  day: string;
  commandId: string;
  intent: CoverIntent;
  expectedDayRevision: number;
  /** Test-only: raise inside the transaction at a named point. Honoured only on dev with the flag on. */
  fault?: string | null;
  now?: Date;
}): Promise<ArrangeOutcome> {
  const replay = await findCommand(input.commandId, input.actorStaffId);
  if (replay) return replay;

  const now = input.now ?? new Date();
  const day = await readCoverDay(input.sessionLabel, input.day, now);
  if (!day.versionId) return { ok: false, reason: "no_timetable" };
  if (!day.header) return { ok: false, reason: "no_timetable_day" };

  // The absence as it will be once this command commits.
  const absenceIndex: AbsenceIndex = { ...day.absenceIndex };
  const absenceChanges: { staff_profile_id: string; periods: number[] | null }[] = [];
  if (input.intent.kind === "absence") {
    absenceIndex[input.intent.staffProfileId] = [...input.intent.periods].sort((a, b) => a - b);
    absenceChanges.push({ staff_profile_id: input.intent.staffProfileId, periods: absenceIndex[input.intent.staffProfileId] });
  } else if (input.intent.kind === "clear_absence") {
    delete absenceIndex[input.intent.staffProfileId];
    absenceChanges.push({ staff_profile_id: input.intent.staffProfileId, periods: null });
  }

  const [{ teacherProfiles, everyone, history }, rules] = await Promise.all([
    profilesFor(day),
    teamRules(input.sessionLabel),
  ]);

  const { events } = teachingEventsFor(day.slots, day.header);
  const needs = coverNeedsFor(events, absenceIndex, rules);

  const override: DutyOverride | null =
    input.intent.kind === "assign"
      ? { needKey: input.intent.needKey, coveringStaffId: input.intent.coveringStaffId }
      : input.intent.kind === "release"
        ? { needKey: input.intent.needKey, coveringStaffId: null }
        : null;

  // A coordinator may choose anybody active — including staff the app would
  // never volunteer — so a manual assignment is judged against every profile.
  const judgedProfiles =
    override?.coveringStaffId && !teacherProfiles[override.coveringStaffId]
      ? { ...teacherProfiles, [override.coveringStaffId]: everyone[override.coveringStaffId] }
      : teacherProfiles;

  // A teacher who said "I cannot cover" is never asked again for that duty.
  // Their duty is not freed by saying so (§5: responsibility moves only when a
  // new plan commits); it is re-arranged by the next command, this one.
  const excluded = exclusionsFrom(day.duties);

  const arranged = arrangeCover({
    needs,
    openPeriods: day.openPeriods,
    live: day.live.map((duty) => ({
      needKey: duty.needKey,
      period: duty.period,
      status: duty.status as "assigned" | "needs_help",
      coveringStaffId: duty.coveringStaffId,
      source: duty.source,
      pinned: duty.pinned,
      reason: duty.reason,
    })),
    day: day.header,
    teacherProfiles: judgedProfiles,
    absenceIndex,
    coverHistory: history,
    override,
    excluded,
  });

  if (arranged.refusedOverride) {
    return { ok: false, reason: "refused_override", blocked: arranged.refusedOverride.blocked };
  }

  // Left without anybody after a refusal, the reason a person sees is the refusal.
  const duties = arranged.duties.map((duty) =>
    duty.status === "needs_help" && excluded.has(duty.need_key)
      ? { ...duty, reason: "cannot_cover" as const }
      : duty,
  );

  return commitCoverCommand({
    command_id: input.commandId,
    kind: input.intent.kind,
    actor_staff_id: input.actorStaffId,
    session_label: input.sessionLabel,
    day: input.day,
    timetable_day: day.header,
    payload_hash: payloadHash(input.day, input.intent),
    expected: {
      day_revision: input.expectedDayRevision,
      timetable_version_id: day.versionId,
      bells_revision: day.bells.revision,
    },
    absences: absenceChanges,
    duties,
    fault: input.fault ?? null,
  });
}

/**
 * Put a teacher into a lesson that is running now with nobody in it — a
 * period that had begun before its teacher was marked away (admin run, 20
 * Oct: "no way to hand-pick a cover teacher"). The cover command never
 * touches a begun period; this is the one narrow way in, judged here against
 * the same day the screens draw and again by the database:
 *
 *  - today, and the period has started and not ended (the real clock, as
 *    every write uses);
 *  - the lesson is one the absences leave with no live duty;
 *  - the person is free then by the engine's own rules (not away, not
 *    teaching, not covering elsewhere).
 */
export async function arrangeLateCover(input: {
  actorStaffId: string;
  sessionLabel: string;
  day: string;
  commandId: string;
  needKey: string;
  coveringStaffId: string;
  now?: Date;
}): Promise<LateCoverOutcome> {
  const replay = await findCommand(input.commandId, input.actorStaffId);
  if (replay) return replay;

  const now = input.now ?? new Date();
  const day = await readCoverDay(input.sessionLabel, input.day, now);
  if (!day.versionId || !day.header) return { ok: false, reason: "no_lesson" };

  const need = day.needs.find((entry) => entry.key === input.needKey);
  const hasDuty = day.live.some((duty) => duty.needKey === input.needKey || duty.needKey.startsWith(`${input.needKey}-`));
  if (!need || hasDuty) return { ok: false, reason: "stale" };
  if (periodTiming(day.bells, input.day, need.event.period, now) !== "started") return { ok: false, reason: "not_running" };

  const { everyone, history } = await profilesFor(day);
  const pseudo = {
    id: `late:${need.key}`,
    needKey: need.key,
    period: need.event.period,
    classLabels: need.event.classes.map((entry) => entry.label),
    subjectCode: need.event.subjectCode,
  } as CoverDuty;
  const verdict = candidatesFor(day, everyone, history, pseudo).find((candidate) => candidate.teacher === input.coveringStaffId);
  if (!verdict || verdict.blocked.length > 0) return { ok: false, reason: "refused_override" };

  return commitLateCover({
    command_id: input.commandId,
    actor_staff_id: input.actorStaffId,
    session_label: input.sessionLabel,
    day: input.day,
    timetable_day: day.header,
    timetable_version_id: day.versionId,
    covering_staff_id: input.coveringStaffId,
    payload_hash: createHash("sha256").update(JSON.stringify({ day: input.day, late: input.needKey, to: input.coveringStaffId })).digest("hex"),
    need: {
      need_key: need.key,
      period: need.event.period,
      event_kind: need.event.kind,
      class_ids: need.event.classes.map((entry) => entry.id),
      class_labels: need.event.classes.map((entry) => entry.label),
      subject_code: need.event.subjectCode,
      absent_staff_ids: [...need.absentStaffIds].sort(),
    },
  });
}
