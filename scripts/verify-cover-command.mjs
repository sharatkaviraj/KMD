/**
 * Gate E, against the database: the cover command is atomic, versioned and
 * idempotent, and it says so under fault, race and replay.
 *
 *   npm run verify:cover            # exit 1 on any broken promise
 *   npm run verify:cover -- --json  # and write docs/evidence/P3-cover-command-<date>.json
 *
 * Drives `vppsone.commit_cover_command` directly, the way the server action
 * does, on a synthetic school day a year ahead (so every period is still open)
 * and with the real published timetable, so "teaching" and "absent" are the
 * database's own facts. Every row it makes is for that one day and is removed
 * at the end, whatever happened.
 *
 * Fault injection uses the `fault_injection` runtime flag, which this script
 * turns on for the run and off again. A migration never turns it on, so it is
 * off on any database this script has not touched.
 *
 * Rule 3: dev only. Rule 6: staff are referred to by id; nothing is printed
 * but outcomes and counts.
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

// Rule 3 / D-346, Phase 3: One's main project only, confined to TEST-2026-27 and test accounts on every marker.
const scope = await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-cover-command", mode: "test-scoped" });

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const rpc = async (payload) => {
  const { data, error } = await db.rpc("commit_cover_command", { p_command: payload });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};

/* ------------------------------------------------------------- the scene */

const { data: version } = await db
  .from("timetable_versions")
  .select("id, session_label")
  .eq("status", "published")
  .match(scope.confined ? { session_label: scope.sessionLabel } : {})
  .order("published_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (!version) {
  console.error("No published timetable on dev.");
  process.exit(1);
}
const session = version.session_label;

const { data: slots } = await db
  .from("timetable_slots")
  .select("day, period, class_id, class_label, subject_code, staff_profile_id, parallel, shared")
  .eq("version_id", version.id)
  .limit(5000);

const header = [...new Set(slots.map((slot) => slot.day))].find((name) => /^mon/i.test(name));
const DAY = "2027-03-01"; // a Monday, a year ahead: every period still open
const P = 2;

const at = slots.filter((slot) => slot.day === header && slot.period === P);
const ordinary = at.find(
  (slot) => !slot.parallel && !slot.shared && at.filter((other) => other.staff_profile_id === slot.staff_profile_id).length === 1,
);
const teachingNow = new Set(at.map((slot) => slot.staff_profile_id));

const { data: profiles } = await db
  .from("staff_profiles")
  .select("id, role, is_active, is_teaching, user_id")
  .eq("is_active", true);
const free = profiles.filter((p) => p.is_teaching && !teachingNow.has(p.id) && p.id !== ordinary?.staff_profile_id);
const busy = profiles.find((p) => teachingNow.has(p.id) && p.id !== ordinary?.staff_profile_id);

const { data: perms } = await db.from("role_permissions").select("role").eq("permission", "substitutions:manage");
const managerRoles = new Set(perms.map((row) => row.role));
const actor = profiles.find((p) => managerRoles.has(p.role) && p.user_id);

if (!header || !ordinary || free.length < 2 || !busy || !actor) {
  console.error("The dev timetable does not have the shape this needs (an ordinary P3 lesson, two free teachers, one busy one).");
  process.exit(1);
}

const A = ordinary.staff_profile_id; // away
const [B, C] = free.map((p) => p.id); // free in P3
const T = busy.id; // teaching in P3
const NEED = `synthetic|${DAY}|P${P}|${ordinary.class_id}`;

const duty = (covering, status = "assigned", needKey = NEED, extra = {}) => ({
  need_key: needKey,
  period: P,
  event_kind: "ordinary",
  class_ids: [ordinary.class_id],
  class_labels: [ordinary.class_label],
  subject_code: ordinary.subject_code,
  absent_staff_ids: [A],
  status,
  covering_staff_id: status === "assigned" ? covering : null,
  suggested_staff_id: null,
  reason: status === "assigned" ? null : "no_candidate",
  source: "auto",
  pinned: false,
  match_tier: "exact",
  warnings: [],
  ...extra,
});

const { data: bells } = await db.from("bell_schedules").select("revision").eq("session_label", session).eq("is_current", true).maybeSingle();
const bellsRevision = bells?.revision ?? 0;

