import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { loadBulkBoot } from "@/modules/payments/vx/data";
import { feeRoleFor } from "@/platform/auth/fee-roles";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/vx/format";
import { BulkEntry } from "@/vx/screens/payments/bulk";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/** Rows post one after another, 25 a request; the upload route declares the same ceiling. */
export const maxDuration = 60;

/**
 * Enter many payments (PayDesk `bulk`): a grid for old paper receipts, or an
 * Excel upload. Anyone who takes money may open and check it; saving many at
 * once is the admin's (payments:bulk), checked again in every action.
 */
export default async function BulkPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("fees:collect", "/payments/bulk");
  const { staff, previewing } = await getViewer();
  const params = await searchParams;
  const view = await resolveViewSession({ searchParamSession: params.session, cookieSession: await getViewSessionCookie() });
  const boot = await loadBulkBoot({
    sessionLabel: view.sessionLabel,
    today: schoolToday(),
    feeRole: feeRoleFor(staff.role),
    myName: staff.displayName,
  });
  return <BulkEntry boot={boot} previewing={Boolean(previewing)} collectable={view.isCollectable} />;
}
