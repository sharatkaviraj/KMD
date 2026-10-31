/**
 * Which environment variable NAMES a codebase reads, by static scan
 * (go-live Phase G, plan §9.3; critique1 B7). Names only: this never reads a
 * `.env` file or a value.
 *
 * What counts as a read:
 *   process.env.NAME          process.env["NAME"]        process.env?.NAME
 *   const { A, B: b } = process.env
 *   getOptionalEnvVar("NAME") / getRequiredEnvVar("NAME") / any call whose
 *   function name contains "Env" (readEnv, envFlag, getEnvVar…) with a
 *   string-literal first argument in UPPER_SNAKE_CASE
 *   string literals inside an array assigned to a name ending in EnvVars /
 *   ENV_VARS / ENV_NAMES (the `requiredEnvVars = [...]` pattern)
 *
 * A name built at run time (`process.env[\`X_${y}\`]`) cannot be seen; the
 * inventory says so in its header.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const NAME = "[A-Z][A-Z0-9_]{1,80}";

const PATTERNS = [
  new RegExp(`process\\.env\\??\\.(${NAME})\\b`, "g"),
  new RegExp(`process\\.env\\??\\.?\\[\\s*["'\`](${NAME})["'\`]\\s*\\]`, "g"),
  new RegExp(`\\b\\w*Env\\w*\\(\\s*["'\`](${NAME})["'\`]`, "g"),
  // `function f(env = process.env) { env.RAZORPAY_KEY_ID }` — the injected-env pattern.
  new RegExp(`(?<![\\w.])env\\??\\.(${NAME})\\b`, "g"),
];

const DESTRUCTURE = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\.env\b/g;
const NAME_ARRAY = /\b\w*(?:EnvVars|ENV_VARS|ENV_NAMES|envVarNames)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/g;

/** The names one source file reads. */
export function scanSource(text) {
  const names = new Set();
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of text.matchAll(DESTRUCTURE)) {
    for (const part of match[1].split(",")) {
      const key = part.split(":")[0].split("=")[0].trim();
      if (new RegExp(`^${NAME}$`).test(key)) names.add(key);
    }
  }
  for (const match of text.matchAll(NAME_ARRAY)) {
    for (const literal of match[1].matchAll(new RegExp(`["'\`](${NAME})["'\`]`, "g"))) names.add(literal[1]);
  }
  // `process.env.NEXT_PUBLIC_*` in a comment is a family, not a name.
  for (const name of names) if (name.endsWith("_")) names.delete(name);
  return names;
}

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "dist", "build", "test-results", "playwright-report", ".claude", ".turbo"]);

/** Every source file under `dir` (skipping build output and dependencies). */
export function listSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listSourceFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && SOURCE_EXT.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * name → the files (repo-relative, forward slashes) that read it, for the
 * given roots. A root that is a file is scanned as one; a missing root is
 * skipped.
 */
export function scanRoots(repoRoot, roots) {
  const found = new Map();
  for (const root of roots) {
    const full = path.join(repoRoot, root);
    let files;
    try {
      files = statSync(full).isDirectory() ? listSourceFiles(full) : [full];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = path.relative(repoRoot, file).split(path.sep).join("/");
      for (const name of scanSource(readFileSync(file, "utf8"))) {
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(rel);
      }
    }
  }
  return found;
}

/** Where a name is read, shortened for a table cell: the first two files, then a count. */
export function whereCell(files) {
  if (!files || files.size === 0) return "—";
  const sorted = [...files].sort();
  const shown = sorted.slice(0, 2).map((file) => `\`${file}\``).join(", ");
  return sorted.length > 2 ? `${shown} +${sorted.length - 2}` : shown;
}
