/**
 * P7, against the database: marks are drafted, submitted and corrected by one
 * command per paper; blank, zero, absent and exempt stay four things; the
 * paper's scheme decides what a mark can be; and only the subject teacher or
 * the exam office enters one.
 *
 *   npm run verify:marks            # exit 1 on any broken promise
 *   npm run verify:marks -- --json  # and write docs/evidence/P7-marks-<date>.json
 *
 * Drives `vppsone.save_marks` directly, the way the server action does, as
 * real QA accounts, on a synthetic exam it creates for the QA teacher's class
 * and deletes at the end (its papers, marks, log and commands go with it). The
 * one enrolment date it moves to test the exam's roll is put back.
 *
 * Rule 3: dev only. Rule 6: children and staff are referred to by id.
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
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-marks", mode: "dev-only" });

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
  const { data, error } = await db.rpc("save_marks", { p: payload });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};

/* ------------------------------------------------------------- the scene */

const { data: setting } = await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const SESSION = setting?.value;
if (!SESSION) throw new Error("app_settings.active_session_label is not set.");

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id, role").eq("user_id", user.id).single();
  return data;
};

const teacher = await profileOf("qa.teacher@qa.vpps.local");
const otherTeacher = await profileOf("qa.teacher2@qa.vpps.local");
const office = await profileOf("qa.exam@qa.vpps.local");

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const { data: held } = await db
  .from("class_teachers")
  .select("class_id, effective_from, effective_to")
  .eq("staff_profile_id", teacher.id)
  .eq("session_label", SESSION);
const own = (held ?? []).find(
  (row) => (!row.effective_from || row.effective_from <= today) && (!row.effective_to || row.effective_to >= today),
);
if (!own) throw new Error("The QA teacher holds no class — run npm run qa:seed");
const CLASS = own.class_id;

const { data: taught } = await db
  .from("teaching_assignments")
  .select("subject_id")
  .eq("session_label", SESSION)
  .eq("staff_profile_id", teacher.id)
  .eq("class_id", CLASS);
const mine = new Set((taught ?? []).map((row) => row.subject_id));
const { data: subjects } = await db.from("subjects").select("id, code").eq("is_active", true);
const assignedSubject = (subjects ?? []).find((row) => mine.has(row.id));
const otherSubject = (subjects ?? []).find((row) => !mine.has(row.id));
const thirdSubject = (subjects ?? []).find((row) => !mine.has(row.id) && row.id !== otherSubject?.id);
if (!assignedSubject || !otherSubject || !thirdSubject) {
  throw new Error("Need one subject the QA teacher teaches in her class and two she does not.");
}

const EXAM = randomUUID();
const PAPER = randomUUID(); // the teacher's subject, halves, exemption allowed
const NOT_HERS = randomUUID(); // a subject she does not teach in her own class
const STRICT = randomUUID(); // whole marks, no exemption

