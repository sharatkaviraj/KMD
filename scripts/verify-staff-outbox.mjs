/**
 * Gate F, against the database: the staff notice outbox claims, records and
 * recovers honestly — and never re-sends something that may already have gone.
 *
 *   npm run verify:outbox            # exit 1 on any broken promise
 *   npm run verify:outbox -- --json  # and write docs/evidence/P4-outbox-<date>.json
 *
 * Drives the database half of the dispatcher (claim → stamp → finish, the
 * sweeper, a person's reconciliation) on a synthetic school day a year ahead.
 * What a provider said is played by this script; the mapping from an HTTP
 * answer to an outcome is unit-tested in tests/staff-notices.test.ts. Nothing
 * here can reach WhatsApp — no transport is loaded at all.
 *
 * Two throwaway staff profiles are made for the run, with synthetic numbers,
 * so no real person's record is touched; they and every row they collect are
 * removed at the end.
 *
 * Rule 3: dev only. Rule 6: synthetic names and numbers only.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { toolScope } from "./target-guard.mjs";

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

// Rule 3 / D-346: One's main project only, and on production it refuses (it writes real-session data).
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-staff-outbox", mode: "dev-only" });

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const call = async (fn, args) => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};

/* ------------------------------------------------------------- the scene */

const DAY = "2027-03-02";
const { data: version } = await db
  .from("timetable_versions")
  .select("id, session_label")
  .eq("status", "published")
  .limit(1)
  .single();
const session = version.session_label;
const { data: slots } = await db.from("timetable_slots").select("day, period, class_id, class_label, subject_code").eq("version_id", version.id).limit(3000);
const header = [...new Set(slots.map((slot) => slot.day))].find((name) => /^tue/i.test(name));
const lesson = slots.find((slot) => slot.day === header && slot.period === 1);
const { data: perms } = await db.from("role_permissions").select("role").eq("permission", "substitutions:manage");
const roles = perms.map((row) => row.role);
const { data: actor } = await db.from("staff_profiles").select("id").in("role", roles).eq("is_active", true).not("user_id", "is", null).limit(1).single();
const { data: bells } = await db.from("bell_schedules").select("revision").eq("session_label", session).eq("is_current", true).maybeSingle();

const tag = Date.now().toString(36).slice(-5).toUpperCase();
const made = [];
async function profile(shortName, phone) {
  const { data, error } = await db
    .from("staff_profiles")
    .insert({ display_name: `Outbox Test ${shortName}`, short_name: shortName, role: "teacher", is_teaching: true, is_active: true, whatsapp_phone: phone })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  made.push(data.id);
  return data.id;
}

let revision = 0;
async function commit(covering) {
  const payload = {
    command_id: randomUUID(),
    kind: "assign",
    actor_staff_id: actor.id,
    session_label: session,
    day: DAY,
    timetable_day: header,
    expected: { day_revision: revision, timetable_version_id: version.id, bells_revision: bells?.revision ?? 0 },
    absences: [],
    duties: [
      {
        need_key: `outbox|${DAY}|${lesson.class_id}`,
        period: 1,
        event_kind: "ordinary",
        class_ids: [lesson.class_id],
        class_labels: [lesson.class_label],
        subject_code: lesson.subject_code,
        absent_staff_ids: [],
        status: covering ? "assigned" : "needs_help",
        covering_staff_id: covering,
        reason: covering ? null : "released",
        source: "manual",
        pinned: true,
        warnings: [],
      },
    ],
  };
  payload.payload_hash = createHash("sha256").update(payload.command_id).digest("hex");
  const receipt = await call("commit_cover_command", { p_command: payload });
  if (!receipt.ok) throw new Error(`commit: ${JSON.stringify(receipt)}`);
  revision = receipt.day_revision;
  return receipt;
}
const notices = async () =>
  (await db.from("staff_notices").select("id, kind, status, status_reason, staff_profile_id, next_attempt_at, attempts").eq("day", DAY).eq("session_label", session).order("created_at")).data ?? [];
const setFlag = (enabled) => db.from("runtime_flags").update({ enabled }).eq("key", "staff_notice_dispatch");

async function cleanup() {
  const { data: duties } = await db.from("cover_duties").select("id").eq("session_label", session).eq("day", DAY);
  const ids = (duties ?? []).map((row) => row.id);
  if (ids.length) {
    const { data: rows } = await db.from("staff_notices").select("id").in("duty_id", ids);
    const noticeIds = (rows ?? []).map((row) => row.id);
    if (noticeIds.length) {
      await db.from("staff_notice_attempts").delete().in("notice_id", noticeIds);
      await db.from("staff_notices").delete().in("id", noticeIds);
    }
    await db.from("cover_duties").update({ supersedes: null }).in("id", ids);
    await db.from("cover_duties").delete().in("id", ids);
  }
  await db.from("cover_commands").delete().eq("session_label", session).eq("day", DAY);
  await db.from("cover_days").delete().eq("session_label", session).eq("day", DAY);
  if (made.length) await db.from("staff_profiles").delete().in("id", made);
}

