import { describe, expect, it } from "vitest";

import {
  familyHousehold,
  linkedTogether,
  predictFamilyChange,
  sameHousehold,
  unlinkAlreadyLanded,
  type FamilyChangeHousehold,
  type FamilyChangeStudent,
} from "@/modules/students-fees/vx/domain/family-change";
import {
  familyCommandResultSchema,
  familyLinkRequestSchema,
  familyPreviewRequestSchema,
  familyPreviewSchema,
  familyUnlinkRequestSchema,
} from "@/platform/fees-bridge/family-command-contracts";
import { familyLabel, thirdChildNotes } from "@/vx/screens/families/logic";

/*
 * Linking brothers and sisters from One (8 Nov 2026): the preview's rule, the
 * household a change locks, and the request shapes Fees accepts. Ported with
 * the Fees tests of the same rule (schoolfees tests/unit/one-bridge-family-commands.test.ts).
 * Synthetic ids and TEST names only.
 */
const id = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const [a, b, c, d] = [id(1), id(2), id(3), id(4)];
const group = "eeeeeeee-0000-4000-8000-000000000001";
const other = "eeeeeeee-0000-4000-8000-000000000002";
const session = "TEST-2026-27";
const commandId = "33333333-3333-4333-8333-333333333333";

const student = (sid: string, sort: number, over: Partial<FamilyChangeStudent> = {}): FamilyChangeStudent => ({
  id: sid,
  fullName: `TEST Child ${sid.slice(7, 8)}`,
  admissionNo: `TEST-${sid.slice(7, 8)}`,
  status: "active",
  classId: `class-${sort}`,
  classSessionLabel: session,
  classSortOrder: sort,
  classLabel: `Class ${sort}`,
  hasPhoto: false,
  ...over,
});
const students = [student(a, 5), student(b, 2), student(c, 8), student(d, 1, { classSessionLabel: "TEST-2025-26", classId: "old" })];
const policy = { calculationType: "tuition_fixed_amount" as const, fixedTuitionAmount: 6000, percentage: null };
const base = new Map([["class-2", 18000], ["class-5", 20000], ["class-8", 24000]]);
const household = (over: Partial<FamilyChangeHousehold>): FamilyChangeHousehold => ({
  sessionLabel: session, operation: "link", studentIds: [a, c], familyGroupId: null, expectedMemberIds: [a, b, c], memberGroups: [], ...over,
});
const run = (h: FamilyChangeHousehold, extra: { staff?: string[]; now?: Array<[string, boolean]>; policyOn?: boolean; outranks?: boolean } = {}) =>
  predictFamilyChange({
    household: h,
    students,
    money: new Map([[a, { yearFees: 20000, feesPending: 5000, lateFeePending: 1000 }]]),
    baseTuitionByClass: base,
    thirdChildPolicy: extra.policyOn === false ? null : policy,
    staffChildIds: new Set(extra.staff ?? []),
    thirdChildNow: new Map((extra.now ?? []).map(([sid, manual]) => [sid, { manual }])),
    staffChildOutranks: extra.outranks ?? true,
  });

