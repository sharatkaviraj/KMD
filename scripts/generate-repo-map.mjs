#!/usr/bin/env node
/**
 * Generate `docs/maps/repo-map.md` from the files git tracks.
 *
 * The hand-written layout notes in CLAUDE.md and README drifted from the tree
 * (a retired-cutover description, a missing `.env.example`). The *shape* of the
 * repo is therefore generated and `npm run docs:map:check` fails on drift; the
 * *why* stays hand-written in AGENTS.md, CLAUDE.md and the module READMEs.
 *
 * Deliberately no file or line counts: they would change on almost every PR
 * and turn the check into busywork. Only folders, route segments, ownership
 * (ported from Fees or One's own) and harness entry points are listed.
 *
 *   node scripts/generate-repo-map.mjs           # write
 *   node scripts/generate-repo-map.mjs --check   # fail if stale
 *
 * Reads only the local checkout. No network, no database.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PORTED_TREES } from "./port-rewrite-imports.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "maps", "repo-map.md");
const CHECK = process.argv.includes("--check");

/** Tracked files only, so a machine that ran Playwright gets the same map as CI. */
const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((f) => f.replaceAll("\\", "/"));

/** Immediate child folders of `dir` that contain at least one tracked file. */
function childDirs(dir) {
  const prefix = dir === "" || dir.endsWith("/") ? dir : `${dir}/`;
  const set = new Set();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const rest = f.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash > 0) set.add(rest.slice(0, slash));
  }
  return [...set].sort();
}

const under = (dir) => files.filter((f) => f.startsWith(`${dir}/`));
const isPorted = (rel) => PORTED_TREES.some((t) => rel === t || rel.startsWith(`${t}/`));
/**
 * File contents as committed to the index (`git cat-file --batch`), not the
 * working tree: an uncommitted edit cannot change the map, and a tracked file
 * deleted on disk cannot crash it. One git process per batch of reads.
 */
const indexed = new Map();
function preload(rels) {
  const wanted = [...new Set(rels)].filter((r) => !indexed.has(r));
  if (!wanted.length) return;
  const input = wanted.map((r) => `:${r}`).join("\n") + "\n";
  const out = execFileSync("git", ["cat-file", "--batch"], { cwd: ROOT, input, maxBuffer: 1 << 28 });
  let at = 0;
  for (const rel of wanted) {
    const nl = out.indexOf(10, at);
    const header = out.subarray(at, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) throw new Error(`git cat-file could not read ${rel}: ${header}`);
    indexed.set(rel, out.subarray(nl + 1, nl + 1 + size).toString("utf8").replace(/\r\n/g, "\n"));
    at = nl + 1 + size + 1;
  }
}
const read = (rel) => {
  preload([rel]);
  return indexed.get(rel);
};

/** First prose line of a README, if there is one. */
function readmeLine(dir) {
  const rel = `${dir}/README.md`;
  if (!files.includes(rel)) return "";
  for (const raw of read(rel).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("<!--") || line.startsWith("```") || line.startsWith("|")) continue;
    return line.replace(/\|/g, "\\|").slice(0, 140);
  }
  return "";
}

const TOP = {
  ".github": "CI workflows (see the workflow table below)",
  docs: "PLAN, PROGRESS, DECISIONS, PARITY, QA, cutover/coexistence records, maps",
  public: "static assets, PWA manifest/icons (Next requires the root)",
  scripts: "operational, QA and quality scripts — many reach a database; see AGENTS.md",
  src: "the application",
  supabase: "`migrations/` (vppsone schema) and `fee-migrations/` (fee-schema SQL One owns); never edit an applied file",
  tests: "vitest suites, synthetic Playwright harnesses, SQL/concurrency proofs",
};

const APP_SEGMENTS = {
  "(app)": "signed-in staff routes (table below)",
  ".well-known": "OAuth/MCP discovery documents",
  api: "route handlers: cron/jobs, webhooks, Fees bridge relay, AI, MCP",
  auth: "Supabase auth callbacks",
  cv: "public certificate verification (the QR on a school certificate)",
  fonts: "self-hosted fonts used by PDFs and the shell",
  lab: "signed-out lab/kiosk screens",
  login: "staff sign-in",
  mcp: "MCP OAuth authorize screen",
  pay: "parent payment link by code (Razorpay is owned by Fees)",
  qa: "QA day-run entry (test accounts only)",
  r: "a teacher's tokenised page (for teachers without an account)",
  rv: "public receipt verification by code",
  t: "tokenised teacher links (marks, tasks)",
  w: "landing page for the button on a WhatsApp template message",
};

