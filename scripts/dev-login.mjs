#!/usr/bin/env node
/**
 * Mint a sign-in link for a test account, so the signed-in screens can be
 * looked at rather than imagined.
 *
 *   npm run dev:login                  # lists the test accounts
 *   npm run dev:login -- teacher       # a link for the QA teacher
 *   npm run dev:login -- office /more  # ...landing somewhere particular
 *
 * **Test accounts only, dev only, and no password is involved anywhere.** The
 * link is a one-time `token_hash` minted by the Supabase admin API and checked
 * by Supabase itself at `/auth/confirm`; nothing here reads, writes or needs a
 * password, and no account is modified. It refuses to run against anything but
 * the dev project (rule 3) and refuses any address outside the QA domain, so
 * it cannot mint a link for a real member of staff.
 *
 * The links are short-lived and single-use. Print one, open it, and it is
 * spent — which is why this prints a fresh one every time rather than caching.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";

/** The only addresses this script will ever mint a link for. */
const QA_DOMAIN = "@qa.vpps.local";

const ACCOUNTS = {
  admin: "qa.admin@qa.vpps.local",
  office: "qa.accountant@qa.vpps.local",
  teacher: "qa.teacher@qa.vpps.local",
  viewer: "qa.viewonly@qa.vpps.local",
};

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

const [whoArg, nextArg] = process.argv.slice(2);
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const next = nextArg ?? "/dashboard";

if (!whoArg) {
  console.log("Test accounts (all passwordless, all dev-only):\n");
  for (const [name, email] of Object.entries(ACCOUNTS)) {
    console.log(`  ${name.padEnd(8)} ${email}`);
  }
  console.log(`\n  npm run dev:login -- teacher\n  npm run dev:login -- admin /assessments`);
  process.exit(0);
}

const email = ACCOUNTS[whoArg] ?? whoArg;

if (!email.endsWith(QA_DOMAIN)) {
  console.error(
    `Refusing to mint a link for ${email}: only ${QA_DOMAIN} test accounts.`,
  );
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await db.auth.admin.generateLink({
  type: "magiclink",
  email,
});

if (error) {
  console.error(`Could not mint a link for ${email}: ${error.message}`);
  process.exit(1);
}

// The link Supabase hands back points at *its* verify endpoint, which then
// bounces to whatever `redirect_to` it was configured with. Going straight to
// our own `/auth/confirm` with the hashed token skips that hop, which keeps
// the whole thing on localhost and out of the Supabase redirect allow-list.
const tokenHash = data.properties.hashed_token;
const url = `${origin}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=${encodeURIComponent(next)}`;

console.log(`${email} -> ${next}\n`);
console.log(url);
