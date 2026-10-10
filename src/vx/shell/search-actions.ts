"use server";

import { getStudents } from "@/modules/students-fees/data/queries";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";
import { getReceiptsList } from "@/modules/receipts/data/queries";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";

export type SearchHit = {
  kind: "student" | "receipt";
  id: string;
  title: string;
  sub: string;
  href: string;
};

/**
 * The search palette's one server call (Ctrl K, D07-Search). Students for
 * anyone who may see the roster or the fee desk; receipts only for the fee
 * desk. Teachers get pages only — they have their own class lists.
 */
export async function searchEverythingAction(query: string): Promise<SearchHit[]> {
  const staff = await assertStaff();
  const q = query.trim();
  if (q.length < 2) return [];

  const seesStudents = can(staff, "students:view") || can(staff, "fees:view");
  const seesReceipts = can(staff, "fees:view");
  if (!seesStudents && !seesReceipts) return [];

  const session = await resolveViewSession({ cookieSession: await getViewSessionCookie() }).catch(() => null);
  const sessionLabel = session?.sessionLabel ?? "";
  const collects = can(staff, "fees:collect");
  const profile = can(staff, "students:view");

  const [students, receipts] = await Promise.all([
    seesStudents
      ? getStudents({ ...EMPTY_STUDENT_FILTERS, sessionLabel, query: q }).catch(() => [])
      : Promise.resolve([]),
    seesReceipts && /\d/.test(q) ? getReceiptsList(q, sessionLabel).catch(() => []) : Promise.resolve([]),
  ]);

  const hits: SearchHit[] = [];
  for (const s of students.slice(0, 6)) {
    hits.push({
      kind: "student",
      id: s.id,
      title: s.fullName,
      sub: `${s.classLabel} · SR ${s.admissionNo}`,
      href: profile ? `/students/${s.id}` : collects ? `/payments?student=${s.id}` : `/dues?student=${s.id}`,
    });
  }
  for (const r of receipts.slice(0, 5)) {
    hits.push({
      kind: "receipt",
      id: r.id,
      title: r.receiptNumber,
      sub: `${r.studentFullName} · ₹${Number(r.totalAmount).toLocaleString("en-IN")}`,
      href: `/receipts/${encodeURIComponent(r.receiptNumber)}`,
    });
  }
  return hits;
}
