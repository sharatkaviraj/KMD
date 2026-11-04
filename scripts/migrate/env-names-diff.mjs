#!/usr/bin/env node
/**
 * The environment inventory: which variable NAMES the fees app's code reads
 * and which One's code reads, side by side with what each Vercel Production
 * project has set (go-live Phase G, plan §9.3; critique1 B7).
 * Names only — never a value. Read-only on the fees repo (file reads; no git,
 * no script of it is run).
 *
 *   npm run migrate:env-names -- [--fees-repo <path>] [--out docs/cutover/ENV-INVENTORY.md] [--check]
 *   npm run migrate:env-names -- --vercel   # live Production names (CLI) against the snapshot below; exit 1 on drift
 *
 * Code side: a static scan (lib/env-scan.mjs) of `src/` and the root config
 * files of each repo, plus the fees MCP worker (`workers/`, Cloudflare, not
 * Vercel) in its own table. Vercel side: the name lists below, taken on
 * 31 Oct 2026 with `vercel env ls production --project <p>` (the CLI prints
 * names and hides values; the API refused this account a listing). Refresh
 * them the same way before C5 and re-run.
 *
 * Each name gets an owner and a status from ANNOTATIONS; a name the code
 * reads that has no annotation is printed as "TO SETTLE" and `--check`
 * exits 1, so a new variable cannot reach the cutover unexamined.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { isMain, parseArgs, repoRoot } from "./lib/env.mjs";
import { scanRoots, whereCell } from "./lib/env-scan.mjs";

export const DEFAULT_FEES_REPO = "D:\\github projects\\schoolfees";

/** Where each repo's app code lives (the build reads these; scripts/ and tests/ are tooling). */
export const APP_ROOTS = [
  "src",
  "next.config.ts",
  "next.config.mjs",
  "proxy.ts",
  "middleware.ts",
  "instrumentation.ts",
  "instrumentation-client.ts",
  "sentry.server.config.ts",
  "sentry.edge.config.ts",
];

/** Vercel Production name inventory refreshed through connector, 1 Nov 2026. */
export const VERCEL_PRODUCTION = {
  one: [
    "APP_MODE",
    "FEES_BRIDGE_ENABLED",
    "FEES_BRIDGE_ORIGIN",
    "FEES_BRIDGE_KEY",
    "FEES_BRIDGE_SYNC_KEY",
    "FEES_BRIDGE_CRON_SECRET",
    "FEES_BRIDGE_WRITES_ENABLED",
    // Set to true on 3 Nov 2026 after Fees 20261103170000 was applied (vercel env add).
    "FEES_BRIDGE_OFFICE_READS",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GEMINI_API_KEY_FREE",
    "OPEN_AI_API_KEY",
    // Built-in AI's switch (4 Nov 2026): `test`, then `live` (docs/ai/README.md).
    "VPPSONE_BUILTIN_AI",
    "CRON_SECRET",
    "JOBS_SECRET",
    "NEXT_PUBLIC_SCHOOL_NAME",
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "QA_LOGIN_KEY",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
    "VPPSONE_ENV",
  ],
  fees: [
    "ONE_BRIDGE_ENABLED",
    "ONE_BRIDGE_KEY",
    "ONE_BRIDGE_SYNC_SECRET",
    "ONE_BRIDGE_AUTH_URL",
    "ONE_BRIDGE_AUTH_ANON_KEY",
    "AISENSY_API_KEY",
    "AISENSY_CAMPAIGN",
    "APP_MODE",
    "CRON_SECRET",
    "FAMILY_PAYMENTS_ENABLED",
    "NEXT_PUBLIC_SCHOOL_ADDRESS",
    "NEXT_PUBLIC_SCHOOL_EMAIL",
    "NEXT_PUBLIC_SCHOOL_NAME",
    "NEXT_PUBLIC_SCHOOL_PHONE",
    "NEXT_PUBLIC_SENTRY_DSN",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "POSTGRES_DATABASE",
    "POSTGRES_HOST",
    "POSTGRES_PASSWORD",
    "POSTGRES_PRISMA_URL",
    "POSTGRES_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_USER",
    "PRODUCTION_SUPABASE_PROJECT_REF",
    "RAZORPAY_ACCOUNT_ID",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "REPAYMENT_PLANS",
    "SCHOOLFEES_DOC_TOKEN",
    "SENTRY_AUTH_TOKEN",
    "SUPABASE_ANON_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_URL",
  ],
};