const command = (overrides) => {
  const base = {
    command_id: randomUUID(),
    kind: "absence",
    actor_staff_id: actor.id,
    session_label: session,
    day: DAY,
    timetable_day: header,
    expected: { day_revision: 0, timetable_version_id: version.id, bells_revision: bellsRevision },
    absences: [{ staff_profile_id: A, periods: [P] }],
    duties: [duty(B)],
  };
  const merged = { ...base, ...overrides };
  merged.payload_hash ??= createHash("sha256").update(JSON.stringify([merged.kind, merged.absences, merged.duties.map((d) => d.covering_staff_id)])).digest("hex");
  return merged;
};

async function dayState() {
  const [{ data: day }, { data: duties }, { data: absences }, { data: notices }, { data: history }] = await Promise.all([
    db.from("cover_days").select("revision").eq("session_label", session).eq("day", DAY).maybeSingle(),
    db.from("cover_duties").select("id, status, covering_staff_id, revision, need_key").eq("session_label", session).eq("day", DAY).order("created_at"),
    db.from("teacher_absences").select("staff_profile_id, periods, revision").eq("day", DAY),
    db.from("staff_notices").select("id, kind, status, staff_profile_id, duty_id").eq("session_label", session).eq("day", DAY).order("created_at"),
    db.from("teacher_absence_history").select("id").eq("session_label", session).eq("day", DAY),
  ]);
  return {
    revision: day?.revision ?? 0,
    duties: duties ?? [],
    live: (duties ?? []).filter((d) => d.status === "assigned" || d.status === "needs_help"),
    absences: absences ?? [],
    notices: notices ?? [],
    history: history ?? [],
  };
}

async function cleanup() {
  const { data: duties } = await db.from("cover_duties").select("id").eq("session_label", session).eq("day", DAY);
  const ids = (duties ?? []).map((d) => d.id);
  if (ids.length > 0) {
    const { data: notices } = await db.from("staff_notices").select("id").in("duty_id", ids);
    const noticeIds = (notices ?? []).map((n) => n.id);
    if (noticeIds.length > 0) {
      await db.from("staff_notice_attempts").delete().in("notice_id", noticeIds).then(() => null, () => null);
      await db.from("staff_notices").delete().in("id", noticeIds);
    }
    await db.from("cover_duties").update({ supersedes: null }).in("id", ids);
    await db.from("cover_duties").delete().in("id", ids);
  }
  await db.from("cover_commands").delete().eq("session_label", session).eq("day", DAY);
  await db.from("cover_days").delete().eq("session_label", session).eq("day", DAY);
  await db.from("teacher_absence_history").delete().eq("session_label", session).eq("day", DAY);
  await db.from("teacher_absences").delete().eq("day", DAY);
}

const setFault = (enabled) =>
  db.from("runtime_flags").update({ enabled }).eq("key", "fault_injection");

/* ------------------------------------------------------------- the tests */

console.log(`\n  commit_cover_command on ${DAY} (${header}, P${P + 1}), session ${session}\n`);

