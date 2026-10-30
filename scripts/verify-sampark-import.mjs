/**
 * P10b, against the database: SamPark's rows are applied through the one
 * writer, precedence keeps what a person recorded, a mapping that disagrees
 * goes back to a person, and the queue is decided only by somebody saying so.
 *
 *   npm run verify:sampark-import            # exit 1 on any broken promise
 *   npm run verify:sampark-import -- --json  # and write docs/evidence/P10-sampark-import-<date>.json
 *
 * Stages synthetic batches directly (the staging step is the app's; this
 * proves the commands), on a synthetic `qa_` field that is active only while
 * the script runs, with SamPark ids `QA-SP-…`. Everything is removed at the end.
 *
 * Rule 3: dev only. Rule 6: children by id, synthetic values.
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
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-sampark-import", mode: "dev-only" });

const options = { db: { schema: "vppsone" }, auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------- the scene */

const { data: setting } = await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const SESSION = setting?.value;
if (!SESSION) throw new Error("app_settings.active_session_label is not set.");
const ENVIRONMENT = "dev";

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id").eq("user_id", user.id).single();
  return data.id;
};
const office = await profileOf("qa.accountant@qa.vpps.local");
const teacher = await profileOf("qa.teacher@qa.vpps.local");

const { data: enrolled } = await db.from("enrolments").select("student_id").eq("session_label", SESSION).eq("status", "enrolled").limit(5);
const [A, B, C, D, E] = enrolled.map((row) => row.student_id);

const STAMP = Date.now();
const SP = (n) => `QA-SP-${STAMP}-${n}`;
const FIELD_KEY = `qa_p10b_${STAMP}`;
const { data: field } = await db
  .from("collection_fields")
  .insert({ key: FIELD_KEY, label_hi: "QA सम्पर्क मान", label_en: "QA SamPark value", input_type: "text", is_active: true })
  .select("id")
  .single();
const FIELD = field.id;

const batches = [];
async function stage(rows) {
  const { data: batch } = await db
    .from("sampark_import_batches")
    .insert({
      file_name: `qa-${STAMP}-${batches.length}.xlsx`,
      file_sha256: createHash("sha256").update(`${STAMP}-${batches.length}`).digest("hex"),
      source_environment: ENVIRONMENT,
      session_label: SESSION,
      row_count: rows.length,
      mapped_fields: [FIELD_KEY],
      uploaded_by: office,
    })
    .select("id")
    .single();
  batches.push(batch.id);
  const { error } = await db.from("sampark_import_rows").insert(
    rows.map((row, index) => ({
      batch_id: batch.id,
      row_no: index + 2,
      external_id: row.externalId ?? null,
      presented: { name: "QA Child", sr: null },
      field_values: row.value === undefined ? {} : { [FIELD_KEY]: row.value },
      resolution: row.studentId ? "matched" : row.resolution ?? "unmatched",
      matched_on: row.studentId ? "sr" : null,
      student_id: row.studentId ?? null,
      candidates: row.candidates ?? [],
      why: row.why ?? null,
    })),
  );
  if (error) throw new Error(error.message);
  return batch.id;
}

const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const apply = async ({ batch, actor = office, commandId = randomUUID(), fault }) => {
  const { data, error } = await db.rpc("apply_sampark_import", {
    p: { command_id: commandId, actor_staff_id: actor, batch_id: batch, payload_hash: hashOf({ batch }), fault },
  });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};
const resolve = async ({ batch, row, student = null, dismiss = false, note = null, actor = office }) => {
  const { data, error } = await db.rpc("resolve_sampark_row", {
    p: {
      command_id: randomUUID(),
      actor_staff_id: actor,
      batch_id: batch,
      row_no: row,
      student_id: student,
      dismiss,
      note,
      payload_hash: hashOf({ batch, row, student, dismiss, note: note ?? "" }),
    },
  });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};
const held = async (student) =>
  (await db.from("student_records").select("value, source, source_detail").eq("student_id", student).eq("field_id", FIELD).maybeSingle()).data;
const mappingOf = async (externalId) =>
  (await db.from("external_student_ids").select("student_id, matched_on").eq("app_id", "sampark").eq("external_id", externalId).maybeSingle()).data;
const rowOf = async (batch, row) =>
  (await db.from("sampark_import_rows").select("resolution, why, applied_at, candidates, student_id").eq("batch_id", batch).eq("row_no", row).single()).data;

console.log("\nP10b — SamPark rows through the one writer, against the database\n");

