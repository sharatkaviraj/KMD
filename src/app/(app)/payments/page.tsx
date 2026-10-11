import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { loadDeskBoot, loadDeskReceipt, loadDeskStudent } from "@/modules/payments/vx/data";
import type { DeskReceipt, DeskStudentResult } from "@/modules/payments/vx/types";
import { feeRoleFor } from "@/platform/auth/fee-roles";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/vx/format";
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/**
 * The posting action's after-work (receipt notice, matview refresh) runs in
 * this route's function; the classic desk declares the same ceiling.
 */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

/**
 * Payment Desk (docs/design-handoff PayDesk): one student at a time, any
 * amount, the ledger's own split shown before saving. `?student=<id>`
 * preselects a student and `?receipt=<id>` opens a saved receipt on the desk.
 *
 * The desk keeps the whole collect flow in client state and is deliberately
 * not keyed on the URL: a revalidation after a save re-renders this route,
 * and the saved receipt must survive it (the classic desk learned the same).
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("fees:collect", "/payments");
  const { staff, previewing } = await getViewer();
  const params = await searchParams;
  const view = await resolveViewSession({ searchParamSession: params.session, cookieSession: await getViewSessionCookie() });
  const today = schoolToday();

  const studentParam = one(params.student) || one(params.studentId);
  const receiptParam = one(params.receipt);
  const receiptId = UUID.test(receiptParam) ? receiptParam : null;

  const [boot, receipt] = await Promise.all([
    loadDeskBoot({
      sessionLabel: view.sessionLabel,
      today,
      isCollectable: view.isCollectable,
      feeRole: feeRoleFor(staff.role),
      myName: staff.displayName,
      myId: staff.id,
    }),
    receiptId ? loadDeskReceipt(receiptId).catch((): DeskReceipt | null => null) : Promise.resolve(null),
  ]);

  const studentId = UUID.test(studentParam) ? studentParam : (receipt?.studentId ?? null);
  const student: DeskStudentResult | null = studentId
    ? await loadDeskStudent({ studentId, sessionLabel: view.sessionLabel, today }).catch(
        (error: unknown): DeskStudentResult => ({
          ok: false,
          message: error instanceof Error ? error.message : "This student's dues could not be loaded.",
          repairable: false,
        }),
      )
    : null;

  return (
    <PaymentDesk
      boot={boot}
      previewing={Boolean(previewing)}
      initialStudentId={studentId}
      initialStudent={student}
      initialReceipt={receipt}
    />
  );
}
