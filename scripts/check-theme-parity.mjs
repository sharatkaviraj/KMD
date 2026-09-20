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
 * checkout is absent (CI has no sibling). That is deliberate: a gate nobody
 * can run locally gets deleted, and a gate that fails in CI for being unable
 * to find a second repository teaches people to ignore it.
 *
 *   node scripts/check-theme-parity.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import resolveConfig from "tailwindcss/resolveConfig.js";

const FEE_REPO =
  process.env.SCHOOLFEES_REPO ??
  path.resolve(process.cwd(), "..", "..", "Projects", "schoolfees");

const FEE_CONFIG = path.join(FEE_REPO, "tailwind.config.ts");

if (!existsSync(FEE_CONFIG)) {
  console.log(
    `theme parity: skipped — no School Fees checkout at ${FEE_REPO}\n` +
      "            set SCHOOLFEES_REPO to run it.",
  );
  process.exit(0);
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
  const mod = await import(pathToFileURL(configPath).href);
  return resolveConfig(mod.default).theme;
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
    `theme parity: ${problems.length} token(s) differ from the fee app\n\n` +
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
console.log(`theme parity: ${counted} tokens match the fee app.`);