const OWNER = "owner";
const SYSTEM = "Vercel (automatic)";

/**
 * name → [where the Production value comes from (who), what to do at C5].
 * "set" = already on One Production; "add at C5" = set it on One Production
 * at cutover step C5; "leave unset" = One's default is the intended value.
 */
export const ANNOTATIONS = {
  FEES_BRIDGE_ENABLED: [OWNER, "One production coexistence switch; configure after schema and identity verification"],
  FEES_BRIDGE_ORIGIN: [OWNER, "One production; exact canonical Fees HTTPS origin only"],
  FEES_BRIDGE_KEY: ["deployment operator", "new server-only bridge credential; shared with source ONE_BRIDGE_KEY; production only"],
  FEES_BRIDGE_SYNC_KEY: ["deployment operator", "separate source sync credential; production only"],
  FEES_BRIDGE_CRON_SECRET: ["deployment operator", "dedicated One scheduler credential; same value in Vault; production only"],
  FEES_BRIDGE_WRITES_ENABLED: [OWNER, "false until canonical TEST command acceptance and named actor grants; never enables local real fee writes"],
  FEES_BRIDGE_OFFICE_READS: [OWNER, "set true on 3 Nov 2026 once Fees migration 20261103170000_one_bridge_office_reads was applied: Fees totals, refund requests, receipt lookup and the day book"],
  ONE_BRIDGE_ENABLED: ["Fees deployment operator", "set on Fees production for coexistence; database read/command/sync gates remain independent"],
  ONE_BRIDGE_KEY: ["Fees deployment operator", "set on Fees production; new server-only credential matching One; no preview copy"],
  ONE_BRIDGE_SYNC_SECRET: ["Fees deployment operator", "set on Fees production; separate synchronization credential"],
  ONE_BRIDGE_AUTH_URL: ["Fees deployment operator", "set on Fees production; pinned One Auth project URL"],
  ONE_BRIDGE_AUTH_ANON_KEY: ["One publishable API key", "set on Fees production only to verify One access tokens; never a One service-role key"],
  SCHOOLFEES_LOCAL_ISOLATION: ["Fees local test runtime", "local tests only; never set on production"],
  // Supabase — One's own project wtgx; never the fees project's keys.
  NEXT_PUBLIC_SUPABASE_URL: ["Supabase wtgx → Settings → API (owner)", "set — keep wtgx (D-338); never the fees URL"],
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["Supabase wtgx → API keys (owner)", "set — wtgx's key"],
  SUPABASE_SERVICE_ROLE_KEY: ["Supabase wtgx → API keys (owner)", "set — wtgx's key; rotate if it was ever shared"],
  SUPABASE_URL: ["Supabase integration", "set on One (not read by One's code); fees: integration leftover"],
  SUPABASE_PROJECT_REF: ["owner", "set on One (not read by One's code; informational)"],
  // Deployment identity
  VPPSONE_ENV: [OWNER, "set; must be `live` at C5 — the parent gate (D-353) and live Razorpay keys (D-354 (3)) need it"],
  APP_MODE: [OWNER, "add at C5: `production` — required together with VPPSONE_ENV=live (`getFeeSchema()` throws otherwise)"],
  NEXT_PUBLIC_SITE_URL: [OWNER, "set — `https://one.vpps.co.in`"],
  VERCEL_ENV: [SYSTEM, "automatic — `production` is what makes a deployment unconfined (D-346)"],
  VERCEL_URL: [SYSTEM, "automatic"],
  VERCEL_BRANCH_URL: [SYSTEM, "automatic — a Preview's branch alias; the AI connection's issuer on a confined deployment only (production uses the verified origin)"],
  VERCEL_PROJECT_PRODUCTION_URL: [SYSTEM, "automatic"],
  VERCEL_REGION: [SYSTEM, "automatic"],
  VERCEL_GIT_COMMIT_SHA: [SYSTEM, "automatic (Sentry release, archive manifest)"],
  VERCEL_OIDC_TOKEN: [SYSTEM, "automatic when OIDC is on — Google workload identity for drive-backup / document-backup (the pool and service account are in the database, not env)"],
  NEXT_PUBLIC_VERCEL_ENV: [SYSTEM, "fees only (its Sentry client); not read by One"],
  NODE_ENV: ["Next.js (automatic)", "automatic"],
  NEXT_RUNTIME: ["Next.js (automatic)", "automatic"],
  CI: ["CI runner", "CI only — never set on Vercel"],
  VITEST: ["test runner", "tests only — never set on Vercel"],
  PLAYWRIGHT_TEST_BASE_URL: ["test runner", "tests only — never set on Vercel"],
  ANALYZE: ["fees build flag", "fees only (bundle analyzer); not needed"],
  // Jobs and crons
  CRON_SECRET: [OWNER, "set — Vercel cron bearer; also stored in Vault as VPPS_CRON_SECRET for the pg_cron jobs that call `/api/fees/cron/*` (one-live-cron-jobs.sql)"],
  JOBS_SECRET: [OWNER, "set — per-job tokens (`npm run jobs:tokens`) go into Vault for pg_cron"],
  ONLINE_PAYMENTS_CRON_SECRET: [OWNER, "leave unset — the pg_cron job sends Vault's VPPS_ONLINE_PAYMENTS_CRON_SECRET, checked in the database (RAZORPAY.md §5)"],
  WHATSAPP_CRON_SECRET: [OWNER, "leave unset — the pg_cron job sends Vault's VPPS_WHATSAPP_CRON_SECRET (whatsapp_cron_secret_matches)"],
  // School identity (receipts, PDFs)
  NEXT_PUBLIC_SCHOOL_NAME: ["fees Production value (owner)", "set"],
  NEXT_PUBLIC_SCHOOL_PHONE: ["copy the fees Production value (owner)", "add at C5 — receipt header (critique1 B6)"],
  NEXT_PUBLIC_SCHOOL_ADDRESS: ["copy the fees Production value (owner)", "add at C5 — receipt header"],
  NEXT_PUBLIC_SCHOOL_EMAIL: ["copy the fees Production value (owner)", "add at C5 — receipt header"],
  // Fee features
  REPAYMENT_PLANS: ["copy the fees Production value (owner)", "add at C5 — EMI plan creation is off in production without it"],
  LOCALE_SWITCHER_ENABLED: [OWNER, "leave unset (on); not set on fees either"],
  SCHOOLFEES_DOC_TOKEN: ["new value (owner) for One's document bridge", "add only if a One MCP worker needs documents (MCP-AND-NOTION.md); unset = route answers 503"],
  FAMILY_PAYMENTS_ENABLED: ["fees", "fees only — not read by either codebase at 8a0cd47c; not needed"],
  AISENSY_CAMPAIGN: ["fees", "fees only — not read by either codebase; not needed"],
  // Razorpay — the same account, keys copied (plan §7), rotated after sign-off
  RAZORPAY_KEY_ID: ["Razorpay dashboard (owner); same pair as fees until rotation", "add at C5 (`rzp_live_` counts only with VERCEL_ENV=production and VPPSONE_ENV=live)"],
  RAZORPAY_KEY_SECRET: ["Razorpay dashboard (owner)", "add at C5"],
  RAZORPAY_WEBHOOK_SECRET: ["new secret for One's own webhook (owner, C6)", "add at C6 — unset, `/api/webhooks/razorpay` answers 404 (`npm run migrate:health -- --probe` checks 401)"],
  RAZORPAY_ACCOUNT_ID: ["Razorpay dashboard (owner)", "add at C5 — events for any other account are ignored"],
  // WhatsApp (AiSensy)
  AISENSY_API_KEY: ["AiSensy dashboard (owner); same key as fees", "add at C5 — without it every AiSensy send is off"],
  AISENSY_WEBHOOK_SECRET: [OWNER, "leave unset — delivery webhooks are an AiSensy Pro feature; Basic plan (route answers 404)"],
  AISENSY_CAMPAIGN_PREFIX: [OWNER, "leave unset — template names as submitted"],
  AISENSY_TASK_CONTRACT: [OWNER, "leave unset unless the teacher-task link goes by AiSensy (then `v1`)"],
  AISENSY_TASK_CAMPAIGN_ORIGIN: [OWNER, "leave unset unless the teacher-task link goes by AiSensy (then the site origin)"],
  MESSAGE_PROVIDER: [OWNER, "add at C9 — `aisensy`; `mock` is refused on live"],
  STAFF_NOTICE_TRANSPORT: [OWNER, "add when staff WhatsApp starts (T+7) — `aisensy`; unset on live = disabled (STAFF-WHATSAPP.md §4)"],
  // AI
  ANTHROPIC_API_KEY: [OWNER, "set — `assist` reading real data needs the owner's yes (MCP-AND-NOTION.md, Q13)"],
  GEMINI_API_KEY: [OWNER, "set — server-only Gemini paid-fallback slot for built-in AI"],
  GEMINI_API_KEY_FREE: [OWNER, "set — free Gemini key; used only for TEST-session (fictional) media, never real records"],
  GEMINI_API_KEY_PAID: [OWNER, "optional override for the existing GEMINI_API_KEY fallback slot"],
  GEMINI_MODEL_PAID: [OWNER, "confined Gemini paid fallback; pinned model"],
  OPEN_AI_API_KEY: [OWNER, "set — server-only OpenAI transcription key for built-in AI voice"],
  OPENAI_API_KEY: [OWNER, "optional compatibility alias if OPEN_AI_API_KEY is absent"],
  VPPSONE_CLAUDE_IMAGE_MODEL: [OWNER, "pinned image extraction model; defaults to Claude Sonnet 5.5"],
  VPPSONE_CLAUDE_VOICE_MODEL: [OWNER, "pinned voice understanding model; defaults to Claude Haiku 5.5"],
  VPPSONE_OPENAI_TRANSCRIPTION_MODEL: [OWNER, "pinned voice transcription model; defaults to gpt-transcribe"],
  VPPSONE_BUILTIN_AI_COVER_AUTO_TEST: [OWNER, "leave off outside an approved fictional TEST cover rehearsal"],
  VPPSONE_BUILTIN_AI: [OWNER, "set — `live` (all permitted staff, their own session) or `test` (TEST sessions only); unset = off"],
  VPPSONE_BUILTIN_AI_COVER_AUTO: [OWNER, "leave unset (valid cover-photo rows apply with a 2-minute Undo); `0` = review only"],
  GEMINI_MODEL: [OWNER, "confined Gemini pilot only; defaults to gemini-3.5-flash-lite"],
  GEMINI_MODEL_VISION: [OWNER, "confined Gemini pilot only; defaults to GEMINI_MODEL"],
  GEMINI_MODEL_FALLBACK: [OWNER, "confined Gemini pilot only; defaults to gemini-3.8-flash"],
  GEMINI_THINKING_LEVEL: [OWNER, "confined Gemini pilot only; optional minimal or low"],
  GEMINI_THINKING_BUDGET: [OWNER, "confined Gemini pilot only; optional Gemini 2.5 budget"],
  GEMINI_INR_PER_USD: [OWNER, "confined Gemini pilot only; accounting conversion (default 90)"],
  VPPSONE_BUILTIN_AI_TEST: [OWNER, "leave unset; Preview/local pilot switch only, production ignores it"],
  OPENAI_MODEL: ["fees", "fees only; not read by One"],
  OAUTH_PROVIDER: ["fees MCP worker", "fees only"],
  // Monitoring
  NEXT_PUBLIC_SENTRY_DSN: [OWNER, "set on both projects; which Sentry project One's copy names is NOT recorded (owner: write the project name here). One's code does not read it, so One's errors never land in the fees project by accident"],
  SENTRY_DSN: [OWNER, "add at C5 — the DSN of a One-owned Sentry project (never the fees project's); unset = server errors are not reported (src/instrumentation.ts)"],
  SENTRY_AUTH_TOKEN: ["fees build", "fees only (source maps); One has no Sentry build step"],
  PERF_TIMING: [OWNER, "leave unset (off)"],
  VPPS_OBSERVABILITY_VERBOSE: [OWNER, "leave unset (off)"],
  // Test sign-in
  QA_LOGIN_KEY: [OWNER, "keep, ROTATE at T0 — the plan said remove (§9.3), the owner override of 30 Oct (D-346) keeps QA sign-in on production for test accounts only; testing happens in production under TEST-2026-27"],
  VPPSONE_SESSION_LABEL: [OWNER, "leave unset — the active session comes from app_settings (rule 3a)"],
  // Fees-only Vercel names
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ["fees", "fees only — One uses the publishable key"],
  SUPABASE_ANON_KEY: ["Supabase integration (fees)", "fees only"],
  SUPABASE_PUBLISHABLE_KEY: ["Supabase integration (fees)", "fees only (and its MCP worker)"],
  SUPABASE_SECRET_KEY: ["Supabase integration (fees)", "fees only"],
  SUPABASE_JWT_SECRET: ["Supabase integration (fees)", "fees only"],
  PRODUCTION_SUPABASE_PROJECT_REF: ["fees", "fees only"],
  POSTGRES_URL: ["Supabase integration (fees)", "fees only — One's scripts use SUPABASE_DEV_DB_PASSWORD locally, never on Vercel"],
  POSTGRES_PRISMA_URL: ["Supabase integration (fees)", "fees only"],
  POSTGRES_URL_NON_POOLING: ["Supabase integration (fees)", "fees only"],
  POSTGRES_USER: ["Supabase integration (fees)", "fees only"],
  POSTGRES_HOST: ["Supabase integration (fees)", "fees only"],
  POSTGRES_PASSWORD: ["Supabase integration (fees)", "fees only"],
  POSTGRES_DATABASE: ["Supabase integration (fees)", "fees only"],
};

