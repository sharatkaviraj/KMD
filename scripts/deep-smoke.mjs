#!/usr/bin/env node
/**
 * Open every screen as every account, and time each one.
 *
 *   node scripts/deep-smoke.mjs                  # against a running server
 *   APP_ORIGIN=https://… node scripts/deep-smoke.mjs
 *   node scripts/deep-smoke.mjs --json
 *
 * **How this differs from `smoke:roles`,** which it does not replace.
 * `smoke:roles` checks one account per *role* against the permission map and
 * fails on drift — it is the correctness gate. This walks every *account*,
 * including the three that share the `teacher` role and the one that is
 * supposed to be refused entry, and it records how long each screen took.
 *
 * Two things only this one sees:
 *
 *  - **All accounts.** Unlike the role gate, this also covers every teacher
 *    account and the staff account that must be refused entry.
 *  - **Timing.** A screen that renders in 4s is passing every correctness test
 *    there is and is still the reason somebody goes back to the paper register.
 *
 * Dev only, and it only ever issues GETs.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { QA_ACCOUNTS } from "../tests/fixtures/qa-accounts.ts";
import { isDevProjectUrl } from "./target-guard.mjs";
import { hasRenderedError } from "./smoke-response.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const asJson = process.argv.includes("--json");
const CASE_TIMEOUT_MS = 30_000;

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

if (!isDevProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const vppsone = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});
const fees = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "public" },
  auth: { persistSession: false },
});

/* ------------------------------------------------------------- the routes */

function routes() {
  const base = path.join(repoRoot, "src/app/(app)");
  const found = [];

  const walk = (dir, route) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      // Route groups like `(app)` do not appear in the URL.
      if (entry.isDirectory()) {
        walk(full, entry.name.startsWith("(") ? route : `${route}/${entry.name}`);
      } else if (entry.name === "page.tsx") {
        found.push(route === "" ? "/" : route);
      }
    }
  };

  walk(base, "");
  return found.sort();
}

/**
 * Real ids for the dynamic segments, from whichever schema owns the noun.
 *
 * A route whose id cannot be resolved is reported as `no-fixture` rather than
 * quietly dropped — an untestable screen is a finding, not an absence.
 */
async function ids() {
  const one = async (client, table, column = "id", filter) => {
    let query = client.from(table).select(column).limit(1);
    if (filter) query = query.eq(filter[0], filter[1]);
    const { data } = await query.maybeSingle();
    return data?.[column] ?? null;
  };

  return {
    "/academics/subjects/[id]": await one(vppsone, "subjects"),
    "/assessments/[id]": await one(vppsone, "assessments"),
    "/assessments/marks/[paperId]": await one(vppsone, "assessment_subjects"),
    "/assessments/report/[studentId]": await one(vppsone, "enrolments", "student_id"),
    "/collection/[id]": await one(vppsone, "collection_requests"),
    "/collection/rounds/[id]": await one(vppsone, "collection_rounds"),
    "/duty/[id]": process.env.SMOKE_DUTY_ID ?? await one(vppsone, "cover_duties"),
    "/staff/[id]": await one(vppsone, "staff_profiles"),
    "/staff/[id]/edit": await one(vppsone, "staff_profiles"),
    "/teach/class/[id]": await one(vppsone, "enrolments", "class_id"),
    "/teach/student/[id]": await one(vppsone, "enrolments", "student_id"),
    "/timetable/[id]": await one(vppsone, "timetable_versions"),

    "/fees/admin-tools/promotion/[runId]": await one(fees, "promotion_runs"),
    "/fees/receipts/[receiptId]": await one(fees, "receipts"),
    "/fees/reminders/runs/[runId]": process.env.SMOKE_RUN_ID ?? await one(fees, "whatsapp_campaign_runs"),
    "/fees/reports/ledger/[studentId]/print": await one(fees, "students"),
    "/fees/students/[studentId]": await one(fees, "students"),
    "/fees/students/[studentId]/edit": await one(fees, "students"),
    "/fees/students/[studentId]/statement": await one(fees, "students"),
    "/fees/students/family/[familyGroupId]/statement": await one(
      fees,
      "student_family_groups",
    ),
  };
}

