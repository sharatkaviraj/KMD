import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { loadDeskBoot, loadDeskReceipt, loadDeskStudent } from "@/modules/payments/vx/data";
import type { DeskReceipt, DeskStudentResult } from "@/modules/payments/vx/types";
import { feeRoleFor, feePermissionsFor } from "@/platform/auth/fee-roles";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/vx/format";
import { PaymentDesk } from "@/vx/screens/payments/desk";
import { getViewer } from "@/vx/view-as";
import { feesBridgeWritesEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeSessions, getBridgeStudent, listBridgeStudents, getBridgeReceipt } from "@/platform/fees-bridge/client";
import type { BridgeReceipt } from "@/platform/fees-bridge/contracts";
import { LiveFeesDesk } from "@/vx/screens/payments/live-fees-desk";
import { ms } from "@/messages/setup";
import { flat } from "@/platform/i18n/language";

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
 * The classic desks, kept while staff compare them with Collect (plan §5
 * rollout): `/payments?classic=1` lands here. Real staff get the live Fees
 * desk and test accounts the vx Payment Desk, exactly as `/payments` was. A
 * route of its own, so neither desk is in Collect's JavaScript.
 *
 * Payment Desk (docs/design-handoff PayDesk): one student at a time, any
 * amount, the ledger's own split shown before saving. `?student=<id>`
 * preselects a student and `?receipt=<id>` opens a saved receipt on the desk.
 *
 * The desk keeps the whole collect flow in client state and is deliberately
 * not keyed on the URL: a revalidation after a save re-renders this route,
 * and the saved receipt must survive it (the classic desk learned the same).
 */
export default async function ClassicPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("fees:collect", "/payments/classic");
  const { staff, previewing } = await getViewer();
  const params = await searchParams;
  const cookieSession = await getViewSessionCookie();
  if (usesCanonicalFees(staff, one(params.session) || cookieSession)) {
    let sessionLabel = "";
    let initialStudents: Awaited<ReturnType<typeof listBridgeStudents>>["students"] = [];
    let initialCursor:string|null = null;
    let initialError:string|null = null;
    let initialReceipt:BridgeReceipt|null=null;
    const askedStudent = one(params.student) || one(params.studentId);
    let initialStudentId = UUID.test(askedStudent) ? askedStudent : null;
    const askedReceipt=one(params.receipt);
    try {
      const {sessions} = await getBridgeSessions();
      const asked = one(params.session) || cookieSession;
      sessionLabel = sessions.find(row=>row.sessionLabel===asked)?.sessionLabel ?? sessions.find(row=>row.isCurrent)?.sessionLabel ?? "";
      if (!sessionLabel) throw new Error("No current source session.");
      const [list,selected,receipt] = await Promise.all([
        listBridgeStudents(sessionLabel),
        initialStudentId ? getBridgeStudent(initialStudentId,sessionLabel) : Promise.resolve(null),
        UUID.test(askedReceipt)?getBridgeReceipt(askedReceipt,sessionLabel):Promise.resolve(null),
      ]);
      initialStudents = list.students;
      initialCursor = list.nextCursor;
      if (selected && !initialStudents.some(student=>student.id===selected.student.id)) initialStudents=[selected.student,...initialStudents];
      initialReceipt=receipt;
      if(receipt){initialStudentId=receipt.student.id;if(!initialStudents.some(student=>student.id===receipt.student.id))initialStudents=[receipt.student,...initialStudents];}
    } catch {
      initialError=flat(ms.bridgeUnavailable,staff.language);
    }
    return <LiveFeesDesk language={staff.language} sessionLabel={sessionLabel} today={schoolToday()} canPost={feesBridgeWritesEnabled() && !previewing && Boolean(sessionLabel)} canWaive={feePermissionsFor(staff.role).includes("payments:waive_late_fee")} canDiscount={feePermissionsFor(staff.role).includes("payments:adjust")} initialStudents={initialStudents} initialCursor={initialCursor} initialStudentId={initialStudentId} initialReceipt={initialReceipt} initialError={initialError} userId={staff.userId}/>;
  }
  const view = await resolveViewSession({ searchParamSession: params.session, cookieSession });
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
