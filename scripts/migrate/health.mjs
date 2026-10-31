#!/usr/bin/env node
/**
 * The health pack in a terminal (go-live Phase G, plan §9.1; critique1 B9).
 * Read-only on One; never touches the fees database.
 *
 *   npm run migrate:health -- [--hours 24] [--json] [--probe https://one.vpps.co.in]
 *
 * Reads `vppsone.ops_health_counts()` through the direct connection
 * (lib/one-db.mjs — One's main project only) and judges it with the app's own
 * rules (`src/modules/ops-health/domain/health.ts`), so the terminal and the
 * `health` job (`/api/jobs/health`, which alerts the admins) never disagree.
 * Counts only: no row, name or phone is read.
 *
 * `--probe <origin>` also does the plan's uptime check on the Razorpay
 * webhook: a POST with a deliberately wrong signature must be answered 401
 * (a 404 means `RAZORPAY_WEBHOOK_SECRET` is not set on that deployment). The
 * route checks the signature before it reads or writes anything, so the probe
 * leaves no row. Only One's own hosts are probed. Before the cutover line
 * a 404 is "not configured yet" (C6 sets the secret); after it, a problem.
 * The scheduled `health` job runs the same probe against its own origin.
 * `--probe` also asks the test-only doors cold (COLD_ROUTES): each must
 * refuse a stranger.
 *
 * Exit 0 when quiet, 1 when something needs a person, 2 when the counts could
 * not be read at all.
 */

import process from "node:process";

import {
  alertPayload,
  evaluateHealth,
  healthSummary,
  probeVerdict,
  WEBHOOK_PROBE_REQUEST,
} from "../../src/modules/ops-health/domain/health.ts";
import { isMain, loadOneEnv, parseArgs } from "./lib/env.mjs";
import { openOneDb } from "./lib/one-db.mjs";

/** One's own hosts; the probe is never sent anywhere else. */
export function probeOrigin(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error("--probe takes an origin such as https://one.vpps.co.in");
  }
  const host = url.hostname;
  const ours =
    host === "one.vpps.co.in" ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    (/^vpps-?one[a-z0-9-]*\.vercel\.app$/.test(host) && url.protocol === "https:");
  if (!ours) throw new Error(`Refusing to probe ${host}: only One's own hosts.`);
  if (host === "one.vpps.co.in" && url.protocol !== "https:") throw new Error("one.vpps.co.in is probed over https only.");
  return url.origin;
}

/** What the webhook's answer means — the app's own rule (ops-health/domain/health.ts), so the job and the terminal agree. */
export { probeVerdict };

async function probeWebhook(origin, { cutover }) {
  const response = await fetch(`${origin}/api/webhooks/razorpay`, {
    ...WEBHOOK_PROBE_REQUEST,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  return probeVerdict(response.status, { cutover });
}

/**
 * The test-only doors, asked cold (no session, no key) — critique1 B17 under
 * the owner's override T1: on production they act for test accounts only, so
 * a stranger must be refused. Observed on one.vpps.co.in, 31 Oct 2026:
 * `/login/test` 404, `/login/dayrun` 404, `/lab/clock` 404, `/lab/enter`
 * 307 → /lab/ended, `/login/test/clock` 307 → /login.
 */
export const COLD_ROUTES = ["/login/test", "/login/test/clock", "/login/dayrun", "/lab/enter", "/lab/clock"];

/** A cold answer is a refusal: 401/403/404/405, or a redirect to sign-in or to the lab's "ended" page. Anything 2xx is not. */
export function coldRouteVerdict(status, location = "") {
  if ([401, 403, 404, 405].includes(status)) return { ok: true, note: String(status) };
  if (status >= 300 && status < 400) {
    const to = (() => {
      try {
        return new URL(location, "https://one.vpps.co.in").pathname;
      } catch {
        return "";
      }
    })();
    const refused = to === "/login" || to.startsWith("/lab/ended");
    return { ok: refused, note: `${status} → ${to || "?"}` };
  }
  return { ok: false, note: `${status}: answered a stranger` };
}

async function probeColdRoutes(origin) {
  const out = [];
  for (const route of COLD_ROUTES) {
    const response = await fetch(`${origin}${route}`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    out.push({ route, ...coldRouteVerdict(response.status, response.headers.get("location") ?? "") });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hours = Number(args.hours ?? 24);
  if (!Number.isInteger(hours) || hours < 1 || hours > 336) throw new Error("--hours is a whole number from 1 to 336.");

  const sql = await openOneDb(loadOneEnv());
  let counts;
  try {
    const rows = await sql.begin("read only", (tx) => tx`select vppsone.ops_health_counts(${hours}::int) as counts`);
    counts = rows[0]?.counts ?? null;
  } finally {
    await sql.end();
  }
  if (!counts || typeof counts !== "object") {
    console.error("health: the database returned no counts.");
    process.exitCode = 2;
    return;
  }

  const result = evaluateHealth(counts);
  const origin = typeof args.probe === "string" ? probeOrigin(args.probe) : null;
  const probe = origin ? await probeWebhook(origin, { cutover: Number(counts.cutover_rows ?? 1) > 0 }) : null;
  const cold = origin ? await probeColdRoutes(origin) : [];
  const coldBad = cold.filter((c) => !c.ok);

  if (args.json) {
    console.log(JSON.stringify({ counts, summary: healthSummary(result), probe, cold }, null, 2));
  } else {
    console.log(`health: ${counts.at} — last ${counts.window_hours} h; month from ${counts.month_start} (IST). Read-only, counts only.`);
    for (const finding of result.findings) {
      const mark = finding.status === "ok" ? "  ok " : finding.status === "problem" ? "  !! " : "  ?? ";
      const value = finding.status === "unreadable" ? "could not be read" : String(finding.value);
      const detail = finding.detail ? ` (${finding.detail.en})` : "";
      console.log(`${mark}${finding.label.en}: ${value}${detail}`);
    }
    if (probe) console.log(`${probe.ok ? "  ok " : "  !! "}Razorpay webhook probe: ${probe.note}`);
    for (const c of cold) console.log(`${c.ok ? "  ok " : "  !! "}cold ${c.route}: ${c.note}`);
    if (result.problems.length || result.unreadable.length) {
      console.log(`\nThe admin alert would say: ${alertPayload(result, String(counts.at).slice(0, 10)).what_en}`);
    }
  }
  if (result.problems.length || result.unreadable.length || (probe && !probe.ok) || coldBad.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(`health: ${error.message}`);
    process.exitCode = 2;
  });
}
