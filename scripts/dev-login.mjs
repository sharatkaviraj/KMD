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

import { QA_ACCOUNTS, QA_EMAIL_DOMAIN } from "../tests/fixtures/qa-accounts.ts";
import { assertTestAccountUser, toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The only addresses this script will ever mint a link for. */
const QA_DOMAIN = QA_EMAIL_DOMAIN;

/**
 * The accounts, from the fixture list rather than from a copy kept here.
 *
 * Three files used to hold their own map of the same addresses, and the one in
 * the role smoke had quietly stopped describing a teacher with any classes
 * (B-17). A name is offered here for every account the list says can sign in.
 */
const ACCOUNTS = Object.fromEntries(
  QA_ACCOUNTS.filter((account) => account.canSignIn).map((account) => [
    account.key,
    account.email,
  ]),
);

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

// Rule 3 / D-346: One's main project only, and on production confined to TEST-2026-27 and test accounts.
const scope = await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "dev-login", mode: "test-scoped" });

const [whoArg, nextArg] = process.argv.slice(2);
const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
// No default. Without a `next` the confirm route sends this account to its
// own role Home (PLAN section 3) — which for a teacher is her day, and is the
// thing worth looking at when the link is opened.
const next = nextArg ?? null;

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

await assertTestAccountUser({ scope, url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, userId: data.user?.id, email: email });

// The link Supabase hands back points at *its* verify endpoint, which then
// bounces to whatever `redirect_to` it was configured with. Going straight to
// our own `/auth/confirm` with the hashed token skips that hop, which keeps
// the whole thing on localhost and out of the Supabase redirect allow-list.
const tokenHash = data.properties.hashed_token;
const url =
  `${origin}/auth/confirm?token_hash=${tokenHash}&type=magiclink` +
  (next ? `&next=${encodeURIComponent(next)}` : "");

console.log(`${email} -> ${next ?? "this role's own Home"}\n`);
console.log(url);
