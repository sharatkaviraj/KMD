/**
 * P6, against the database: a register is saved whole, once, with a receipt;
 * changed only by a correction that says why; and refused rather than guessed
 * at when the roll, the revision or the person is wrong.
 *
 *   npm run verify:attendance            # exit 1 on any broken promise
 *   npm run verify:attendance -- --json  # and write docs/evidence/P6-attendance-<date>.json
 *
 * Drives `vppsone.save_attendance_register` directly, the way the server
 * action does, as three real QA accounts — the class teacher, a subject
 * teacher and the office — on past school days the QA class has no register
 * for. Everything it writes is for those days and is removed at the end,
 * whatever happened; the one enrolment date it moves to test the dated roll is
 * put back.
 *
 * Rule 3: dev only. Rule 6: children and staff are referred to by id; nothing
 * is printed but outcomes and counts.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { isDevProjectUrl } from "./target-guard.mjs";

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

if (!isDevProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

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
  const { data, error } = await db.rpc("save_attendance_register", { p: payload });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};

/* ------------------------------------------------------------- the scene */

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id, role").eq("user_id", user.id).single();
  return data;
};

const owner = await profileOf("qa.teacher@qa.vpps.local");
const subjectTeacher = await profileOf("qa.teacher2@qa.vpps.local");
// The "office" QA account signs in as qa.accountant (role office).
const office = await profileOf("qa.accountant@qa.vpps.local");

// The session the school is in, from the setting the fee app reads — never
// the last label sorted, because `TEST-2026-27` sorts above `2026-27` and the
// QA teacher holds a class in both (rule 3a).
const { data: setting } = await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const ACTIVE = setting?.value;
if (!ACTIVE) throw new Error("app_settings.active_session_label is not set.");

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const { data: held } = await db
  .from("class_teachers")
  .select("class_id, session_label, effective_from, effective_to")
  .eq("staff_profile_id", owner.id)
  .eq("session_label", ACTIVE);
const current = (held ?? []).find(
  (row) => (!row.effective_from || row.effective_from <= today) && (!row.effective_to || row.effective_to >= today),
);
if (!current) throw new Error("The QA teacher holds no class today — run npm run qa:seed");
const CLASS = current.class_id;
const SESSION = current.session_label;

const { data: calendarRows } = await db.from("academic_calendar_days").select("day, kind").eq("session_label", SESSION);
const kindOf = new Map((calendarRows ?? []).map((row) => [row.day, row.kind]));
const isOpen = (day) => {
  const kind = kindOf.get(day);
  if (kind) return kind !== "holiday" && kind !== "vacation";
  return new Date(`${day}T00:00:00Z`).getUTCDay() !== 0;
};
const shift = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

const { data: existing } = await db
  .from("attendance_registers")
  .select("day")
  .eq("session_label", SESSION)
  .eq("class_id", CLASS)
  .is("period", null);
const taken = new Set((existing ?? []).map((row) => row.day));

// Three open past days with no register: the main one, one for the office's
// first save, one for the race.
const days = [];
for (let back = 14; back < 120 && days.length < 3; back += 1) {
  const day = shift(today, -back);
  if (isOpen(day) && !taken.has(day)) days.push(day);
}
if (days.length < 3) throw new Error("Could not find three open past days without a register.");
const [DAY, OFFICE_DAY, RACE_DAY] = days;

const rosterOf = async (day) => {
  const { data, error } = await db.rpc("attendance_roster", { p_session: SESSION, p_class: CLASS, p_day: day });
  if (error) throw new Error(error.message);
  return [...data].sort();
};
const roster = await rosterOf(DAY);
if (roster.length < 3) throw new Error("The QA class needs at least three children on the roll.");