/** The fees MCP worker's names (Cloudflare wrangler vars/secrets, not Vercel). */
export const WORKER_NOTE =
  "Cloudflare wrangler vars and secrets of `schoolfees-live-mcp`. Fees remains live during coexistence; do not freeze this worker or repoint its database.";

/** Build the rows: every name either side reads or has set on Vercel Production. */
export function inventoryRows({ one, fees, vercel = VERCEL_PRODUCTION, annotations = ANNOTATIONS }) {
  const names = new Set([...one.keys(), ...fees.keys(), ...vercel.one, ...vercel.fees]);
  return [...names].sort().map((name) => {
    const note = annotations[name];
    return {
      name,
      oneReads: one.get(name),
      feesReads: fees.get(name),
      oneSet: vercel.one.includes(name),
      feesSet: vercel.fees.includes(name),
      source: note?.[0] ?? "—",
      status: note?.[1] ?? "TO SETTLE",
    };
  });
}

export function renderInventory(rows, workerRows, { feesCommit, date }) {
  const yes = (v) => (v ? "yes" : "—");
  const lines = [
    "# Environment inventory — fees app vs One (names only)",
    "",
    "Go-live Phase G (plan §9.3; critique1 B7). **Generated** by",
    "`npm run migrate:env-names` — edit `scripts/migrate/env-names-diff.mjs`",
    "(`ANNOTATIONS`, `VERCEL_PRODUCTION`) and re-run; do not edit this file by hand.",
    "No value appears here or in the script.",
    "Coexistence supersedes the historical C5 provider-copy notes below: Fees retains Razorpay, fee messaging and financial jobs. Do not copy those secrets or activate competing One financial jobs for coexistence.",
    "",
    `- Code: static scan of each repo's app code (\`${APP_ROOTS.join("`, `")}\`) — One at this commit, the fees app at \`${feesCommit}\` (read-only).`,
    "  A name built at run time cannot be seen by the scan.",
    `- Vercel Production: name inventory refreshed on ${date} for the \`vppsone\` and \`schoolfees\` projects (names only).`,
    "- Status: **set** = on One Production now; **add at C5/C6/C9** = the owner sets it on One Production at that cutover step (CUTOVER-RUNBOOK-2026-27.md);",
    "  **leave unset** = One's default is intended; **REMOVE** = must be gone before T0; **TO SETTLE** = nobody has decided (blocks C5).",
    "",
    "| Name | One reads | fees reads | One Prod | fees Prod | Production value from | Status |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| \`${r.name}\` | ${whereCell(r.oneReads)} | ${whereCell(r.feesReads)} | ${yes(r.oneSet)} | ${yes(r.feesSet)} | ${r.source} | ${r.status} |`,
    ),
    "",
    "## The fees MCP worker (Cloudflare)",
    "",
    WORKER_NOTE,
    "",
    "| Name | Read in |",
    "|---|---|",
    ...workerRows.map((r) => `| \`${r.name}\` | ${whereCell(r.files)} |`),
    "",
    "## To do at C5 (summary)",
    "",
    ...rows.filter((r) => /^add at C5|^REMOVE|ROTATE|must be `live`/.test(r.status)).map((r) => `- \`${r.name}\`: ${r.status}`),
    "",
    "Unsettled names: " + (rows.filter((r) => r.status === "TO SETTLE").map((r) => `\`${r.name}\``).join(", ") || "none") + ".",
    "",
  ];
  return lines.join("\n");
}

