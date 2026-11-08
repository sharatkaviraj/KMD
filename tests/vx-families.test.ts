import { describe, expect, it } from "vitest";

import { buildFamilyBook, type FamilyMoneyRow, type FamilyStudentRow } from "@/modules/students-fees/vx/domain/family-book";
import type { BridgeFamilyChild, BridgeFamilyGroup } from "@/platform/fees-bridge/screen-read-contracts";
import {
  collectChild,
  devanagariToLatin,
  familyCounts,
  familyScore,
  inFilter,
  maskedPhone,
  mobile,
  searchFamilies,
  toFamilyCard,
  toFamilyCards,
} from "@/vx/screens/families/logic";

/*
 * Families (owner, 8 Nov 2026): the list and the family page draw what Fees
 * sends, or One's TEST copy in the same shape. Test names only.
 */

const money = (over: Partial<NonNullable<BridgeFamilyChild["money"]>> = {}): NonNullable<BridgeFamilyChild["money"]> => ({
  yearFees: 20000, paid: 5000, feesPending: 15000, lateFeePending: 0, discount: 0, discountLabels: [],
  nextDueDate: "2027-01-20", nextDueAmount: 5000, overdue: false, ...over,
});

const child = (id: string, over: Partial<BridgeFamilyChild> = {}): BridgeFamilyChild => ({
  studentId: id, fullName: `Test Child ${id}`, admissionNo: `TEST-${id}`, classLabel: "Class 5 A", status: "active",
  fatherName: "Test Father", motherName: "Test Mother", fatherPhone: "9000000001", motherPhone: null,
  villageCity: "Testpur", hasPhoto: false, siblingOrder: null, thirdChildCandidate: false, money: money(), ...over,
});

const group = (id: string, children: BridgeFamilyChild[], over: Partial<BridgeFamilyGroup> = {}): BridgeFamilyGroup => ({
  groupId: id, label: "", guardianName: null, guardianPhone: null, children, ...over,
});

describe("a family card", () => {
  it("adds the children's fees, keeps the late fee apart and names the family", () => {
    const f = toFamilyCard(group("g1", [child("1", { money: money({ lateFeePending: 1000 }) }), child("2", { money: money({ feesPending: 0, paid: 20000 }) })]));
    expect(f.name).toBe("Test Father");
    expect(f.feesPending).toBe(15000);
    expect(f.lateFee).toBe(1000);
    expect(f.paid).toBe(25000);
    expect(f.yearFees).toBe(40000);
    expect(f.phone).toBe("9000000001");
    expect(f.village).toBe("Testpur");
  });

  it("prefers the family's own label and guardian phone", () => {
    const f = toFamilyCard(group("g1", [child("1")], { label: "Test Family", guardianPhone: "9111111111" }));
    expect(f.name).toBe("Test Family");
    expect(f.phone).toBe("9111111111");
  });

  it("says 'not read' for the whole family when one child's money is missing, never a smaller total", () => {
    const f = toFamilyCard(group("g1", [child("1"), child("2", { money: null })]));
    expect(f.feesPending).toBeNull();
    expect(f.paid).toBeNull();
    expect(inFilter(f, "owing")).toBe(false);
    expect(inFilter(f, "paid")).toBe(false);
  });

  it("calls a family whose only debt is a late fee 'fees paid'", () => {
    const f = toFamilyCard(group("g1", [child("1", { money: money({ feesPending: 0, lateFeePending: 1000 }) })]));
    expect(inFilter(f, "paid")).toBe(true);
    expect(inFilter(f, "late")).toBe(true);
    expect(inFilter(f, "owing")).toBe(false);
  });

  it("marks a family where every child has left", () => {
    expect(toFamilyCard(group("g1", [child("1", { status: "left" }), child("2", { status: "inactive" })])).allLeft).toBe(true);
    expect(toFamilyCard(group("g1", [child("1", { status: "left" }), child("2")])).allLeft).toBe(false);
  });

  it("drops a family with nobody in it", () => {
    expect(toFamilyCards([group("g1", []), group("g2", [child("1")])]).map((f) => f.id)).toEqual(["g2"]);
  });
});

describe("the counts above the list", () => {
  it("counts each filter and leaves unread families out of the money", () => {
    const cards = toFamilyCards([
      group("a", [child("1"), child("2"), child("3")]),
      group("b", [child("4", { money: money({ feesPending: 0, lateFeePending: 1000 }) })]),
      group("c", [child("5", { money: null })]),
    ]);
    const c = familyCounts(cards);
    expect(c).toMatchObject({ all: 3, owing: 1, late: 1, three: 1, paid: 1, children: 5, feesPending: 45000, lateFee: 1000, unread: 1 });
  });
});