const marksFor = (ids, overrides = {}) => ids.map((id) => ({ student_id: id, status: overrides[id] ?? "present" }));
const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const command = (overrides = {}) => {
  const base = {
    command_id: randomUUID(),
    actor_staff_id: owner.id,
    session_label: SESSION,
    class_id: CLASS,
    day: DAY,
    kind: "save",
    expected_revision: 0,
    reason: null,
    marks: marksFor(roster),
  };
  const merged = { ...base, ...overrides };
  merged.payload_hash ??= hashOf([merged.kind, merged.expected_revision, merged.reason, merged.marks]);
  return merged;
};

async function registerState(day = DAY) {
  const { data: register } = await db
    .from("attendance_registers")
    .select("id, revision, status, taken_by, on_behalf_of, totals")
    .eq("session_label", SESSION)
    .eq("class_id", CLASS)
    .eq("day", day)
    .is("period", null)
    .maybeSingle();
  if (!register) return { register: null, marks: [], revisions: [] };
  const [{ data: marks }, { data: revisions }] = await Promise.all([
    db.from("attendance_marks").select("student_id, status").eq("register_id", register.id),
    db.from("attendance_register_revisions").select("revision, kind, reason, changes").eq("register_id", register.id).order("revision"),
  ]);
  return { register, marks: marks ?? [], revisions: revisions ?? [] };
}

async function cleanup() {
  for (const day of days) {
    const { data: register } = await db
      .from("attendance_registers")
      .select("id")
      .eq("session_label", SESSION)
      .eq("class_id", CLASS)
      .eq("day", day)
      .is("period", null)
      .maybeSingle();
    if (!register) continue;
    await db.from("attendance_corrections").delete().eq("register_id", register.id);
    await db.from("attendance_register_revisions").delete().eq("register_id", register.id);
    await db.from("attendance_registers").delete().eq("id", register.id);
  }
  const { data: notices } = await db.from("staff_notices").select("id").like("notice_key", "verify:%");
  const ids = (notices ?? []).map((row) => row.id);
  if (ids.length > 0) {
    await db.from("staff_notice_attempts").delete().in("notice_id", ids);
    await db.from("staff_notices").delete().in("id", ids);
  }
}

const setFault = (enabled) => db.from("runtime_flags").update({ enabled }).eq("key", "fault_injection");

/* ------------------------------------------------------------- the tests */

console.log(`\n  save_attendance_register for the QA class on ${DAY}, session ${SESSION}, ${roster.length} on the roll\n`);

const [absent, halfDay, third] = roster;
let movedEnrolment = null;

