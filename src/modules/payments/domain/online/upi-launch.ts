/**
 * Opening a UPI app from the browser WhatsApp opens links in.
 *
 * A UPI Payment Link on Android answers with an HTTP 302 straight to
 * `upi://pay?…`. Chrome hands that to the phone's UPI apps. WhatsApp's own
 * browser does not follow a redirect to a scheme it cannot load, and shows
 * "Web page not available — net::ERR_UNKNOWN_URL_SCHEME" (seen on 2026-10-29,
 * the first time Pay now was tapped inside WhatsApp on a UPI link).
 *
 * In-app browsers DO hand a `upi://` or `intent://` link to Android when the
 * parent taps it: that is how Razorpay's standard page opened PhonePe from the
 * ₹1,250 test. So on Android the pay page shows the link Razorpay would have
 * redirected to, as buttons the parent taps, with app-specific `intent://`
 * forms and an "open in Chrome" escape beside it.
 *
 * Everything here is pure. Fetching the redirect is `data/online`.
 */

/** The UPI apps a parent is most likely to have, with their Android packages. */
export const UPI_APPS = [
  { key: "phonepe", label: "PhonePe", androidPackage: "com.phonepe.app" },
  { key: "gpay", label: "Google Pay", androidPackage: "com.google.android.apps.nbu.paisa.user" },
  { key: "paytm", label: "Paytm", androidPackage: "net.one97.paytm" },
  { key: "bhim", label: "BHIM", androidPackage: "in.org.npci.upiapp" },
] as const;

export type UpiApp = (typeof UPI_APPS)[number];

/** Android phones, whatever browser they are in. iPhones and desktops keep Razorpay's own page. */
export function isAndroidUserAgent(userAgent: string | null | undefined): boolean {
  return /\bAndroid\b/i.test(userAgent ?? "");
}

/**
 * Razorpay's redirect target, if it is exactly the payment we expect, else null.
 *
 * Shown on the school's own page, so it is checked before it is trusted: a
 * `upi://pay` URI, to a Razorpay collection VPA (`….rzp@…`), in rupees, for
 * this intent's amount to the paisa, carrying Razorpay's transaction
 * reference. Anything else falls back to Razorpay's own page, which is never
 * worse than before.
 *
 * Returns the string as Razorpay wrote it, so the UPI app reads the same
 * encoding Razorpay meant.
 */
export function readRazorpayUpiUri(
  location: string | null | undefined,
  expectedPaise: number,
): string | null {
  if (!location || !Number.isInteger(expectedPaise) || expectedPaise <= 0) return null;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  if (url.protocol !== "upi:" || url.host !== "pay") return null;
  const params = url.searchParams;
  if (!/^[a-z0-9._-]+\.rzp@[a-z0-9.-]+$/i.test(params.get("pa") ?? "")) return null;
  if ((params.get("cu") ?? "INR") !== "INR") return null;
  if (!params.get("tr")) return null;
  const amount = params.get("am");
  if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  if (Math.round(Number(amount) * 100) !== expectedPaise) return null;
  return location;
}

/**
 * The `intent://` form of a `upi://` URI, for one app.
 *
 * Some in-app browsers act on `intent://` but not on a bare custom scheme, and
 * a named package skips the chooser. `fallbackUrl` is where Android goes when
 * that app is not installed, instead of the Play Store.
 */
export function upiAppIntentUrl(upiUri: string, app: UpiApp, fallbackUrl?: string): string {
  const target = upiUri.replace(/^upi:\/\//i, "");
  const extras = [
    "scheme=upi",
    `package=${app.androidPackage}`,
    fallbackUrl ? `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}` : null,
  ].filter(Boolean);
  return `intent://${target}#Intent;${extras.join(";")};end`;
}

/**
 * Opens an https page in Chrome from an in-app browser, where the redirect to
 * a UPI app works. Falls back to the same page in whatever browser it is.
 */
export function chromeIntentUrl(httpsUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(httpsUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    `#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`
  );
}
