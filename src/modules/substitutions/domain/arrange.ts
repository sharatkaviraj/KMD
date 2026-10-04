import {
  candidateForTeacher,
  generatePlan,
  type AbsenceIndex,
  type AssignmentLike,
  type GeneratedAssignment,
  type TeacherProfiles,
  type Vacancy,
} from "@/modules/substitutions/domain/engine";
import type { CoverNeed } from "@/modules/substitutions/domain/events";

/**
 * The whole day's cover, worked out once, as the state the database should
 * hold (PLAN P3).
 *
 * The engine still decides who fits a lesson best — its tiers, familiarity,
 * fairness and min-cost allocation are kept as they were. What this adds is
 * what the engine alone could not promise:
 *
 *  - **stability.** A cover that is still valid stays with the teacher who
 *    has it. Re-planning the day for a second absence does not shuffle the
 *    first one's covers and re-notify everybody (§8: "a global plan version
 *    change does not renotify unchanged duties").
 *  - **hard validity before preference.** A kept or pinned cover whose teacher
 *    is now away, teaching, double booked or off shift is released, not kept
 *    because somebody once chose it.
 *  - **a final whole-plan check.** Each cover is legal on its own when the
 *    engine picks it; two of them together can still give a teacher five
 *    periods in a row (the audit's P1-P2-P5 counterexample). Every automatic
 *    cover is checked again against all the others, and one that breaks a
 *    rule is released and re-allocated with that teacher excluded — or left
 *    needing help.
 *  - **honest leftovers.** Nothing becomes "self study" or "merged" by itself
 *    any more. What the app cannot arrange safely is `needs_help`, with the
 *    reason and, where the engine has one, a suggestion a person can accept.
 *
 * Pure: the caller supplies everything, including which periods are still
 * open by the bells, and gets back rows to commit.
 */

export type LiveDuty = {
  needKey: string;
  period: number;
  status: "assigned" | "needs_help";
  coveringStaffId: string | null;
  source: "auto" | "manual";
  pinned: boolean;
  reason: string | null;
};

export type DesiredDuty = {
  need_key: string;
  period: number;
  event_kind: string;
  class_ids: string[];
  class_labels: string[];
  subject_code: string;
  absent_staff_ids: string[];
  status: "assigned" | "needs_help";
  covering_staff_id: string | null;
  suggested_staff_id: string | null;
  reason: NeedsHelpReason | null;
  source: "auto" | "manual";
  pinned: boolean;
  match_tier: string | null;
  warnings: string[];
};

export type NeedsHelpReason =
  | "no_candidate"
  | "team_unmapped"
  | "team_below_minimum"
  | "whole_team_absent"
  | "pin_invalid"
  | "plan_validation"
  | "cannot_cover"
  | "released";

/** A coordinator's deliberate choice for one duty, applied before anything else. */
export type DutyOverride = { needKey: string; coveringStaffId: string | null };

export type ArrangeInput = {
  /** Every cover need on the day, from `coverNeedsFor`. */
  needs: readonly CoverNeed[];
  /** Periods still arrangeable by the bells. Others are history and are left out. */
  openPeriods: ReadonlySet<number>;
  live: readonly LiveDuty[];
  /** The sheet's day header the engine's schedules are keyed by. */
  day: string;
  teacherProfiles: TeacherProfiles;
  absenceIndex: AbsenceIndex;
  coverHistory?: Record<string, number>;
  maxConsecutive?: number;
  override?: DutyOverride | null;
  /** People who have said they cannot cover a need — never asked again for it. */
  excluded?: ReadonlyMap<string, ReadonlySet<string>>;
};

export type ArrangeResult = {
  duties: DesiredDuty[];
  /** An override the facts refuse — reported to the coordinator, not committed. */
  refusedOverride: { needKey: string; blocked: string[] } | null;
};

const MAX_ROUNDS = 6;

/** A lesson need as the engine's vacancy. A team needs a person, not the engine. */
function vacancyFor(need: CoverNeed, slotId: string, exclude: readonly string[]): Vacancy {
  const [first, ...rest] = need.event.classes;
  return {
    slotId,
    periodIndex: need.event.period,
    className: first.label,
    alsoClassNames: rest.map((entry) => entry.label),
    subject: need.event.subjectCode,
    originalTeacher: need.absentStaffIds[0],
    excludeTeachers: [...exclude],
  };
}

