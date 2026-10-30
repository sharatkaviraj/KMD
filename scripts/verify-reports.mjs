/**
 * P8, against the database: a report card is issued once, by the exam office,
 * against the term's latest approved scheme, from papers their teachers
 * submitted and that have not moved since — and a reissue is a new revision
 * that says why and keeps the old one.
 *
 *   npm run verify:reports            # exit 1 on any broken promise
 *   npm run verify:reports -- --json  # and write docs/evidence/P8-reports-<date>.json
 *
 * Drives `vppsone.issue_report_card` directly, as real QA accounts, on a
 * synthetic term named `QA-P8-…` for the QA teacher's class. The term's exam,
 * marks, schemes and cards are removed at the end — the one kind of term the
 * append-only rules let a script remove.
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

// Rule 3 / D-346, Phase 3: One's main project only, confined to TEST-2026-27 and test accounts, and
// refused on production: it flips school-wide switches (runtime_flags, parent policy or the staff-notice queue).
const scope = await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-reports", mode: "confined-dev-only" });

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const issue = async (payload) => {
  const { data, error } = await db.rpc("issue_report_card", { p: payload });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};
const marks = async (payload) => {
  const { data, error } = await db.rpc("save_marks", { p: payload });
  return error ? { ok: false, reason: "raised", message: error.message } : data;
};
const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/* ------------------------------------------------------------- the scene */

// Confined (Phase 3): the QA accounts are test accounts, so the run lives in TEST-2026-27.
const { data: setting } = scope.confined ? { data: { value: scope.sessionLabel } } : await db.schema("public").from("app_settings").select("value").eq("key", "active_session_label").maybeSingle();
const SESSION = setting?.value;
if (!SESSION) throw new Error("app_settings.active_session_label is not set.");

const { data: users } = await db.auth.admin.listUsers({ perPage: 1000 });
const profileOf = async (email) => {
  const user = users.users.find((entry) => entry.email === email);
  if (!user) throw new Error(`${email} has no account — run npm run qa:seed`);
  const { data } = await db.from("staff_profiles").select("id").eq("user_id", user.id).single();
  return data;
};
const teacher = await profileOf("qa.teacher@qa.vpps.local");
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
const { data: subject } = await db.from("subjects").select("id, code").eq("is_active", true).limit(1).single();

const TERM = `QA-P8-${randomUUID().slice(0, 8)}`;
const EXAM = randomUUID();
const PAPER = randomUUID();

async function cleanup() {
  const { data: stale } = await db.from("report_card_issues").select("term").like("term", "QA-P8-%");
  const terms = [...new Set((stale ?? []).map((row) => row.term)), TERM];
  for (const term of terms) {
    await db.from("report_card_issues").delete().eq("term", term);
    await db.from("report_schemes").delete().eq("term", term);
    await db.from("assessments").delete().eq("term", term);
  }
}

