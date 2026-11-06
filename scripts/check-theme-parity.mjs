/**
 * The two apps must resolve the same Tailwind class to the same CSS.
 *
 * VPPS One carries a copy of School Fees' `tailwind.config.ts`, because the
 * ported components hold thousands of literal class strings and the fee app's
 * radius scale is shifted (`rounded-lg` is 14px there, not 8px). A copy drifts
 * silently — a one-digit slip in `--surface-2` is invisible in review and
 * obvious on a phone. This is the alarm.
 *
 * It needs the sibling repo on disk, so it SKIPS rather than fails when the
 * checkout is absent. CI never has the sibling: `veerpatta/schoolfees` is
 * private and the workflow token cannot read it. A skip is reported as a skip
 * — a GitHub warning annotation and a step-summary line saying NOT RUN — so a
 * green job never reads as "theme parity passed". Pass `--require` (or set
 * THEME_PARITY_REQUIRED=1) to make an absent checkout a failure; an explicit
 * SCHOOLFEES_REPO that is not a schoolfees checkout always fails.
 *
 *   node scripts/check-theme-parity.mjs
 *   SCHOOLFEES_REPO=../schoolfees node scripts/check-theme-parity.mjs --require
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import resolveConfig from "tailwindcss/resolveConfig.js";

/** An explicit SCHOOLFEES_REPO means the caller meant to compare, so a bad path fails rather than skips. */
const EXPLICIT = process.env.SCHOOLFEES_REPO?.trim() || "";
const REQUIRED = process.argv.includes("--require") || process.env.THEME_PARITY_REQUIRED === "1" || EXPLICIT !== "";

/** A School Fees checkout: its own package name and a tailwind config. Guards against comparing One with itself. */
function isFeesCheckout(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    return pkg.name === "schoolfees" && existsSync(path.join(dir, "tailwind.config.ts"));
  } catch {
    return false;
  }
}

/** An explicit SCHOOLFEES_REPO is authoritative; otherwise the sibling layouts in use on developer machines. */
const CANDIDATES = EXPLICIT
  ? [path.resolve(EXPLICIT)]
  : [
      path.resolve(process.cwd(), "..", "schoolfees"),
      path.resolve(process.cwd(), "..", "..", "schoolfees"),
      path.resolve(process.cwd(), "..", "..", "Projects", "schoolfees"),
    ];

const FEE_REPO = CANDIDATES.find(isFeesCheckout) ?? CANDIDATES[0];

const FEE_CONFIG = path.join(FEE_REPO, "tailwind.config.ts");

if (!isFeesCheckout(FEE_REPO)) {
  const message =
    `theme parity: ${REQUIRED ? "FAILED" : "NOT RUN"} — no School Fees checkout (package "schoolfees" with tailwind.config.ts) found ` +
    `(looked in: ${CANDIDATES.join(", ")}). Set SCHOOLFEES_REPO to a schoolfees checkout to run it.`;
  console.log(message);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=Theme parity NOT RUN::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        "- **Theme parity: NOT RUN** (no School Fees checkout on this runner). " +
          "Reproduce locally: `SCHOOLFEES_REPO=../schoolfees npm run check:theme -- --require`\n",
      );
    }
  }
  process.exit(REQUIRED ? 1 : 0);
}

/** Which Fees revision was compared — commit, branch, and whether the tree is dirty — so a result can be reproduced. */
const git = (...args) =>
  execFileSync("git", ["-C", FEE_REPO, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
let feeRevision = "unknown revision (not a git checkout)";
try {
  const sha = git("rev-parse", "--short=12", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const dirty = git("status", "--porcelain", "--", "tailwind.config.ts", "src/app/globals.css") !== "";
  feeRevision = `${sha} (${branch === "HEAD" ? "detached" : branch}${dirty ? ", UNCOMMITTED theme changes" : ""})`;
} catch {
  // Not a git checkout: the comparison still runs, it just cannot name a commit.
}

/**
 * The parts that must match exactly. `content` is deliberately excluded: the
 * two apps scan different trees and always will.
 */
const COMPARED = [
  "colors",
  "borderRadius",
  "boxShadow",
  "fontFamily",
  "transitionTimingFunction",
  "height",
  "minHeight",
];

/**
 * The fee app ships `@tailwindcss/container-queries`; VPPS One does not,
 * because the fee tree has zero `@container` usages. That is a recorded
 * difference, not drift, so the plugin's own theme keys are exempt.
 */
const EXEMPT_PREFIXES = ["containers"];

async function loadTheme(configPath) {
  try {
    const mod = await import(pathToFileURL(configPath).href);
    return resolveConfig(mod.default).theme;
  } catch (error) {
    // Most often the Fees checkout has no node_modules (its config imports
    // Tailwind plugins). That is a failed check, never a silent pass.
    console.error(
      `theme parity: FAILED to load ${configPath}: ${error?.message ?? error}\n` +
        "            run `npm ci` in that checkout first.",
    );
    process.exit(1);
  }
}

function flatten(value, prefix = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return new Map([[prefix.join("."), JSON.stringify(value)]]);
  }
  const out = new Map();
  for (const [key, inner] of Object.entries(value)) {
    for (const [k, v] of flatten(inner, [...prefix, key])) out.set(k, v);
  }
  return out;
}

const [mine, theirs] = await Promise.all([
  loadTheme(path.resolve("tailwind.config.ts")),
  loadTheme(FEE_CONFIG),
]);

const problems = [];

for (const section of COMPARED) {
  const a = flatten(mine[section] ?? {});
  const b = flatten(theirs[section] ?? {});
  const keys = new Set([...a.keys(), ...b.keys()]);

  for (const key of [...keys].sort()) {
    if (EXEMPT_PREFIXES.some((p) => key.startsWith(p))) continue;
    const ours = a.get(key);
    const fee = b.get(key);
    if (ours === fee) continue;
    problems.push(
      `  ${section}.${key}\n` +
        `      VPPS One: ${ours ?? "(absent)"}\n` +
        `      fee app : ${fee ?? "(absent)"}`,
    );
  }
}

if (problems.length > 0) {
  console.error(
    `theme parity: ${problems.length} token(s) differ from the fee app (${FEE_REPO} @ ${feeRevision})\n\n` +
      problems.join("\n") +
      "\n\nEither copy the fee app's value, or record the difference in\n" +
      "docs/DECISIONS.md and add the key to EXEMPT_PREFIXES here.\n",
  );
  process.exit(1);
}

const counted = COMPARED.reduce(
  (n, section) => n + flatten(mine[section] ?? {}).size,
  0,
);
console.log(`theme parity: ${counted} tokens match the fee app (${FEE_REPO} @ ${feeRevision}).`);
