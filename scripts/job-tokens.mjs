#!/usr/bin/env node
/**
 * Print each job's trigger URL.
 *
 *   npm run jobs:tokens
 *
 * The token is `HMAC(JOBS_SECRET, job)`, so the four jobs have four different
 * ones and **none of them is the secret**. One can be handed to whatever
 * should trigger one job without handing over the other three, and a token
 * that ends up in a log reveals nothing about the rest.
 *
 * Vercel's own cron does not need any of this: it sends `CRON_SECRET` as a
 * bearer header, which the route accepts alongside the per-job token. These
 * URLs are for triggering a single job from anywhere else — or, more often,
 * for checking by hand that a job still works.
 *
 * Reads `.env.local`, so it prints the dev tokens. Production tokens come from
 * production's own `JOBS_SECRET`, which is not in this repo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { jobTokenFor } from "../src/modules/jobs/domain/token.ts";
import { jobNames } from "../src/modules/jobs/domain/jobs.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

if (!env.JOBS_SECRET) {
  console.error("No JOBS_SECRET in .env.local — the jobs will refuse every request.");
  process.exit(1);
}

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";

for (const job of jobNames) {
  console.log(`${origin}/api/jobs/${job}?token=${jobTokenFor(env.JOBS_SECRET, job)}`);
}