describe("what the preview says will happen", () => {
  it("a third child joining: the youngest class gets the 3rd Child Policy at its tuition", () => {
    const p = run(household({ memberGroups: [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: group }] }));
    expect(p.after).toEqual({ family: [a, b, c], alone: [] });
    expect(p.familiesNow).toBe(1);
    expect(p.thirdChild).toEqual({ policyConfigured: true, eligibleCount: 3, recipientAfter: b, outrankedByStaffChildStudentId: null, recipientTuition: 6000, gains: [b], loses: [] });
    expect(p.children.find((x) => x.studentId === a)).toMatchObject({ familyGroupId: group, baseTuition: 20000, money: { yearFees: 20000, feesPending: 5000, lateFeePending: 1000 } });
    expect(p.children.find((x) => x.studentId === c)?.money).toBeNull();
    expect(familyPreviewSchema.parse(p)).toEqual(p);
  });

  it("a brother or sister from another year counts for nothing this year and is listed last", () => {
    const p = run(household({ studentIds: [a, d], expectedMemberIds: [a, b, d], memberGroups: [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: group }] }));
    expect(p.thirdChild.eligibleCount).toBe(2);
    expect(p.thirdChild.recipientAfter).toBeNull();
    expect(p.children.at(-1)).toMatchObject({ studentId: d, inThisYear: false, baseTuition: null });
  });

  it("a staff child in the youngest class keeps Staff Child where Fees' rule runs", () => {
    const p = run(household({}), { staff: [b], now: [[c, false]] });
    expect(p.thirdChild).toMatchObject({ recipientAfter: null, outrankedByStaffChildStudentId: b, gains: [], loses: [c] });
  });

  it("One's own copy, whose engine has no Staff Child rule yet, predicts the 3rd Child Policy for them", () => {
    const p = run(household({}), { staff: [b], outranks: false });
    expect(p.thirdChild).toMatchObject({ recipientAfter: b, outrankedByStaffChildStudentId: null, gains: [b] });
    expect(p.children.find((x) => x.studentId === b)?.staffChild).toBe(true);
  });

  it("the discount moves when a younger child joins, a hand-set one included", () => {
    const p = run(household({}), { now: [[a, true]] });
    expect(p.thirdChild).toMatchObject({ recipientAfter: b, gains: [b], loses: [a] });
  });

  it("an unlink that leaves three keeps the family and takes the automatic discount off the child who leaves", () => {
    const four = [a, b, c, "00000009-0000-4000-8000-000000000009"].map((studentId) => ({ studentId, familyGroupId: group }));
    const p = run(household({ operation: "unlink", studentIds: [b], familyGroupId: group, expectedMemberIds: four.map((m) => m.studentId), memberGroups: four }), { now: [[b, false]] });
    expect(p.after.alone).toEqual([b]);
    expect(p.after.family).toHaveLength(3);
    expect(p.thirdChild.loses).toEqual([b]);
  });

  it("an unlink that leaves one child ends the family; a hand-set discount is left alone", () => {
    const two = [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: group }];
    const p = run(household({ operation: "unlink", studentIds: [a], familyGroupId: group, expectedMemberIds: [a, b], memberGroups: two }), { now: [[a, true], [b, false]] });
    expect(p.after).toEqual({ family: [], alone: [a, b] });
    expect(p.thirdChild).toMatchObject({ recipientAfter: null, eligibleCount: 0, loses: [b] });
  });

  it("without a 3rd Child Policy this year, nothing changes for anyone in a family", () => {
    const p = run(household({}), { policyOn: false, now: [[a, false]] });
    expect(p.thirdChild).toMatchObject({ policyConfigured: false, recipientAfter: null, gains: [], loses: [] });
  });
});

describe("the household a change locks", () => {
  const rows = [
    { studentId: a, familyGroupId: group },
    { studentId: b, familyGroupId: group },
    { studentId: b, familyGroupId: group },
    { studentId: c, familyGroupId: other },
    { studentId: d, familyGroupId: other },
  ];
  it("a link takes every named child and everyone in their families, once, sorted", () => {
    const h = familyHousehold({ operation: "link", studentIds: [c, a], familyGroupId: null, rows });
    expect(h.expectedMemberIds).toEqual([a, b, c, d]);
    expect(h.memberGroups).toHaveLength(4);
  });
  it("a link of children in no family is just those children", () => {
    expect(familyHousehold({ operation: "link", studentIds: [c, a], familyGroupId: null, rows: [] }).expectedMemberIds).toEqual([a, c]);
  });
  it("an unlink takes the family's members only", () => {
    expect(familyHousehold({ operation: "unlink", studentIds: [a], familyGroupId: group, rows }).expectedMemberIds).toEqual([a, b]);
  });
  it("compares households whatever the order or case", () => {
    expect(sameHousehold([b, a.toUpperCase()], [a, b, b])).toBe(true);
    expect(sameHousehold([a, b], [a, b, c])).toBe(false);
  });
});

/*
 * 8 Nov 2026: a TEST link of three made the family, then its 3rd Child step
 * failed and the sheet said "Nothing was changed". After a step stops
 * part-way the table decides what the sheet says.
 */
describe("what landed when the engine stopped part-way", () => {
  it("a link landed when every named child is in one family", () => {
    const rows = [
      { studentId: a, familyGroupId: group },
      { studentId: b, familyGroupId: group },
      { studentId: c.toUpperCase(), familyGroupId: group },
    ];
    expect(linkedTogether([a, b, c], rows)).toBe(group);
  });
  it("a link did not land when a child is missing or in another family", () => {
    expect(linkedTogether([a, b, c], [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: group }])).toBeNull();
    expect(linkedTogether([a, b], [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: other }])).toBeNull();
    expect(linkedTogether([a, b], [])).toBeNull();
  });
  it("Finish on a take-out runs again only when the child is out and nobody else moved", () => {
    expect(unlinkAlreadyLanded([b, c], a, [a, b, c])).toBe(true);
    expect(unlinkAlreadyLanded([b], a, [a, b])).toBe(true);
    expect(unlinkAlreadyLanded([a, b], a, [a, b])).toBe(false);
    expect(unlinkAlreadyLanded([b, d], a, [a, b, c])).toBe(false);
    expect(unlinkAlreadyLanded([b], a, [b, c])).toBe(false);
  });
});

