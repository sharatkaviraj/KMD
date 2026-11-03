#!/usr/bin/env node
/**
 * Is everything ready for a Smoke Lab run? **Read-only**: it opens no run,
 * issues no pass and changes nothing, so it is safe to run any time.
 *
 *   npm run smoke:ready                                     # the committed school-day plan
 *   npm run smoke:ready -- docs/smoke/plans/school-day.json
 *   APP_ORIGIN=https://vppsone.vercel.app npm run smoke:ready
 *
 * 1. The plan: every seat in the pool, personas the console will keep, waves
 *    in clock order (`checkPlan`). `open-run.mjs` otherwise finds these out
 *    half-way through a browser session.
 * 2. The app at APP_ORIGIN (default http://localhost:3200, as open-run) has
 *    the lab on: `/api/lab/brief` without a pass answers 401. A 404 means the
 *    deployment is declared live or is not on the test database.
 * 3. With the dev service key in `.env.local`: every planned seat has its
 *    sign-in account, staff profile and smoke flag; no run is already open;
 *    and the AI helper's month has room for the run at its seat cap (D-331).
 *    Without the key this part is skipped and says so.
 *
 * Exits 1 on any error. Prints no key, pass or link.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { monthStartIst } from "@/modules/assist/domain/cost";
import { SMOKE_ASSIST_DAILY_CAP } from "@/modules/smoke/domain/limits";
import { checkPlan } from "@/modules/smoke/domain/plan";

import { isOneMainProjectUrl } from "../target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const planPath = path.resolve(process.argv[2] ?? path.join(repoRoot, "docs/smoke/plans/school-day.json"));
const origin = process.env.APP_ORIGIN ?? "http://localhost:3200";

// A Sonnet draft (remarks, results, the brief) is about two cents; Haiku ones are far less.
const DEARER_DRAFT_USD = 0.03;

let failed = false;
const ok = (line) => console.log(`  ok    ${line}`);
const warn = (line) => console.log(`  warn  ${line}`);
const fail = (line) => {
  failed = true;
  console.log(`  FAIL  ${line}`);
};

/* ------------------------------------------------------------- the plan */

console.log(`Plan  ${path.relative(repoRoot, planPath)}`);
let plan = null;
try {
  plan = JSON.parse(readFileSync(planPath, "utf8"));
} catch (error) {
  fail(`cannot read the plan: ${error.message}`);
}
if (plan) {
  const { errors, warnings } = checkPlan(plan);
  for (const line of errors) fail(line);
  for (const line of warnings) warn(line);
  if (!errors.length) ok(`${plan.seats.length} seats, ${plan.waves?.length ?? 0} waves, school day ${plan.schoolDay} from ${plan.clockStart} for ${plan.hours} h`);
}

/* -------------------------------------------------------------- the app */

console.log(`\nApp   ${origin}`);
try {
  const res = await fetch(new URL("/api/lab/brief", origin), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (res.status === 401) ok("the lab is on (a brief without a pass is refused with 401)");
  else if (res.status === 404) fail("the lab is off here: this deployment is declared live or is not on the test database");
  else fail(`/api/lab/brief answered ${res.status}; expected 401`);
} catch (error) {
  fail(`nothing answers at ${origin} (${error.cause?.code ?? error.message}). Start a production build or set APP_ORIGIN.`);
}

/* --------------------------------------------------------- the database */

console.log("\nTest database");
const envFile = path.join(repoRoot, ".env.local");
const env = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, "utf8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        }),
    )
  : {};

if (!isOneMainProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL) || !env.SUPABASE_SERVICE_ROLE_KEY) {
  warn("skipped: .env.local has no One main-project URL and service key (rule 3). `npm run smoke:pool -- status` needs them too.");
} else if (plan?.seats?.length) {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "vppsone" },
  });

  const emails = plan.seats.map((seat) => `smoke.${seat.key}@qa.vpps.local`);
  const { data: pool, error: poolError } = await db.from("smoke_pool").select("email, auth_user_id, staff_profile_id").in("email", emails);
  if (poolError) fail(`cannot read smoke_pool: ${poolError.message}`);
  else {
    const byEmail = new Map(pool.map((row) => [row.email, row]));
    const unready = [];
    for (const email of emails) {
      const row = byEmail.get(email);
      if (!row?.auth_user_id || !row.staff_profile_id) {
        unready.push(email);
        continue;
      }
      const { data: user } = await db.auth.admin.getUserById(row.auth_user_id);
      if (user?.user?.app_metadata?.smoke_lab !== true) unready.push(email);
    }
    if (unready.length) fail(`${unready.length} seat(s) not ready: ${unready.join(", ")}. Run \`npm run smoke:pool\`.`);
    else ok(`all ${emails.length} planned seats have an account, a profile and the smoke flag`);
  }

  const { data: open } = await db.from("smoke_runs").select("title, expires_at").eq("status", "open").gt("expires_at", new Date().toISOString());
  if (open?.length) warn(`a run is already open (${open.map((r) => r.title).join("; ")}): its passes are live. Close it on /smoke first unless it is this one.`);
  else ok("no run is open, so every seat is signed out and banned until one is");

  const { data: assist } = await db.from("assist_settings").select("enabled, monthly_budget_usd").eq("id", 1).maybeSingle();
  if (!assist?.enabled) ok("the AI helper is off: no run can spend anything on it");
  else {
    const { data: spent } = await db.from("assist_log").select("cost_usd").gte("created_at", monthStartIst(new Date()).toISOString());
    const used = (spent ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
    const left = Number(assist.monthly_budget_usd) - used;
    const worst = plan.seats.length * SMOKE_ASSIST_DAILY_CAP * DEARER_DRAFT_USD;
    const line = `AI helper: $${left.toFixed(2)} left this month; this run spends at most about $${worst.toFixed(2)} (${plan.seats.length} seats x ${SMOKE_ASSIST_DAILY_CAP} drafts)`;
    if (left < worst) warn(`${line}. Drafts stop when the month's budget runs out, for the school's own testers too.`);
    else ok(line);
  }
}

console.log(failed ? "\nNot ready." : "\nReady. Nothing has been opened: open the run from the plan when you mean to start.");
process.exit(failed ? 1 : 0);
