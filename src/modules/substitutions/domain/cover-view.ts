import type { CoverNeed } from "@/modules/substitutions/domain/events";

/*
 * What the cover screens show beside the duties (school-day run, 14 Oct).
 *
 * Pure: no database, so both the vx Substitutions tab and the classic
 * `/substitutions` page draw the same thing from the same `CoverDay`.
 */

/** A lesson an absent teacher leaves whose period began before any cover existed. */
export type MissedPeriod = {
  key: string;
  period: number;
  classLabels: string[];
  subjectCode: string;
  absentStaffIds: string[];
};

/**
 * The lessons nobody can be arranged for any more: the absence leaves them
 * without a teacher, their period has begun (or the day is over), and no duty
 * was ever made for them. The command only makes duties for periods still to
 * come, so without this a teacher marked away at 11:00 reads "0 periods · no
 * cover needed" — the screen has to say which classes sat without a teacher.
 */
export function missedPeriods(
  needs: readonly Pick<CoverNeed, "key" | "event" | "absentStaffIds">[],
  live: readonly { needKey: string }[],
  openPeriods: ReadonlySet<number>,
): MissedPeriod[] {
  const hasDuty = new Set(live.map((duty) => duty.needKey));
  return needs
    .filter((need) => !openPeriods.has(need.event.period) && !hasDuty.has(need.key))
    .map((need) => ({
      key: need.key,
      period: need.event.period,
      classLabels: need.event.classes.map((c) => c.label),
      subjectCode: need.event.subjectCode,
      absentStaffIds: [...need.absentStaffIds],
    }))
    .sort((a, b) => a.period - b.period || a.classLabels.join().localeCompare(b.classLabels.join()));
}

/**
 * Who may be offered as cover: teaching staff, and anybody the published
 * timetable gives a lesson. Office, admin, accountant, coordinator and
 * view-only logins are active profiles but not classroom staff (D-213), and a
 * "Best match" that is the accountant is not a match at all.
 */
export function coverEligibleIds(
  staff: readonly { id: string; isTeaching: boolean }[],
  slots: readonly { staffProfileId: string }[],
): Set<string> {
  const teaches = new Set(slots.map((slot) => slot.staffProfileId));
  return new Set(staff.filter((person) => person.isTeaching || teaches.has(person.id)).map((person) => person.id));
}

/**
 * A name a person can tell apart from every other in the same list. Two
 * profiles both called "QA Teacher" become "QA Teacher (Ravina)" and
 * "QA Teacher (QATE)"; a short name that only repeats the name is not added.
 */
export function distinctNames(
  staff: readonly { id: string; displayName: string; shortName?: string | null }[],
): Map<string, string> {
  const key = (name: string) => name.trim().toLocaleLowerCase("en");
  const count = new Map<string, number>();
  for (const person of staff) count.set(key(person.displayName), (count.get(key(person.displayName)) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const person of staff) {
    const short = (person.shortName ?? "").trim();
    const clash = (count.get(key(person.displayName)) ?? 0) > 1;
    names.set(
      person.id,
      clash && short && key(short) !== key(person.displayName) ? `${person.displayName} (${short})` : person.displayName,
    );
  }
  // Still the same after the short name (two "Asha (AS)"): number them, stably.
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const name of names.values()) total.set(key(name), (total.get(key(name)) ?? 0) + 1);
  for (const person of staff) {
    const name = names.get(person.id)!;
    if ((total.get(key(name)) ?? 0) < 2) continue;
    const n = (seen.get(key(name)) ?? 0) + 1;
    seen.set(key(name), n);
    names.set(person.id, `${name} ${n}`);
  }
  return names;
}
