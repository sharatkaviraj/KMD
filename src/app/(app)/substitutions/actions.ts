"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { decodeMessage, t, type Localized } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { clearAbsence, markAbsent } from "@/modules/substitutions/data/absences-repo";
import { buildPlanningContext } from "@/modules/substitutions/data/planning-context";
import {
  clearCoverPolicy,
  upsertCoverPolicy,
} from "@/modules/substitutions/data/policies-repo";
import {
  ensurePlan,
  getPlan,
  planAssignments,
  publishPlan,
  removeAssignment,
  replaceGenerated,
  setAssignment,
  setPinned,
  unpublishPlan,
  type AssignmentWrite,
} from "@/modules/substitutions/data/plans-repo";
import {
  chooseMergeHost,
  generatePlan,
  type AssignmentLike,
  type GeneratedAssignment,
} from "@/modules/substitutions/domain/engine";
import { hostsInPeriod } from "@/modules/substitutions/domain/plan";
import {
  absenceSchema,
  coverPolicySchema,
} from "@/modules/substitutions/domain/policies";
import {
  idleSubsState,
  type SubsState,
} from "@/modules/substitutions/domain/form-state";

function failure(message: Localized): SubsState {
  return { status: "error", message };
}

function fieldErrorsFrom(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Localized {
  return decodeMessage(error.issues[0]?.message ?? "");
}

const isGenerated = (
  item: AssignmentLike | GeneratedAssignment,
): item is GeneratedAssignment => "source" in item;

function numbersFrom(formData: FormData, field: string): number[] {
  return formData
    .getAll(field)
    .map((value) => Number(value.toString()))
    .filter((value) => Number.isInteger(value));
}

/* ------------------------------------------------------------ absences */

export async function markAbsentAction(
  _previous: SubsState,
  formData: FormData,
): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = absenceSchema.safeParse({
    staffProfileId: (formData.get("staffProfileId") ?? "").toString(),
    day: (formData.get("day") ?? "").toString(),
    periods: numbersFrom(formData, "periods"),
    reason: (formData.get("reason") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await markAbsent(parsed.data, sessionLabel, actor.userId);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/substitutions");
  return { ...idleSubsState, status: "saved" };
}

export async function clearAbsenceAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await clearAbsence(id);
  revalidatePath("/substitutions");
}

/* ----------------------------------------------------- generating a plan */

/**
 * Work out the cover for a day.
 *
 * Everything the engine needs is assembled here and nowhere else: the
 * timetable it is planning against, who is away and for which periods, the
 * standing cover policies, and how often each teacher has covered lately.
 *
 * What is left over after the allocation is not a failure. A period nobody can
 * take is sent to the class next door when the grades are close enough, and
 * left as self study when they are not — both are decisions a school makes
 * every week, and a plan that reported them as errors would be a plan nobody
 * could act on.
 */
export async function generatePlanAction(
  _previous: SubsState,
  formData: FormData,
): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const day = (formData.get("day") ?? "").toString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return failure(m.notSaved);

  const context = await buildPlanningContext(sessionLabel, day);
  if (!context) return failure(m.subsNoTimetable);

  const { header, slots, absenceIndex, vacancies, teacherProfiles } = context;

  // No block for this weekday — a Sunday, or a sheet that never had one.
  if (!header) return failure(m.subsNoVacancies);

  const planId = await ensurePlan({
    sessionLabel,
    day,
    versionId: context.versionId,
    createdByUserId: actor.userId,
  });

  if (vacancies.length === 0) {
    // The plan row is still written, so the screen can say "nothing to do
    // today" rather than looking like nothing was tried.
    await replaceGenerated(planId, context.versionId, []);
    revalidatePath("/substitutions");
    return { ...idleSubsState, status: "saved", message: m.subsNoVacancies };
  }

  const existing = await planAssignments(planId);
  const pins = existing.filter((row) => row.pinned);

  const result = generatePlan({
    day: header,
    teacherProfiles,
    absenceIndex,
    coverHistory: context.coverHistory,
    vacancies: vacancies.map((vacancy) => ({
      slotId: vacancy.slotId,
      periodIndex: vacancy.periodIndex,
      className: vacancy.className,
      subject: vacancy.subject,
      originalTeacher: vacancy.originalTeacher,
    })),
    // Pinned rows are handed to the engine as work already done, so it never
    // double-books against a decision somebody already made.
    existingAssignments: pins
      .filter((pin) => pin.coveringStaffId)
      .map((pin) => ({
        slotId: `${pin.classId}|${pin.period}`,
        teacher: pin.coveringStaffId!,
        periodIndex: pin.period,
      })),
  });

  const byKey = new Map(vacancies.map((vacancy) => [vacancy.slotId, vacancy]));
  const rows: AssignmentWrite[] = [];
  const covered = new Map<string, string>();

  for (const item of [...result.assignments, ...result.reviewSuggestions]) {
    const vacancy = byKey.get(item.slotId ?? "");
    if (!vacancy) continue;
    // A pin came in as an existing assignment and is already in the table;
    // only what the engine generated carries a `source`.
    if (!isGenerated(item)) continue;

    rows.push({
      period: vacancy.periodIndex,
      classId: vacancy.classId,
      classLabel: vacancy.className,
      subjectCode: vacancy.subject,
      originalStaffId: vacancy.originalStaffId,
      coveringStaffId: item.teacher,
      kind: "cover",
      matchTier: item.matchTier,
      source: item.source,
      warnings: item.warnings,
    });

    covered.set(`${vacancy.classId}|${vacancy.periodIndex}`, item.teacher);
  }

  /* ------------------------------------- what nobody could be found for */

  for (const open of result.openSlots) {
    const vacancy = byKey.get(open.slotId);
    if (!vacancy) continue;

    const hosts = hostsInPeriod(
      slots,
      header,
      vacancy.periodIndex,
      absenceIndex,
      covered,
    ).filter((host) => host.classId !== vacancy.classId);

    const host = chooseMergeHost(vacancy.className, hosts);
    const hostEntry = host
      ? hosts.find((entry) => entry.className === host.className)
      : null;

    rows.push({
      period: vacancy.periodIndex,
      classId: vacancy.classId,
      classLabel: vacancy.className,
      subjectCode: vacancy.subject,
      originalStaffId: vacancy.originalStaffId,
      coveringStaffId: null,
      kind: hostEntry ? "merged" : "self_study",
      mergeHostClassId: hostEntry?.classId ?? null,
      mergeHostClassLabel: hostEntry?.className ?? null,
      source: "auto",
      warnings: [],
    });
  }

  try {
    await replaceGenerated(planId, context.versionId, rows);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/substitutions");
  revalidatePath("/teach");

  return {
    ...idleSubsState,
    status: "saved",
    message: t(
      `${rows.length} पीरियड की व्यवस्था बनी।`,
      `Worked out ${rows.length} period${rows.length === 1 ? "" : "s"}.`,
    ),
  };
}

/* ------------------------------------------------------ editing by hand */

/**
 * Change one row by hand.
 *
 * Anything a coordinator sets is pinned by construction: they decided it, so
 * working the cover out again must not quietly undo it.
 */
export async function setCoverAction(
  _previous: SubsState,
  formData: FormData,
): Promise<SubsState> {
  await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const day = (formData.get("day") ?? "").toString();
  const classId = (formData.get("classId") ?? "").toString();
  const classLabel = (formData.get("classLabel") ?? "").toString();
  const subjectCode = (formData.get("subjectCode") ?? "").toString() || null;
  const originalStaffId = (formData.get("originalStaffId") ?? "").toString() || null;
  const period = Number((formData.get("period") ?? "").toString());
  const choice = (formData.get("choice") ?? "").toString();

  if (!classId || !Number.isInteger(period)) return failure(m.notSaved);

  const plan = await getPlan(sessionLabel, day);
  if (!plan) return failure(m.notSaved);

  const base = {
    period,
    classId,
    classLabel,
    subjectCode,
    originalStaffId,
    source: "manual" as const,
    pinned: true,
  };

  let row: AssignmentWrite;

  if (choice === "self_study") {
    row = { ...base, coveringStaffId: null, kind: "self_study" };
  } else if (choice.startsWith("merge:")) {
    const [, hostId, ...label] = choice.split(":");
    row = {
      ...base,
      coveringStaffId: null,
      kind: "merged",
      mergeHostClassId: hostId,
      mergeHostClassLabel: label.join(":"),
    };
  } else {
    row = { ...base, coveringStaffId: choice, kind: "cover" };
  }

  try {
    await setAssignment(plan.id, row);
  } catch {
    // The unique index refuses a teacher already covering another class this
    // period. That is the engine's "no double booking" rule, held by the
    // database for the one path the engine does not see.
    return failure(
      t(
        "यह अध्यापक इसी पीरियड में कहीं और है।",
        "That teacher is already covering another class this period.",
      ),
    );
  }

  revalidatePath("/substitutions");
  revalidatePath("/teach");
  return { ...idleSubsState, status: "saved" };
}

export async function togglePinAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await setPinned(id, formData.get("pinned") === "true");
  revalidatePath("/substitutions");
}

export async function removeCoverAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const id = (formData.get("id") ?? "").toString();
  if (!id) return;

  await removeAssignment(id);
  revalidatePath("/substitutions");
  revalidatePath("/teach");
}