try {
  // A person already recorded B's value; a different import recorded C's.
  await db.from("student_records").insert([
    { session_label: SESSION, student_id: B, field_id: FIELD, value: "teacher-value", source: "teacher" },
    { session_label: SESSION, student_id: C, field_id: FIELD, value: "psp-value", source: "import", source_detail: "psp" },
  ]);

  const first = await stage([
    { externalId: SP(1), studentId: A, value: "sampark-a-1" },
    { externalId: SP(2), studentId: B, value: "sampark-b" },
    { externalId: SP(3), studentId: C, value: "sampark-c" },
    { externalId: SP(4), value: "sampark-d" },
    { externalId: SP(5), value: "sampark-e" },
  ]);

  /* ---------------------------------------------------------- authority */
  const refused = await apply({ batch: first, actor: teacher });
  check("1. a teacher cannot apply an import", refused.reason === "not_permitted" && (await held(A)) === null, refused.reason);

  /* ---------------------------------------------------------- applying */
  const command = randomUUID();
  const receipt = await apply({ batch: first, commandId: command });
  check(
    "2. the matched rows are applied and nothing else",
    receipt.ok && receipt.rows_applied === 3 && (await rowOf(first, 5)).applied_at === null,
    JSON.stringify({ rows: receipt.rows_applied, written: receipt.written }),
  );
  check(
    "3. a value nobody held is recorded as an import from SamPark",
    JSON.stringify(await held(A)) === JSON.stringify({ value: "sampark-a-1", source: "import", source_detail: "sampark" }),
  );
  check("4. and the row's SamPark id now points at that child (SamPark's links resolve)", (await mappingOf(SP(1)))?.student_id === A);
  check(
    "5. a value a person recorded is kept, and the refusal is in the history",
    (await held(B))?.value === "teacher-value" && receipt.kept_person === 1 &&
      Boolean((await db.from("student_record_history").select("reason").eq("field_id", FIELD).eq("student_id", B).eq("outcome", "blocked").maybeSingle()).data),
  );
  check("6. a value a different import recorded is kept", (await held(C))?.value === "psp-value" && receipt.kept_other_import === 1);

  const replay = await apply({ batch: first, commandId: command });
  check("7. the same command again returns what it did", replay.replayed === true && replay.rows_applied === 3);
  const again = await apply({ batch: first });
  check("8. applying the batch again finds nothing left to apply", again.ok && again.rows_applied === 0);

  /* ------------------------------------- the same import corrects itself */
  const second = await stage([{ externalId: SP(1), studentId: A, value: "sampark-a-2" }]);
  const corrected = await apply({ batch: second });
  check("9. a newer SamPark file corrects what SamPark wrote", corrected.written === 1 && (await held(A))?.value === "sampark-a-2");

  /* ------------------------------------------------ mapping that disagrees */
  const third = await stage([{ externalId: SP(1), studentId: D, value: "sampark-x" }]);
  const conflict = await apply({ batch: third });
  const sentBack = await rowOf(third, 2);
  check(
    "10. a row whose SamPark id is already another child's goes back to a person, naming both",
    conflict.sent_back_to_queue === 1 && sentBack.resolution === "ambiguous" && sentBack.why === "ids_disagree" &&
      sentBack.candidates.includes(A) && sentBack.candidates.includes(D) && (await held(D)) === null,
    JSON.stringify(sentBack),
  );

  /* -------------------------------------------------------------- queue */
  const chosen = await resolve({ batch: first, row: 5, student: D, note: "Checked with the class teacher" });
  check(
    "11. a person chooses the child for an unmatched row, and it is applied by hand",
    chosen.ok && chosen.applied === true && (await held(D))?.value === "sampark-d" && (await mappingOf(SP(4)))?.matched_on === "hand",
    JSON.stringify(chosen),
  );
  const noReason = await resolve({ batch: first, row: 6, dismiss: true });
  check("12. setting a row aside needs a reason", noReason.reason === "reason_required" && (await rowOf(first, 6)).resolution === "unmatched");
  const dismissed = await resolve({ batch: first, row: 6, dismiss: true, note: "Left before this session" });
  check("13. with a reason it is set aside, and writes nothing", dismissed.ok && (await rowOf(first, 6)).resolution === "dismissed" && (await mappingOf(SP(5))) === null);
  const twice = await resolve({ batch: first, row: 6, student: E });
  check("14. a decided row is not decided again", twice.reason === "already_decided");
  const teacherTry = await resolve({ batch: third, row: 2, student: A, actor: teacher });
  check("15. a teacher cannot decide the queue", teacherTry.reason === "not_permitted");

  /* --------------------------------------------------------- atomicity */
  await db.from("runtime_flags").update({ enabled: true }).eq("key", "fault_injection");
  try {
    const fourth = await stage([
      { externalId: SP(6), studentId: E, value: "sampark-e-1" },
      { externalId: SP(7), studentId: B, value: "sampark-b-2" },
    ]);
    const faulted = await apply({ batch: fourth, fault: "after_first_row" });
    check(
      "16. a failure after the first row leaves nothing applied and no mapping made",
      faulted.reason === "raised" && (await rowOf(fourth, 2)).applied_at === null && (await mappingOf(SP(6))) === null && (await held(E)) === null,
      faulted.message?.slice(0, 50),
    );
  } finally {
    await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  }
} finally {
  await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  await db.from("student_record_history").delete().eq("field_id", FIELD);
  await db.from("student_records").delete().eq("field_id", FIELD);
  await db.from("external_student_ids").delete().eq("app_id", "sampark").like("external_id", `QA-SP-${STAMP}-%`);
  if (batches.length > 0) await db.from("sampark_import_batches").delete().in("id", batches);
  await db.from("collection_fields").delete().eq("id", FIELD);
}

const { count: leftover } = await db.from("external_student_ids").select("external_id", { count: "exact", head: true }).like("external_id", `QA-SP-${STAMP}-%`);
check("17. nothing synthetic is left behind", leftover === 0);

/* ---------------------------------------------------------- the verdict */

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} held.\n`);

if (asJson) {
  const day = new Date().toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P10-sampark-import-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(`Wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length > 0 ? 1 : 0);
