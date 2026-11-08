import {
  calculateConventionalPolicyTuition,
  selectThirdChildPolicyRecipient,
  type ThirdChildPolicyFamilyMember,
} from "@/modules/fees/domain/conventional-discount-rules";
import type { ConventionalDiscountPolicy } from "@/modules/fees/domain/types";
import type { FamilyPreview, FamilyPreviewChild } from "@/platform/fees-bridge/family-command-contracts";

/*
 * What linking or unlinking brothers and sisters will do (8 Nov 2026), by the
 * rules that run after the save. Ported from schoolfees
 * src/modules/one-bridge/domain/family-commands.ts (`predictFamilyChange`),
 * which answers One's real-year preview; this copy answers the TEST year from
 * One's own fee copy, in the same shape. One change, and why: One's ported
 * `applyThirdChildPolicyForFamilyGroup` predates the Fees rule that a Staff
 * Child outranks the 3rd Child Policy, so `staffChildOutranks` says which
 * engine is being predicted. Pure; tested in tests/vx-family-change.test.ts.
 *
 * - The family that remains: every 3rd Child row of its members is switched
 *   off except the recipient's, hand-set ones included.
 * - A child left in no family: only automatic 3rd Child rows come off.
 */

export type FamilyChangeHousehold = {
  sessionLabel: string;
  operation: "link" | "unlink";
  studentIds: string[];
  familyGroupId: string | null;
  /** Everyone the change touches: the named children and every member of their families. */
  expectedMemberIds: string[];
  memberGroups: ReadonlyArray<{ studentId: string; familyGroupId: string }>;
};

export type FamilyChangeStudent = {
  id: string;
  fullName: string;
  admissionNo: string;
  status: string;
  classId: string | null;
  classSessionLabel: string | null;
  classSortOrder: number | null;
  classLabel: string | null;
  hasPhoto: boolean;
};

export type FamilyChangeMoney = { yearFees: number; feesPending: number; lateFeePending: number };
export type FamilyChangePolicy = Pick<ConventionalDiscountPolicy, "calculationType" | "fixedTuitionAmount" | "percentage">;

export function predictFamilyChange(input: {
  household: FamilyChangeHousehold;
  students: ReadonlyArray<FamilyChangeStudent>;
  money: ReadonlyMap<string, FamilyChangeMoney>;
  baseTuitionByClass: ReadonlyMap<string, number>;
  thirdChildPolicy: FamilyChangePolicy | null;
  staffChildIds: ReadonlySet<string>;
  /** Active 3rd Child rows this year, and whether each was set by hand. */
  thirdChildNow: ReadonlyMap<string, { manual: boolean }>;
  staffChildOutranks: boolean;
  /** The lowest tuition each child's other discounts (RTE, Staff Child, …) give this year; absent for none. */
  otherDiscountTuition?: ReadonlyMap<string, number>;
}): FamilyPreview {
  const source = input.household;
  const session = source.sessionLabel;
  const byId = new Map(input.students.map((s) => [s.id, s]));
  const groupOf = new Map<string, string>();
  for (const row of source.memberGroups) if (!groupOf.has(row.studentId)) groupOf.set(row.studentId, row.familyGroupId);
  const household = [...new Set(source.expectedMemberIds)].sort();

  let family: string[];
  let alone: string[];
  if (source.operation === "link") {
    family = household;
    alone = [];
  } else {
    const leaving = source.studentIds[0];
    const remaining = [
      ...new Set(source.memberGroups.filter((m) => m.familyGroupId === source.familyGroupId && m.studentId !== leaving).map((m) => m.studentId)),
    ].sort();
    family = remaining.length >= 2 ? remaining : [];
    alone = remaining.length >= 2 ? [leaving] : [leaving, ...remaining];
  }

  const enrolled = (id: string) => {
    const s = byId.get(id);
    return Boolean(s && s.status === "active" && s.classSessionLabel === session);
  };
  const candidates: ThirdChildPolicyFamilyMember[] = family.filter(enrolled).map((id) => {
    const s = byId.get(id)!;
    return { studentId: id, classSortOrder: s.classSortOrder, classLabel: s.classLabel, admissionNo: s.admissionNo };
  });
  const policyConfigured = Boolean(input.thirdChildPolicy);
  const recipient = policyConfigured ? selectThirdChildPolicyRecipient(candidates) : null;
  const outranked = input.staffChildOutranks && recipient && input.staffChildIds.has(recipient.studentId) ? recipient.studentId : null;
  const recipientAfter = outranked ? null : (recipient?.studentId ?? null);

  const gains = recipientAfter && !input.thirdChildNow.has(recipientAfter) ? [recipientAfter] : [];
  const loses: string[] = [];
  if (policyConfigured) {
    for (const id of family) if (id !== recipientAfter && input.thirdChildNow.has(id)) loses.push(id);
  }
  // Taking automatic rows off a child left alone happens whether or not the policy is active.
  for (const id of alone) if (input.thirdChildNow.get(id)?.manual === false) loses.push(id);

  const recipientClass = recipientAfter ? (byId.get(recipientAfter)?.classId ?? null) : null;
  const recipientBase = recipientClass ? input.baseTuitionByClass.get(recipientClass) : undefined;
  const recipientTuition =
    recipientAfter && input.thirdChildPolicy && recipientBase !== undefined
      ? calculateConventionalPolicyTuition({ baseTuition: recipientBase, policy: input.thirdChildPolicy })
      : null;

  // Lowest tuition wins, so the 3rd Child Policy moves fees only when it is lower
  // than what another discount already gives (an RTE child pays ₹0 either way).
  const changesFees = (base: number | null, id: string): boolean | undefined => {
    if (!input.thirdChildPolicy || base === null) return undefined;
    const other = input.otherDiscountTuition?.get(id);
    return other === undefined || calculateConventionalPolicyTuition({ baseTuition: base, policy: input.thirdChildPolicy }) < other;
  };

  const children: FamilyPreviewChild[] = household.map((id) => {
    const s = byId.get(id);
    const classId = s?.classId ?? null;
    const baseTuition = classId && input.baseTuitionByClass.has(classId) ? input.baseTuitionByClass.get(classId)! : null;
    const moves = changesFees(baseTuition, id);
    return {
      studentId: id,
      fullName: s?.fullName ?? "",
      admissionNo: s?.admissionNo ?? "",
      classLabel: s?.classLabel ?? "",
      status: s?.status ?? "active",
      inThisYear: Boolean(s && s.classSessionLabel === session),
      hasPhoto: Boolean(s?.hasPhoto),
      familyGroupId: groupOf.get(id) ?? null,
      staffChild: input.staffChildIds.has(id),
      thirdChildNow: input.thirdChildNow.has(id),
      baseTuition,
      ...(moves === undefined ? {} : { thirdChildChangesFees: moves }),
      money: input.money.get(id) ?? null,
    };
  });
  children.sort((a, b) => Number(b.inThisYear) - Number(a.inThisYear) || a.fullName.localeCompare(b.fullName) || a.studentId.localeCompare(b.studentId));

  return {
    sessionLabel: session,
    operation: source.operation,
    studentIds: source.studentIds,
    familyGroupId: source.familyGroupId,
    expectedMemberIds: household,
    familiesNow: new Set(household.map((id) => groupOf.get(id)).filter(Boolean)).size,
    children,
    after: { family, alone },
    thirdChild: {
      policyConfigured,
      eligibleCount: candidates.length,
      recipientAfter,
      outrankedByStaffChildStudentId: outranked,
      recipientTuition,
      gains,
      loses: [...new Set(loses)].sort(),
    },
  };
}

