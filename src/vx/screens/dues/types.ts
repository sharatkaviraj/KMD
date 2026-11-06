import type { AgingBucket, DuesFamily, PromiseState } from "@/modules/defaulters/vx/domain/families";

export type DuesTab = "call" | "prom" | "left" | "aging";

export type DuesSheet = "call" | "promise" | "wa" | "plan" | "wo";

export type PromiseView = {
  id: string;
  /** The child the promise was taken for: "Mark paid" opens the desk on them. */
  studentId: string;
  familyKey: string;
  fatherName: string;
  kidsLine: string;
  phone: string | null;
  kind: "pay" | "visit";
  promisedOn: string;
  amount: number;
  note: string | null;
  by: string | null;
  createdAt: string;
  state: PromiseState;
  paid: number;
  receiptNumber: string | null;
};

export type LeftView = {
  studentId: string;
  fullName: string;
  fatherName: string | null;
  phone: string | null;
  status: string;
  classLabel: string | null;
  owed: number;
  lastPaymentDate: string | null;
  writeOff: { status: string; amount: number; reasonCode: string; note: string | null; by: string | null } | null;
};

export type KidInstallment = { no: number; label: string; dueDate: string; pending: number; lateFee: number; status: string; carry: boolean; amount?: number };

export type KidMeta = { admissionNo: string | null; route: string | null };

export type FamilyContact = { at: string; channel: string | null; outcome: string | null; note: string | null; studentId: string };

export type ClassInstRow = { classLabel: string; inst1: number; inst2: number; inst3: number; inst4: number; other: number; lastYear: number; total: number };

export type DuesProps = {
  today: string;
  sessionLabel: string;
  tab: DuesTab;
  families: DuesFamily[];
  lateFeeOnly: { count: number; amount: number };
  metrics: {
    pendingToday: number;
    students: number;
    notDueYet: number;
    promisesToday: number;
    promisesKeptToday: number;
    callsToday: number;
    collectedWeek: number;
  };
  promises: PromiseView[];
  left: LeftView[];
  aging: { buckets: AgingBucket[]; top: DuesFamily[]; classByInst: ClassInstRow[] };
  selected: DuesFamily | null;
  detail: { installments: Record<string, KidInstallment[]>; contacts: FamilyContact[]; meta?: Record<string, KidMeta> } | null;
  sheet: DuesSheet | null;
  /** The log sheet was opened by a Call button: the phone is dialling. */
  dialing?: boolean;
  writeOffFor: LeftView | null;
  /** `openStudent`: the reader may open Student 360 (`students:view`); absent means no. */
  perms: { log: boolean; plan: boolean; planEnabled: boolean; collect: boolean; writeOff: boolean; callSheet?: boolean; openStudent?: boolean };
};