function gitHead(dir) {
  // Read-only: the commit id from .git, no git process.
  try {
    const head = readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head.slice(0, 8);
    const ref = head.slice(5);
    try {
      return readFileSync(path.join(dir, ".git", ref), "utf8").trim().slice(0, 8);
    } catch {
      const packed = readFileSync(path.join(dir, ".git", "packed-refs"), "utf8");
      const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
      return line ? line.slice(0, 8) : "unknown";
    }
  } catch {
    return "unknown";
  }
}

/** The Vercel project behind each side of VERCEL_PRODUCTION. */
export const VERCEL_PROJECTS = { one: "vppsone", fees: "schoolfees" };

/**
 * The variable names in `vercel env ls` output: the first column of each
 * row. The CLI prints values as "Encrypted", so nothing secret is in the
 * text; only names are kept. Pure.
 */
export function namesFromVercelLs(text) {
  const names = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const first = line.trim().split(/\s+/)[0] ?? "";
    if (/^[A-Z][A-Z0-9_]{1,}$/.test(first) && first !== "NAME") names.add(first);
  }
  return [...names].sort();
}

/** Names added to or removed from a project's Production since the committed snapshot. Pure. */
export function vercelDrift(expected, live) {
  const want = new Set(expected);
  const have = new Set(live);
  return { added: [...have].filter((n) => !want.has(n)).sort(), removed: [...want].filter((n) => !have.has(n)).sort() };
}