/* ---------------------------------------------------------- signing in */

async function signIn(email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`${email}: ${error.message}`);

  const jar = new Map();
  let url = `${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2Fdashboard`;

  for (let hop = 0; hop < 6; hop += 1) {
    if (new URL(url).origin !== new URL(origin).origin) {
      throw new Error("QA sign-in redirected outside the test app.");
    }
    const response = await fetch(url, {
      redirect: "manual",
      headers: jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {},
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || raw.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, value);
    }

    const location = response.headers.get("location");
    if (!location) break;
    url = new URL(location, origin).toString();
    if (url.includes("/login")) return { refused: true, cookie: null };
  }

  if (jar.size === 0) return { refused: true, cookie: null };
  return { refused: false, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
}

/* ------------------------------------------------------------- the visit */

async function visit(pathname, cookie) {
  const started = Date.now();
  let url = `${origin}${pathname}`;

  for (let hop = 0; hop < 6; hop += 1) {
    // Stop at an external handoff: the browser would not send these cookies
    // to a different origin, and neither should the smoke runner.
    if (new URL(url).origin !== new URL(origin).origin) {
      return { result: "rendered", handoff: new URL(url).origin, ms: Date.now() - started };
    }
    const response = await fetch(url, {
      redirect: "manual",
      headers: { cookie },
      signal: AbortSignal.timeout(CASE_TIMEOUT_MS),
    });
    const location = response.headers.get("location");

    if (!location) {
      let ms = Date.now() - started;
      if (response.status >= 500) return { result: "error", ms, status: response.status };
      if (response.status === 404) return { result: "not-found", ms, status: 404 };
      if (response.status >= 400) {
        return { result: `http-${response.status}`, ms, status: response.status };
      }

      const body = await response.text();
      ms = Date.now() - started;

      // A guard that fires after the shell has started streaming cannot send
      // a 307; Next puts the destination in a meta refresh instead. Reading
      // the status alone makes every refusal look like a page that rendered.
      const streamed = body.match(
        /id="__next-page-redirect"[^>]*content="[^";]*;url=([^"]+)"/,
      );
      if (streamed) {
        const target = streamed[1];
        if (target.includes("/access-denied")) return { result: "access-denied", ms };
        if (target.includes("/login")) return { result: "login", ms };
        url = new URL(target.replaceAll("&amp;", "&"), origin).toString();
        continue;
      }

      // The error boundary renders with a 200, so the status does not say
      // whether the page threw.
      if (hasRenderedError(body)) {
        return { result: "error", ms, status: response.status };
      }

      return { result: "rendered", ms, status: response.status, bytes: body.length };
    }

    url = new URL(location, origin).toString();
    if (url.includes("/access-denied")) return { result: "access-denied", ms: Date.now() - started };
    if (url.includes("/login")) return { result: "login", ms: Date.now() - started };
  }

  return { result: "redirect-loop", ms: Date.now() - started };
}

/* ------------------------------------------------------------------ main */

const ALL_ROUTES = routes();
const ID_MAP = await ids();

const missingFixtures = ALL_ROUTES.filter((route) => route.includes("[") && ID_MAP[route] == null);

function resolve(route) {
  if (!route.includes("[")) return route;
  const value = ID_MAP[route];
  if (value == null) return null;
  return route.replace(/\[[^\]]+\]/, value);
}

console.log(`\n  Deep smoke  ${origin}`);
console.log(`  ${QA_ACCOUNTS.length} accounts x ${ALL_ROUTES.length} routes\n`);

if (missingFixtures.length > 0) {
  console.log(`  No fixture id, cannot be opened at all:`);
  for (const route of missingFixtures) console.log(`    ${route}`);
  console.log("");
}

const cases = [];
const failures = [];