/* ------------------------------------------------------------- the tests */

console.log(`\n  staff notice outbox on ${DAY} (${header}, P2), session ${session}\n`);

const { data: flagRow } = await db.from("runtime_flags").select("enabled").eq("key", "staff_notice_dispatch").single();
const flagWas = flagRow.enabled;

try {
  const X = await profile(`OX${tag}`, "9000000001");
  const Y = await profile(`OY${tag}`, "9000000002");
  const Z = await profile(`OZ${tag}`, null);

  // 1. The switch off means nothing is claimed.
  await setFlag(false);
  await commit(X);
  const off = await call("claim_staff_notice", { p_worker: "w1", p_lease_seconds: 60, p_transport: "mock" });
  check("with the switch off nothing is claimed", off.claimed === false && off.reason === "disabled");
  await setFlag(true);

  // 2. Two dispatchers at once: exactly one claims it.
  const [a, b] = await Promise.all([
    call("claim_staff_notice", { p_worker: "w1", p_lease_seconds: 60, p_transport: "mock" }),
    call("claim_staff_notice", { p_worker: "w2", p_lease_seconds: 60, p_transport: "mock" }),
  ]);
  const winner = [a, b].find((claim) => claim.claimed);
  const claims = [a, b].filter((claim) => claim.claimed).length;
  check("two dispatchers at once: one claims, the other finds nothing", claims === 1 && winner?.destination === "9000000001");

  // 3. Only the lease holder may stamp; the snapshot is recorded before sending.
  const worker = winner === a ? "w1" : "w2";
  const wrong = await call("stamp_staff_notice", { p_attempt: winner.attempt_id, p_worker: "w9", p_template: "t", p_language: "en", p_params: {}, p_link: "x" });
  const right = await call("stamp_staff_notice", { p_attempt: winner.attempt_id, p_worker: worker, p_template: "vppsone_cover_assigned", p_language: "en", p_params: { params: ["Outbox Test"] }, p_link: "https://example.test/duty/x" });
  check("only the lease holder can stamp what will be sent", wrong === false && right === true);

  // 4. Accepted with a receipt id.
  await call("finish_staff_notice", { p_attempt: winner.attempt_id, p_worker: worker, p_outcome: "accepted", p_provider_message_id: "mock:1", p_provider_status: 200, p_error: null });
  let rows = await notices();
  check("a provider receipt makes the notice accepted", rows.find((row) => row.kind === "cover_assigned")?.status === "accepted");

  // 5. Reassigned after it went: the first person is owed a cancellation.
  await commit(Y);
  rows = await notices();
  const cancel = rows.find((row) => row.kind === "cover_cancelled" && row.staff_profile_id === X);
  check("a duty moved after its notice went out queues a cancellation for that person", cancel?.status === "pending");

  // 6. A timeout after the call is Unknown, and is never claimed again by itself.
  const claim6 = await call("claim_staff_notice", { p_worker: "w3", p_lease_seconds: 60, p_transport: "mock", p_notice_id: cancel.id });
  await call("stamp_staff_notice", { p_attempt: claim6.attempt_id, p_worker: "w3", p_template: "t", p_language: "en", p_params: {}, p_link: "x" });
  await call("finish_staff_notice", { p_attempt: claim6.attempt_id, p_worker: "w3", p_outcome: "unknown", p_provider_message_id: null, p_provider_status: null, p_error: "timeout" });
  const again = await call("claim_staff_notice", { p_worker: "w4", p_lease_seconds: 60, p_transport: "mock", p_notice_id: cancel.id });
  rows = await notices();
  check("a timeout is Unknown and is never re-sent by the machine", rows.find((row) => row.id === cancel.id)?.status === "unknown" && again.claimed === false);

  // 7. A 2xx without a receipt id is Unknown too.
  const yNotice = rows.find((row) => row.kind === "cover_assigned" && row.staff_profile_id === Y);
  const claim7 = await call("claim_staff_notice", { p_worker: "w5", p_lease_seconds: 60, p_transport: "mock", p_notice_id: yNotice.id });
  await call("stamp_staff_notice", { p_attempt: claim7.attempt_id, p_worker: "w5", p_template: "t", p_language: "en", p_params: {}, p_link: "x" });
  await call("finish_staff_notice", { p_attempt: claim7.attempt_id, p_worker: "w5", p_outcome: "accepted", p_provider_message_id: "", p_provider_status: 200, p_error: null });
  rows = await notices();
  check("an answer with no receipt id is Unknown, not sent", rows.find((row) => row.id === yNotice.id)?.status === "unknown");

  // 8. A person authorises a resend; a rate limit is retried later, not now.
  const reconciled = await call("reconcile_staff_notice", { p_notice: yNotice.id, p_actor: actor.id, p_resolution: "resend" });
  const claim8 = await call("claim_staff_notice", { p_worker: "w6", p_lease_seconds: 60, p_transport: "mock", p_notice_id: yNotice.id });
  await call("stamp_staff_notice", { p_attempt: claim8.attempt_id, p_worker: "w6", p_template: "t", p_language: "en", p_params: {}, p_link: "x" });
  const finished8 = await call("finish_staff_notice", { p_attempt: claim8.attempt_id, p_worker: "w6", p_outcome: "rate_limited", p_provider_message_id: null, p_provider_status: 429, p_error: "rate limited" });
  const tooSoon = await call("claim_staff_notice", { p_worker: "w7", p_lease_seconds: 60, p_transport: "mock", p_notice_id: yNotice.id });
  const { data: attempts8 } = await db.from("staff_notice_attempts").select("attempt_no, authorized_by").eq("notice_id", yNotice.id).order("attempt_no");
  check(
    "a resend is a person's decision, and a rate limit waits before the next attempt",
    reconciled.ok === true && finished8.notice_status === "failed" && Boolean(finished8.retry_at) && tooSoon.claimed === false && attempts8.length === 2,
  );

  // 9. A lease that expires after the provider call becomes Unknown; before it, back to the queue.
  await db.from("staff_notices").update({ status: "pending", next_attempt_at: null }).eq("id", yNotice.id);
  const claim9 = await call("claim_staff_notice", { p_worker: "w8", p_lease_seconds: 60, p_transport: "mock", p_notice_id: yNotice.id });
  await db.from("staff_notice_attempts").update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", claim9.attempt_id);
  await call("sweep_staff_notices", {});
  rows = await notices();
  const back = rows.find((row) => row.id === yNotice.id)?.status;
  const claim9b = await call("claim_staff_notice", { p_worker: "w9", p_lease_seconds: 60, p_transport: "mock", p_notice_id: yNotice.id });
  await call("stamp_staff_notice", { p_attempt: claim9b.attempt_id, p_worker: "w9", p_template: "t", p_language: "en", p_params: {}, p_link: "x" });
  await db.from("staff_notice_attempts").update({ lease_expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", claim9b.attempt_id);
  await call("sweep_staff_notices", {});
  rows = await notices();
  const late = await call("finish_staff_notice", { p_attempt: claim9b.attempt_id, p_worker: "w9", p_outcome: "accepted", p_provider_message_id: "mock:late", p_provider_status: 200, p_error: null });
  check(
    "an expired lease before sending goes back to the queue; after sending it is Unknown, and a late answer does not overwrite it",
    back === "pending" && rows.find((row) => row.id === yNotice.id)?.status === "unknown" && late.recorded === false,
  );

  // 10. A notice for a duty that has moved on is suppressed, not sent stale.
  await commit(Z);
  rows = await notices();
  const zNotice = rows.find((row) => row.kind === "cover_assigned" && row.staff_profile_id === Z);
  await commit(X);
  const stale = await call("claim_staff_notice", { p_worker: "w10", p_lease_seconds: 60, p_transport: "mock" });
  rows = await notices();
  check(
    "an unsent notice for a duty that moved on is withdrawn before anyone claims it",
    rows.find((row) => row.id === zNotice.id)?.status === "cancelled" && (!stale.claimed || stale.notice.id !== zNotice.id),
  );

  // 11. Nobody without a number is sent to; the reason is kept.
  // (Only the notice for the live duty — an older one for a duty that has
  // since moved is suppressed as duty_changed, which is checked first.)
  await commit(Z);
  rows = await notices();
  const zLive = rows.filter((row) => row.staff_profile_id === Z && row.kind === "cover_assigned" && row.status === "pending");
  for (const row of zLive) await call("claim_staff_notice", { p_worker: "w11", p_lease_seconds: 60, p_transport: "mock", p_notice_id: row.id });
  rows = await notices();
  check(
    "a teacher with no phone is suppressed with the reason, never sent",
    zLive.length > 0 && zLive.every((row) => rows.find((r) => r.id === row.id)?.status_reason === "no_phone"),
  );
} finally {
  await setFlag(flagWas);
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n  PASS — ${results.length} of ${results.length}.\n` : `\n  FAIL — ${failed.length} of ${results.length}.\n`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P4-outbox-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), target: "schoolfees-dev", syntheticDay: DAY, results }, null, 2));
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length === 0 ? 0 : 1);
