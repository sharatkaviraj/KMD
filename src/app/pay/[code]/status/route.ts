import { after, NextResponse } from "next/server";

import { afterOnlinePosting } from "@/modules/payments/data/online/after-posting";
import { refreshOrderStatus } from "@/modules/payments/data/online/orders";
import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { readOnlineSwitches } from "@/modules/payments/data/online/service";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

import { loadCheckoutSend } from "../checkout-send";

/**
 * What the one-tap pay page polls while it waits for a payment: the page asks,
 * this looks (at most once every eight seconds per order) at Razorpay with the
 * school's key, posts what was captured, and answers with the page's state.
 *
 * Public by design: the pay code in the URL is the only input, and the answer
 * is the state of that code's own order — "waiting", "confirming" or the
 * receipt numbers — nothing else.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const send = await loadCheckoutSend(code);
  const config = readRazorpayConfig();
  if (!send || !config) {
    return NextResponse.json({ state: "none" }, { headers: { "cache-control": "no-store" } });
  }
  const supabase = createAdminClient();
  const switches = await readOnlineSwitches(supabase);
  const { status, postedPaymentIds } = await refreshOrderStatus({
    supabase,
    client: createRazorpayClient(config),
    sendId: send.id,
    autoPosting: switches.autoPosting,
  });
  if (postedPaymentIds.length > 0) {
    after(() => afterOnlinePosting({ supabase: createAdminClient(), paymentIds: postedPaymentIds }));
  }
  return NextResponse.json(status, { headers: { "cache-control": "no-store" } });
}