for (const account of QA_ACCOUNTS) {
  const { refused, cookie } = await signIn(account.email);

  if (refused) {
    const expected = account.canSignIn === false;
    console.log(
      `  ${account.key.padEnd(22)} ${expected ? "refused (correct)" : "REFUSED UNEXPECTEDLY"}`,
    );
    if (!expected) failures.push({ account: account.key, route: "(sign-in)", result: "refused" });
    cases.push({ account: account.key, role: account.role, route: "(sign-in)", result: "refused" });
    continue;
  }

  if (account.canSignIn === false) {
    console.log(`  ${account.key.padEnd(22)} SIGNED IN BUT SHOULD NOT HAVE`);
    failures.push({ account: account.key, route: "(sign-in)", result: "allowed" });
  }

  let rendered = 0;
  let denied = 0;
  let broken = 0;
  let slowest = { route: null, ms: 0 };

  for (const route of ALL_ROUTES) {
    const pathname = resolve(route);
    if (pathname === null) {
      cases.push({ account: account.key, role: account.role, route, result: "no-fixture" });
      continue;
    }

    let outcome;
    try {
      outcome = await visit(pathname, cookie);
    } catch (error) {
      outcome = { result: "threw", ms: CASE_TIMEOUT_MS, detail: String(error.message ?? error) };
    }

    if (outcome.result === "rendered") rendered += 1;
    else if (outcome.result === "access-denied") denied += 1;
    else {
      broken += 1;
      failures.push({ account: account.key, role: account.role, route, ...outcome });
    }

    if ((outcome.ms ?? 0) > slowest.ms) slowest = { route, ms: outcome.ms };

    cases.push({ account: account.key, role: account.role, route, ...outcome });
  }

  console.log(
    `  ${account.key.padEnd(22)} ${String(rendered).padStart(3)} rendered` +
      `  ${String(denied).padStart(3)} denied` +
      `  ${String(broken).padStart(3)} broken` +
      `   slowest ${slowest.route ?? "-"} ${slowest.ms}ms`,
  );
}

/* --------------------------------------------------------------- summary */

console.log(`\n  ${cases.length} cases, ${failures.length} not rendered or denied\n`);

if (failures.length > 0) {
  console.log(`  Broken:`);
  const grouped = new Map();
  for (const failure of failures) {
    const key = `${failure.route} -> ${failure.result}`;
    grouped.set(key, [...(grouped.get(key) ?? []), failure.account]);
  }
  for (const [key, accounts] of [...grouped].sort()) {
    console.log(`    ${key.padEnd(62)} ${accounts.join(", ")}`);
  }
  console.log("");
}

// The slowest screens, across every account that was allowed to open them.
const timings = new Map();
for (const one of cases) {
  if (one.result !== "rendered") continue;
  const seen = timings.get(one.route) ?? [];
  timings.set(one.route, [...seen, one.ms]);
}

const slowest = [...timings]
  .map(([route, all]) => ({
    route,
    worst: Math.max(...all),
    median: all.sort((a, b) => a - b)[Math.floor(all.length / 2)],
    opens: all.length,
  }))
  .sort((a, b) => b.median - a.median)
  .slice(0, 20);

console.log(`  Slowest screens (median across accounts that could open them):`);
for (const row of slowest) {
  console.log(
    `    ${row.route.padEnd(50)} ${String(row.median).padStart(6)}ms median` +
      `  ${String(row.worst).padStart(6)}ms worst  (${row.opens})`,
  );
}

const report = {
  at: new Date().toISOString(),
  origin,
  accounts: QA_ACCOUNTS.length,
  routes: ALL_ROUTES.length,
  cases: cases.length,
  failures,
  missingFixtures,
  slowest,
};

const writeAt = process.argv.indexOf("--write");
if (writeAt !== -1 && !process.argv[writeAt + 1]) throw new Error("--write requires a report path.");
const out = writeAt === -1 ? path.join(repoRoot, "docs", "deep-smoke-report.json") : path.resolve(process.argv[writeAt + 1]);
writeFileSync(out, `${JSON.stringify(asJson ? { ...report, cases } : report, null, 2)}\n`);
console.log(`\n  Report: ${path.relative(repoRoot, out)}\n`);

process.exit(failures.length > 0 || missingFixtures.length > 0 ? 1 : 0);
