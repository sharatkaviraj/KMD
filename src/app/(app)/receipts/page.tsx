import { requirePermission } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { canAccessSession } from "@/platform/auth/test-session-policy";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { getBridgeReceipts } from "@/platform/fees-bridge/client";
import { feesBridgeOfficeReads, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { schoolToday } from "@/vx/format";
import { DayBook, DayBookUnavailable } from "@/vx/screens/receipts/day-book";
import { ReceiptsDesk } from "@/vx/screens/receipts/desk";
import { loadReceiptsDesk } from "@/vx/screens/receipts/load";

export const runtime = "nodejs";

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Receipts and the day close (design `Fees`): list, filters, count and close. */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("fees:view", "/receipts");
  const search = await searchParams;
  const asked = one(search.session);
  const session = asked && /^\d{4}-\d{2}$/.test(asked) && canAccessSession(staff, asked) ? asked : await resolveSessionLabel();
  // Real session under the live connection: Fees' own Receipts page, read natively (review F01).
  if (session && feesBridgeOfficeReads() && usesCanonicalFees(staff, session)) {
    const today = schoolToday(new Date());
    const to = DAY.test(one(search.to)) ? one(search.to) : today;
    const from = DAY.test(one(search.from)) && one(search.from) <= to ? one(search.from) : to;
    const page = Math.max(1, Math.min(10_000, Number.parseInt(one(search.page), 10) || 1));
    const data = await getBridgeReceipts({ sessionLabel: session, from, to, query: one(search.q).slice(0, 100), page, pageSize: 40 }).catch(() => null);
    if (!data) return <DayBookUnavailable language={staff.language} sessionLabel={session} />;
    return <DayBook data={data} language={staff.language} canSeeClose={data.dayCloseVisible && feePermissionsFor(staff.role).includes("finance:view")} />;
  }
  const props = await loadReceiptsDesk(staff, search);
  return <ReceiptsDesk {...props} />;
}
