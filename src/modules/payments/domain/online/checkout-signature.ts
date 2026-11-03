/**
 * The signature Razorpay Standard Checkout hands the page after a payment:
 * HMAC-SHA256 of `order_id|payment_id` under the KEY SECRET (not the webhook
 * secret).
 *
 * A hint that the handler's ids are genuine, nothing more. Money is decided by
 * fetching the payment from Razorpay with the school's key; a valid signature
 * on its own posts nothing.
 */

import { verifyRazorpaySignature } from "./razorpay-signature";

export function verifyCheckoutSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string | null | undefined;
  keySecret: string;
}): boolean {
  if (!/^order_[A-Za-z0-9]+$/.test(args.orderId) || !/^pay_[A-Za-z0-9]+$/.test(args.paymentId)) return false;
  return verifyRazorpaySignature(`${args.orderId}|${args.paymentId}`, args.signature, args.keySecret);
}