describe("finding a family", () => {
  const cards = toFamilyCards([
    group("a", [child("1", { fullName: "Aarav Testwala", admissionNo: "TEST-101", fatherName: "Mahesh Testwala", fatherPhone: "9812345678" })]),
    group("b", [child("2", { fullName: "Diya Sampleton", admissionNo: "TEST-202", fatherName: "Ramesh Sampleton", fatherPhone: "9898989898", villageCity: "Kheda" })]),
  ]);

  it("finds by a child's name, the father, a phone and an SR", () => {
    expect(searchFamilies(cards, "aarav", "all", "name").map((f) => f.id)).toEqual(["a"]);
    expect(searchFamilies(cards, "ramesh", "all", "name").map((f) => f.id)).toEqual(["b"]);
    expect(searchFamilies(cards, "981234", "all", "name").map((f) => f.id)).toEqual(["a"]);
    expect(searchFamilies(cards, "98989 89898", "all", "name").map((f) => f.id)).toEqual(["b"]);
    expect(searchFamilies(cards, "TEST-202", "all", "name").map((f) => f.id)).toEqual(["b"]);
  });

  it("falls back to the village", () => {
    expect(familyScore(cards[1], "kheda")).not.toBeNull();
  });

  it("finds a Latin name typed in Hindi", () => {
    expect(devanagariToLatin("आरव")).toBe("aarav");
    expect(searchFamilies(cards, "आरव", "all", "name").map((f) => f.id)).toEqual(["a"]);
    expect(searchFamilies(cards, "दिया", "all", "name").map((f) => f.id)).toEqual(["b"]);
  });

  it("sorts by most fees left when asked", () => {
    const sorted = toFamilyCards([
      group("small", [child("1", { fullName: "A Test", money: money({ feesPending: 100 }) })]),
      group("big", [child("2", { fullName: "B Test", money: money({ feesPending: 9000 }) })]),
    ]);
    expect(searchFamilies(sorted, "", "all", "owing").map((f) => f.id)).toEqual(["big", "small"]);
    expect(searchFamilies(sorted, "", "all", "name").map((f) => f.id)).toEqual(["small", "big"]);
  });

  it("matches nothing for nonsense", () => {
    expect(searchFamilies(cards, "zzqx", "all", "name")).toEqual([]);
  });
});

describe("phones and the Collect fee button", () => {
  it("accepts only a ten-digit Indian mobile for call links", () => {
    expect(mobile("+91 98123 45678")).toBe("9812345678");
    expect(mobile("0123456789")).toBeNull();
    expect(mobile(null)).toBeNull();
    expect(maskedPhone("9812345678")).toBe("98123 ••678");
  });

  it("opens the first child with fees left, else the first on the roll", () => {
    const owing = toFamilyCard(group("g", [child("1", { money: money({ feesPending: 0 }) }), child("2")]));
    expect(collectChild(owing)).toBe("2");
    const paid = toFamilyCard(group("g", [child("1", { status: "left", money: money({ feesPending: 0 }) }), child("2", { money: money({ feesPending: 0 }) })]));
    expect(collectChild(paid)).toBe("2");
  });
});

describe("One's TEST copy in the shape Fees sends", () => {
  const student = (id: string, over: Partial<FamilyStudentRow> = {}): FamilyStudentRow => ({
    id, full_name: `Test ${id}`, admission_no: `TEST-${id}`, status: "active", father_name: " Test Father ", mother_name: null,
    primary_phone: "9000000001", secondary_phone: "", village_city: null, photo_path: null, classLabel: "Class 2 A", ...over,
  });
  const row = (studentId: string, over: Partial<FamilyMoneyRow> = {}): FamilyMoneyRow => ({
    studentId, baseChargeTotal: 12000.4, totalPaid: 2000, outstandingAmount: 10000, lateFeeOutstandingAmount: 1000,
    discountAmount: 0, conventionalDiscountLabels: "Staff Child, ", nextDueDate: "2027-01-20", nextDueAmount: 3000, statusLabel: "OVERDUE", ...over,
  });

  it("leaves out members not in the year, drops empty families, orders siblings, and never invents money", () => {
    const book = buildFamilyBook({
      groups: [
        { id: "g1", family_label: null, guardian_name: null, guardian_phone: null },
        { id: "g2", family_label: "Empty", guardian_name: null, guardian_phone: null },
      ],
      members: [
        { family_group_id: "g1", student_id: "b", sibling_order: 2, is_policy_candidate: true },
        { family_group_id: "g1", student_id: "a", sibling_order: 1, is_policy_candidate: null },
        { family_group_id: "g1", student_id: "gone", sibling_order: 3, is_policy_candidate: false },
        { family_group_id: "g2", student_id: "gone2", sibling_order: 1, is_policy_candidate: false },
      ],
      students: [student("a", { photo_path: "x.jpg" }), student("b")],
      money: [row("a")],
    });
    expect(book).toHaveLength(1);
    expect(book[0].children.map((c) => c.studentId)).toEqual(["a", "b"]);
    const [a, b] = book[0].children;
    expect(a).toMatchObject({ fatherName: "Test Father", motherPhone: null, hasPhoto: true, thirdChildCandidate: false });
    expect(a.money).toMatchObject({ yearFees: 12000, feesPending: 10000, lateFeePending: 1000, discountLabels: ["Staff Child"], overdue: true });
    expect(b.thirdChildCandidate).toBe(true);
    expect(b.money).toBeNull();
  });
});

describe("what Fees sends", () => {
  it("parses a families answer and refuses money that is not a number", async () => {
    const { bridgeFamiliesSchema } = await import("@/platform/fees-bridge/screen-read-contracts");
    const answer = { sessionLabel: "2026-27", asOf: "2026-11-08T10:00:00.000Z", asOfDate: "2026-11-08", families: [group("g1", [child("1"), child("2", { money: null })])] };
    expect(bridgeFamiliesSchema.parse(answer).families[0].children).toHaveLength(2);
    const bad = { ...answer, families: [group("g1", [child("1", { money: { ...money(), feesPending: "15000" as unknown as number } })])] };
    expect(bridgeFamiliesSchema.safeParse(bad).success).toBe(false);
  });
});