/**
 * `--vercel`: ask the CLI for each project's Production names now and compare
 * them with VERCEL_PRODUCTION (critique1 B7: a scripted name-only diff, so a
 * Production env that changed after 31 Oct cannot reach C5 unseen). Exit 1
 * on any difference: refresh the list (and the annotations), then re-run.
 */
function checkVercel() {
  let drift = 0;
  for (const [side, project] of Object.entries(VERCEL_PROJECTS)) {
    const run = spawnSync("vercel", ["env", "ls", "production", "--project", project], { encoding: "utf8", shell: process.platform === "win32" });
    if (run.status !== 0) {
      console.error(`env-names-diff --vercel: \`vercel env ls production --project ${project}\` failed (exit ${run.status}); log in with \`vercel login\` and link the scope.`);
      process.exitCode = 2;
      return;
    }
    const live = namesFromVercelLs(`${run.stdout}\n${run.stderr}`);
    const { added, removed } = vercelDrift(VERCEL_PRODUCTION[side], live);
    const same = !added.length && !removed.length;
    console.log(`  ${same ? "ok" : "!!"} ${project} Production: ${live.length} names${same ? ", as committed" : ""}`);
    if (added.length) console.log(`     added since the snapshot: ${added.join(", ")}`);
    if (removed.length) console.log(`     gone since the snapshot: ${removed.join(", ")}`);
    if (!same) drift += 1;
  }
  if (drift) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.vercel) return checkVercel();
  const feesRepo = typeof args["fees-repo"] === "string" ? args["fees-repo"] : DEFAULT_FEES_REPO;
  const out = typeof args.out === "string" ? args.out : "docs/cutover/ENV-INVENTORY.md";

  const one = scanRoots(repoRoot, APP_ROOTS);
  const fees = scanRoots(feesRepo, APP_ROOTS);
  if (fees.size === 0) throw new Error(`No env reads found under ${feesRepo}; is the path right?`);
  const workers = scanRoots(feesRepo, ["workers"]);
  const workerRows = [...workers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, files]) => ({ name, files }));

  const rows = inventoryRows({ one, fees });
  const text = renderInventory(rows, workerRows, { feesCommit: gitHead(feesRepo), date: "1 Nov 2026" });
  writeFileSync(path.join(repoRoot, out), text);

  const unsettled = rows.filter((r) => r.status === "TO SETTLE");
  console.log(`env-names-diff: ${rows.length} names (One reads ${one.size}, fees reads ${fees.size}); worker ${workerRows.length}; wrote ${out}.`);
  if (unsettled.length) console.log(`  TO SETTLE: ${unsettled.map((r) => r.name).join(", ")}`);
  if (args.check && unsettled.length) process.exitCode = 1;
}

if (isMain(import.meta.url)) main();
