import type { BridgeFamilyChild, BridgeFamilyGroup } from "@/platform/fees-bridge/screen-read-contracts";

/*
 * One's own copy of the fee data (test accounts and TEST sessions) shaped
 * exactly as Fees sends its families (schoolfees `toBridgeFamilies`), so the
 * Families screen draws one shape whichever side answered. Pure.
 */

export type FamilyGroupRow = { id: string; family_label: string | null; guardian_name: string | null; guardian_phone: string | null };
export type FamilyMemberRow = { family_group_id: string; student_id: string; sibling_order: number | null; is_policy_candidate: boolean | null };
export type FamilyStudentRow = {
  id: string; full_name: string; admission_no: string | null; status: string | null; father_name: string | null;
  mother_name: string | null; primary_phone: string | null; secondary_phone: string | null; village_city: string | null;
  photo_path: string | null; classLabel: string;
};
export type FamilyMoneyRow = {
  studentId: string; baseChargeTotal: number; totalPaid: number; outstandingAmount: number; lateFeeOutstandingAmount: number;
  discountAmount: number; conventionalDiscountLabels: string | null; nextDueDate: string | null; nextDueAmount: number | null;
  statusLabel: string;
};

const rupees = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const blank = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/** A member whose record is not in the session is left out; a family left with nobody is dropped; no money row is null, never 0. */
export function buildFamilyBook(input: {
  groups: readonly FamilyGroupRow[];
  members: readonly FamilyMemberRow[];
  students: readonly FamilyStudentRow[];
  money: readonly FamilyMoneyRow[];
}): BridgeFamilyGroup[] {
  const students = new Map(input.students.map((s) => [s.id, s]));
  const money = new Map(input.money.map((m) => [m.studentId, m]));
  const byGroup = new Map<string, FamilyMemberRow[]>();
  for (const m of input.members) byGroup.set(m.family_group_id, [...(byGroup.get(m.family_group_id) ?? []), m]);
  const out: BridgeFamilyGroup[] = [];
  for (const g of input.groups) {
    const children: BridgeFamilyChild[] = [];
    for (const m of byGroup.get(g.id) ?? []) {
      const s = students.get(m.student_id);
      if (!s) continue;
      const f = money.get(s.id);
      children.push({
        studentId: s.id, fullName: s.full_name, admissionNo: s.admission_no ?? "", classLabel: s.classLabel,
        status: s.status ?? "active", fatherName: blank(s.father_name), motherName: blank(s.mother_name),
        fatherPhone: blank(s.primary_phone), motherPhone: blank(s.secondary_phone), villageCity: blank(s.village_city),
        hasPhoto: Boolean(s.photo_path), siblingOrder: m.sibling_order ?? null, thirdChildCandidate: m.is_policy_candidate === true,
        money: f
          ? {
              yearFees: rupees(f.baseChargeTotal), paid: rupees(f.totalPaid), feesPending: rupees(f.outstandingAmount),
              lateFeePending: rupees(f.lateFeeOutstandingAmount), discount: rupees(f.discountAmount),
              discountLabels: (f.conventionalDiscountLabels ?? "").split(",").map((x) => x.trim()).filter(Boolean),
              nextDueDate: f.nextDueDate ?? null, nextDueAmount: f.nextDueAmount === null || f.nextDueAmount === undefined ? null : rupees(f.nextDueAmount),
              overdue: f.statusLabel === "OVERDUE",
            }
          : null,
      });
    }
    if (!children.length) continue;
    children.sort((a, b) => (a.siblingOrder ?? 99) - (b.siblingOrder ?? 99) || a.fullName.localeCompare(b.fullName));
    out.push({ groupId: g.id, label: blank(g.family_label) ?? "", guardianName: blank(g.guardian_name), guardianPhone: blank(g.guardian_phone), children });
  }
  return out.sort((a, b) => (a.label || a.children[0].fullName).localeCompare(b.label || b.children[0].fullName));
}