/**
 * The household a change touches, from membership rows: for a link, every
 * named child and every member of any family they are in; for an unlink,
 * the family's members. Sorted, so it compares with what the preview showed.
 */
export function familyHousehold(input: {
  operation: "link" | "unlink";
  studentIds: readonly string[];
  familyGroupId: string | null;
  rows: ReadonlyArray<{ studentId: string; familyGroupId: string }>;
}): { expectedMemberIds: string[]; memberGroups: Array<{ studentId: string; familyGroupId: string }> } {
  const named = new Set(input.studentIds);
  const groups =
    input.operation === "unlink"
      ? new Set(input.familyGroupId ? [input.familyGroupId] : [])
      : new Set(input.rows.filter((r) => named.has(r.studentId)).map((r) => r.familyGroupId));
  const seen = new Set<string>();
  const memberGroups: Array<{ studentId: string; familyGroupId: string }> = [];
  for (const r of input.rows) {
    if (!groups.has(r.familyGroupId)) continue;
    const key = `${r.studentId}:${r.familyGroupId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    memberGroups.push({ studentId: r.studentId, familyGroupId: r.familyGroupId });
  }
  const ids = new Set<string>(input.operation === "link" ? input.studentIds : []);
  for (const m of memberGroups) ids.add(m.studentId);
  return { expectedMemberIds: [...ids].sort(), memberGroups };
}

/** The same household, whatever order or case the ids came in. */
export function sameHousehold(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a.map((id) => id.toLowerCase()))].sort();
  const right = [...new Set(b.map((id) => id.toLowerCase()))].sort();
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/**
 * The family every named child is now in, or null when they are not all in
 * one. Read after the ported engine stopped part-way: if the children are
 * already one family the screen must say "saved", never "nothing changed".
 */
export function linkedTogether(studentIds: readonly string[], rows: ReadonlyArray<{ studentId: string; familyGroupId: string }>): string | null {
  const named = new Set(studentIds.map((id) => id.toLowerCase()));
  const groups = new Set<string>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!named.has(r.studentId.toLowerCase())) continue;
    groups.add(r.familyGroupId);
    seen.add(r.studentId.toLowerCase());
  }
  return seen.size === named.size && groups.size === 1 ? [...groups][0] : null;
}

/**
 * "Finish" after a take-out that stopped part-way: the child is already out
 * and everyone still in the family was in the one the preview showed. Then
 * the follow-up steps run again; anything else is a family that changed.
 */
export function unlinkAlreadyLanded(members: readonly string[], studentId: string, expectedMemberIds: readonly string[]): boolean {
  const expected = new Set(expectedMemberIds.map((id) => id.toLowerCase()));
  const child = studentId.toLowerCase();
  return expected.has(child) && !members.some((id) => id.toLowerCase() === child) && members.every((id) => expected.has(id.toLowerCase()));
}

/** Why One's own copy refused a change. The screen words each one. */
export type FamilyChangeRefusal = "not_found" | "family_changed" | "failed";

export class FamilyChangeRefused extends Error {
  constructor(readonly code: FamilyChangeRefusal, message: string = code) {
    super(message);
    this.name = "FamilyChangeRefused";
  }
}