await cleanup();
try {
  // 1. A first command commits everything at once.
  const first = command();
  const r1 = await rpc(first);
  let s = await dayState();
  check(
    "a command commits the absence, the duty and the notice together",
    r1.ok === true && s.revision === 1 && s.live.length === 1 && s.absences.length === 1 && s.notices.length === 1 && s.history.length === 1,
    `assigned ${r1.assigned}, notices ${r1.notices_queued}`,
  );

  // 2. The same submission again returns the same receipt and writes nothing.
  const r2 = await rpc(first);
  const s2 = await dayState();
  check(
    "a repeated submission returns its receipt and writes nothing",
    r2.ok === true && r2.replayed === true && r2.day_revision === r1.day_revision && s2.duties.length === s.duties.length && s2.revision === 1,
  );

  // 3. Its id with a different payload is refused.
  const r3 = await rpc({ ...first, payload_hash: "different", duties: [duty(C)] });
  check("a reused id with a different payload is refused", r3.ok === false && r3.reason === "id_reused");

  // 4. A command that names an older day revision is stale and writes nothing.
  const r4 = await rpc(command({ duties: [duty(C)] }));
  const s4 = await dayState();
  check(
    "a command against an older revision is stale and writes nothing",
    r4.ok === false && r4.reason === "stale" && s4.revision === 1 && s4.live[0]?.covering_staff_id === B,
  );

  const at1 = { day_revision: 1, timetable_version_id: version.id, bells_revision: bellsRevision };

  // 5. A cover the facts refuse rolls the absence back with it.
  const r5 = await rpc(command({ expected: at1, absences: [{ staff_profile_id: A, periods: [P, P + 1] }], duties: [duty(T)] }));
  const s5 = await dayState();
  check(
    "a teacher who is teaching is refused, and the absence change is rolled back",
    r5.ok === false && /cover_command:invalid/.test(r5.message ?? "") && s5.absences[0]?.periods.length === 1 && s5.revision === 1,
    (r5.message ?? "").match(/"problem":"(\w+)"/)?.[1] ?? "",
  );

  // 6. Two teachers in one room at once is refused.
  const r6 = await rpc(
    command({
      expected: at1,
      duties: [duty(B), duty(B, "assigned", `${NEED}#2`, { class_ids: [slots[0].class_id], class_labels: ["X"] })],
    }),
  );
  check("one teacher on two duties in one period is refused", r6.ok === false && /double_booked/.test(r6.message ?? ""));

  // 7. A fault after each internal write leaves the previous state intact.
  await setFault(true);
  for (const point of ["after_absences", "after_duties", "before_receipt"]) {
    const before = await dayState();
    const r = await rpc(command({ expected: at1, absences: [{ staff_profile_id: A, periods: [P, P + 1] }], duties: [duty(C)], fault: point }));
    const after = await dayState();
    check(
      `an injected fault ${point.replace("_", " ")} leaves nothing behind`,
      r.ok === false &&
        /injected_fault/.test(r.message ?? "") &&
        after.revision === before.revision &&
        after.duties.length === before.duties.length &&
        after.notices.length === before.notices.length &&
        after.history.length === before.history.length &&
        after.live[0]?.covering_staff_id === B,
    );
  }
  await setFault(false);

  // 8. Two operators at once on the same revision: exactly one wins.
  const [ra, rb] = await Promise.all([
    rpc(command({ expected: at1, duties: [duty(C)] })),
    rpc(command({ expected: at1, duties: [duty(B, "needs_help")] })),
  ]);
  const s8 = await dayState();
  const winners = [ra, rb].filter((r) => r.ok === true).length;
  const stale = [ra, rb].filter((r) => r.reason === "stale").length;
  check(
    "two simultaneous commands on one revision: one commits, one is stale",
    winners === 1 && stale === 1 && s8.revision === 2 && s8.live.length === 1,
  );

  // 9. A change supersedes the duty, keeps its history and tells both people.
  const assignedTo = s8.live[0].covering_staff_id;
  const r9 = await rpc(command({ expected: { ...at1, day_revision: 2 }, duties: [duty(assignedTo === B ? C : B)] }));
  const s9 = await dayState();
  const superseded = s9.duties.filter((d) => d.status === "superseded").length;
  check(
    "a reassignment supersedes rather than edits, and keeps the old revision",
    r9.ok === true && superseded >= 1 && s9.live.length === 1 && s9.live[0].revision > 1,
  );

  // P5. The teacher answers: only the holder, idempotently, and "cannot cover"
  // tells whoever arranges cover without freeing her.
  const holder = s9.live[0].covering_staff_id;
  const dutyId = s9.live[0].id;
  const respond = (staff, response) =>
    db.rpc("respond_to_cover_duty", { p_duty: dutyId, p_staff: staff, p_response: response, p_note: "synthetic" }).then((r) => r.data);
  const stranger = await respond(holder === B ? C : B, "acknowledge");
  const ack1 = await respond(holder, "acknowledge");
  const ack2 = await respond(holder, "acknowledge");
  check("only the holder may answer, and acknowledging twice is acknowledging once", stranger.reason === "not_yours" && ack1.ok && ack2.ok);
  const refusal = await respond(holder, "cannot_cover");
  const { data: escalations } = await db.from("staff_notices").select("kind").eq("duty_id", dutyId).eq("kind", "cover_escalation");
  const { data: stillHers } = await db.from("cover_duties").select("status, covering_staff_id, cannot_cover_at").eq("id", dutyId).single();
  check(
    "\"cannot cover\" escalates to whoever arranges cover and does not free the duty",
    refusal.ok && (escalations ?? []).length >= 1 && stillHers.status === "assigned" && stillHers.covering_staff_id === holder && Boolean(stillHers.cannot_cover_at),
  );
  const oldLink = await db.rpc("respond_to_cover_duty", { p_duty: s.live[0]?.id ?? dutyId, p_staff: holder, p_response: "acknowledge" }).then((r) => r.data);
  check("an old link to a duty that moved cannot be acknowledged", s.live[0]?.id === dutyId || oldLink.reason === "not_yours");

  // 9b. Choosing, by hand, the teacher who already has it pins it — in place,
  // with no new revision and nothing sent, because nothing she was told changed.
  const pinned = await rpc(
    command({ kind: "assign", expected: { ...at1, day_revision: 3 }, duties: [duty(holder, "assigned", NEED, { source: "manual", pinned: true })] }),
  );
  const { data: pinnedRow } = await db.from("cover_duties").select("id, revision, source, pinned").eq("id", dutyId).single();
  check(
    "assigning the current holder pins the duty in place and notifies nobody",
    pinned.ok === true && pinned.pinned === 1 && pinned.changed === 0 && pinned.notices_queued === 0 &&
      pinnedRow.source === "manual" && pinnedRow.pinned === true && pinnedRow.revision === s9.live[0].revision,
    `pinned ${pinned.pinned}, changed ${pinned.changed}`,
  );

  // 10. An unsent notice is withdrawn, not corrected; a sent one gets a cancellation.
  const withdrawn = s9.notices.filter((n) => n.status === "cancelled").length;
  check("an unsent notice for a duty that moved is withdrawn, not corrected", withdrawn >= 1 && !s9.notices.some((n) => n.kind === "cover_cancelled"));

  const current = s9.notices.find((n) => n.status === "pending" && n.kind === "cover_assigned");
  await db.from("staff_notices").update({ status: "accepted" }).eq("id", current.id);
  const r10 = await rpc(command({ kind: "clear_absence", expected: { ...at1, day_revision: 4 }, absences: [{ staff_profile_id: A, periods: null }], duties: [] }));
  const s10 = await dayState();
  check(
    "the teacher comes back: the duty is cancelled and the person who was told is told",
    r10.ok === true && s10.live.length === 0 && s10.notices.some((n) => n.kind === "cover_cancelled" && n.status === "pending") && s10.absences.length === 0,
  );

  // 11. A begun period is history.
  const { data: open } = await db.rpc("cover_period_open", { p_session_label: session, p_day: "2020-01-01", p_period: 0 });
  check("a period on a past day is never arrangeable", open === false);

  // 12. Only somebody who manages cover may command it.
  const outsider = profiles.find((p) => !managerRoles.has(p.role));
  const r12 = await rpc(command({ actor_staff_id: outsider.id, expected: { ...at1, day_revision: 5 } }));
  check("an actor without substitutions:manage is refused", r12.ok === false && r12.reason === "not_permitted");

  // 13. The operator's switch (pilot runbook): off means no command lands,
  // and nothing already committed is touched.
  await db.from("runtime_flags").update({ enabled: false }).eq("key", "cover_command");
  try {
    const before = await dayState();
    const r13 = await rpc(command({ expected: { ...at1, day_revision: 5 } }));
    const after = await dayState();
    check(
      "with the operator switch off a command is refused, and nothing committed changes",
      r13.ok === false && r13.reason === "disabled" && JSON.stringify(after) === JSON.stringify(before),
      r13.reason,
    );
  } finally {
    await db.from("runtime_flags").update({ enabled: true }).eq("key", "cover_command");
  }
} finally {
  await db.from("runtime_flags").update({ enabled: true }).eq("key", "cover_command");
  await setFault(false);
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n  PASS — ${results.length} of ${results.length}.\n` : `\n  FAIL — ${failed.length} of ${results.length}.\n`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P3-cover-command-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), target: "schoolfees-dev", syntheticDay: DAY, results }, null, 2));
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length === 0 ? 0 : 1);
