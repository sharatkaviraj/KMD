import "server-only";

import { listStaff } from "@/modules/staff/data/staff-repo";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import {
  absencesOn,
  toAbsenceIndex,
} from "@/modules/substitutions/data/absences-repo";
import { listCoverPolicies } from "@/modules/substitutions/data/policies-repo";
import { recentCovers } from "@/modules/substitutions/data/plans-repo";
import {
  buildTeacherProfiles,
  type AbsenceIndex,
  type PolicyOverride,
  type TeacherProfiles,
} from "@/modules/substitutions/domain/engine";
import {
  coverHistoryFrom,
  teacherDetailsFrom,
  vacanciesFor,
  type PlanSlot,
  type VacancyWithIds,
} from "@/modules/substitutions/domain/plan";
import {
  isFullDay,
  splitByRole,
  type CoverPolicy,
  type TeacherAbsence,
} from "@/modules/substitutions/domain/policies";
import { addDays } from "@/platform/dates";

/**
 * Everything the engine needs for one day, assembled once.
 *
 * Both the planner screen and the generate action need exactly this, and the
 * two have to agree: a screen that ranked candidates against different inputs
 * from the ones the allocation used would offer a coordinator a name the
 * allocator had already ruled out. So it is built in one place and read twice.
 */

export type PlanningContext = {
  versionId: string;
  /** The day header this weekday matches in the published sheet. */
  header: string | null;
  days: string[];
  slots: PlanSlot[];
  absences: TeacherAbsence[];
  absenceIndex: AbsenceIndex;
  policies: CoverPolicy[];
  teacherProfiles: TeacherProfiles;
  coverHistory: Record<string, number>;
  vacancies: VacancyWithIds[];
  staff: { id: string; displayName: string; shortName: string; isTeaching: boolean }[];
};

/** How far back the history penalty looks. The engine caps it anyway. */
const HISTORY_DAYS = 30;

export async function buildPlanningContext(
  sessionLabel: string,
  day: string,
): Promise<PlanningContext | null> {
  const published = await getPublishedVersion(sessionLabel);
  if (!published) return null;

  const [slots, absences, policies, allStaff, history] = await Promise.all([
    listSlots(published.id) as Promise<PlanSlot[]>,
    absencesOn(sessionLabel, day),
    listCoverPolicies(sessionLabel),
    listStaff(),
    recentCovers(sessionLabel, addDays(day, -HISTORY_DAYS), addDays(day, -1)),
  ]);

  const days = [...new Set(slots.map((slot) => slot.day))];
  const header = matchDayHeader(days, day);
  const absenceIndex = toAbsenceIndex(absences);

  const policyOverrides: Record<string, PolicyOverride> = {};
  for (const policy of policies) {
    const override: PolicyOverride = { maxAutoSubstitutions: policy.maxAutoCovers };
    // A full-day window is no restriction, and an override with none is noise.
    if (!isFullDay(policy.allowedPeriods)) {
      override.availability = { allowedPeriodIndexes: policy.allowedPeriods };
    }
    policyOverrides[policy.staffProfileId] = override;
  }

  const { reserveStaff, dutyStaff } = splitByRole(policies);

  const staff = allStaff
    .filter((person) => person.isActive)
    .map((person) => ({
      id: person.id,
      displayName: person.displayName,
      shortName: person.shortName,
      isTeaching: person.isTeaching,
    }));

  // The roster is every active member of staff, not only the ones on the
  // timetable: office staff have no periods at all, which is exactly why they
  // have to be listed so a coordinator can pin one deliberately.
  const teacherProfiles = buildTeacherProfiles({
    teacherDetails: teacherDetailsFrom(slots, days),
    roster: staff.map((person) => person.id),
    policyOverrides,
    reserveStaff,
    dutyStaff,
  });

  return {
    versionId: published.id,
    header,
    days,
    slots,
    absences,
    absenceIndex,
    policies,
    teacherProfiles,
    coverHistory: coverHistoryFrom(history),
    vacancies: header ? vacanciesFor(slots, header, absenceIndex) : [],
    staff,
  };
}
