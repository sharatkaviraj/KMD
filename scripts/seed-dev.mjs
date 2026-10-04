#!/usr/bin/env node
/**
 * Give the QA auth users a VPPS One staff profile.
 *
 *   npm run seed:dev
 *
 * The accounts themselves already exist: VPPS One shares `auth.users` with the
 * fee app, so signing in is not what this creates. What it creates is the
 * `vppsone.staff_profiles` row that makes an account *staff here* — without
 * one, sign-in succeeds and the app still says you are nobody (D-6).
 *
 * Idempotent: re-running updates the same rows, matched on `user_id`.
 * `short_name` is immutable in the database, so a re-run never touches it.
 *
 * Rule 6: test names only. Every name below is invented. No child, parent or
 * member of staff is described here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { DEV_PROJECT_REFS, isDevProjectUrl } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The dev project. This script refuses to run against anything else. */
const [DEV_PROJECT_REF] = DEV_PROJECT_REFS;

/**
 * Seeded staff, one per QA account (kickoff task 1.1).
 *
 * `qa.collector@` and `qa.director@` also exist on this database as fee-app
 * accounts and are deliberately left without a profile: somebody has to be the
 * "signed in, but not staff here" case, and finding it by accident in Phase 3
 * would be worse than finding it now.
 */
const SEED_STAFF = [
  {
    email: "qa.admin@qa.vpps.local",
    display_name: "QA Admin",
    short_name: "QAAD",
    role: "admin",
    is_teaching: false,
  },
  {
    email: "qa.teacher@qa.vpps.local",
    display_name: "QA Teacher",
    short_name: "QATE",
    role: "teacher",
    is_teaching: true,
  },
  {
    email: "qa.accountant@qa.vpps.local",
    display_name: "QA Office",
    short_name: "QAOF",
    role: "office",
    is_teaching: false,
  },
  {
    email: "qa.viewonly@qa.vpps.local",
    display_name: "QA Viewer",
    short_name: "QAVW",
    role: "view_only",
    is_teaching: false,
  },
];

/** `.env.local` is not loaded for a plain `node` run, so read it here. */
function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(path.join(repoRoot, ".env.local"), "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.",
  );
}

// Rule 3. The live fee database is not a target, and a seed script holding a
// service-role key is exactly the thing that must not be pointed at it by a
// stale shell variable.
if (!isDevProjectUrl(supabaseUrl)) {
  fail(
    `Refusing to seed ${supabaseUrl}.\n  ` +
      `This script only runs against schoolfees-dev (${DEV_PROJECT_REF}).`,
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  db: { schema: "vppsone" },
  auth: { autoRefreshToken: false, persistSession: false },
});

/** auth.users is not readable through PostgREST; the admin API is the way in. */
async function findAuthUsersByEmail(emails) {
  const wanted = new Set(emails.map((email) => email.toLowerCase()));
  const found = new Map();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      fail(`Could not list auth users: ${error.message}`);
    }

    for (const user of data.users) {
      const email = user.email?.toLowerCase();
      if (email && wanted.has(email)) {
        found.set(email, user.id);
      }
    }

    if (data.users.length < perPage) break;
  }

  return found;
}

async function main() {
  console.log(`\n  Seeding vppsone.staff_profiles on ${supabaseUrl}\n`);

  const usersByEmail = await findAuthUsersByEmail(SEED_STAFF.map((s) => s.email));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const staff of SEED_STAFF) {
    const userId = usersByEmail.get(staff.email.toLowerCase());

    if (!userId) {
      console.log(`  skip    ${staff.email.padEnd(30)} no auth user on this project`);
      skipped += 1;
      continue;
    }

    const { data: existing, error: readError } = await supabase
      .from("staff_profiles")
      .select("id, short_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) {
      fail(`Could not read the profile for ${staff.email}: ${readError.message}`);
    }

    if (existing) {
      // short_name is immutable in the database, so it is not in this update.
      // Sending it would fail the trigger on any row somebody had renamed by
      // hand, and turn a re-run into an error for no gain.
      const { error } = await supabase
        .from("staff_profiles")
        .update({
          display_name: staff.display_name,
          role: staff.role,
          is_teaching: staff.is_teaching,
          is_active: true,
        })
        .eq("id", existing.id);

      if (error) {
        fail(`Could not update ${staff.email}: ${error.message}`);
      }

      const note =
        existing.short_name === staff.short_name
          ? ""
          : `  (short_name stays ${existing.short_name}, it is immutable)`;
      console.log(`  update  ${staff.email.padEnd(30)} ${staff.role}${note}`);
      updated += 1;
      continue;
    }

    const { error } = await supabase.from("staff_profiles").insert({
      user_id: userId,
      display_name: staff.display_name,
      short_name: staff.short_name,
      role: staff.role,
      is_teaching: staff.is_teaching,
      is_active: true,
      preferred_language: "hi",
      created_by: userId,
    });

    if (error) {
      fail(`Could not create ${staff.email}: ${error.message}`);
    }

    console.log(`  create  ${staff.email.padEnd(30)} ${staff.role}`);
    created += 1;
  }

  console.log(
    `\n  ${created} created, ${updated} updated, ${skipped} skipped.\n`,
  );

  if (skipped > 0) {
    console.log(
      "  A skipped row means that email has no auth user here. Create it in\n" +
        "  the Supabase dashboard (Authentication -> Users) and run this again.\n",
    );
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
