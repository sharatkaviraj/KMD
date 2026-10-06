#!/usr/bin/env node
/** Complete screen gates with two temporary, inert dev-only metadata fixtures. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { pickSessionLabel } from "../src/platform/config/active-session.ts";
import { QA_ACCOUNTS } from "../tests/fixtures/qa-accounts.ts";
import { isDevProjectUrl } from "./target-guard.mjs";

const env = parseEnv(readFileSync(".env.local", "utf8"));
if (!isDevProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Screen fixtures require the dev database.");
const origin = process.env.APP_ORIGIN ?? "http://localhost:3450";
const manifest = await fetch(new URL("/manifest.webmanifest", origin), { signal: AbortSignal.timeout(30000) });
const app = await manifest.json();
if (!manifest.ok || app.short_name !== "VPPS One" || app.id !== "/") throw new Error("The target is not VPPS One.");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const native = admin.schema("vppsone");
function checked(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}
const labels = checked(await admin.from("classes").select("session_label"), "Session labels");
const setting = checked(await admin.from("app_settings").select("value").eq("key", "active_session_label").maybeSingle(), "Active session");
const session = pickSessionLabel({ configured: env.VPPSONE_SESSION_LABEL, active: setting?.value, labels: [...new Set(labels.map(row => row.session_label))] });
if (!session) throw new Error("An active academic session is required.");
const account = QA_ACCOUNTS.find(row => row.key === "teacher");
let qaUser;
for (let page = 1; !qaUser; page += 1) {
  const users = checked(await admin.auth.admin.listUsers({ page, perPage: 1000 }), "QA user lookup").users;
  qaUser = users.find(user => user.email === account.email);
  if (!qaUser && users.length < 1000) throw new Error("Seed the QA teaching account first.");
}
const teacher = checked(await native.from("staff_profiles").select("id").eq("user_id", qaUser.id).single(), "QA teacher");
const enrolment = checked(await native.from("enrolments").select("class_id").eq("session_label", session).limit(1).single(), "QA class");
const dutyId = randomUUID();
const runId = randomUUID();
const stamp = new Date().toISOString();
const date = stamp.slice(0, 10);
let failed = false;
try {
  checked(await native.from("cover_duties").insert({
    id: dutyId, session_label: session, day: date, need_key: `QA-SCREEN-${dutyId}`, period: 0,
    event_kind: "ordinary", class_ids: [enrolment.class_id], class_labels: ["QA screen fixture"],
    subject_code: "QA", absent_staff_ids: [], status: "cancelled", covering_staff_id: teacher.id,
    source: "manual", day_revision: 1, command_id: randomUUID(), ended_at: stamp,
  }), "Cancelled duty fixture");
  // Finished, zero recipients, and no send/outbox records: this cannot dispatch a message.
  checked(await admin.from("whatsapp_campaign_runs").insert({
    id: runId, session_label: session, campaign_name: `QA-SCREEN-${runId}`,
    situation: "fee_due", language: "hi", filters: {}, finished_at: stamp,
  }), "Empty campaign-run fixture");
  console.log("Created a cancelled QA duty and a finished zero-recipient run. No sends queued.");
  for (const [script, args] of [
    ["scripts/smoke-roles.mjs", ["--strict", "--write", `docs/evidence/role-smoke-${date}.json`]],
    ["scripts/deep-smoke.mjs", ["--json", "--write", `docs/evidence/deep-smoke-${date}.json`]],
  ]) {
    const result = spawnSync(process.execPath, ["--import", "./scripts/alias-hook.mjs", script, ...args], {
      stdio: "inherit", env: { ...process.env, APP_ORIGIN: origin, SMOKE_DUTY_ID: dutyId, SMOKE_RUN_ID: runId },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) failed = true;
  }
} finally {
  checked(await native.from("cover_duties").delete().eq("id", dutyId), "Duty cleanup");
  checked(await admin.from("whatsapp_campaign_runs").delete().eq("id", runId), "Run cleanup");
  for (const [client, table, id] of [[native, "cover_duties", dutyId], [admin, "whatsapp_campaign_runs", runId]]) {
    const result = await client.from(table).select("id", { count: "exact", head: true }).eq("id", id);
    checked(result, "Cleanup check");
    if (result.count !== 0) throw new Error(`QA fixture remains in ${table}.`);
  }
  console.log("Both temporary screen fixtures were removed and their absence verified.");
}
process.exitCode = failed ? 1 : 0;