const bands = [
  { from: 50, label: "P", hi: "उत्तीर्ण", en: "Pass" },
  { from: 0, label: "F", hi: "अनुत्तीर्ण", en: "Fail" },
];
async function newScheme(status, revision) {
  const { data, error } = await db
    .from("report_schemes")
    .insert({
      session_label: SESSION,
      term: TERM,
      revision,
      status,
      grade_bands: bands,
      percent_decimals: 1,
      approved_by: status === "approved" ? office.id : null,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

const card = (missing = 0) => ({ studentName: "Synthetic", totals: { missing, scored: 30, outOf: 40 }, rows: [] });

/* ------------------------------------------------------------- the tests */

await cleanup();
let child;
try {
  const { error: examError } = await db.from("assessments").insert({
    id: EXAM, session_label: SESSION, term: TERM, code: TERM, label_hi: "QA", label_en: "QA", status: "open",
  });
  if (examError) throw new Error(examError.message);
  const { error: paperError } = await db.from("assessment_subjects").insert({
    id: PAPER, assessment_id: EXAM, class_id: CLASS, class_label: "QA", subject_id: subject.id,
    subject_code: subject.code, max_marks: 40, mark_step: 0.5, allow_exempt: true,
  });
  if (paperError) throw new Error(paperError.message);

  const { data: roster } = await db.rpc("paper_roster", { p_paper: PAPER });
  const ids = [...roster].sort();
  child = ids[0];
  console.log(`\n  issue_report_card on the synthetic term ${TERM}, ${ids.length} on the roll\n`);

  const command = (overrides = {}) => {
    const base = {
      command_id: randomUUID(),
      actor_staff_id: office.id,
      session_label: SESSION,
      term: TERM,
      student_id: child,
      scheme_id: null,
      expected_revision: 0,
      reason: null,
      card: card(),
      sources: { papers: [{ id: PAPER, entry_revision: 1 }] },
    };
    const merged = { ...base, ...overrides };
    merged.payload_hash ??= hashOf([merged.student_id, merged.expected_revision, merged.reason, merged.scheme_id]);
    return merged;
  };

  // 1. No approved scheme, no card.
  const draftScheme = await newScheme("draft", 1);
  const r1 = await issue(command({ scheme_id: draftScheme }));
  check("a card cannot be issued against a draft scheme", r1.ok === false && r1.reason === "no_approved_scheme");

  // Approve it the way the app does.
  await db.from("report_schemes").update({ status: "approved", approved_by: office.id, approved_at: new Date().toISOString() }).eq("id", draftScheme);
  const SCHEME = draftScheme;

  // 2. Not until every paper is submitted.
  const r2 = await issue(command({ scheme_id: SCHEME }));
  check(
    "a card cannot be issued while a paper the class sat is unsubmitted",
    r2.ok === false && r2.reason === "papers_not_submitted" && (r2.papers ?? []).includes(subject.code),
  );

  const submitted = await marks({
    command_id: randomUUID(), actor_staff_id: office.id, paper_id: PAPER, kind: "submit", expected_revision: 0,
    payload_hash: "x", entries: ids.map((id, index) => ({ student_id: id, state: "value", value: (index % 40) })),
  });
  if (!submitted.ok) throw new Error(`Could not submit the synthetic paper: ${submitted.reason ?? submitted.message}`);

  // 3. Not incomplete, not from marks that moved.
  const r3 = await issue(command({ scheme_id: SCHEME, card: card(1) }));
  check("an incomplete card is refused", r3.ok === false && r3.reason === "incomplete");
  const r4 = await issue(command({ scheme_id: SCHEME, sources: { papers: [{ id: PAPER, entry_revision: 0 }] } }));
  check(
    "a card worked out before the marks last moved is refused, naming the paper",
    r4.ok === false && r4.reason === "marks_moved" && (r4.papers ?? []).includes(subject.code),
  );

  // 4. Only the exam office.
  const r5 = await issue(command({ scheme_id: SCHEME, actor_staff_id: teacher.id }));
  check("a teacher cannot issue a card", r5.ok === false && r5.reason === "not_permitted");

  // 5. Issue, replay, reuse.
  const first = command({ scheme_id: SCHEME });
  const r6 = await issue(first);
  const r7 = await issue(first);
  const r8 = await issue({ ...first, payload_hash: "different" });
  check("the exam office issues revision 1", r6.ok === true && r6.revision === 1 && r6.kind === "issue");
  check("a repeated issue returns the same revision and writes nothing", r7.ok === true && r7.replayed === true && r7.revision === 1);
  check("a reused id with a different payload is refused", r8.ok === false && r8.reason === "id_reused");

  // 6. A reissue says why, against the revision the page showed.
  const r9 = await issue(command({ scheme_id: SCHEME, expected_revision: 1 }));
  const r10 = await issue(command({ scheme_id: SCHEME, expected_revision: 0, reason: "x" }));
  check("a reissue without a reason is refused", r9.ok === false && r9.reason === "reason_required");
  check("a reissue against an older revision is stale", r10.ok === false && r10.reason === "stale" && r10.current_revision === 1);

  // 7. A fault part-way leaves revision 1 issued.
  await db.from("runtime_flags").update({ enabled: true }).eq("key", "fault_injection");
  const r11 = await issue(command({ scheme_id: SCHEME, expected_revision: 1, reason: "fault", fault: "after_supersede" }));
  await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  const { data: afterFault } = await db.from("report_card_issues").select("revision, status").eq("term", TERM).eq("student_id", child);
  check(
    "an injected fault after the old revision is superseded leaves it issued",
    r11.ok === false && /injected_fault/.test(r11.message ?? "") &&
      afterFault.length === 1 && afterFault[0].status === "issued",
  );

  const r12 = await issue(command({ scheme_id: SCHEME, expected_revision: 1, reason: "Father's name corrected" }));
  const { data: lineage } = await db
    .from("report_card_issues")
    .select("id, revision, status, kind, reason, supersedes")
    .eq("term", TERM)
    .eq("student_id", child)
    .order("revision");
  check(
    "a reissue is revision 2 with its reason; revision 1 is kept, superseded, and linked",
    r12.ok === true && r12.revision === 2 && r12.kind === "reissue" &&
      lineage.length === 2 && lineage[0].status === "superseded" && lineage[1].status === "issued" &&
      lineage[1].supersedes === lineage[0].id && lineage[1].reason === "Father's name corrected",
  );

  // 8. Nothing issued is edited, and an approved scheme is final.
  const edited = await db.from("report_card_issues").update({ card: { tampered: true } }).eq("id", lineage[1].id);
  const unSuperseded = await db.from("report_card_issues").update({ status: "issued" }).eq("id", lineage[0].id);
  const schemeEdit = await db.from("report_schemes").update({ percent_decimals: 2 }).eq("id", SCHEME);
  check(
    "an issued card cannot be edited or brought back, and an approved scheme cannot be changed",
    /issued_is_final/.test(edited.error?.message ?? "") &&
      /issued_is_final/.test(unSuperseded.error?.message ?? "") &&
      /approved_is_final/.test(schemeEdit.error?.message ?? ""),
  );

  // 9. A newer approved scheme retires the old one for issuing.
  await newScheme("approved", 2);
  const r13 = await issue(command({ scheme_id: SCHEME, expected_revision: 2, reason: "x" }));
  check("a card cannot be issued against a scheme that a newer approved revision replaced", r13.ok === false && r13.reason === "scheme_changed");
} finally {
  await db.from("runtime_flags").update({ enabled: false }).eq("key", "fault_injection");
  await cleanup();
}

const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? `\n  PASS — ${results.length} of ${results.length}.\n` : `\n  FAIL — ${failed.length} of ${results.length}.\n`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P8-reports-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), target: "schoolfees-dev", results }, null, 2));
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failed.length === 0 ? 0 : 1);
