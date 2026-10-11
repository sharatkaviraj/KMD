import type { DeskBoot, DeskReceipt, DeskStudent } from "@/modules/payments/vx/types";

export const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
export const OTHER_ID = "00000000-0000-4000-8000-000000000002";
export const student: DeskStudent = {
  id: STUDENT_ID, name: "TEST Child A", sr: "TEST-1", classLabel: "Class 7", father: "TEST Parent", phone: null, route: null, isNew: false, onPlan: false,
  rows: [{ id: "00000000-0000-4000-8000-000000000010", installmentNo: 1, label: "Installment 1", isCarryForward: false, dueDate: "2026-04-20", charge: 2000, feesPaid: 0, feesPending: 2000, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeWaived: 0, lateFeeStatus: "pending", planPriority: 1 }, { id: "00000000-0000-4000-8000-000000000011", installmentNo: 2, label: "Installment 2", isCarryForward: false, dueDate: "2027-01-20", charge: 2000, feesPaid: 0, feesPending: 2000, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none", planPriority: 1 }],
  receipts: [], siblings: [], plan: { tuition: 4000, transport: 0, academic: 0, installments: 2 }, readAt: "2026-10-11T10:00:00Z",
};
export const boot: DeskBoot = {
  sessionLabel: "TEST-2026-27", today: "2026-10-11", sessionStart: "2026-04-01", canPost: true, blocking: null, modes: ["cash", "upi", "bank_transfer", "cheque"],
  classes: [{ id: "qa-class", label: "Class 7", short: "7" }],
  students: [student, { ...student, id: OTHER_ID, name: "TEST Child B", sr: "TEST-2" }].map(s => ({ id: s.id, name: s.name, sr: s.sr, classId: "qa-class", classLabel: s.classLabel, father: s.father, phone: null, pendingToday: 2000, lateFee: 1000 })),
  todayCollection: { count: 0, amount: 0 }, lateFeeFlat: 1000, me: { name: "TEST Cashier", isAdmin: true, canWaive: true, canRemove: true, canBulk: true },
};
export const receipt: DeskReceipt = { id: "00000000-0000-4000-8000-000000000020", receiptNumber: "TEST-0001", studentId: STUDENT_ID, studentName: student.name, sr: student.sr, classLabel: student.classLabel, father: student.father, phone: null, paymentDate: boot.today, createdAt: "2026-10-11T10:00:00Z", mode: "cash", reference: null, notes: null, receivedBy: boot.me.name, total: 500, lines: [{ label: "Installment 1", amount: 500 }], lateFeePaid: 0, lateFeeWaived: 0, isReversed: false, outstandingAfter: 4500 };
