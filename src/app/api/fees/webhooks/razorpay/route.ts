/**
 * Razorpay's webhook under the fee area's API prefix (go-live Phase E, plan
 * §7.1): the same handler as `/api/webhooks/razorpay`, which keeps the fees
 * app's path shape. Either URL may be the one registered in Razorpay's
 * dashboard (docs/cutover/RAZORPAY.md names `/api/webhooks/razorpay`); the
 * handler, its signature check and its 404-until-configured rule are one and
 * the same.
 *
 * Route segment config cannot be re-exported (Next reads it statically), so
 * `maxDuration` is restated here.
 */
export { GET, POST } from "@/app/api/webhooks/razorpay/route";

export const maxDuration = 60;