await cleanup();
try {
  // 1. Nothing is recorded until somebody saves.
  const s0 = await registerState();
  check("an unopened, unsaved register is not recorded", s0.register === null || s0.register.revision === 0);

  // 2. The class teacher saves the whole roll, once, with a receipt.
  const first = command({ marks: marksFor(roster, { [absent]: "absent", [halfDay]: "half_day" }) });
  const r1 = await rpc(first);
  const s1 = await registerState();
  check(
    "the class teacher's save records every child, revision 1, with a receipt",
    r1.ok === true &&
      r1.revision === 1 &&
      r1.totals?.total === roster.length &&
      r1.totals?.absent === 1 &&
      r1.totals?.half_day === 1 &&
      s1.marks.length === roster.length &&
      s1.register.revision === 1 &&
      s1.register.taken_by === owner.id &&
      s1.revisions.length === 1 &&
      s1.revisions[0].kind === "save",
    `${r1.totals?.present ?? "?"} present · 1 absent · 1 half day`,
  );

  // 3. The same submission again: the same receipt, nothing new written.
  const r2 = await rpc(first);
  const s2 = await registerState();
  check(
    "a repeated submission returns its receipt and writes nothing",
    r2.ok === true && r2.replayed === true && r2.revision === 1 && s2.revisions.length === 1,
  );

  // 4. Its id with a different payload is refused.
  const r3 = await rpc({ ...first, payload_hash: "different", marks: marksFor(roster) });
  check("a reused id with a different payload is refused", r3.ok === false && r3.reason === "id_reused");

  // 5. A save that names the old revision is stale, and says what was saved.
  const r4 = await rpc(command({ marks: marksFor(roster) }));
  check(
    "a second save against revision 0 is stale and shows the receipt it lost to",
    r4.ok === false && r4.reason === "stale" && r4.current_revision === 1 && r4.latest?.revision === 1,
  );

  // 6. The whole roll or nothing.
  const r5 = await rpc(command({ expected_revision: 1, kind: "correction", reason: "test", marks: marksFor(roster.slice(1)) }));
  check(
    "a save missing a child is refused, naming the child",
    r5.ok === false && r5.reason === "roster_changed" && r5.missing?.length === 1 && r5.missing[0] === roster[0],
  );
  const stranger = randomUUID();
  const r6 = await rpc(command({ expected_revision: 1, kind: "correction", reason: "test", marks: marksFor([...roster, stranger]) }));
  check("a save naming a child not on that day's roll is refused", r6.ok === false && r6.reason === "roster_changed" && r6.extra?.includes(stranger));

  // 7. The roll is the roll on that date.
  const { data: enrolment } = await db
    .from("enrolments")
    .select("id, enrolled_on")
    .eq("student_id", third)
    .eq("session_label", SESSION)
    .single();
  movedEnrolment = enrolment;
  await db.from("enrolments").update({ enrolled_on: shift(DAY, 1) }).eq("id", enrolment.id);
  const dated = await rosterOf(DAY);
  const r7 = await rpc(command({ expected_revision: 1, kind: "correction", reason: "test", marks: marksFor(roster) }));
  await db.from("enrolments").update({ enrolled_on: enrolment.enrolled_on }).eq("id", enrolment.id);
  movedEnrolment = null;
  check(
    "a child admitted after the date is not on that date's roll, and a save including them is refused",
    !dated.includes(third) && r7.ok === false && r7.reason === "roster_changed" && r7.extra?.includes(third),
  );

  // 8. A correction says why, and changes something.
  const r8 = await rpc(command({ kind: "correction", expected_revision: 1, reason: "  ", marks: marksFor(roster) }));
  check("a correction with no reason is refused", r8.ok === false && r8.reason === "reason_required");
  const r9 = await rpc(
    command({ kind: "correction", expected_revision: 1, reason: "no change", marks: marksFor(roster, { [absent]: "absent", [halfDay]: "half_day" }) }),
  );
  check("a correction that changes nothing is refused", r9.ok === false && r9.reason === "no_change");

  // 9. The class teacher corrects; both revisions are kept.
  const r10 = await rpc(
    command({ kind: "correction", expected_revision: 1, reason: "Arrived after assembly", marks: marksFor(roster, { [halfDay]: "half_day" }) }),
  );
  const s10 = await registerState();
  const change = s10.revisions.at(-1)?.changes?.[0];
  check(
    "the class teacher's correction is revision 2, with its reason and its before-and-after; revision 1 is kept",
    r10.ok === true &&
      r10.revision === 2 &&
      r10.changes === 1 &&
      s10.revisions.length === 2 &&
      s10.revisions[0].kind === "save" &&
      s10.revisions[1].reason === "Arrived after assembly" &&
      change?.student_id === absent && change?.from === "absent" && change?.to === "present",
  );

  // 10. A subject teacher may neither take nor change the register.
  const r11 = await rpc(command({ actor_staff_id: subjectTeacher.id, day: OFFICE_DAY }));
  const r12 = await rpc(command({ actor_staff_id: subjectTeacher.id, kind: "correction", expected_revision: 2, reason: "x", marks: marksFor(roster) }));
  check(
    "a subject teacher can neither save nor correct the class's register",
    r11.ok === false && r11.reason === "not_permitted" && r12.ok === false && r12.reason === "not_permitted",
  );

  // 11. The office records on the class teacher's behalf, and says so.
  const officeRoster = await rosterOf(OFFICE_DAY);
  const r13 = await rpc(command({ actor_staff_id: office.id, day: OFFICE_DAY, marks: marksFor(officeRoster) }));
  const s13 = await registerState(OFFICE_DAY);
  check(
    "the office's save is recorded as on the class teacher's behalf",
    r13.ok === true && s13.register.taken_by === office.id && s13.register.on_behalf_of === owner.id && r13.on_behalf_of === owner.id,
  );

  // 12. Not a day that has not happened; not a Sunday.
  let sunday = shift(today, -1);
  while (new Date(`${sunday}T00:00:00Z`).getUTCDay() !== 0 || kindOf.has(sunday)) sunday = shift(sunday, -1);
  const r14 = await rpc(command({ day: shift(today, 2), marks: marksFor(await rosterOf(shift(today, 2))) }));
  const r15 = await rpc(command({ day: sunday, marks: marksFor(await rosterOf(sunday)) }));
  check(
    "a day that has not happened, and a day the school was shut, are refused",
    r14.ok === false && r14.reason === "future_day" && r15.ok === false && r15.reason === "school_closed",
  );

  // 13. A fault part-way leaves the register exactly as it was.
  await setFault(true);
  for (const point of ["after_register", "after_marks", "before_receipt"]) {
    const before = await registerState();
    const r = await rpc(
      command({ kind: "correction", expected_revision: 2, reason: "fault", marks: marksFor(roster, { [third]: "leave" }), fault: point }),
    );
    const after = await registerState();
    check(
      `an injected fault ${point.replace("_", " ")} leaves the register as it was`,
      r.ok === false &&
        /injected_fault/.test(r.message ?? "") &&
        after.register.revision === before.register.revision &&
        after.revisions.length === before.revisions.length &&
        JSON.stringify(after.marks.map((m) => [m.student_id, m.status]).sort()) ===
          JSON.stringify(before.marks.map((m) => [m.student_id, m.status]).sort()),
    );
  }
  await setFault(false);

  // 14. A request approved is a correction, and both happen or neither does.
  const { data: request } = await db
    .from("attendance_corrections")
    .insert({
      register_id: s10.register.id,
      student_id: third,
      from_status: "present",
      to_status: "late",
      reason: "Came in at 9:20",
      requested_by: subjectTeacher.id,
    })
    .select("id")
    .single();
  const own = await rpc(
    command({ actor_staff_id: subjectTeacher.id, kind: "correction", expected_revision: 2, reason: "Came in at 9:20", correction_request_id: request.id, marks: marksFor(roster, { [halfDay]: "half_day", [third]: "late" }) }),
  );
  const approved = await rpc(
    command({ actor_staff_id: office.id, kind: "correction", expected_revision: 2, reason: "Came in at 9:20", correction_request_id: request.id, marks: marksFor(roster, { [halfDay]: "half_day", [third]: "late" }) }),
  );
  const { data: decided } = await db.from("attendance_corrections").select("status, decided_by").eq("id", request.id).single();
  const again = await rpc(
    command({ actor_staff_id: office.id, kind: "correction", expected_revision: 3, reason: "again", correction_request_id: request.id, marks: marksFor(roster, { [third]: "late" }) }),
  );
  const s14 = await registerState();
  check(
    "approving a request writes the correction and closes the request together; a decided request cannot be applied twice",
    own.ok === false &&
      approved.ok === true &&
      approved.revision === 3 &&
      decided.status === "approved" &&
      decided.decided_by === office.id &&
      again.ok === false &&
      /request_not_pending/.test(again.message ?? "") &&
      s14.register.revision === 3,
  );

  // 15. Two saves of the same new register at once: exactly one lands.
  const raceRoster = await rosterOf(RACE_DAY);
  const [ra, rb] = await Promise.all([
    rpc(command({ day: RACE_DAY, marks: marksFor(raceRoster) })),
    rpc(command({ actor_staff_id: office.id, day: RACE_DAY, marks: marksFor(raceRoster, { [raceRoster[0]]: "absent" }) })),
  ]);
  const sRace = await registerState(RACE_DAY);
  check(
    "two simultaneous first saves: one is recorded, the other is told it is stale",
    [ra, rb].filter((r) => r.ok === true).length === 1 &&
      [ra, rb].filter((r) => r.reason === "stale").length === 1 &&
      sRace.register.revision === 1 &&
      sRace.revisions.length === 1,
  );

  // 15b. A register the previous build submitted — status 'submitted',
  // revision 0, no history — is kept as revision 1 the moment anybody saves,
  // and that save is told it is stale rather than writing over it.
  await db.from("attendance_register_revisions").delete().eq("register_id", sRace.register.id);
  await db.from("attendance_registers").update({ revision: 0, totals: null }).eq("id", sRace.register.id);
  const healed = await rpc(command({ day: RACE_DAY, marks: marksFor(raceRoster) }));
  const sHealed = await registerState(RACE_DAY);
  check(
    "a register submitted by the old build is imported as revision 1, and a new save against it is stale",
    healed.ok === false &&
      healed.reason === "stale" &&
      healed.latest?.kind === "imported" &&
      sHealed.register.revision === 1 &&
      sHealed.revisions.length === 1 &&
      sHealed.revisions[0].kind === "imported",
  );

  // 16. A reminder for a register saved meanwhile is suppressed, not sent; so
  // is one to somebody no longer responsible for the class.
  const notAfter = new Date(Date.now() + 3600_000).toISOString();
  const reminder = (staff, day, key) => ({
    notice_key: `verify:${key}:${randomUUID()}`,
    kind: "attendance_reminder",
    class_id: CLASS,
    class_label: "QA",
    staff_profile_id: staff,
    session_label: SESSION,
    day,
    not_after: notAfter,
    command_id: randomUUID(),
  });
  const inserted = await db.from("staff_notices").insert(reminder(owner.id, DAY, "saved")).select("id").single();
  const insertedToo = await db.from("staff_notices").insert(reminder(subjectTeacher.id, shift(today, 30), "stranger")).select("id").single();
  if (inserted.error || insertedToo.error) throw new Error(`Could not queue a reminder: ${(inserted.error ?? insertedToo.error).message}`);
  const saved = inserted.data;
  const wrongPerson = insertedToo.data;
  const claims = [
    await db.rpc("claim_staff_notice", { p_worker: "verify", p_lease_seconds: 30, p_transport: "mock", p_notice_id: saved.id }),
    await db.rpc("claim_staff_notice", { p_worker: "verify", p_lease_seconds: 30, p_transport: "mock", p_notice_id: wrongPerson.id }),
  ];
  const { data: outcomes } = await db.from("staff_notices").select("id, status, status_reason").in("id", [saved.id, wrongPerson.id]);
  const byId = new Map((outcomes ?? []).map((row) => [row.id, row]));
  check(
    "a reminder is suppressed once the register is saved, and never goes to someone not responsible",
    byId.get(saved.id)?.status === "suppressed" &&
      byId.get(saved.id)?.status_reason === "already_saved" &&
      byId.get(wrongPerson.id)?.status === "suppressed" &&
      byId.get(wrongPerson.id)?.status_reason === "not_responsible",
    (outcomes ?? []).map((row) => row.status_reason).join(", "),
  );
  void claims;

  // 17. Half a day is the school's half.
  const { data: credit } = await db.rpc("half_day_credit", { p_session: SESSION });
  check("a half day counts as the school's credit, 0.5 unless it says otherwise", Number(credit) >= 0 && Number(credit) <= 1, `credit ${credit}`);
} finally {
  await setFault(false);
  if (movedEnrolment) {
    await db.from("enrolments").update({ enrolled_on: movedEnrolment.enrolled_on }).eq("id", movedEnrolment.id);
  }
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n  PASS — ${results.length} of ${results.length}.\n` : `\n  FAIL — ${failed.length} of ${results.length}.\n`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P6-attendance-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), target: "schoolfees-dev", days, results }, null, 2));
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length === 0 ? 0 : 1);
