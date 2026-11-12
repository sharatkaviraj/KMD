import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every door a machine or a parent knocks on answers without a session
 * (go-live Phase E, plan §7.2; critique0 #1, critique1 A1).
 *
 * The middleware sends any request without a session to /login, except a
 * short allow-list. Razorpay's webhook, the crons pg_cron and Vercel call, and
 * a parent tapping Pay now all come without one — and before this phase every
 * one of them got a 307 to the staff sign-in page: Razorpay counts that as a
 * failed delivery and in the end switches the webhook off, a cron "succeeds"
 * having done nothing, and a parent sees a login form.
 *
 * Two holds:
 *  1. Every route handler that authenticates by a secret, a signature or a
 *     token is under a public prefix — found from the source, so a new cron or
 *     webhook cannot be added behind the login page by forgetting this list.
 *  2. A cold request with no cookie to each of those paths is answered by the
 *     route (200 from the middleware), never a 307.
 */

let signedIn = false;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({
        data: signedIn ? { claims: { sub: "00000000-0000-0000-0000-000000000001" } } : null,
        error: null,
      }),
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

const { updateSession, isPublicPath, PUBLIC_PREFIXES } = await import("@/platform/supabase/middleware");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** `src/app/(group)/a/[id]/route.ts` -> `/a/sample-id`: the URL a request would use. */
function urlOf(file: string): string {
  const rel = path.relative(APP, path.dirname(file)).split(path.sep);
  const parts = rel
    .filter((part) => part && !/^\(.*\)$/.test(part))
    .map((part) => (/^\[.*\]$/.test(part) ? "sample-AbCdEfGhIjKlMnOpQr" : part));
  return `/${parts.join("/")}`;
}

/** A machine credential or a public token the route checks itself. */
const MACHINE_CREDENTIAL =
  /CRON_SECRET|JOBS_SECRET|WEBHOOK_SECRET|verifyRazorpaySignature|x-hub-signature-256|queueSecretMatches|cron_secret_matches|SCHOOLFEES_DOC_TOKEN|timingSafeEqual|loadCheckoutSend|isPayCodeShaped/;

/**
 * Secret-checked routes deliberately left behind the login page, each with its
 * reason. Nothing outside the school calls them, so a session AND the secret
 * is the right door. The list only shrinks: an entry that disappears fails.
 */
const BEHIND_LOGIN: Record<string, string> = {
  "/api/fees/admin/repair-discount-drift": "An operator's one-off repair: run signed in, with CRON_SECRET as a second key.",
  "/api/fees/admin/revalidate-after-bulk": "An operator's cache bust after a bulk import: signed in, with CRON_SECRET.",
  "/api/fees/service/documents":
    "The fees app's document bridge for its MCP worker, which calls the fees app, not One. Opened if a One-side MCP is built (plan §11, critique0 #29).",
};

const credentialRoutes = walk(APP)
  .filter((file) => /[\\/]route\.tsx?$/.test(file))
  .filter((file) => MACHINE_CREDENTIAL.test(readFileSync(file, "utf8")))
  .map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, "/"), url: urlOf(file) }));

describe("routes that authenticate by a secret, signature or token", () => {
  it("finds them", () => {
    const urls = credentialRoutes.map((route) => route.url);
    // If these vanish, the pattern stopped matching and the test below is empty.
    expect(urls).toContain("/api/webhooks/razorpay");
    expect(urls).toContain("/api/fees/cron/online-payments");
    expect(urls).toContain("/pay/sample-AbCdEfGhIjKlMnOpQr/status");
    expect(urls).toContain("/api/jobs/sample-AbCdEfGhIjKlMnOpQr");
  });

  it.each(credentialRoutes.filter((route) => !(route.url in BEHIND_LOGIN)).map((route) => [route.url, route.file]))(
    "%s (%s) is reachable without a session",
    (url) => {
      expect(isPublicPath(url), `${url} checks its own credential but the middleware would send it to /login`).toBe(true);
    },
  );

  it("keeps the behind-login list honest", () => {
    const urls = new Set(credentialRoutes.map((route) => route.url));
    for (const url of Object.keys(BEHIND_LOGIN)) {
      expect(urls.has(url), `${url} no longer exists or no longer checks a secret; remove it from BEHIND_LOGIN`).toBe(true);
      expect(isPublicPath(url), `${url} is public now; remove it from BEHIND_LOGIN`).toBe(false);
    }
  });

  it("names the four prefixes Phase E opened", () => {
    expect(PUBLIC_PREFIXES).toEqual(expect.arrayContaining(["/pay", "/api/webhooks", "/api/fees/webhooks", "/api/fees/cron"]));
  });
});

