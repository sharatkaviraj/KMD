import { NextResponse } from "next/server";
import { feesBridgeEnabled } from "@/platform/fees-bridge/policy";

import {
  createReceiptSender,
  postingsForPayments,
  refreshAfterOnlinePosting,
} from "@/modules/payments/data/online/after-posting";
import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { reconcileOnlinePayments } from "@/modules/payments/data/online/service";
import { drainStaffPaymentAlerts } from "@/modules/payments/data/online/staff-alerts";
import { logError, logInfo, logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

/**
 * The online-payments reconciler: everything the webhook may have missed.
 *
 * Called every ten minutes by the database timer (`20261028140100`, pg_cron +
 * pg_net, silent until Vault holds `VPPS_ONLINE_PAYMENTS_CRON_SECRET`) — not
 * by `vercel.json`, whose two Hobby-plan cron slots are spent.
 *
 * One bounded pass: retry the inbox, ask Razorpay about every open or recently
 * closed link (a capture that arrived after expiry or after a cash payment is
 * found here, and recorded for review), cancel links the school has moved past,
 * post captures when automatic posting is on, and send queued receipts.
 *
 * Runs whatever the three switches say about NEW links: money that has already
 * been paid is received and reconciled during a rollback too.
 *
 * One (go-live Phase E): the fees app's `/api/cron/online-payments`, here under
 * `/api/fees/cron/`, which the middleware lets through without a session (its
 * secret is checked below). The database timer above was stripped from One's
 * copy of `20261028140100` (it called the fees app); One's own job is created
 * at cutover — the SQL is in docs/cutover/RAZORPAY.md §5. Never acts on a
 * fees app (`vpps_`) link or order, and a live key outside a live deployment
 * reads as "not configured" (`readRazorpayConfig`).
 */

export const maxDuration = 60;

async function authorize(request: Request): Promise<boolean> {
  const expected = [process.env.CRON_SECRET, process.env.ONLINE_PAYMENTS_CRON_SECRET].filter(
    (value): value is string => Boolean(value),
  );
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (provided && expected.includes(provided)) return true;
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  try {
    const { data, error } = await createAdminClient().rpc("online_payments_cron_secret_matches", {
      p_secret: provided,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = readRazorpayConfig();
  if (feesBridgeEnabled()) return NextResponse.json({ok:true,skipped:true,reason:"fees_is_financial_owner"});
  if (!config) {
    logWarn("cron.online_payments.unconfigured", {});
    return NextResponse.json({ ok: true, skipped: "Razorpay keys are not configured." });
  }

  const supabase = createAdminClient();
  try {
    const report = await reconcileOnlinePayments({
      supabase,
      client: createRazorpayClient(config),
      sendReceipt: createReceiptSender(supabase),
      afterPosting: async (paymentIds) =>
        refreshAfterOnlinePosting(supabase, await postingsForPayments(supabase, paymentIds)),
      budgetMs: 40_000,
    });
    // The retry net for staff alerts: anything a posting path queued but could
    // not finish, and WhatsApp numbers that did not accept the first time.
    const staffAlerts = await drainStaffPaymentAlerts({ supabase }).catch(() => ({
      alerts: 0,
      pushed: 0,
      whatsappSent: 0,
    }));
    logInfo("cron.online_payments.done", { ...report, staffAlerts: staffAlerts.alerts, mode: config.mode });
    return NextResponse.json({ ok: true, mode: config.mode, ...report, staffAlerts });
  } catch (caught) {
    logError("cron.online_payments.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
