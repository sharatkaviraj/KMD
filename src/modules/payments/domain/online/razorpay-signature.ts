import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay webhook signature: HMAC-SHA256 of the RAW request body, keyed with
 * the webhook secret (a value chosen in the dashboard — not the API key
 * secret), sent hex-encoded in `X-Razorpay-Signature`.
 *
 * The body must be the exact bytes received. Parsing and re-serialising JSON
 * changes whitespace and key order, and a signature over that is a signature
 * over something Razorpay never sent.
 *
 * Constant-time on equal-length input; a header of the wrong shape is refused
 * before any comparison.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret) return false;
  const provided = String(signatureHeader ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const actual = Buffer.from(provided, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Exported for tests and for the Payment Links callback check. */
export function signRazorpayBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}