/**
 * The converse (go-live Phase E review): everything a signed-out request can
 * reach — every route handler, every page and every server-action file under
 * a public prefix — checks a credential of its own, or is on this list with
 * the reason it needs none. A new `route.ts` under `/api/fees/cron` that
 * forgot its secret, or a page under `/pay` that skipped the pay-code check,
 * fails here instead of being quietly public.
 */
// The AI connection (plan 2026-11-03-mcp-feasibility §5.3): `handleMcp` checks
// the One-issued bearer token (401 + WWW-Authenticate otherwise), and
// `handleToken` / `handleRevoke` the code, refresh token or token in the body.
const PUBLIC_TOKEN =
  /isPayCodeShaped|loadCheckoutSend|resolveToken|resolveStaffToken|resolveTaskToken|limitByToken|resolvePass|handleMcp\(request|handleToken\(request|handleRevoke\(request/;

const OPEN_BY_DESIGN: Record<string, string> = {
  "src/app/.well-known/oauth-protected-resource/route.ts":
    "RFC 9728 metadata for the AI connection: names the MCP resource, its authorization server and scope, nothing else.",
  "src/app/.well-known/oauth-protected-resource/api/mcp/route.ts":
    "The same RFC 9728 document at its path-suffixed location, where the 401 challenge points.",
  "src/app/.well-known/oauth-authorization-server/route.ts":
    "RFC 8414 metadata for One's own AI-connection authorization server: endpoint URLs and supported methods only.",
  "src/app/api/mcp/oauth/register/route.ts":
    "RFC 7591 dynamic registration, unauthenticated by design (Claude registers a client on every fresh connection). It grants nothing: redirect URIs must match an exact allowlist, registrations are capped per hour, and no data opens until a signed-in eligible member of staff approves on /mcp/authorize.",
  "src/app/rv/[code]/page.tsx":
    "The parent's receipt check (the fees app's /r/{number}): shows a receipt number, date, amount and reversal state for the number in the URL, nothing about the child.",
  "src/app/cv/[code]/page.tsx":
    "The QR on a school certificate: for a random 64-bit code frozen into one issue, shows status, number, kind, date and a masked name; never class, parentage or birth date, and never a TEST document.",
};

/** The file's own source, plus the source of any module it re-exports from (`export … from "@/…"`). */
function sourceWithReexports(file: string): string {
  const own = readFileSync(file, "utf8");
  const targets = [...own.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+"@\/([^"]+)"/g)].map((match) => match[1]);
  return [
    own,
    ...targets.map((target) => {
      for (const ext of [".ts", ".tsx"]) {
        const candidate = path.join(ROOT, "src", `${target}${ext}`);
        try {
          return readFileSync(candidate, "utf8");
        } catch {
          // try the next extension
        }
      }
      return "";
    }),
  ].join("\n");
}

const reachableWithoutSession = walk(APP)
  .filter((file) => /[\\/](route\.tsx?|page\.tsx)$/.test(file) || /^\s*["']use server["']/.test(readFileSync(file, "utf8")))
  .map((file) => ({ file: path.relative(ROOT, file).replace(/\\/g, "/"), url: urlOf(file), abs: file }))
  // The prefixes, not PUBLIC_PATHS: those are the sign-in pages themselves.
  .filter((entry) => PUBLIC_PREFIXES.some((prefix) => entry.url === prefix || entry.url.startsWith(`${prefix}/`)));

describe("everything under a public prefix checks its own credential", () => {
  it("finds the routes, pages and actions a signed-out request reaches", () => {
    const files = reachableWithoutSession.map((entry) => entry.file);
    expect(files).toContain("src/app/pay/[code]/page.tsx");
    expect(files).toContain("src/app/pay/[code]/actions.ts");
    expect(files).toContain("src/app/pay/[code]/checkout-actions.ts");
    expect(files).toContain("src/app/api/fees/webhooks/razorpay/route.ts");
    expect(files).toContain("src/app/r/[token]/page.tsx");
    expect(files).toContain("src/app/rv/[code]/page.tsx");
    expect(files).toContain("src/app/cv/[code]/page.tsx");
  });

  it.each(reachableWithoutSession.filter((entry) => !(entry.file in OPEN_BY_DESIGN)).map((entry) => [entry.file, entry.abs]))(
    "%s checks a secret, a signature or a token",
    (file, abs) => {
      const source = sourceWithReexports(abs);
      expect(
        MACHINE_CREDENTIAL.test(source) || PUBLIC_TOKEN.test(source),
        `${file} is reachable without a session but checks no credential; add the check or list it in OPEN_BY_DESIGN with a reason`,
      ).toBe(true);
    },
  );

  it("keeps the open-by-design list honest", () => {
    const files = new Set(reachableWithoutSession.map((entry) => entry.file));
    for (const file of Object.keys(OPEN_BY_DESIGN)) expect(files.has(file), `${file} is gone; remove it`).toBe(true);
  });
});

describe("a cold request with no cookie", () => {
  beforeEach(() => {
    signedIn = false;
  });

  const COLD = [
    "/pay/AbCdEfGhIjKlMnOpQrStUv",
    "/pay/AbCdEfGhIjKlMnOpQrStUv/status",
    "/pay/AbCdEfGhIjKlMnOpQrStUv?step=open&check=1",
    "/api/webhooks/razorpay",
    "/api/fees/webhooks/razorpay",
    "/api/webhooks/whatsapp",
    "/api/webhooks/whatsapp-hub",
    "/api/jobs/whatsapp-queue",
    "/api/jobs/whatsapp-templates",
    "/api/jobs/parent-helper",
    "/api/jobs/parent-files",
    "/api/fees/cron/online-payments",
    "/api/fees/cron/whatsapp-scheduled-runs",
    "/api/fees/cron/auto-day-close",
    "/api/fees/cron/nightly-backup",
    "/api/jobs/staff-notices",
    "/rv/SVP20261213-5001",
    "/cv/0123456789abcdef",
    // The AI connection: each answers its own 401 (Claude needs the challenge to start sign-in).
    "/api/mcp",
    "/api/mcp/oauth/token",
    "/api/mcp/oauth/register",
    "/api/mcp/oauth/revoke",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-authorization-server",
  ];

  it.each(COLD)("%s is answered by its route, not redirected to /login", async (url) => {
    const response = await updateSession(new NextRequest(new URL(url, "https://one.vpps.co.in"), { method: "POST" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  // The staff WhatsApp timers (scripts/ops/schedule-staff-notices-cron.sql)
  // knock with pg_net's GET and a per-job token, with no cookie at all.
  it.each(["staff-notices", "fee-day-summary", "fee-day-not-closed"])(
    "the pg_cron GET to /api/jobs/%s with a token is answered by the route, not redirected",
    async (job) => {
      const url = `/api/jobs/${job}?token=0123456789abcdef0123456789abcdef`;
      const response = await updateSession(new NextRequest(new URL(url, "https://one.vpps.co.in")));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it("still sends the fee screens — and the AI consent page — to /login", async () => {
    // The opening is the prefixes above, not the fee area: /fees/payments/online
    // is staff-only. The AI connection's consent page stays behind sign-in,
    // and the login round trip keeps its whole query.
    for (const url of ["/fees/payments/online", "/payments", "/paying", "/api/fees/admin/revalidate-after-bulk", "/mcp/authorize", "/api/mcpx", "/.well-known/oauth-protected-resourcex", "/settings/ai-connection"]) {
      const response = await updateSession(new NextRequest(new URL(url, "https://one.vpps.co.in")));
      expect(response.status, url).toBe(307);
    }
    const consent = "/mcp/authorize?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=s%26t&code_challenge=x&code_challenge_method=S256";
    const response = await updateSession(new NextRequest(new URL(consent, "https://one.vpps.co.in")));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(consent);
  });
});