describe("a family's name on screen", () => {
  it("never shows the engine's generated label", () => {
    expect(familyLabel("Family 9876543210 7fc74467")).toBeNull();
    expect(familyLabel("Family — 7fc74467")).toBeNull();
    expect(familyLabel("  ")).toBeNull();
  });
  it("keeps a name a person gave", () => {
    expect(familyLabel(" Sharma family ")).toBe("Sharma family");
    expect(familyLabel("Family of TEST Ramesh")).toBe("Family of TEST Ramesh");
  });
});

describe("what the sheet says about the 3rd Child Policy", () => {
  it("names who gets it, at what tuition, and who loses it", () => {
    const p = run(household({}), { now: [[a, true]] });
    expect(thirdChildNotes(p)).toEqual([
      { kind: "gets", studentId: b, tuition: 6000, base: 18000 },
      { kind: "loses", studentId: a },
    ]);
  });
  it("says who keeps it, when nothing moves", () => {
    expect(thirdChildNotes(run(household({}), { now: [[b, false]] }))).toEqual([{ kind: "keeps", studentId: b }]);
  });
  it("says a family of two does not get it", () => {
    const p = run(household({ studentIds: [a, d], expectedMemberIds: [a, d] }));
    expect(thirdChildNotes(p)).toEqual([{ kind: "needThree", count: 1 }]);
  });
  it("says when no policy is set, and when a Staff Child keeps Staff Child", () => {
    expect(thirdChildNotes(run(household({}), { policyOn: false }))).toEqual([{ kind: "off" }]);
    expect(thirdChildNotes(run(household({}), { staff: [b] }))).toEqual([{ kind: "staff", studentId: b }]);
  });
  it("says nothing changes when a family ends and nobody held it", () => {
    const two = [{ studentId: a, familyGroupId: group }, { studentId: b, familyGroupId: group }];
    const p = run(household({ operation: "unlink", studentIds: [a], familyGroupId: group, expectedMemberIds: [a, b], memberGroups: two }));
    expect(thirdChildNotes(p)).toEqual([{ kind: "same" }]);
  });
});

describe("the shapes Fees accepts", () => {
  it("sorts and de-duplicates ids so a retry is identical", () => {
    const first = familyLinkRequestSchema.parse({ commandId, sessionLabel: "2026-27", studentIds: [b, a, b], expectedMemberIds: [c, a, b] });
    expect(first).toEqual({ commandId, sessionLabel: "2026-27", studentIds: [a, b], expectedMemberIds: [a, b, c] });
  });
  it("refuses a link of one child, an unknown field and an unlink without its family", () => {
    expect(familyLinkRequestSchema.safeParse({ commandId, sessionLabel: "2026-27", studentIds: [a, a], expectedMemberIds: [a, b] }).success).toBe(false);
    expect(familyLinkRequestSchema.safeParse({ commandId, sessionLabel: "2026-27", studentIds: [a, b], expectedMemberIds: [a, b], note: "x" }).success).toBe(false);
    expect(familyUnlinkRequestSchema.safeParse({ commandId, sessionLabel: "2026-27", studentId: a, expectedMemberIds: [a, b] }).success).toBe(false);
    expect(familyPreviewRequestSchema.safeParse({ sessionLabel: "2026-27", operation: "link", studentIds: [a] }).success).toBe(false);
    expect(familyPreviewRequestSchema.parse({ sessionLabel: "2026-27", operation: "unlink", studentId: a, familyGroupId: group })).toMatchObject({ operation: "unlink" });
  });
  it("reads a saved answer, including one whose after-steps still need finishing", () => {
    const answer = {
      commandId, kind: "family_unlink", status: "completed", sessionLabel: "2026-27", studentIds: [a], familyGroupId: null,
      memberStudentIds: [], remainingStudentIds: [b], createdNewGroup: false, mergedGroupCount: 0, changedBy: "TEST Admin",
      completedAt: "2026-11-08T18:00:00.000Z", after: { settled: false, thirdChild: null, dues: null },
    };
    expect(familyCommandResultSchema.parse(answer).after.settled).toBe(false);
    expect(familyCommandResultSchema.safeParse({ ...answer, status: "pending" }).success).toBe(false);
  });
});
