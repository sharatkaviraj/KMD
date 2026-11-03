import "server-only";

import { payCodeRefused } from "@/platform/migration/cutover-watermark";
import { readCutoverWatermark } from "@/platform/migration/cutover-watermark-reader";

/**
 * One only (go-live Phase E; critique0 #11, D-353 (4)): a pay code the fees app
 * minted never opens a payment in One.
 *
 * The real reminder sends reach One's database with the data load, pay codes
 * and all. A fees Pay now button points at the fees app's host, so a parent
 * never brings one here — but a One staff member copying a link from an
 * imported send would, and One would then open its own Razorpay order on a
 * send the fees app is still collecting for. So every door on this route that
 * can open or read a payment (the page, "Pay online", the one-tap checkout and
 * its status poll) asks this first, with the send's own `created_at` and
 * `session_label`: rows written before the cutover line are the fees app's.
 *
 * TEST-session sends are never refused, and before any real load there is no
 * line. A watermark that cannot be read refuses (`payCodeRefused`).
 */
export async function sendIsFeesApps(send: {
  created_at: string | null | undefined;
  session_label?: string | null;
}): Promise<boolean> {
  return payCodeRefused(send, await readCutoverWatermark("public.whatsapp_reminder_sends"));
}