async function setup() {
  const { error: examError } = await db.from("assessments").insert({
    id: EXAM, session_label: SESSION, term: "QA", code: `QA-P7-${EXAM.slice(0, 8)}`,
    label_hi: "QA", label_en: "QA", status: "open",
  });
  if (examError) throw new Error(examError.message);
  const { error } = await db.from("assessment_subjects").insert([
    { id: PAPER, assessment_id: EXAM, class_id: CLASS, class_label: "QA", subject_id: assignedSubject.id, subject_code: assignedSubject.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
    { id: NOT_HERS, assessment_id: EXAM, class_id: CLASS, class_label: "QA", subject_id: otherSubject.id, subject_code: otherSubject.code, max_marks: 40, mark_step: 0.5, allow_exempt: true },
    { id: STRICT, assessment_id: EXAM, class_id: CLASS, class_label: "QA", subject_id: thirdSubject.id, subject_code: thirdSubject.code, max_marks: 20, mark_step: 1, allow_exempt: false },
  ]);
  if (error) throw new Error(error.message);
}

async function cleanup() {
  await db.from("assessments").delete().eq("id", EXAM);
  // And any exam an earlier, interrupted run left behind.
  await db.from("assessments").delete().like("code", "QA-P7-%");
}

const rosterOf = async (paper) => {
  const { data, error } = await db.rpc("paper_roster", { p_paper: paper });
  if (error) throw new Error(error.message);
  return [...data].sort();
};

const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const command = (overrides = {}) => {
  const base = {
    command_id: randomUUID(),
    actor_staff_id: teacher.id,
    paper_id: PAPER,
    kind: "draft",
    expected_revision: 0,
    reason: null,
    entries: [],
  };
  const merged = { ...base, ...overrides };
  merged.payload_hash ??= hashOf([merged.kind, merged.expected_revision, merged.reason, merged.entries]);
  return merged;
};
const entry = (student, state, value = null) => ({ student_id: student, state, value });

async function paperState(paper = PAPER) {
  const [{ data: row }, { data: marks }, { data: log }] = await Promise.all([
    db.from("assessment_subjects").select("entry_status, entry_revision, submitted_by").eq("id", paper).single(),
    db.from("marks").select("student_id, value, absent, exempt").eq("assessment_subject_id", paper),
    db.from("marks_change_log").select("id, reason").eq("assessment_subject_id", paper),
  ]);
  return { paper: row, marks: marks ?? [], log: log ?? [] };
}
const cellOf = (state, student) => state.marks.find((row) => row.student_id === student);

const setFault = (enabled) => db.from("runtime_flags").update({ enabled }).eq("key", "fault_injection");

/* ------------------------------------------------------------- the tests */

await cleanup();
await setup();
const roster = await rosterOf(PAPER);
console.log(`\n  save_marks on a synthetic exam for the QA class, session ${SESSION}, ${roster.length} on the roll\n`);
if (roster.length < 5) throw new Error("The QA class needs at least five children.");
const [a, b, c, d, e] = roster;
let moved = null;

try {
  // 1. A draft keeps a zero, an absence and an exemption, and leaves the rest blank.
  const first = command({ entries: [entry(a, "value", 0), entry(b, "absent"), entry(c, "exempt"), entry(d, "blank")] });
  const r1 = await rpc(first);
  const s1 = await paperState();
  check(
    "a draft records a zero, an absence and an exemption as three different things, and writes nothing for a blank",
    r1.ok === true && r1.revision === 1 && r1.entry_status === "open" && s1.marks.length === 3 &&
      Number(cellOf(s1, a)?.value) === 0 && cellOf(s1, b)?.absent === true && cellOf(s1, c)?.exempt === true &&
      !cellOf(s1, d) && r1.counts?.blank === roster.length - 3,
    `${r1.counts?.entered} entered · ${r1.counts?.blank} blank`,
  );

  // 2. Replays and reuse.
  const r2 = await rpc(first);
  const s2 = await paperState();
  check("a repeated draft returns its receipt and writes nothing", r2.ok === true && r2.replayed === true && s2.log.length === s1.log.length);
  const r3 = await rpc({ ...first, payload_hash: "different" });
  check("a reused id with a different payload is refused", r3.ok === false && r3.reason === "id_reused");
  const r4 = await rpc(command({ entries: [entry(d, "value", 10)] }));
  check("a save against the old revision is stale", r4.ok === false && r4.reason === "stale" && r4.current_revision === 1);

  // 3. The scheme, all or nothing.
  const r5 = await rpc(command({ expected_revision: 1, entries: [entry(d, "value", 12), entry(e, "value", 41)] }));
  const s5 = await paperState();
  check(
    "a mark above the maximum refuses the whole column — the valid cell beside it is not written either",
    r5.ok === false && /marks:invalid_value/.test(r5.message ?? "") && !cellOf(s5, d) && s5.paper.entry_revision === 1,
  );
  const r6 = await rpc(command({ expected_revision: 1, entries: [entry(d, "value", 12.25)] }));
  check("a quarter on a paper marked in halves is refused", r6.ok === false && /marks:invalid_value/.test(r6.message ?? ""));
  const r7 = await rpc(command({ expected_revision: 1, entries: [entry(randomUUID(), "value", 5)] }));
  check("a child not on the exam's roll is refused", r7.ok === false && /marks:not_on_roll/.test(r7.message ?? ""));

  // 4. Submitting needs everybody; a blank is never a zero.
  const r8 = await rpc(command({ kind: "submit", expected_revision: 1, entries: [entry(d, "value", 12)] }));
  const s8 = await paperState();
  check(
    "submitting with children still blank is refused, naming them, and the cells sent with it are not written",
    r8.ok === false && /marks:incomplete/.test(r8.message ?? "") && !cellOf(s8, d) && s8.paper.entry_status === "open",
    `${(r8.message ?? "").split(",").length} still blank`,
  );
  const r9 = await rpc(command({ expected_revision: 1, entries: [entry(a, "value", 0)] }));
  check("a draft that changes nothing is refused as no change", r9.ok === false && /marks:no_change/.test(r9.message ?? ""));

  const full = roster.map((student, index) =>
    student === a ? entry(a, "value", 0) : student === b ? entry(b, "absent") : student === c ? entry(c, "exempt") : entry(student, "value", (index % 40) + 0.5),
  );
  const r10 = await rpc(command({ kind: "submit", expected_revision: 1, entries: full }));
  const s10 = await paperState();
  check(
    "submitting a complete column marks the paper submitted, by whom, with a receipt",
    r10.ok === true && r10.entry_status === "submitted" && r10.revision === 2 && r10.counts?.blank === 0 &&
      s10.paper.entry_status === "submitted" && s10.paper.submitted_by === teacher.id,
  );

  // 5. After submitting: corrections only, with a reason, never back to blank.
  const r11 = await rpc(command({ expected_revision: 2, entries: [entry(d, "value", 3)] }));
  check("a draft on a submitted paper is refused", r11.ok === false && r11.reason === "already_submitted");
  const r12 = await rpc(command({ kind: "correction", expected_revision: 2, entries: [entry(d, "value", 3)] }));
  check("a correction without a reason is refused", r12.ok === false && r12.reason === "reason_required");
  const r13 = await rpc(command({ kind: "correction", expected_revision: 2, reason: "x", entries: [entry(d, "blank")] }));
  check("a correction cannot blank a submitted cell", r13.ok === false && /marks:cannot_blank/.test(r13.message ?? ""));
  const r14 = await rpc(command({ kind: "correction", expected_revision: 2, reason: "Re-totalled the paper", entries: [entry(d, "value", 3)] }));
  const s14 = await paperState();
  check(
    "a correction with a reason changes the cell, logs the reason, and the paper stays submitted",
    r14.ok === true && r14.changed === 1 && s14.paper.entry_status === "submitted" &&
      Number(cellOf(s14, d)?.value) === 3 && s14.log.some((row) => row.reason === "Re-totalled the paper"),
  );

  // 6. Who: the subject teacher, the exam office; not the class teacher for every subject.
  const r15 = await rpc(command({ paper_id: NOT_HERS, entries: [entry(a, "value", 5)] }));
  const r16 = await rpc(command({ actor_staff_id: otherTeacher.id, kind: "correction", expected_revision: 3, reason: "x", entries: [entry(d, "value", 4)] }));
  check(
    "the class teacher cannot enter a subject she does not teach, nor another teacher hers",
    r15.ok === false && r15.reason === "not_permitted" && r16.ok === false && r16.reason === "not_permitted",
  );
  const r17 = await rpc(command({ actor_staff_id: office.id, paper_id: NOT_HERS, entries: [entry(a, "value", 5)] }));
  check("the exam office may enter any paper", r17.ok === true && r17.revision === 1);
  const r18 = await rpc(command({ kind: "reopen", expected_revision: 3 }));
  const r19 = await rpc(command({ actor_staff_id: office.id, kind: "reopen", expected_revision: 3 }));
  const s19 = await paperState();
  check(
    "only the exam office hands a submitted paper back",
    r18.ok === false && r18.reason === "not_permitted" && r19.ok === true && s19.paper.entry_status === "open" && s19.paper.entry_revision === 4,
  );

  // 7. A paper that allows no exemption, marked in wholes.
  const r20 = await rpc(command({ actor_staff_id: office.id, paper_id: STRICT, entries: [entry(e, "exempt")] }));
  const r21 = await rpc(command({ actor_staff_id: office.id, paper_id: STRICT, entries: [entry(e, "value", 7.5)] }));
  check(
    "a paper that allows no exemption refuses one, and a paper in whole marks refuses a half",
    r20.ok === false && /marks:exempt_not_allowed/.test(r20.message ?? "") && r21.ok === false && /marks:invalid_value/.test(r21.message ?? ""),
  );

  // 8. Faults leave the column as it was.
  await setFault(true);
  for (const point of ["after_marks", "before_receipt"]) {
    const before = await paperState();
    const r = await rpc(command({ expected_revision: 4, entries: [entry(e, "value", 9)], fault: point }));
    const after = await paperState();
    check(
      `an injected fault ${point.replace("_", " ")} leaves the column as it was`,
      r.ok === false && /injected_fault/.test(r.message ?? "") && after.paper.entry_revision === before.paper.entry_revision &&
        after.log.length === before.log.length && Number(cellOf(after, e)?.value) === Number(cellOf(before, e)?.value),
    );
  }
  await setFault(false);

  // 9. Two people at once on the same revision: one lands, one is stale.
  const [ra, rb] = await Promise.all([
    rpc(command({ expected_revision: 4, entries: [entry(e, "value", 11)] })),
    rpc(command({ actor_staff_id: office.id, expected_revision: 4, entries: [entry(e, "value", 12)] })),
  ]);
  check(
    "two saves of one paper at once: one lands, the other is told it is stale",
    [ra, rb].filter((r) => r.ok === true).length === 1 && [ra, rb].filter((r) => r.reason === "stale").length === 1,
  );

  // 10. The exam's roll: a child who joined after it ended is not asked for a mark.
  await db.from("assessments").update({ status: "open", starts_on: "2026-09-01", ends_on: "2026-09-05" }).eq("id", EXAM);
  const { data: enrolment } = await db.from("enrolments").select("id, enrolled_on").eq("student_id", e).eq("session_label", SESSION).single();
  moved = enrolment;
  await db.from("enrolments").update({ enrolled_on: "2026-09-10" }).eq("id", enrolment.id);
  const dated = await rosterOf(PAPER);
  await db.from("enrolments").update({ enrolled_on: enrolment.enrolled_on }).eq("id", enrolment.id);
  moved = null;
  check("a child admitted after the exam ended is not on its roll", !dated.includes(e) && dated.includes(a));

  // 11. A locked exam takes no marks.
  await db.from("assessments").update({ status: "locked", locked_at: new Date().toISOString(), locked_by: office.id }).eq("id", EXAM);
  const { data: current } = await db.from("assessment_subjects").select("entry_revision").eq("id", PAPER).single();
  const r22 = await rpc(command({ actor_staff_id: office.id, expected_revision: current.entry_revision, entries: [entry(e, "value", 1)] }));
  check("a locked exam refuses every save", r22.ok === false && r22.reason === "exam_not_open");
} finally {
  await setFault(false);
  if (moved) await db.from("enrolments").update({ enrolled_on: moved.enrolled_on }).eq("id", moved.id);
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n  PASS — ${results.length} of ${results.length}.\n` : `\n  FAIL — ${failed.length} of ${results.length}.\n`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P7-marks-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), target: "schoolfees-dev", results }, null, 2));
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length === 0 ? 0 : 1);