/** Imports of a ported feature module (`src/modules/x` in PORTED_TREES becomes `@/modules/x/`). The ported design kit and platform helpers are shared, so they do not make a page "ported". */
const PORTED_ALIASES = PORTED_TREES.filter((t) => t.startsWith("src/modules/")).map((t) => `"@/${t.replace(/^src\//, "")}/`);
const importsPorted = (src) => PORTED_ALIASES.some((a) => src.includes(a)) || src.includes('"@/app/(app)/fees');
/** A page whose only job is to send the reader elsewhere: calls redirect() and renders no JSX. */
const isRedirectOnly = (src) => /\bredirect\(/.test(src) && !/(return|=>)\s*\(?\s*</.test(src);

/**
 * What a route segment's pages render: vx screens (current), ported Fees
 * screens (classic), One's pre-vx screens, or redirects — every kind present,
 * so /payments (vx Collect + /payments/classic) shows both.
 */
function routeKind(seg) {
  const dir = `src/app/(app)/${seg}`;
  const pages = under(dir).filter((f) => /\/page\.tsx$/.test(f));
  if (!pages.length) return "no page";
  preload(pages);
  const kinds = new Set();
  for (const p of pages) {
    const src = read(p);
    if (seg === "fees") kinds.add("ported Fees screens (classic)");
    else if (isRedirectOnly(src)) kinds.add("redirect");
    else if (src.includes("@/vx/screens")) kinds.add("vx (current)");
    else if (importsPorted(src)) kinds.add("ported Fees screens (classic)");
    else kinds.add("One (pre-vx)");
  }
  return [...kinds].sort().join(" + ");
}

/**
 * Playwright configs by what they need. A config whose webServer builds a
 * vite fixture is synthetic (no app, no database). Anything else drives a
 * running app — local `next` on One's production database — or a deployed
 * site, and is an external effect (AGENTS.md).
 */
function playwrightRows() {
  const configs = files.filter((f) => /^tests\/playwright\/[^/]+\.playwright\.config\.ts$/.test(f)).sort();
  const workflows = files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
  preload([...configs, ...workflows]);
  const ci = workflows.map(read).join("\n");
  return configs.map((f) => {
    const name = path.basename(f, ".playwright.config.ts");
    const synthetic = /webServer[\s\S]*vite/.test(read(f));
    const needs = synthetic ? "synthetic (vite fixture)" : "**external**: a running app/database or a deployed site";
    return `| \`${name}\` | ${needs} | ${ci.includes(`${name}.playwright.config.ts`) ? "yes" : "no"} |`;
  });
}

function moduleRow(name) {
  const dir = `src/modules/${name}`;
  const layers = ["domain", "data", "ui", "vx", "platform"].filter((l) => files.some((f) => f.startsWith(`${dir}/${l}/`)));
  const owner = isPorted(dir) ? "ported from Fees" : "One";
  return `| \`${name}\` | ${owner} | ${layers.join(", ") || "—"} | ${readmeLine(dir) || "—"} |`;
}

function workflowRow(rel) {
  const src = read(rel);
  const name = /^name:\s*(.+)$/m.exec(src)?.[1]?.trim() ?? path.basename(rel);
  const triggers = [];
  if (/^\s*pull_request:/m.test(src)) triggers.push(/pull_request:\s*\n\s+paths:/m.test(src) ? "PR (paths)" : "PR");
  if (/^\s*push:/m.test(src)) triggers.push("push main");
  if (/^\s*schedule:/m.test(src)) triggers.push("schedule");
  if (/workflow_dispatch/.test(src)) triggers.push("manual");
  return `| \`${path.basename(rel)}\` | ${name} | ${triggers.join(", ")} |`;
}

const lines = [];
const push = (...l) => lines.push(...l);

push(
  "# Repo map",
  "",
  "**Generated — do not edit by hand.** Run `npm run docs:map`; CI runs",
  "`npm run docs:map:check` and fails when this file disagrees with the tree.",
  "The reasons behind the layout are in [AGENTS.md](../../AGENTS.md) and",
  "[CLAUDE.md](../../CLAUDE.md); the Collect trace is [collect-flow.md](collect-flow.md).",
  "",
  "Ownership comes from `PORTED_TREES` in `scripts/port-rewrite-imports.mjs`: a",
  "ported tree uses the fee Supabase clients, fee roles and the next-intl",
  "catalogue; everything else uses One's own.",
  "",
  "## Top level",
  "",
  "| Path | What it is |",
  "|---|---|",
);
for (const d of childDirs("").filter((d) => d !== ".claude")) push(`| \`${d}/\` | ${TOP[d] ?? "—"} |`);

push("", "## `src/`", "", "| Path | What it is |", "|---|---|");
const SRC = {
  app: "Next App Router routes",
  lib: "small shared helpers predating `platform/`",
  messages: "strings: `index.ts`/`setup.ts` pairs (One) and `{en,hi,hi-en}.json` (ported, next-intl)",
  modules: "feature folders: `domain/` (pure) · `data/` (db) · `ui/`",
  platform: "auth, Supabase clients, deployment confinement, Fees bridge client, i18n, money",
  ui: "School Fees' design kit",
  vx: "the current screen design: `screens/`, shell, `text.ts` pairs",
};
for (const d of childDirs("src")) push(`| \`src/${d}/\` | ${SRC[d] ?? "—"}${isPorted(`src/${d}`) ? " — ported" : ""} |`);

push("", "## `src/app/` segments", "", "| Segment | What it is |", "|---|---|");
for (const d of childDirs("src/app")) push(`| \`${d}\` | ${APP_SEGMENTS[d] ?? "—"} |`);

push(
  "",
  "## Signed-in routes — `src/app/(app)/`",
  "",
  "*vx (current)*: every page renders `src/vx/screens/*`. *Ported Fees screens*: the",
  "classic desks ported from School Fees. *One (pre-vx)*: One's own older screens.",
  "",
  "| Route | Renders |",
  "|---|---|",
);
for (const d of childDirs("src/app/(app)")) push(`| \`/${d}\` | ${routeKind(d)} |`);

push("", "## Modules — `src/modules/`", "", "| Module | Owner | Layers | README says |", "|---|---|---|---|");
for (const d of childDirs("src/modules")) push(moduleRow(d));

push("", "## Platform — `src/platform/`", "", "| Folder | Owner |", "|---|---|");
for (const d of childDirs("src/platform")) push(`| \`${d}\` | ${isPorted(`src/platform/${d}`) ? "ported from Fees" : "One"} |`);

push("", "## vx screens — `src/vx/screens/`", "", childDirs("src/vx/screens").map((d) => `\`${d}\``).join(" · "));

push(
  "",
  "## Test harnesses",
  "",
  "| Where | What | Needs |",
  "|---|---|---|",
  "| `tests/**/*.test.ts(x)` | vitest (`npm run test`) | nothing external |",
  "| `tests/architecture.test.ts` | import/ownership rules, ported-tree fences | nothing external |",
  "| `tests/sql/*.mjs` | migration + grant proofs on in-memory PGlite | nothing external |",
  "| `tests/sql/*.py` | lock/concurrency proofs on a disposable PostgreSQL 17 with two real connections | CI service container or local Postgres |",
  "| `tests/playwright/*.playwright.config.ts` | browser harnesses — synthetic or external, per config below | Playwright browsers; external ones need an app |",
  "| `playwright.config.ts` → `tests/e2e` | workflow suite (`npm run smoke:workflows`) | a database and test accounts — **not** part of `check` |",
  "",
  "Playwright configs, classified from each config's `webServer` (\"In CI\" = named in a workflow):",
  "",
  "| Config | Needs | In CI |",
  "|---|---|---|",
);
push(...playwrightRows());
push("", "Test folders:", "", childDirs("tests").map((d) => `\`${d}\``).join(" · "));

push("", "## Workflows — `.github/workflows/`", "", "| File | Name | Runs on |", "|---|---|---|");
for (const f of files.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).sort()) push(workflowRow(f));
push("");

const out = lines.join("\n");
const current = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
if (CHECK) {
  if (current !== out) {
    console.error("docs/maps/repo-map.md is stale. Run `npm run docs:map` and commit the result.");
    process.exit(1);
  }
  console.log("repo map: current");
} else {
  writeFileSync(OUT, out);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
