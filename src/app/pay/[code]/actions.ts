"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import { readOnlineSwitches, readUpiOnlyLinks, startOnlinePayment } from "@/modules/payments/data/online/service";
import { onlineOfferRefusal, readPayScope } from "@/modules/payments/domain/online/pay-scope";
import { isAndroidUserAgent } from "@/modules/payments/domain/online/upi-launch";
import { schoolProfile } from "@/platform/config/school";
import { createAbsoluteUrl, getSiteUrl } from "@/platform/env";
import { logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

import { sendIsFeesApps } from "./cutover-line";
import { isPayCodeShaped } from "./pay-code";
import { originFromHeaders } from "./request-origin";

/**
 * "Pay online" on `/pay/[code]`: the only write a parent's tap can cause.
 *
 * Public by design, like the page — the visitor is a parent on their own
 * phone. It accepts ONE field, the pay code, and re-derives everything else
 * from the database: the student and scope from the send row, the amount from
 * the ledger, under the student's lock. A posted amount, student or link would
 * be ignored; none is read.
 *
 * Opening the page never creates anything (WhatsApp and browsers prefetch
 * links). Only this POST opens an intent and a provider link, and a second tap
 * — or a second phone — gets the same ones back.
 */
export async function startOnlinePaymentAction(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim();
  if (!isPayCodeShaped(code)) redirect("/pay/invalid");
  const back = `/pay/${encodeURIComponent(code)}`;

  const config = readRazorpayConfig();
  if (!config) redirect(`${back}?notice=unavailable`);

  const supabase = createAdminClient();
  const switches = await readOnlineSwitches(supabase);
  if (!switches.links) redirect(`${back}?notice=unavailable`);

  const { data: send } = await supabase
    .from("whatsapp_reminder_sends")
    .select("id, pay_scope, pay_code_expires_on, created_at, session_label")
    .eq("pay_code", code)
    .maybeSingle();
  const scope = readPayScope(send?.pay_scope);
  if (!send || onlineOfferRefusal(scope) || !scope) redirect(`${back}?notice=unavailable`);
  // One only: a send the fees app made opens nothing here (`cutover-line.ts`).
  if (await sendIsFeesApps(send)) redirect(`${back}?notice=unavailable`);

  const requestHeaders = await headers();
  const origin = originFromHeaders(requestHeaders) ?? getSiteUrl();

  const result = await startOnlinePayment({
    supabase,
    client: createRazorpayClient(config),
    studentId: scope.studentIds[0],
    sendId: send.id,
    scope,
    noticeDateIso: send.pay_code_expires_on ? String(send.pay_code_expires_on) : null,
    // Where Razorpay's own page returns the parent. From the request's host:
    // the env-based default resolves to localhost in production.
    callbackUrl: createAbsoluteUrl(`${back}?returned=1`, origin),
    schoolName: schoolProfile.name,
  });

  if (result.kind === "redirect") {
    // A UPI link on Android redirects to `upi://`, which WhatsApp's browser
    // will not follow. Send the phone to this page's own UPI buttons instead,
    // which a parent taps — and a tapped `upi://` link does open the app.
    const userAgent = requestHeaders.get("user-agent");
    if (isAndroidUserAgent(userAgent) && config.mode === "live" && (await readUpiOnlyLinks(supabase))) {
      redirect(`${back}?step=open`);
    }
    redirect(result.url);
  }
  if (result.kind === "try_again") {
    logWarn("pay.online.try_again", { reason: result.reason });
    redirect(`${back}?notice=busy`);
  }
  redirect(`${back}?notice=unavailable`);
}
