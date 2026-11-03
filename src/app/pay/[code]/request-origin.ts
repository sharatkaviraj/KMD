/**
 * The origin a parent actually reached the pay page on, from the request.
 *
 * `createAbsoluteUrl` builds from `NEXT_PUBLIC_SITE_URL` and falls back to
 * `http://localhost:3000`, and production does not have that variable at
 * runtime: the first live render of the UPI buttons (2026-10-29) pointed the
 * app fallbacks at localhost and dropped the https-only "open in Chrome"
 * escape. Every absolute URL a parent's phone or Razorpay is handed from this
 * route is built from the host the request came in on instead.
 *
 * Null when the headers do not name a plausible host; the caller then falls
 * back to `getSiteUrl()`.
 */
export function originFromHeaders(headers: Pick<Headers, "get">): string | null {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return null;
  const proto = (headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim().toLowerCase();
  return `${proto === "http" ? "http" : "https"}://${host.toLowerCase()}`;
}
