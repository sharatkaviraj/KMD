#!/usr/bin/env node
/**
 * Open every screen as every role, and check the answer against the map.
 *
 *   npm run smoke:roles                      # against the dev server
 *   APP_ORIGIN=https://… npm run smoke:roles
 *   npm run smoke:roles -- --json            # machine-readable result per case
 *   npm run smoke:roles -- --strict          # a known drift fails too
 *
 * **Three readings of who may open what, and they are not the same thing.**
 *
 *  1. `permissions.ts` — the map.
 *  2. Each page's own `requirePermission()` — what actually refuses.
 *  3. `tests/fixtures/role-expectations.ts` — PLAN §3, written by hand.
 *
 * (1) against (2) is what this has always checked, and it catches a page that
 * names the wrong permission or forgets to ask — which no unit test can, since
 * the test would assert the same map the page is wrong about.
 *
 * (3) is new in R0.3, because (1) and (2) can agree with each other and both
 * be wrong about the product (B-09). A disagreement there is a *drift*: it has
 * to be listed in `role-expectations.ts` with an owner, and an unlisted one
 * fails the run.
 *
 * A missing fixture fails, a hung case fails, and a run that executed fewer
 * combinations than it set out to refuses to report a pass (B-10).
 *
 * Dev only (rule 3), and it only ever issues GETs — it opens screens, it does
 * not press anything.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { can, staffRoles } from "../src/platform/auth/permissions.ts";
import { accountsByRole } from "../tests/fixtures/qa-accounts.ts";
import {
  differenceFor,
  productAllows,
} from "../tests/fixtures/role-expectations.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

/**
 * One case, one deadline.
 *
 * A screen that hangs used to hang the whole run, and a run that never
 * finishes reports nothing at all. Twenty seconds is far longer than any of
 * these screens takes, and short enough that thirty-six of them cannot add
 * up to an afternoon.
 */
const CASE_TIMEOUT_MS = 20_000;

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_PROJECT_REF)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

/* ------------------------------------------- what each screen asks for */

/** `/route` → the permission its own guard names, or null for "any staff". */
function guards() {
  const base = path.join(repoRoot, "src/app/(app)");
  const found = new Map();

  const walk = (dir, route) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${route}/${entry.name}`);
      } else if (entry.name === "page.tsx") {
        const source = readFileSync(full, "utf8").replace(/\r\n/g, "\n");

        const one = source.match(/requirePermission\(\s*"([\w:]+)"/);
        const many = source.match(/requireAnyPermission\(\s*\[([^\]]+)\]/);

        found.set(route === "" ? "/" : route, {
          any: many
            ? [...many[1].matchAll(/"([\w:]+)"/g)].map((m) => m[1])
            : null,
          permission: one ? one[1] : null,
        });
      }
    }
  };

  walk(base, "");
  return found;
}

/* ---------------------------------------------------- real ids to visit */

async function fillIds(route) {
  const pick = async (table, where = {}) => {
    let query = db.from(table).select("id").limit(1);
    for (const [k, v] of Object.entries(where)) query = query.eq(k, v);
    const { data } = await query.maybeSingle();
    return data?.id ?? null;
  };

  const map = {
    "[id]": null,
    "[paperId]": await pick("assessment_subjects"),
    "[studentId]": null,
  };

  if (route.startsWith("/assessments/[id]")) map["[id]"] = await pick("assessments");
  else if (route.startsWith("/collection/rounds/[id]")) map["[id]"] = await pick("collection_rounds");
  else if (route.startsWith("/collection/[id]")) map["[id]"] = await pick("collection_requests");
  else if (route.startsWith("/staff/[id]")) map["[id]"] = await pick("staff_profiles");
  else if (route.startsWith("/timetable/[id]")) map["[id]"] = await pick("timetable_versions");
  else if (route.startsWith("/academics/subjects/[id]")) map["[id]"] = await pick("subjects");
  else if (route.startsWith("/teach/class/[id]")) {
    const { data } = await db.from("enrolments").select("class_id").limit(1).maybeSingle();
    map["[id]"] = data?.class_id ?? null;
  } else if (route.startsWith("/teach/student/[id]")) {
    const { data } = await db.from("enrolments").select("student_id").limit(1).maybeSingle();
    map["[id]"] = data?.student_id ?? null;
  }

  if (route.includes("[studentId]")) {
    const { data } = await db.from("enrolments").select("student_id").limit(1).maybeSingle();
    map["[studentId]"] = data?.student_id ?? null;
  }

  let filled = route;
  for (const [token, value] of Object.entries(map)) {
    if (!filled.includes(token)) continue;
    if (!value) return null;
    filled = filled.replace(token, value);
  }
  return filled;
}

/* ------------------------------------------------------------ signing in */

/**
 * One address per role, taken from the fixture list rather than written here.
 *
 * It used to be six addresses typed into this file, and that is how B-17 stayed
 * invisible: the account this signed in as for `teacher` had no class, no
 * periods and no assignments, so thirty-six of the 216 combinations were
 * results about an empty teacher. `tests/fixtures/qa-accounts.ts` now says what
 * each account is *for*, and `npm run qa:seed` makes it true.
 */
const ACCOUNTS = accountsByRole();

for (const role of staffRoles) {
  if (!ACCOUNTS[role]) {
    console.error(`No QA account for ${role}. Run \`npm run qa:seed\` first.`);
    process.exit(1);
  }
}

