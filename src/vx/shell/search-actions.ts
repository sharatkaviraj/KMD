"use server";

import { getStudentMasterFieldsByIds, getStudents } from "@/modules/students-fees/data/queries";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";
import { getReceiptsList } from "@/modules/receipts/data/queries";
import { recentReceiptsFor } from "@/modules/students-fees/vx/admin-students";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { searchStudents } from "@/modules/students/data/directory-repo";
import { assertStaff, type CurrentStaff } from "@/platform/auth/current-staff";
import { assertStudentVisible } from "@/platform/auth/test-session-access";
import { can } from "@/platform/auth/permissions";
import { getBridgeDirectory, getBridgeReceiptDetail, lookupBridgeReceipt } from "@/platform/fees-bridge/client";
import { RECEIPT_NUMBER } from "@/platform/fees-bridge/office-read-contracts";
import { feesBridgeOfficeReads, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { listMoney, mobileOf } from "@/vx/screens/admin/logic";
import { moneyStatus, type MoneyStatus } from "@/vx/screens/admin/students-logic";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { matchStaff, type StaffHit } from "@/vx/shell/staff-search";
import { matchWhy, searchTerm, type MatchWhy } from "@/vx/shell/student-search-query";

export type { StaffHit };

export type StudentHit = {
  id: string;
  name: string;
  classLabel: string;
  sr: string;
  /** Father's (else mother's) name, when known. */
  parent: string | null;
  href: string;
  /** Pending today / on track / paid up — only for `fees:view`. */
  money: MoneyStatus | null;
  /** Why it matched, when not by the child's own name or SR (S01). */
  why?: MatchWhy;
};

export type ReceiptHit = {
  id: string;
  number: string;
  amount: number;
  student: string;
  date: string;
  mode: string;
  /** Kept in the list and marked, never hidden (RULES A). */
  reversed: boolean;
  /** Found through the child's name rather than the receipt number (the phone lists these, F04). */
  byChild?: boolean;
  href: string;
};

export type ActionHit =
  | { kind: "collect"; href: string; student: string; pending: number | null }
  | { kind: "call"; tel: string; who: string | null; relation: "father" | "mother"; child: string };

/**
 * `staff`: colleagues by name, for whoever may see the staff list or the timetable (B12).
 * `failed`: a part that could not be searched — never shown as "Nothing matches" (S01).
 */
export type SearchResult = {
  students: StudentHit[];
  receipts: ReceiptHit[];
  actions: ActionHit[];
  staff?: StaffHit[];
  failed?: ("students" | "receipts")[];
  /**
   * The first child's id when their latest receipts may be shown. They are not
   * read here: that read is the whole Fees workspace, the desk never shows them
   * (D07), and the phone asks `searchChildReceiptsAction` after the names (S01).
   */
  childReceiptsFor?: string;
};

const EMPTY: SearchResult = { students: [], receipts: [], actions: [] };
const SHOWN = 5;

type MoneyFields = { overdueAmount: number; outstandingAmount: number; pendingLateFeeAmount: number; totalPaid: number; totalDue: number; lateFeeTotal: number };

/** The fee app's figures in the design's three words; the late fee is never added in. */
function statusOf(s: MoneyFields): MoneyStatus {
  return moneyStatus(
    listMoney({
      overdueAmount: Number(s.overdueAmount || 0),
      outstandingAmount: Number(s.outstandingAmount || 0),
      pendingLateFeeAmount: Number(s.pendingLateFeeAmount || 0),
      totalPaid: Number(s.totalPaid || 0),
      totalDue: Number(s.totalDue || 0),
      lateFeeTotal: Number(s.lateFeeTotal || 0),
    }),
  );
}

/** One found child, whichever reader found them. */
type Found = {
  id: string;
  name: string;
  classLabel: string;
  sr: string;
  father: string | null;
  mother: string | null;
  fatherPhone: string | null;
  motherPhone: string | null;
  money: MoneyFields | null;
};

type Seen = { students: Found[]; receipts: ReceiptHit[]; failed: SearchResult["failed"] };
type Ask = { staff: CurrentStaff; term: string; seesReceipts: boolean; money: boolean };

const receiptHref = (number: string, id: string, session?: string) =>
  session
    ? `/receipts/${encodeURIComponent(number)}?${new URLSearchParams({ receiptId: id, session })}`
    : `/receipts/${encodeURIComponent(number)}`;

/**
 * The real session under the live Fees connection: the Fees directory for a
 * fee reader (it holds parents, phones and money), One's own roster for a
 * roster-only reader. The local fee tables are refused under the connection,
 * which is why searching them here used to find nobody.
 */
async function canonicalSearch(ask: Ask, sessionLabel: string): Promise<Seen> {
  const failed: NonNullable<SearchResult["failed"]> = [];
  // A typed receipt number is resolved by Fees, exactly (its lookup, under the
  // receipt detail rule), at the same time as the directory rather than after it.
  const typedReceipt = ask.seesReceipts && feesBridgeOfficeReads() && /\d/.test(ask.term) && RECEIPT_NUMBER.test(ask.term)
    ? findTypedReceipt(ask.term, sessionLabel)
    : Promise.resolve({ receipts: [] as ReceiptHit[], failed: false });
  let students: Found[] = [];
  try {
    if (ask.money) {
      const read = (status: "active" | "all") =>
        getBridgeDirectory({ sessionLabel, query: ask.term, classId: "", segments: [], sort: "name", page: 1, pageSize: SHOWN, status });
      // Children on the roll first; a child who left still owes and is still found.
      let page = await read("active");
      if (page.students.length === 0) page = await read("all");
      students = page.students.map((s) => ({
        id: s.id, name: s.fullName, classLabel: s.classLabel, sr: s.admissionNo,
        father: s.fatherName, mother: s.motherName, fatherPhone: s.fatherPhone, motherPhone: s.motherPhone,
        money: s,
      }));
    } else {
      const [page, labels] = await Promise.all([
        searchStudents({ text: ask.term, classId: null, page: 1 }, sessionLabel),
        classLabelMap(sessionLabel).catch(() => null),
      ]);
      students = page.rows.slice(0, SHOWN).map((s) => ({
        id: s.studentId, name: s.fullName, classLabel: (s.classId && labels?.get(s.classId)) || "", sr: s.admissionNo ?? "",
        father: s.fatherName, mother: null, fatherPhone: s.guardianPhone, motherPhone: null, money: null,
      }));
    }
  } catch {
    failed.push("students");
  }

  const typed = await typedReceipt;
  if (typed.failed) failed.push("receipts");
  return { students, receipts: typed.receipts, failed: failed.length ? failed : undefined };
}

async function findTypedReceipt(term: string, sessionLabel: string): Promise<{ receipts: ReceiptHit[]; failed: boolean }> {
  try {
    const found = await lookupBridgeReceipt(term, sessionLabel);
    const d = (await getBridgeReceiptDetail(found.receiptId, sessionLabel)).detail;
    return { failed: false, receipts: [{ id: found.receiptId, number: found.receiptNumber, amount: d.totalAmount, student: d.studentFullName, date: d.paymentDate, mode: d.paymentMode,
      reversed: Boolean(d.isVoided || (d.reversedAmount ?? 0) > 0), href: receiptHref(found.receiptNumber, found.receiptId, sessionLabel) }] };
  } catch (error) {
    // Not a receipt number after all is not a failure; anything else is said.
    return { receipts: [], failed: !(error instanceof FeesBridgeError && ["not_found", "forbidden"].includes(error.code)) };
  }
}

/** The local path: TEST accounts, TEST sessions, and a deployment without the connection. */
async function localSearch(ask: Ask, sessionLabel: string, seesStudents: boolean): Promise<Seen> {
  const failed: NonNullable<SearchResult["failed"]> = [];
  const [listed, byNumber] = await Promise.all([
    seesStudents
      ? getStudents({ ...EMPTY_STUDENT_FILTERS, sessionLabel, query: ask.term }).catch(() => {
          failed.push("students");
          return [];
        })
      : Promise.resolve([]),
    ask.seesReceipts && /\d/.test(ask.term)
      ? getReceiptsList(ask.term, sessionLabel).catch(() => {
          failed.push("receipts");
          return [];
        })
      : Promise.resolve([]),
  ]);

  const top = listed.slice(0, SHOWN);
  // The parents' names are not on the list read; one small read for the five shown.
  const parents = top.length ? await getStudentMasterFieldsByIds(top.map((s) => s.id)).catch(() => null) : null;

  const students = top.map((s): Found => ({
    id: s.id, name: s.fullName, classLabel: s.classLabel, sr: s.admissionNo,
    father: (parents?.get(s.id)?.fatherName ?? "").trim() || null,
    mother: (parents?.get(s.id)?.motherName ?? "").trim() || null,
    fatherPhone: s.fatherPhone, motherPhone: s.motherPhone, money: s,
  }));
  const receipts: ReceiptHit[] = byNumber.slice(0, SHOWN).map((r) => ({
    id: r.id, number: r.receiptNumber, amount: Number(r.totalAmount), student: r.studentFullName, date: r.paymentDate, mode: r.paymentMode,
    reversed: Boolean(r.isReversed), href: receiptHref(r.receiptNumber, r.id),
  }));
  return { students, receipts, failed: failed.length ? failed : undefined };
}

/**
 * The first child's latest receipts, which the phone lists under a name search
 * (F04). Asked for after the names are on screen, so the slow Fees workspace
 * read never holds them up; `recentReceiptsFor` checks `fees:view` and the
 * session itself.
 */
export async function searchChildReceiptsAction(studentId: string): Promise<{ receipts: ReceiptHit[]; failed: boolean }> {
  const staff = await assertStaff();
  if (!can(staff, "fees:view") || !/^[0-9a-f-]{36}$/i.test(studentId)) return { receipts: [], failed: false };
  // The id came from the browser: a test account must not read a real child's receipts.
  try {
    await assertStudentVisible(staff, studentId);
  } catch {
    return { receipts: [], failed: false };
  }
  try {
    const recent = await recentReceiptsFor(studentId);
    return { failed: false, receipts: recent.map((r) => ({
      id: r.id, number: r.number, amount: r.amount, student: "", date: r.date, mode: r.mode, reversed: r.reversed, byChild: true,
      href: receiptHref(r.number, r.id, r.session),
    })) };
  } catch {
    return { receipts: [], failed: true };
  }
}

/**
 * The search palette's one server call (Ctrl K, D07-Search / F04-Search).
 * Students for anyone who may see the roster or the fee desk; their money in
 * the design's words only for `fees:view`; receipts only for the fee desk.
 * "Do it now" offers Collect for `fees:collect` and a call to the first
 * child's parent. Teachers get pages only — they have their own class lists.
 */
export async function searchEverythingAction(query: string): Promise<SearchResult> {
  const staff = await assertStaff();
  const term = searchTerm(query);
  if (term.length < 2) return EMPTY;

  const seesStudents = can(staff, "students:view") || can(staff, "fees:view");
  const seesReceipts = can(staff, "fees:view");
  const staffTo = can(staff, "staff:view") ? "staff" : can(staff, "timetable:view") ? "timetable" : null;
  const colleagues = staffTo ? listStaff().then((all) => matchStaff(all, term, staffTo)).catch(() => [] as StaffHit[]) : Promise.resolve([] as StaffHit[]);
  if (!seesStudents && !seesReceipts) {
    const found = await colleagues;
    return found.length ? { ...EMPTY, staff: found } : EMPTY;
  }

  const collects = can(staff, "fees:collect");
  const profile = can(staff, "students:view");
  const money = can(staff, "fees:view");
  const ask: Ask = { staff, term, seesReceipts, money };

  // The directory's session (pickSessionLabel), so search and the list agree on
  // who is in the school; the fee view-session only on the local path.
  const directorySession = await resolveSessionLabel().catch(() => null);
  const seen = directorySession && usesCanonicalFees(staff, directorySession)
    ? await canonicalSearch(ask, directorySession)
    : await localSearch(
        ask,
        (await resolveViewSession({ cookieSession: await getViewSessionCookie() }).catch(() => null))?.sessionLabel ?? "",
        seesStudents,
      );

  const found = await colleagues;
  const out: SearchResult = {
    students: [],
    receipts: seen.receipts,
    actions: [],
    ...(found.length ? { staff: found } : {}),
    ...(seen.failed ? { failed: seen.failed } : {}),
    ...(seesReceipts && seen.receipts.length === 0 && seen.students[0] ? { childReceiptsFor: seen.students[0].id } : {}),
  };
  for (const s of seen.students) {
    const why = matchWhy(term, { name: s.name, sr: s.sr, father: s.father, mother: s.mother, phones: [s.fatherPhone, s.motherPhone] });
    out.students.push({
      id: s.id,
      name: s.name,
      classLabel: s.classLabel,
      sr: s.sr,
      parent: s.father || s.mother,
      href: profile ? `/students/${s.id}` : collects ? `/payments?student=${s.id}` : `/dues?student=${s.id}`,
      money: money && s.money ? statusOf(s.money) : null,
      ...(why ? { why } : {}),
    });
  }

  const first = seen.students[0];
  if (first) {
    if (collects) {
      const status = money && first.money ? statusOf(first.money) : null;
      out.actions.push({ kind: "collect", href: `/payments?student=${first.id}`, student: first.name, pending: status?.kind === "pending" ? status.amount : null });
    }
    const father = mobileOf(first.fatherPhone);
    const mother = mobileOf(first.motherPhone);
    if (father) out.actions.push({ kind: "call", tel: father, who: first.father, relation: "father", child: first.name });
    else if (mother) out.actions.push({ kind: "call", tel: mother, who: first.mother, relation: "mother", child: first.name });
  }
  return out;
}
