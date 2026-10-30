/**
 * P9, against the database: a message to a parent needs a person's approval
 * unless the school named a bounded exception in full, the app's own parent
 * dispatch is switched off, and a wrong-number flag says why, is kept, and is
 * read only by staff who work the messages.
 *
 *   npm run verify:parent-policy            # exit 1 on any broken promise
 *   npm run verify:parent-policy -- --json  # and write docs/evidence/P9-parent-policy-<date>.json
 *
 * The policy rows are changed only inside a check and put back exactly as
 * they were, version included, so a message queued on dev does not go stale
 * because this script ran. The flags it writes are synthetic numbers and are
 * removed at the end.
 *
 * Rule 3: dev only. Rule 6: no real number — the flags use 99999 0000x.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { assertTestAccountUser, toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

// Rule 3 / D-346, Phase 3: One's main project only, confined to TEST-2026-27 and test accounts on every marker.
const scope = await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-parent-policy", mode: "test-scoped" });

const options = { db: { schema: "vppsone" }, auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** A client that is exactly this person: a magic link verified, no password. */
async function signedInAs(email) {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`${email}: ${error.message}`);
  await assertTestAccountUser({ scope, url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, userId: data.user?.id, email });
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const { error: verifyError } = await client.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) throw new Error(`${email}: ${verifyError.message}`);
  return client;
}

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id, role").eq("user_id", user.id).single();
  return data;
};
const office = await profileOf("qa.accountant@qa.vpps.local");
const teacher = await profileOf("qa.teacher@qa.vpps.local");

const FLAG_PHONES = ["9999900001", "9999900002"];
const cleanUp = () => db.from("parent_route_flags").delete().in("phone", FLAG_PHONES);
await cleanUp();

console.log("\nP9 — the parent message policy, against the database\n");

/* ------------------------------------------------------ 1. the defaults */

const { data: policies } = await db
  .from("parent_message_policies")
  .select("category, approval_required, auto_recipients, auto_trigger, auto_content, auto_correction, policy_version, updated_by, updated_at")
  .order("category");
check(
  "1. four categories exist, and every one needs a person's approval",
  (policies ?? []).length === 4 && policies.every((row) => row.approval_required === true),
  (policies ?? []).map((row) => `${row.category}:${row.approval_required ? "approval" : "AUTOMATIC"}`).join(", "),
);

const { data: dispatchFlag } = await db.from("runtime_flags").select("enabled").eq("key", "parent_dispatch").maybeSingle();
check("2. the app's own parent dispatch is switched off", dispatchFlag?.enabled === false, `parent_dispatch=${dispatchFlag?.enabled}`);

/* ------------------------------------- 2. an exception names everything */

const target = policies?.find((row) => row.category === "general");
const restore = () =>
  db
    .from("parent_message_policies")
    .update({
      approval_required: target.approval_required,
      auto_recipients: target.auto_recipients,
      auto_trigger: target.auto_trigger,
      auto_content: target.auto_content,
      auto_correction: target.auto_correction,
      policy_version: target.policy_version,
      updated_by: target.updated_by,
      updated_at: target.updated_at,
    })
    .eq("category", "general");

try {
  const bare = await db.from("parent_message_policies").update({ approval_required: false }).eq("category", "general");
  check("3. turning approval off with nothing named is refused", bare.error?.code === "23514", bare.error?.code ?? "accepted");

  const partial = await db
    .from("parent_message_policies")
    .update({ approval_required: false, auto_recipients: "Guardian on record", auto_trigger: "Daily at 10", auto_content: "   ", auto_correction: "Correction message" })
    .eq("category", "general");
  check("4. a blank field in the exception is as good as a missing one", partial.error?.code === "23514", partial.error?.code ?? "accepted");

  const named = await db
    .from("parent_message_policies")
    .update({ approval_required: false, auto_recipients: "Guardian on record", auto_trigger: "Daily at 10", auto_content: "Template X only", auto_correction: "Send a correction" })
    .eq("category", "general");
  check("5. an exception that names all four is accepted", !named.error, named.error?.message ?? "");
} finally {
  const back = await restore();
  const { data: after } = await db.from("parent_message_policies").select("approval_required, policy_version").eq("category", "general").single();
  check(
    "6. the policy is put back exactly, version included",
    !back.error && after.approval_required === target.approval_required && after.policy_version === target.policy_version,
    `approval=${after.approval_required}, version=${after.policy_version}`,
  );
}

/* --------------------------------------------------- 3. wrong numbers */

const blank = await db.from("parent_route_flags").insert({ phone: FLAG_PHONES[0], reason: "  ", flagged_by: office.id });
check("7. a flag must say why", blank.error?.code === "23514", blank.error?.code ?? "accepted");

const half = await db
  .from("parent_route_flags")
  .insert({ phone: FLAG_PHONES[0], reason: "Parent says it is not theirs", flagged_by: office.id, cleared_at: new Date().toISOString() });
check("8. a flag is cleared by somebody, never anonymously", half.error?.code === "23514", half.error?.code ?? "accepted");

const { data: flag, error: flagError } = await db
  .from("parent_route_flags")
  .insert({ phone: FLAG_PHONES[1], reason: "Parent says it is not theirs", flagged_by: office.id })
  .select("id")
  .single();
check("9. a flag with a reason and a person is kept", !flagError, flagError?.message ?? "");

/* ------------------------------------------------ 4. who reads a flag */

const { data: viewers } = await db.from("role_permissions").select("role").eq("permission", "collection:view");
const mayView = new Set((viewers ?? []).map((row) => row.role));

for (const [label, email, profile] of [
  ["office", "qa.accountant@qa.vpps.local", office],
  ["teacher", "qa.teacher@qa.vpps.local", teacher],
]) {
  const client = await signedInAs(email);
  const { data: seen, error } = await client.from("parent_route_flags").select("id").eq("id", flag.id);
  const reads = !error && (seen ?? []).length === 1;
  const expected = mayView.has(profile.role);
  check(
    `10. the ${label} (${profile.role}) ${expected ? "reads" : "does not read"} a flag`,
    reads === expected,
    error ? `refused:${error.code}` : `${(seen ?? []).length} row`,
  );
  const write = await client.from("parent_route_flags").update({ reason: "changed" }).eq("id", flag.id).select("id");
  check(`11. the ${label} cannot change a flag directly`, Boolean(write.error) || (write.data ?? []).length === 0, write.error ? `refused:${write.error.code}` : "0 rows");
  const policyWrite = await client.from("parent_message_policies").update({ approval_required: true }).eq("category", "general").select("category");
  check(
    `12. the ${label} cannot change the policy directly`,
    Boolean(policyWrite.error) || (policyWrite.data ?? []).length === 0,
    policyWrite.error ? `refused:${policyWrite.error.code}` : "0 rows",
  );
  await client.auth.signOut();
}

await cleanUp();

/* ---------------------------------------------------------- the verdict */

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P9-parent-policy-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