/* ---------------------------------------------------------- publishing */

export async function publishPlanAction(formData: FormData) {
  const actor = await assertPermission("substitutions:manage");

  const planId = (formData.get("planId") ?? "").toString();
  if (!planId) return;

  await publishPlan(planId, actor.id);

  // The covering teachers read it from their own Today card, which is the
  // whole point: a cover nobody was told about is a class nobody turns up to.
  revalidatePath("/substitutions");
  revalidatePath("/teach");
}

export async function unpublishPlanAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const planId = (formData.get("planId") ?? "").toString();
  if (!planId) return;

  await unpublishPlan(planId);
  revalidatePath("/substitutions");
  revalidatePath("/teach");
}

/* ------------------------------------------------------------ policies */

export async function saveCoverPolicyAction(
  _previous: SubsState,
  formData: FormData,
): Promise<SubsState> {
  const actor = await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const parsed = coverPolicySchema.safeParse({
    staffProfileId: (formData.get("staffProfileId") ?? "").toString(),
    allowedPeriods: numbersFrom(formData, "allowedPeriods"),
    coverRole: (formData.get("coverRole") ?? "normal").toString(),
    maxAutoCovers: (formData.get("maxAutoCovers") ?? "2").toString(),
    note: (formData.get("note") ?? "").toString(),
  });

  if (!parsed.success) return failure(fieldErrorsFrom(parsed.error));

  try {
    await upsertCoverPolicy(parsed.data, sessionLabel, actor.userId);
  } catch {
    return failure(m.notSaved);
  }

  revalidatePath("/substitutions/policies");
  return { ...idleSubsState, status: "saved" };
}

export async function clearCoverPolicyAction(formData: FormData) {
  await assertPermission("substitutions:manage");

  const sessionLabel = await resolveSessionLabel();
  const staffProfileId = (formData.get("staffProfileId") ?? "").toString();
  if (!sessionLabel || !staffProfileId) return;

  await clearCoverPolicy(staffProfileId, sessionLabel);
  revalidatePath("/substitutions/policies");
}