/** Sign in with a minted link and return the cookie header it leaves behind. */
async function signIn(email) {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`${email}: ${error.message}`);

  const jar = new Map();
  let url = `${origin}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=%2Fdashboard`;

  for (let hop = 0; hop < 5; hop += 1) {
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
    if (url.includes("/login")) throw new Error(`${email}: sign-in bounced to /login`);
  }

  if (jar.size === 0) throw new Error(`${email}: no session cookie`);
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/* ------------------------------------------------------------- the visit */

async function visit(pathname, cookie) {
  let url = `${origin}${pathname}`;

  for (let hop = 0; hop < 6; hop += 1) {
    const response = await fetch(url, { redirect: "manual", headers: { cookie } });
    const location = response.headers.get("location");

    if (!location) {
      if (response.status >= 500) return "error";
      if (response.status === 404) return "not-found";
      if (response.status >= 400) return `http-${response.status}`;

      const body = await response.text();

      // **A guard that fires mid-stream does not get to set a status.** Once
      // the shell has started going out, `redirect()` cannot send a 307, so
      // Next puts the destination in a meta refresh instead and the browser
      // follows it. The response is a 200 carrying a redirect — read the
      // status alone and every refusal in the app looks like a page that
      // rendered, which is exactly what this script concluded the first time
      // it ran, about all six roles at once.
      const streamed = body.match(
        /id="__next-page-redirect"[^>]*content="[^";]*;url=([^"]+)"/,
      );

      if (streamed) {
        const target = streamed[1];
        if (target.includes("/access-denied")) return "access-denied";
        if (target.includes("/login")) return "login";
        return `redirected-to ${target}`;
      }

      // Next renders the error boundary with a 200 too, so the status alone
      // does not tell you the page threw.
      if (body.includes("कुछ गड़बड़ हो गई") || body.includes("Something went wrong")) {
        return "error";
      }
      return "rendered";
    }

    url = new URL(location, origin).toString();
    if (url.includes("/access-denied")) return "access-denied";
    if (url.includes("/login")) return "login";
  }

  return "redirect-loop";
}

/** `visit`, but a case that hangs is a failed case rather than a hung run. */
async function visitWithTimeout(pathname, cookie) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CASE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([visit(pathname, cookie), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ run */

const pages = guards();
const routes = [...pages.keys()].filter((route) => route !== "/access-denied").sort();
const expectedCombinations = routes.length * staffRoles.length;

console.log(
  `${routes.length} screens × ${staffRoles.length} roles = ${expectedCombinations} combinations`,
);
console.log(`origin ${origin}\n`);

const results = [];
const failures = [];
const drifts = [];

for (const role of staffRoles) {
  const cookie = await signIn(ACCOUNTS[role]);
  const notes = [];

  for (const route of routes) {
    const guard = pages.get(route);
    const startedAt = Date.now();

    /**
     * A missing fixture is a **failure**, not a skip.
     *
     * `fillIds` returns null when there is no row to visit, and the loop used
     * to shrug and carry on — so a run that checked 150 of 216 combinations
     * exited 0 and printed a tick (B-10). Nothing said which 66 were missing,
     * and "no assessments in the database" looks exactly like "everything
     * passed".
     */
    const filled = await fillIds(route);

    if (!filled) {
      const result = {
        role,
        route,
        outcome: "no-fixture",
        expectedByMap: null,
        expectedByProduct: null,
        verdict: "fail",
        reason: "no test row exists to visit this route with — run `npm run qa:seed`",
        elapsedMs: Date.now() - startedAt,
      };
      results.push(result);
      failures.push(result);
      notes.push(`  ✗ ${route} — ${result.reason}`);
      continue;
    }

    const mapAllows = guard.any
      ? guard.any.some((p) => can({ role }, p))
      : guard.permission
        ? can({ role }, guard.permission)
        : true;

    const productAllowsIt = productAllows(route, role);

    const outcome = await visitWithTimeout(filled, cookie);
    const elapsedMs = Date.now() - startedAt;
    const expectedByMap = mapAllows ? "rendered" : "access-denied";
    const expectedByProduct = productAllowsIt ? "rendered" : "access-denied";

    const result = {
      role,
      route,
      outcome,
      expectedByMap,
      expectedByProduct,
      guard: guard.any ? `any(${guard.any.join("|")})` : (guard.permission ?? null),
      verdict: "ok",
      reason: null,
      elapsedMs,
    };

    /**
     * Three readings, and the difference between two kinds of disagreement.
     *
     * The screen disagreeing with the map is a **bug**: the guard names a
     * permission the map does not support, or forgets to ask. Nothing else in
     * this repository can see that.
     *
     * The map disagreeing with the product description is a **drift**: the
     * code is self-consistent and the product says something else. That has to
     * be written down in `role-expectations.ts` with an owner. An unlisted one
     * fails the run, because absorbing it silently is precisely what B-09 is
     * about.
     */
    if (outcome !== expectedByMap) {
      result.verdict = "fail";
      result.reason = `the screen disagrees with the permission map: expected ${expectedByMap}, got ${outcome}`;
      failures.push(result);
      notes.push(`  ✗ ${route} — expected ${expectedByMap}, got ${outcome}`);
    } else if (expectedByProduct !== expectedByMap) {
      const known = differenceFor(route, role, mapAllows);

      if (known) {
        result.verdict = "drift";
        result.reason = `${known.owner}: ${known.note}`;
        drifts.push(result);
      } else {
        result.verdict = "fail";
        result.reason = `the permission map disagrees with PLAN §3 and nothing in role-expectations.ts owns it: product says ${expectedByProduct}, the map says ${expectedByMap}`;
        failures.push(result);
        notes.push(`  ✗ ${route} — unowned drift: product ${expectedByProduct}, map ${expectedByMap}`);
      }
    }

    results.push(result);
  }

  const slowest = Math.max(
    0,
    ...results.filter((r) => r.role === role).map((r) => r.elapsedMs),
  );

  console.log(
    `${role.padEnd(22)} ${notes.length === 0 ? "✓" : `${notes.length} to look at`}  (slowest ${slowest}ms)`,
  );
  for (const note of notes) console.log(note);
}

/* -------------------------------------------------------------- report */

const report = {
  checkedAt: new Date().toISOString(),
  origin,
  screens: routes.length,
  roles: staffRoles.length,
  expected: expectedCombinations,
  executed: results.length,
  passed: results.filter((r) => r.verdict === "ok").length,
  drifted: drifts.length,
  failed: failures.length,
  results,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
}

console.log(
  `\n${report.executed} of ${report.expected} executed · ${report.passed} as expected · ${report.drifted} known drift · ${report.failed} failed`,
);

/**
 * A run that checked fewer combinations than it set out to has not passed
 * (D-96). Before this, the count was incremented inside the loop and nothing
 * compared it to anything.
 */
if (report.executed !== report.expected) {
  console.error(
    `\nRefusing to report a pass: ${report.expected - report.executed} combinations never ran.`,
  );
  process.exit(1);
}

if (drifts.length > 0) {
  console.log(
    `\n${drifts.length} combination${drifts.length === 1 ? "" : "s"} where the code and PLAN §3 disagree, each owned in role-expectations.ts:\n`,
  );
  const byOwner = new Map();
  for (const drift of drifts) {
    const owner = drift.reason.split(":")[0];
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), `${drift.role} · ${drift.route}`]);
  }
  for (const [owner, cases] of byOwner) {
    console.log(`  ${owner} — ${cases.length} case${cases.length === 1 ? "" : "s"}`);
    for (const entry of cases) console.log(`    ${entry}`);
  }
}

if (failures.length > 0) {
  console.log(`\n${failures.length} failure${failures.length === 1 ? "" : "s"}:\n`);
  for (const failure of failures) {
    console.log(`  ${failure.role} · ${failure.route} — ${failure.reason}`);
  }
  process.exit(1);
}

// `--strict` is what R1.2 turns on once the viewer's reach is resolved: it
// makes a known drift fail too, so the list cannot quietly grow a permanent
// resident.
if (strict && drifts.length > 0) {
  console.error("\n--strict: a known drift is still a disagreement.");
  process.exit(1);
}

console.log("\nEvery screen answered the way the permission map says it should.");
