#!/usr/bin/env node
/**
 * Mark every QA, Smoke Lab and day-run staff profile as a test account
 * (Phase 3, plan §3.6; owner override T1, D-346).
 *
 *   node scripts/mark-qa-test-accounts.mjs            dry run (the default): counts only
 *   node scripts/mark-qa-test-accounts.mjs --apply    flag them, one audit row each
 *   node scripts/mark-qa-test-accounts.mjs --revert <run-tag>
 *                                                     put back exactly what that run flagged
 *
 * Which profiles: an auth user on `@qa.vpps.local`, or a profile/user held in
 * `vppsone.qa_dayrun_accounts` or `vppsone.smoke_pool`. A seat whose account
 * is NOT on the QA domain stops the run (nothing is written): a seat table is
 * not allowed to turn a real member of staff into a test account by itself.
 *
 * Why: from Phase 3 a test account sees and writes TEST-2026-27 only, and on
 * production QA sign-in works only for test accounts. The QA accounts are the
 * test bed, so they become test accounts, not banned ones.
 *
 * Reversible: every flag is changed with a row in
 * `vppsone.staff_authority_changes` whose reason carries the run tag, and
 * `--revert <tag>` unflags exactly those profiles. Prints counts only, never
 * a name or an address (rule 6).
 *
 * Writes with the service role, which the flag's trigger allows (a signed-in
 * session never can — `vppsone.set_test_account` is the app's door).
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { toolScope } from "./target-guard.mjs";

export const QA_DOMAIN = "@qa.vpps.local";

/**
 * The pure selection: which profiles to flag, and whether any seat points at
 * an account outside the QA domain (which refuses the whole run).
 */
export function selectQaProfiles({ profiles, emailByUserId, dayrun, smoke }) {
  const seatProfileIds = new Set([...dayrun, ...smoke].map((seat) => seat.staffProfileId).filter(Boolean));
  const seatUserIds = new Set([...dayrun, ...smoke].map((seat) => seat.userId).filter(Boolean));
  const isQaEmail = (email) => typeof email === "string" && email.toLowerCase().endsWith(QA_DOMAIN);

  const chosen = [];
  let nonQaSeats = 0;
  for (const profile of profiles) {
    const email = profile.userId ? emailByUserId.get(profile.userId) : null;
    const seat = seatProfileIds.has(profile.id) || (profile.userId && seatUserIds.has(profile.userId));
    if (isQaEmail(email)) chosen.push(profile);
    else if (seat) nonQaSeats += 1;
  }
  return {
    toFlag: chosen.filter((profile) => profile.isTestAccount !== true),
    alreadyFlagged: chosen.filter((profile) => profile.isTestAccount === true).length,
    nonQaSeats,
  };
}

export function countByRole(profiles) {
  const counts = {};
  for (const profile of profiles) counts[profile.role] = (counts[profile.role] ?? 0) + 1;
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const revertAt = args.indexOf("--revert");
  const revertTag = revertAt >= 0 ? args[revertAt + 1] : null;
  if (revertAt >= 0 && !/^[a-z0-9-]{6,40}$/i.test(revertTag ?? "")) {
    console.error("--revert needs the run tag the apply printed.");
    process.exit(1);
  }

  const env = parseEnv(readFileSync(".env.local", "utf8"));
  // Read-only as far as the tool guard goes: it changes accounts, not session
  // data, and it must run on production too (that is where QA lives).
  await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "mark-qa-test-accounts", mode: "read-only" });
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "vppsone" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const must = (label, result) => {
    if (result.error) throw new Error(`${label}: ${result.error.message}`);
    return result.data;
  };

  if (revertTag) {
    const rows = must(
      "Could not read the audit rows",
      await db
        .from("staff_authority_changes")
        .select("staff_profile_id, reason")
        .like("reason", `is_test_account: false -> true.%[run ${revertTag}]%`),
    );
    const ids = [...new Set(rows.map((row) => row.staff_profile_id))];
    console.log(`revert ${revertTag}: ${ids.length} profile(s) flagged by that run.`);
    if (!apply) {
      console.log("Dry run. Add --apply to unflag them.");
      return;
    }
    for (const id of ids) {
      const profile = must("Could not read a profile", await db.from("staff_profiles").select("id, role, is_active, is_test_account").eq("id", id).single());
      if (profile.is_test_account !== true) continue;
      must("Could not unflag", await db.from("staff_profiles").update({ is_test_account: false }).eq("id", id));
      must(
        "Could not log",
        await db.from("staff_authority_changes").insert({
          staff_profile_id: id,
          actor_staff_id: null,
          from_role: profile.role,
          to_role: profile.role,
          from_active: profile.is_active,
          to_active: profile.is_active,
          reason: `is_test_account: true -> false. Reverted QA conversion [run ${revertTag}]`,
        }),
      );
    }
    console.log(`unflagged ${ids.length}.`);
    return;
  }

  const [profiles, dayrun, smoke] = await Promise.all([
    db.from("staff_profiles").select("id, user_id, role, is_active, is_test_account").then((r) => must("Could not read staff profiles", r)),
    db.from("qa_dayrun_accounts").select("user_id, staff_profile_id").then((r) => must("Could not read day-run seats", r)),
    db.from("smoke_pool").select("auth_user_id, staff_profile_id").then((r) => must("Could not read Smoke Lab seats", r)),
  ]);
  const emailByUserId = new Map();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list auth users: ${error.message}`);
    for (const user of data.users) emailByUserId.set(user.id, user.email ?? null);
    if (data.users.length < 200) break;
  }

  const selection = selectQaProfiles({
    profiles: profiles.map((p) => ({ id: p.id, userId: p.user_id, role: p.role, isActive: p.is_active, isTestAccount: p.is_test_account })),
    emailByUserId,
    dayrun: dayrun.map((s) => ({ userId: s.user_id, staffProfileId: s.staff_profile_id })),
    smoke: smoke.map((s) => ({ userId: s.auth_user_id, staffProfileId: s.staff_profile_id })),
  });

  console.log(`staff profiles: ${profiles.length}; QA auth users: ${[...emailByUserId.values()].filter((e) => e?.toLowerCase().endsWith(QA_DOMAIN)).length}`);
  console.log(`to flag: ${selection.toFlag.length}; already test accounts: ${selection.alreadyFlagged}`);
  console.log(`to flag, by role: ${JSON.stringify(countByRole(selection.toFlag))}`);
  if (selection.nonQaSeats > 0) {
    console.error(`Refusing: ${selection.nonQaSeats} Smoke Lab / day-run seat(s) point at an account outside ${QA_DOMAIN}.`);
    process.exit(1);
  }
  if (!apply) {
    console.log("Dry run. Add --apply to flag them.");
    return;
  }

  const tag = `qa${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  for (const profile of selection.toFlag) {
    must("Could not flag", await db.from("staff_profiles").update({ is_test_account: true }).eq("id", profile.id).eq("is_test_account", false));
    must(
      "Could not log",
      await db.from("staff_authority_changes").insert({
        staff_profile_id: profile.id,
        actor_staff_id: null,
        from_role: profile.role,
        to_role: profile.role,
        from_active: profile.isActive,
        to_active: profile.isActive,
        reason: `is_test_account: false -> true. QA account converted to a test account (Phase 3) [run ${tag}]`,
      }),
    );
  }
  console.log(`flagged ${selection.toFlag.length}. Run tag: ${tag} (revert: --revert ${tag} --apply)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