/** A team short by two supervisors is two duties; an unmapped one is one, for a person to size. */
function slotsFor(need: CoverNeed): string[] {
  if (need.automatic) return [need.key];
  const count = Math.max(1, need.supervisorsNeeded ?? 1);
  return count === 1 ? [need.key] : Array.from({ length: count }, (_, at) => `${need.key}-${at + 1}`);
}

export function arrangeCover(input: ArrangeInput): ArrangeResult {
  const base = { day: input.day, teacherProfiles: input.teacherProfiles, absenceIndex: input.absenceIndex };
  const policy = { maxConsecutive: input.maxConsecutive };
  const liveByKey = new Map(input.live.map((duty) => [duty.needKey, duty]));
  const excludedFor = (key: string, needKey: string) =>
    [...(input.excluded?.get(key) ?? input.excluded?.get(needKey) ?? [])];

  type Slot = { key: string; need: CoverNeed };
  const slots: Slot[] = input.needs
    .filter((need) => input.openPeriods.has(need.event.period))
    .flatMap((need) => slotsFor(need).map((key) => ({ key, need })));

  /** Who holds which slot so far: the allocation being built. */
  const held = new Map<string, { teacher: string; source: "auto" | "manual"; pinned: boolean }>();
  const released = new Map<string, NeedsHelpReason>();
  let refusedOverride: ArrangeResult["refusedOverride"] = null;

  const assignmentsExcept = (key: string): AssignmentLike[] =>
    [...held.entries()]
      .filter(([other]) => other !== key)
      .map(([other, entry]) => ({
        slotId: other,
        teacher: entry.teacher,
        periodIndex: slots.find((slot) => slot.key === other)!.need.event.period,
      }));

  const judge = (slot: Slot, teacher: string) =>
    candidateForTeacher(
      {
        ...base,
        coverHistory: input.coverHistory,
        policy,
        assignments: assignmentsExcept(slot.key),
        vacancy: vacancyFor(slot.need, slot.key, excludedFor(slot.key, slot.need.key)),
      },
      teacher,
    );

  /* --------------------------------------------- 1. the coordinator's word */

  const override = input.override ?? null;
  for (const slot of slots) {
    if (override?.needKey !== slot.key) continue;
    if (override.coveringStaffId === null) {
      released.set(slot.key, "released");
      continue;
    }
    const verdict = judge(slot, override.coveringStaffId);
    if (!verdict || verdict.blocked.length > 0) {
      refusedOverride = { needKey: slot.key, blocked: verdict?.blocked ?? ["unknown_teacher"] };
      continue;
    }
    // A person chose this, knowing the warnings; only a hard block refuses it.
    held.set(slot.key, { teacher: override.coveringStaffId, source: "manual", pinned: true });
  }

  /* ------------------------------------------------ 2. keep what still holds */

  for (const slot of slots) {
    if (held.has(slot.key) || released.has(slot.key)) continue;
    const live = liveByKey.get(slot.key);
    if (!live || live.status !== "assigned" || !live.coveringStaffId) continue;

    const verdict = judge(slot, live.coveringStaffId);
    const hardBlocked = !verdict || verdict.blocked.length > 0;

    if (live.source === "manual" && live.pinned) {
      if (hardBlocked) released.set(slot.key, "pin_invalid");
      else held.set(slot.key, { teacher: live.coveringStaffId, source: "manual", pinned: true });
      continue;
    }
    // An automatic cover is kept only while the engine would still make it.
    if (!hardBlocked && verdict!.autoEligible && slot.need.automatic) {
      held.set(slot.key, { teacher: live.coveringStaffId, source: "auto", pinned: false });
    }
  }

  /* ------------------------------- 3. allocate, check the whole, repeat */

  const extraExclusions = new Map<string, Set<string>>();
  const suggestions = new Map<string, GeneratedAssignment>();
  const tiers = new Map<string, { tier: string; warnings: string[] }>();

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const open = slots.filter(
      (slot) => slot.need.automatic && !held.has(slot.key) && released.get(slot.key) !== "released",
    );
    if (open.length > 0) {
      const result = generatePlan({
        ...base,
        coverHistory: input.coverHistory,
        policy,
        vacancies: open.map((slot) =>
          vacancyFor(slot.need, slot.key, [
            ...excludedFor(slot.key, slot.need.key),
            ...(extraExclusions.get(slot.key) ?? []),
          ]),
        ),
        existingAssignments: assignmentsExcept("\u0000"),
      });

      for (const item of result.assignments) {
        if (!("source" in item) || !item.slotId) continue;
        held.set(item.slotId, { teacher: item.teacher, source: "auto", pinned: false });
        tiers.set(item.slotId, { tier: item.matchTier, warnings: item.warnings });
      }
      for (const suggestion of result.reviewSuggestions) suggestions.set(suggestion.slotId, suggestion);
    }

    // Every automatic cover against all the others. The latest period's
    // cover is released first, because the earlier one is the one somebody is
    // about to walk to.
    const violations = slots
      .filter((slot) => held.get(slot.key)?.source === "auto")
      .filter((slot) => {
        const verdict = judge(slot, held.get(slot.key)!.teacher);
        return !verdict || verdict.blocked.length > 0 || !verdict.autoEligible;
      })
      .sort((a, b) => b.need.event.period - a.need.event.period);

    if (violations.length === 0) break;

    const [worst] = violations;
    const teacher = held.get(worst.key)!.teacher;
    held.delete(worst.key);
    tiers.delete(worst.key);
    const set = extraExclusions.get(worst.key) ?? new Set<string>();
    set.add(teacher);
    extraExclusions.set(worst.key, set);
    if (round === MAX_ROUNDS - 1) released.set(worst.key, "plan_validation");
  }

  // Out of rounds, nothing invalid survives: release what still breaks a rule,
  // latest period first, until the whole plan holds. A safe "needs help" is a
  // valid answer; a fictional cover is not (§7).
  for (;;) {
    const remaining = slots
      .filter((slot) => held.get(slot.key)?.source === "auto")
      .filter((slot) => {
        const verdict = judge(slot, held.get(slot.key)!.teacher);
        return !verdict || verdict.blocked.length > 0 || !verdict.autoEligible;
      })
      .sort((a, b) => b.need.event.period - a.need.event.period);
    if (remaining.length === 0) break;
    held.delete(remaining[0].key);
    released.set(remaining[0].key, "plan_validation");
  }

  /* ------------------------------------------------------------ 4. rows */

  const duties: DesiredDuty[] = slots.map(({ key, need }) => {
    const row = {
      need_key: key,
      period: need.event.period,
      event_kind: need.event.kind,
      class_ids: need.event.classes.map((entry) => entry.id),
      class_labels: need.event.classes.map((entry) => entry.label),
      subject_code: need.event.subjectCode,
      absent_staff_ids: [...need.absentStaffIds].sort(),
    };
    const holding = held.get(key);
    if (holding) {
      const verdict = judge({ key, need }, holding.teacher);
      return {
        ...row,
        status: "assigned" as const,
        covering_staff_id: holding.teacher,
        suggested_staff_id: null,
        reason: null,
        source: holding.source,
        pinned: holding.pinned,
        match_tier: verdict?.matchTier ?? tiers.get(key)?.tier ?? null,
        warnings: verdict?.warnings ?? tiers.get(key)?.warnings ?? [],
      };
    }

    const suggestion = suggestions.get(key);
    const reason: NeedsHelpReason =
      released.get(key) ??
      (need.reason === "teacher_absent" ? (extraExclusions.has(key) ? "plan_validation" : "no_candidate") : need.reason);
    return {
      ...row,
      status: "needs_help" as const,
      covering_staff_id: null,
      suggested_staff_id: suggestion?.teacher ?? null,
      reason,
      source: "auto" as const,
      pinned: false,
      match_tier: suggestion?.matchTier ?? null,
      warnings: suggestion?.warnings ?? [],
    };
  });

  return { duties, refusedOverride };
}
