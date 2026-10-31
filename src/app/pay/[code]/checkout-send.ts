import "server-only";

import { checkoutOfferRefusal, readPayScope, type PayScope } from "@/modules/payments/domain/online/pay-scope";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

import { sendIsFeesApps } from "./cutover-line";
import { isPayCodeShaped } from "./pay-code";

/**
 * The send behind a pay code, when it may open the one-tap checkout.
 *
 * Server-only and NOT a server action, so nothing here is callable from the
 * browser: the pay page and the checkout actions call it with the code from
 * the URL and re-derive everything else from the database.
 *
 * A checkout link stays usable for 21 days from the send. The figures are
 * always read live, so an old link never quotes an old amount; the limit is
 * there because the link now shows each child's name and fees.
 */

export const CHECKOUT_LINK_DAYS = 21;

export type CheckoutSend = {
  id: string;
  scope: PayScope;
  /** The session the reminder was sent for: who sees the page while it is a pilot. */
  sessionLabel: string | null;
  /** The number the reminder went to, as Razorpay wants it. Only ever sent to checkout. */
  contact: string | null;
};

export async function loadCheckoutSend(code: string): Promise<CheckoutSend | null> {
  const clean = decodeURIComponent(String(code ?? "")).trim();
  if (!isPayCodeShaped(clean)) return null;
  const { data, error } = await createAdminClient()
    .from("whatsapp_reminder_sends")
    .select("id, destination, pay_scope, session_label, created_at")
    .eq("pay_code", clean)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; destination: string | null; pay_scope: unknown; session_label: string | null; created_at: string };
  const scope = readPayScope(row.pay_scope);
  if (!scope || checkoutOfferRefusal(scope)) return null;
  if (Date.now() - new Date(row.created_at).getTime() > CHECKOUT_LINK_DAYS * 24 * 3600_000) return null;
  // One only: a send the fees app made opens nothing here (`cutover-line.ts`).
  if (await sendIsFeesApps(row)) return null;
  const digits = String(row.destination ?? "").replace(/\D/g, "");
  return { id: row.id, scope, sessionLabel: row.session_label, contact: digits.length >= 10 ? `+${digits}` : null };
}
