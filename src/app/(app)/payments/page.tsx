import { redirect } from "next/navigation";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import type { LedgerMode } from "@/modules/collect/domain/cash";
import type { MoneyPortInfo } from "@/modules/collect/data/money-port";
import { loadDeskBoot } from "@/modules/payments/vx/data";
import { sessionStartDate } from "@/modules/payments/vx/domain/desk";
import { requirePermission } from "@/platform/auth/current-staff";
import { feePermissionsFor, feeRoleFor } from "@/platform/auth/fee-roles";
import { getBridgeSessions } from "@/platform/fees-bridge/client";
import { feesBridgeWritesEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { schoolToday } from "@/vx/format";
import { CollectBridge } from "@/vx/screens/collect/collect-bridge";
import { CollectLocal } from "@/vx/screens/collect/collect-local";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

/** The local adapter posts through the ported fee action, whose after-work runs in this route's function. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEDGER_MODES: readonly LedgerMode[] = ["cash", "upi", "bank_transfer", "cheque"];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

/**
 * Collect (plan §3, docs/plans/2026-11-05-native-money-and-collect-flow.md):
 * the card-by-card payment entry, one UI on two ledgers.
 *
 *  - Real staff (`usesCanonicalFees`): the bridge adapter. Fees is the ledger;
 *    saving needs `FEES_BRIDGE_WRITES_ENABLED` and is otherwise read-only.
 *  - Test accounts and confined deployments: the local adapter, on the TEST
 *    session, through the vx Payment Desk's own actions.
 *
 * `?classic=1` (and a `?receipt=` link, which only the classic desks open)
 * goes to the classic desks at `/payments/classic`, a separate route so that
 * neither desk is in this page's JavaScript. `?student=<id>` opens a child.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("fees:collect", "/payments");
  const params = await searchParams;
  if (one(params.classic) === "1" || one(params.receipt)) {
    const rest = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (key !== "classic" && value !== undefined) rest.set(key, one(value));
    redirect(`/payments/classic${rest.size ? `?${rest}` : ""}`);
  }
  const { staff, previewing } = await getViewer();
  const cookieSession = await getViewSessionCookie();
  const asked = one(params.student) || one(params.studentId);
  const initialStudentId = UUID.test(asked) ? asked : null;
  const feePermissions = feePermissionsFor(staff.role);
  const today = schoolToday();
  const base = {
    today,
    canWaive: feePermissions.includes("payments:waive_late_fee"),
    canAdjust: feePermissions.includes("payments:adjust"),
    staffName: staff.displayName,
    userId: staff.userId,
  };

  if (usesCanonicalFees(staff, one(params.session) || cookieSession)) {
    let sessionLabel = "";
    try {
      const { sessions } = await getBridgeSessions();
      const wanted = one(params.session) || cookieSession;
      sessionLabel = sessions.find((row) => row.sessionLabel === wanted)?.sessionLabel ?? sessions.find((row) => row.isCurrent)?.sessionLabel ?? "";
    } catch {
      sessionLabel = "";
    }
    if (!sessionLabel) redirect("/payments/classic");
    const info: MoneyPortInfo = {
      ...base,
      kind: "bridge",
      sessionLabel,
      sessionStart: sessionStartDate(sessionLabel),
      canPost: feesBridgeWritesEnabled() && !previewing,
      canSplit: true,
      showRealQr: true,
      modes: [...LEDGER_MODES],
    };
    return <CollectBridge info={info} initialStudentId={initialStudentId} />;
  }

  const view = await resolveViewSession({ searchParamSession: params.session, cookieSession });
  const boot = await loadDeskBoot({
    sessionLabel: view.sessionLabel,
    today,
    isCollectable: view.isCollectable,
    feeRole: feeRoleFor(staff.role),
    myName: staff.displayName,
    myId: staff.id,
  });
  const info: MoneyPortInfo = {
    ...base,
    kind: "local",
    sessionLabel: view.sessionLabel,
    sessionStart: boot.sessionStart,
    canPost: boot.canPost && !previewing,
    canWaive: boot.me.canWaive,
    // The TEST ledger has no tender lines yet, and its QR would be the school's real one.
    canSplit: false,
    showRealQr: false,
    modes: boot.modes.filter((m): m is LedgerMode => (LEDGER_MODES as readonly string[]).includes(m)),
  };
  return <CollectLocal info={info} roll={boot.students} initialStudentId={initialStudentId} testSession={view.isTest} />;
}
