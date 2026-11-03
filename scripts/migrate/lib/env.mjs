/**
 * Where the migration tools find their configuration and put their output.
 *
 *  - One's own env: `.env.local` at the repo root (One's main project,
 *    `wtgxcptmucjerhufzjcf`).
 *  - The fees app's live keys: the secrets backup in
 *    `%USERPROFILE%\.schoolfees-secrets\` (the same file replicate-live.mjs
 *    reads). Read only by `lib/fees-readonly.mjs`; never printed (I-6).
 *  - Output with personal data: `%USERPROFILE%\.vppsone-migration\<run>\`,
 *    outside the repo (I-5). `secrets/` under a run holds auth rows, encrypted
 *    (lib/secrets-box.mjs), and is deleted after a load (critique0 #28).
 *
 * Set VPPSONE_MIGRATION_HOME to an absolute path outside the repo to move
 * private output away from the default user-profile directory.
 * Env var NAMES only ever appear in messages, never values.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const FEES_SECRETS_FILE = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? os.homedir(),
  ".schoolfees-secrets",
  "env.local.production.20260915-1137.bak",
);

/** Reject the repository itself and descendants, but not sibling path prefixes. */
function assertOutsideRepo(dir, root = repoRoot) {
  const relative = path.relative(path.resolve(root), path.resolve(dir));
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error("Refusing a migration folder inside the repo (I-5).");
  }
}

/**
 * Pure resolution so operators can put private migration files on another drive.
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveMigrationHome(env = process.env, root = repoRoot) {
  const override = env.VPPSONE_MIGRATION_HOME;
  if (override !== undefined && (typeof override !== "string" || !path.isAbsolute(override))) {
    throw new Error("VPPSONE_MIGRATION_HOME must be an absolute path outside the repo.");
  }
  const home = path.resolve(override ?? path.join(env.USERPROFILE ?? env.HOME ?? os.homedir(), ".vppsone-migration"));
  assertOutsideRepo(home, root);
  return home;
}

export const MIGRATION_HOME = resolveMigrationHome();

/** KEY=value lines; quotes stripped; comments and blanks skipped. */
export function parseEnvText(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        let value = line.slice(at + 1).trim();
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

export function loadOneEnv() {
  const file = path.join(repoRoot, ".env.local");
  if (!existsSync(file)) throw new Error(".env.local is missing at the repo root.");
  return parseEnvText(readFileSync(file, "utf8"));
}

export function loadFeesSecrets(file = process.env.VPPSONE_FEES_SECRETS_FILE ?? FEES_SECRETS_FILE) {
  if (!path.isAbsolute(file)) throw new Error("VPPSONE_FEES_SECRETS_FILE must be an absolute path.");
  if (!existsSync(file)) throw new Error(`The fees secrets file is missing (${path.basename(file)}).`);
  return parseEnvText(readFileSync(file, "utf8"));
}

/** A run id that sorts by time and names no person: 20261030T120501Z. */
export function newRunId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

/** The private folder for one run, created on demand. Refuses anything inside the repo. */
export function runDir(runId, { create = true } = {}) {
  if (!/^[0-9A-Za-z_-]{6,64}$/.test(runId ?? "")) throw new Error("A run id is letters, digits, - and _ only.");
  const dir = path.join(MIGRATION_HOME, runId);
  assertOutsideRepo(dir);
  if (create) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The newest COMPLETE extract, or null: the manifest with the latest
 * `finishedAt` — never a sort of folder names. Run ids are free text, so
 * '20261030-a2-first' or 'rehearsal-1' would sort above every newer
 * timestamped run (the CLAUDE.md rule 3a mistake). A `--tables` subset
 * (`manifest.subset`) is never "the latest extract". load-snapshot --apply
 * does not use this at all: it needs an explicit --run.
 */
export function latestRunId(home = MIGRATION_HOME) {
  if (!existsSync(home)) return null;
  let best = null;
  for (const name of readdirSync(home)) {
    const file = path.join(home, name, "manifest.json");
    if (!existsSync(file)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (manifest?.subset || !manifest?.finishedAt) continue;
    const at = Date.parse(manifest.finishedAt);
    if (Number.isNaN(at)) continue;
    if (!best || at > best.at) best = { name, at };
  }
  return best?.name ?? null;
}

/** True when `moduleUrl` is the script node was started with (so tests can import it). */
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  const a = path.resolve(fileURLToPath(moduleUrl)).toLowerCase();
  const b = path.resolve(process.argv[1]).toLowerCase();
  return a === b;
}

/** `--name value` / `--name=value` / `--flag` out of argv. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && VALUE_FLAGS.has(arg.slice(2))) {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

const VALUE_FLAGS = new Set(["run", "as-of", "session", "since", "out", "tables", "bucket", "limit", "watermark", "max-attempts", "mcp", "hours", "probe", "fees-repo", "restore-test", "restore", "schema", "revert", "accept-held"]);
