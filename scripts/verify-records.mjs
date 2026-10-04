/**
 * P10a, against the database: a child's collected values are decided by one
 * command and written by one function, which keeps every write — and the two
 * dangerous cases are refused by name rather than decided by accident.
 *
 *   npm run verify:records            # exit 1 on any broken promise
 *   npm run verify:records -- --json  # and write docs/evidence/P10-records-<date>.json
 *
 * Drives `vppsone.accept_submissions` directly, as real QA accounts, on a
 * synthetic field (`qa_p10_…`) and a synthetic link. Everything it makes is
 * removed at the end — the field's history included, which is the one kind
 * of history the append-only rule lets a script remove.
 *
 * Rule 3: dev only. Rule 6: children are referred to by id; the values are
 * synthetic numbers in the 98000… block.
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

/* ------------------------------------------------------------- the scene */

const { data: setting } = await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const SESSION = setting?.value;
if (!SESSION) throw new Error("app_settings.active_session_label is not set.");

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id").eq("user_id", user.id).single();
  return data.id;
};
const office = await profileOf("qa.accountant@qa.vpps.local");
const teacher = await profileOf("qa.teacher@qa.vpps.local");

const { data: enrolled } = await db
  .from("enrolments")
  .select("student_id, class_id")
  .eq("session_label", SESSION)
  .eq("status", "enrolled")
  .limit(2);
const [A, B] = enrolled.map((row) => row.student_id);
const classId = enrolled[0].class_id;

const FIELD_KEY = `qa_p10_${Date.now()}`;
const { data: field } = await db
  .from("collection_fields")
  .insert({ key: FIELD_KEY, label_hi: "QA P10 नंबर", label_en: "QA P10 number", input_type: "text", is_active: false })
  .select("id")
  .single();
const FIELD = field.id;

const { data: request } = await db
  .from("collection_requests")
  .insert({
    session_label: SESSION,
    title_hi: "QA P10",
    title_en: "QA P10",
    class_id: classId,
    class_label: "QA Class",
    audience_kind: "class",
    audience_label: "QA Class",
    token: `QAP10VERIFY${Date.now()}`,
    status: "open",
    opened_at: new Date().toISOString(),
  })
  .select("id")
  .single();

// A second link, so one child can have two answers waiting (one per link).
const { data: request2 } = await db
  .from("collection_requests")
  .insert({
    session_label: SESSION,
    title_hi: "QA P10 b",
    title_en: "QA P10 b",
    class_id: classId,
    class_label: "QA Class",
    audience_kind: "class",
    audience_label: "QA Class",
    token: `QAP10VERIFYB${Date.now()}`,
    status: "open",
    opened_at: new Date().toISOString(),
  })
  .select("id")
  .single();

