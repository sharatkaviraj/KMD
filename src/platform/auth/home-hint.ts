import { isSafeInternalPath } from "@/platform/env";

/**
 * Where `/` sends this person, remembered so the proxy can send them there
 * before anything renders (boot speed, 6 Nov 2026).
 *
 * The installed app always opens `/` (the manifest's `start_url`). For an
 * admin that is Today; for everybody else `/` only redirects — to `/teach`,
 * `/accounts`, a chosen start screen. That redirect came from the page, after
 * the (app) layout and the shell had done every read they do, so a teacher
 * opening the app paid for two full signed-in renders before seeing one.
 *
 * The hint is a plain cookie, written by the shell on each signed-in screen
 * from the same rule `/` uses, and read here. It is a hint and never a grant:
 *
 *  - it names an internal path, nothing else (`isSafeInternalPath`), and the
 *    screen it names checks its own permission as it always does;
 *  - it carries the account's user id, and the proxy follows it only for that
 *    account, so on a shared office PC the next person to sign in is not sent
 *    to the last person's home;
 *  - it is only ever followed for a plain document load of `/` — never a
 *    client navigation, a prefetch, a form post or a URL with a query.
 *
 * Stale is cheap: after a role or start-screen change it is followed at most
 * once more, and the screen it lands on rewrites it.
 */
export { HOME_HINT_COOKIE, HOME_HINT_MAX_AGE } from "@/platform/auth/home-hint-cookie";

const SEPARATOR = "|";

export function encodeHomeHint(userId: string, href: string): string {
  return `${userId}${SEPARATOR}${href}`;
}

/** The path to send `userId` to, or null when the hint is absent, theirs not, or unsafe. */
export function readHomeHint(value: string | null | undefined, userId: string | null | undefined): string | null {
  if (!value || !userId) return null;
  const at = value.indexOf(SEPARATOR);
  if (at <= 0) return null;
  if (value.slice(0, at) !== userId) return null;
  const href = value.slice(at + 1);
  if (href.length > 200 || !isSafeInternalPath(href)) return null;
  // `/` itself would be a loop; the hint is only ever somewhere else.
  const path = href.split(/[?#]/, 1)[0];
  if (path === "/" || path === "") return null;
  return href;
}

/** Only a browser's own load of `/` follows the hint. */
export function followsHomeHint(request: { method: string; nextUrl: { pathname: string; search: string }; headers: Headers }): boolean {
  if (request.method !== "GET") return false;
  if (request.nextUrl.pathname !== "/" || request.nextUrl.search !== "") return false;
  // A client navigation or prefetch asks for the RSC payload; the router
  // already knows how to follow the page's own redirect, and an admin's
  // "Today" link must keep working while they preview another role.
  if (request.headers.get("rsc") || request.headers.get("next-router-prefetch")) return false;
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;
  return true;
}
