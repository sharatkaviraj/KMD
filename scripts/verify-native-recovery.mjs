#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { QA_ACCOUNTS } from "../tests/fixtures/qa-accounts.ts";
import { can } from "../src/platform/auth/permissions.ts";
import { toolScope } from "./target-guard.mjs";

const env = parseEnv(readFileSync(".env.local", "utf8"));
// Rule 3 / D-346: One's main project only, and on production it refuses (it writes real-session data).
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-native-recovery", mode: "dev-only" });
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const contactId = randomUUID();
const session = `QA-RECOVERY-${contactId}`;
const results = [];
function check(name, ok) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) throw new Error(name);
}
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function asAccount(account) {
  const link = checked(await admin.auth.admin.generateLink({ type: "magiclink", email: account.email }));
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token }));
  return client;
}
const student = checked(await admin.from("students").select("id").limit(1).single());
try {
  checked(await admin.from("defaulter_contacts").insert({
    id: contactId, student_id: student.id, session_label: session, channel: "call", outcome: "promised_pay",
    contacted_at: "2037-01-01T06:00:00Z", snooze_until: "2037-02-01", note: "QA native recovery verification",
  }));
  for (const account of QA_ACCOUNTS) {
    const client = await asAccount(account);
    if (account.key === "office") {
      const legacy = await client.rpc("refresh_defaulter_recovery_state", { p_session_label: session, p_today: "2037-02-02" });
      check("legacy permission map reproduces refusal for the native office role", legacy.error?.code === "28000");
    }
    if (account.key === "admin") {
      const beforeDue = await client.schema("vppsone").rpc("refresh_defaulter_recovery_state", { p_session_label: session, p_today: "2037-02-01" });
      check("a promise is not broken on its promised date", !beforeDue.error && beforeDue.data === 0);
    }
    const refreshed = await client.schema("vppsone").rpc("refresh_defaulter_recovery_state", { p_session_label: session, p_today: "2037-02-02" });
    const allowed = account.canSignIn && can({ role: account.role }, "fees:view");
    check(`${account.key}: native fee permission ${allowed ? "allows" : "refuses"} refresh`, allowed ? !refreshed.error && refreshed.data === 1 : refreshed.error?.code === "28000");
  }
  const anon = createClient(url, key, { auth: { persistSession: false } });
  const anonymous = await anon.schema("vppsone").rpc("refresh_defaulter_recovery_state", { p_session_label: session });
  check("anonymous execution is revoked", anonymous.error?.code === "42501");
  const state = checked(await admin.from("defaulter_recovery_state").select("promise_kept_count,promise_broken_count,last_resolved_contact_id")
    .eq("student_id", student.id).eq("session_label", session).single());
  check("repeated authorized refreshes count the promise exactly once", state.promise_kept_count === 0 && state.promise_broken_count === 1 && state.last_resolved_contact_id === contactId);
} finally {
  checked(await admin.from("defaulter_recovery_state").delete().eq("student_id", student.id).eq("session_label", session));
  checked(await admin.from("defaulter_contacts").delete().eq("id", contactId));
  for (const [table, field, value] of [["defaulter_contacts", "id", contactId], ["defaulter_recovery_state", "session_label", session]]) {
    const result = await admin.from(table).select("student_id", { count: "exact", head: true }).eq(field, value);
    checked(result);
    check(`${table}: temporary fixture removed`, result.count === 0);
  }
  writeFileSync("docs/evidence/native-recovery-2026-10-06.json", JSON.stringify({ measuredAt: new Date().toISOString(), project: "wtgxcptmucjerhufzjcf", results }, null, 2) + "\n");
}