async function answer({ student, value, shown, requestId = request.id, at = new Date().toISOString() }) {
  await db.from("collection_submissions").delete().eq("request_id", requestId).eq("student_id", student).eq("field_id", FIELD);
  const { data, error } = await db
    .from("collection_submissions")
    .insert({ request_id: requestId, student_id: student, field_id: FIELD, value, previous_value: shown, status: "pending", submitted_at: at })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const decide = async ({ ids, actor = office, decision = "accept", replace = false, commandId = randomUUID(), fault, note = null }) => {
  const hash = createHash("sha256").update(JSON.stringify({ decision, ids: [...ids].sort(), note: note ?? "", replace })).digest("hex");
  const { data, error } = await db.rpc("accept_submissions", {
    p: { command_id: commandId, actor_staff_id: actor, session_label: SESSION, decision, submission_ids: ids, note, replace_newer: replace, payload_hash: hash, fault },
  });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};
const held = async (student) =>
  (await db.from("student_records").select("value, source, source_ref").eq("student_id", student).eq("field_id", FIELD).maybeSingle()).data;
const historyCount = async () =>
  (await db.from("student_record_history").select("id", { count: "exact", head: true }).eq("field_id", FIELD)).count ?? 0;
const statusOf = async (id) => (await db.from("collection_submissions").select("status").eq("id", id).single()).data.status;

console.log("\nP10a — one writer for collected values, against the database\n");

try {
  /* ---------------------------------------------------- authority */
  const s1 = await answer({ student: A, value: "9800000101", shown: null });
  const refusedTeacher = await decide({ ids: [s1], actor: teacher });
  check("1. a teacher cannot decide answers", refusedTeacher.reason === "not_permitted" && (await statusOf(s1)) === "pending", refusedTeacher.reason);

  /* ------------------------------------------------ accept and replay */
  const command = randomUUID();
  const accepted = await decide({ ids: [s1], commandId: command });
  const record = await held(A);
  check(
    "2. accepting writes the record as the teacher's, naming the answer",
    accepted.ok && accepted.recorded === 1 && record?.value === "9800000101" && record.source === "teacher" && record.source_ref === `submission:${s1}`,
    JSON.stringify({ recorded: accepted.recorded, source: record?.source }),
  );
  check("3. and keeps it in the history", (await historyCount()) === 1);

  const replay = await decide({ ids: [s1], commandId: command });
  check("4. the same command again returns what it did, and does nothing", replay.replayed === true && replay.recorded === 1 && (await historyCount()) === 1);

  const reused = await decide({ ids: [s1], commandId: command, decision: "reject" });
  check("5. the same id for a different decision is refused", reused.reason === "id_reused", reused.reason);

  const again = await decide({ ids: [s1] });
  check("6. deciding an answer somebody already decided changes nothing", again.ok && again.already_decided === 1 && again.decided === 0 && (await historyCount()) === 1);

  /* ---------------------------------------------- a newer answer waits */
  const older = await answer({ student: B, value: "9800000201", shown: null, at: "2026-04-01T10:00:00Z" });
  const newer = await answer({ student: B, value: "9800000202", shown: null, requestId: request2.id, at: "2026-06-01T10:00:00Z" });
  const supersededTry = await decide({ ids: [older] });
  check(
    "7. an older answer with a newer one waiting is refused, and stays pending",
    supersededTry.ok && supersededTry.refused?.[0]?.reason === "superseded" && (await statusOf(older)) === "pending" && (await held(B)) === null,
    JSON.stringify(supersededTry.refused),
  );
  const newerTaken = await decide({ ids: [newer] });
  check("8. the newer one is accepted", newerTaken.recorded === 1 && (await held(B))?.value === "9800000202");

  /* ------------------------------------------- the record moved under it */
  // `older` was shown nothing; the record now holds the newer answer.
  const moved = await decide({ ids: [older] });
  check(
    "9. an answer about a value that has since moved is refused by name",
    moved.refused?.[0]?.reason === "record_moved" && (await held(B))?.value === "9800000202",
    JSON.stringify(moved.refused),
  );
  const replaced = await decide({ ids: [older], replace: true });
  const history = (await db.from("student_record_history").select("old_value, new_value, outcome").eq("field_id", FIELD).eq("student_id", B).order("id")).data;
  check(
    "10. replaced only when a person says so, and the history keeps the value it replaced",
    replaced.recorded === 1 && (await held(B))?.value === "9800000201" && history.at(-1)?.old_value === "9800000202",
    JSON.stringify(history.at(-1)),
  );

  /* -------------------------------------------- blank and the same value */
  const blank = await answer({ student: A, value: "  ", shown: "9800000101" });
  const blankDecision = await decide({ ids: [blank] });
  const before = await historyCount();
  check("11. a blank answer is a confirmation and writes nothing", blankDecision.confirmed === 1 && blankDecision.recorded === 0 && (await held(A))?.value === "9800000101");
  const same = await answer({ student: A, value: "9800000101", shown: "9800000101" });
  const sameDecision = await decide({ ids: [same] });
  check("12. the value already held is confirmed, not rewritten", sameDecision.confirmed === 1 && (await historyCount()) === before);

  /* ---------------------------------------------------------- reject */
  const rejectable = await answer({ student: A, value: "9800000109", shown: "9800000101" });
  const rejected = await decide({ ids: [rejectable], decision: "reject", note: "Not this number" });
  check("13. a rejection writes nothing", rejected.decided === 1 && (await statusOf(rejectable)) === "rejected" && (await held(A))?.value === "9800000101");

  /* ----------------------------------------------------- many at once */
  const bulk = await answer({ student: A, value: "9800000111", shown: "9800000101" });
  const ids = [bulk, ...Array.from({ length: 399 }, () => randomUUID())];
  const many = await decide({ ids });
  check("14. four hundred ids are one call (they travel in the body, not the URL)", many.ok && many.recorded === 1, `decided ${many.decided}`);

  /* ------------------------------------------------------- concurrency */
  const raced = await answer({ student: A, value: "9800000121", shown: "9800000111" });
  const beforeRace = await historyCount();
  const [first, second] = await Promise.all([decide({ ids: [raced] }), decide({ ids: [raced] })]);
  const winners = [first, second].filter((receipt) => receipt.decided === 1).length;
  const losers = [first, second].filter((receipt) => receipt.already_decided === 1).length;
  check(
    "15. two people deciding at once: one decides, the other is told, one write",
    winners === 1 && losers === 1 && (await historyCount()) === beforeRace + 1,
    `${winners} decided, ${losers} told`,
  );

  /* ------------------------------------------------------- atomicity */
  await db.from("runtime_flags").update({ enabled: true }).eq("key", "fault_injection");
  try {
    const f1 = await answer({ student: A, value: "9800000131", shown: "9800000121" });
    const f2 = await answer({ student: B, value: "9800000231", shown: "9800000201", requestId: request2.id });
    const beforeFault = await historyCount();
    const faulted = await decide({ ids: [f1, f2], fault: "after_first_write" });
    check(
      "16. a failure after the first write leaves nothing written and nothing decided",
      faulted.reason === "raised" && (await statusOf(f1)) === "pending" && (await statusOf(f2)) === "pending" &&
        (await held(A))?.value === "9800000121" && (await historyCount()) === beforeFault,
      faulted.message?.slice(0, 60),
    );
  } finally {
    await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  }

  /* ---------------------------------------------------- append-only */
  const { data: realRow } = await db.from("student_record_history").select("id").neq("field_id", FIELD).limit(1).maybeSingle();
  if (realRow) {
    const edit = await db.from("student_record_history").update({ new_value: "x" }).eq("id", realRow.id);
    const remove = await db.from("student_record_history").delete().eq("id", realRow.id);
    check("17. a history row cannot be edited or deleted", Boolean(edit.error) && Boolean(remove.error), `${edit.error?.code}/${remove.error?.code}`);
  } else {
    check("17. a history row cannot be edited or deleted", false, "no non-QA history row to try");
  }
  const qaEdit = await db.from("student_record_history").update({ new_value: "x" }).eq("field_id", FIELD);
  check("18. not even a synthetic one can be edited", Boolean(qaEdit.error), qaEdit.error?.code);
} finally {
  await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  await db.from("student_record_history").delete().eq("field_id", FIELD);
  await db.from("student_records").delete().eq("field_id", FIELD);
  await db.from("collection_requests").delete().in("id", [request.id, request2.id]);
  await db.from("collection_fields").delete().eq("id", FIELD);
}

const { count: leftover } = await db.from("student_record_history").select("id", { count: "exact", head: true }).eq("field_id", FIELD);
check("19. the synthetic field leaves nothing behind", leftover === 0);

/* ---------------------------------------------------------- the verdict */

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P10-records-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
