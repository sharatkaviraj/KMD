/**
 * Gate C, against the database itself: what each kind of account can read
 * straight from PostgREST, with no page in the way.
 *
 *   npm run verify:access            # print the matrix, exit 1 on any breach
 *   npm run verify:access -- --json  # and write docs/evidence/P1-access-<date>.json
 *
 * The smoke runners prove the *pages* refuse the wrong people. This proves the
 * thing the pages cannot: a signed-in JWT pointed at the REST API directly — the
 * way the fee app's accounts, a deactivated colleague or a curious teacher
 * would reach it — gets exactly what its role and classes allow (PLAN P1).
 *
 * Every account signs in the way a person does — a one-time magic-link token
 * minted by the admin API and verified by Supabase — and then reads with the
 * publishable key and its own session, so RLS is the only thing deciding.
 * Expected counts come from the service role reading the same tables, so the
 * test says "a teacher sees her own classes and nothing else", not "a teacher
 * sees 41 rows".
 *
 * One extra account is made and removed each run: a login with **no staff
 * profile at all**, because that is what every fee-app-only account is.
 *
 * Rule 3: dev only. Rule 6: QA addresses only, nothing printed but counts.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { QA_ACCOUNTS } from "../tests/fixtures/qa-accounts.ts";
import { ACTIVE_SESSION_KEY, pickSessionLabel } from "../src/platform/config/active-session.ts";
import { toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const asJson = process.argv.includes("--json");
/** Enforce the column revocations too (migration *_hide_phone_reason_and_token_columns). */
const columnsHidden = !process.argv.includes("--before-columns");

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
await toolScope({ url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "verify-access", mode: "dev-only" });

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const service = (schema = "vppsone") =>
  createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema },
    auth: { persistSession: false, autoRefreshToken: false },
  });

/** A client that is exactly this person, and nobody else. */
async function signedInAs(email) {
  const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`${email}: ${error.message}`);

  const client = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    db: { schema: "vppsone" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw new Error(`${email}: ${verifyError.message}`);
  return client;
}

/* ------------------------------------------------------------- the truth */

const admin = service();

const { data: activeSetting } = await service("public")
  .from("app_settings")
  .select("value")
  .eq("key", ACTIVE_SESSION_KEY)
  .maybeSingle();
const { data: sessionRows } = await admin.from("enrolments").select("session_label").limit(1000);
const sessionLabel = pickSessionLabel({
  requested: null,
  configured: null,
  active: typeof activeSetting?.value === "string" ? activeSetting.value : null,
  labels: [...new Set((sessionRows ?? []).map((row) => row.session_label))],
});

async function countAll(table) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

const PUPIL_TABLES = [
  "enrolments",
  "attendance_registers",
  "attendance_marks",
  "attendance_corrections",
  "attendance_register_revisions",
  "notes",
  "marks",
  "student_records",
  "student_record_history",
  "student_documents",
  "report_cards",
  "collection_requests",
  "collection_request_members",
  "collection_submissions",
  "message_sends",
];
const REFERENCE_TABLES = ["timetable_slots", "subjects", "class_teachers"];

/** Tables without an `id`, counted by another column. */
const COUNT_COLUMN = { collection_request_members: "request_id" };

const totals = Object.fromEntries(
  await Promise.all([...PUPIL_TABLES, ...REFERENCE_TABLES].map(async (t) => [t, await countAll(t)])),
);

/** The class keys a staff profile owns today, read the way my_class_keys() does. */
async function ownKeysOf(staffProfileId) {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const [{ data: held }, { data: taught }] = await Promise.all([
    admin
      .from("class_teachers")
      .select("class_id, session_label, effective_from, effective_to")
      .eq("staff_profile_id", staffProfileId),
    admin.from("teaching_assignments").select("class_id, session_label").eq("staff_profile_id", staffProfileId),
  ]);
  const keys = new Set();
  for (const row of held ?? []) {
    if (row.effective_from && row.effective_from > today) continue;
    if (row.effective_to && row.effective_to < today) continue;
    keys.add(`${row.class_id}|${row.session_label}`);
  }
  for (const row of taught ?? []) keys.add(`${row.class_id}|${row.session_label}`);
  return keys;
}

/* ------------------------------------------------------------- the probe */

async function probe(client) {
  const counts = {};
  for (const table of [...PUPIL_TABLES, ...REFERENCE_TABLES]) {
    // Counted by a column every reader may see: `*` would include a revoked
    // column and be refused outright, which says nothing about the rows.
    const { count, error } = await client
      .from(table)
      .select(COUNT_COLUMN[table] ?? "id", { count: "exact", head: true });
    // A refusal by privilege is as good as zero rows, and is recorded as such.
    counts[table] = error ? `refused:${error.code ?? "?"}` : (count ?? 0);
  }

  const { data: enrolled, error: enrolError } = await client
    .from("enrolments")
    .select("class_id, session_label")
    .limit(1000);
  const enrolledKeys = new Set(
    (enrolError ? [] : enrolled ?? []).map((row) => `${row.class_id}|${row.session_label}`),
  );

  const hidden = {};
  for (const [table, column] of [
    ["staff_profiles", "phone"],
    ["staff_profiles", "whatsapp_phone"],
    ["teacher_absences", "reason"],
    ["collection_requests", "token"],
    ["collection_requests", "contact_phone"],
  ]) {
    const { data, error } = await client.from(table).select(column).not(column, "is", null).limit(1);
    hidden[`${table}.${column}`] = error ? "refused" : (data ?? []).length > 0 ? "READABLE" : "empty";
  }

  const rpc = await client.rpc("change_staff_authority", {
    p_actor_staff_id: "00000000-0000-0000-0000-000000000000",
    p_target_staff_id: "00000000-0000-0000-0000-000000000000",
    p_role: "admin",
    p_is_active: true,
  });
  const permissionsTable = await client.from("role_permissions").select("role").limit(1);

  return {
    counts,
    enrolledKeys,
    hidden,
    authorityCommand: rpc.error ? "refused" : "CALLABLE",
    rolePermissionsTable: permissionsTable.error ? "refused" : "READABLE",
  };
}

/* -------------------------------------------------------- the accounts */

const runTag = Date.now().toString(36);
const orphanEmail = `qa.noprofile.${runTag}@qa.vpps.local`;
const { data: orphan, error: orphanError } = await admin.auth.admin.createUser({
  email: orphanEmail,
  email_confirm: true,
});
if (orphanError) throw new Error(`could not create the profile-less login: ${orphanError.message}`);

const { data: profiles } = await admin.from("staff_profiles").select("id, user_id, role, is_active");
const profileByUser = new Map((profiles ?? []).map((row) => [row.user_id, row]));
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const userByEmail = new Map((users?.users ?? []).map((u) => [u.email, u]));

const subjects = [
  ...QA_ACCOUNTS.map((account) => ({ key: account.key, email: account.email, role: account.role })),
  { key: "noProfile", email: orphanEmail, role: null },
];

const failures = [];
const rows = [];

function expect(key, condition, message) {
  if (!condition) failures.push(`${key}: ${message}`);
}

try {
  for (const subject of subjects) {
    const user = subject.key === "noProfile" ? orphan.user : userByEmail.get(subject.email);
    if (!user) {
      failures.push(`${subject.key}: no auth user for ${subject.email} (run npm run qa:seed)`);
      continue;
    }
    const profile = profileByUser.get(user.id) ?? null;
    const active = Boolean(profile?.is_active);
    const role = active ? profile.role : null;

    let client;
    try {
      client = await signedInAs(subject.email);
    } catch (error) {
      failures.push(`${subject.key}: could not sign in — ${error.message}`);
      continue;
    }

    const result = await probe(client);
    rows.push({ key: subject.key, role: role ?? (profile ? "inactive" : "no profile"), ...result });
    const pupilRows = PUPIL_TABLES.map((t) => result.counts[t]).filter((v) => typeof v === "number");
    const sawPupils = pupilRows.some((n) => n > 0);

    // Nobody but the service role runs the authority command or reads the map.
    expect(subject.key, result.authorityCommand === "refused", "could call change_staff_authority");
    expect(subject.key, result.rolePermissionsTable === "refused", "could read role_permissions");

    if (columnsHidden) {
      for (const [column, verdict] of Object.entries(result.hidden)) {
        expect(subject.key, verdict !== "READABLE", `could read ${column} directly`);
      }
    }

    if (!active) {
      // No profile, or a switched-off one: nothing at all.
      expect(subject.key, !sawPupils, "an account with no active profile read pupil rows");
      for (const table of REFERENCE_TABLES) {
        const n = result.counts[table];
        expect(subject.key, typeof n !== "number" || n === 0, `read ${table} with no active profile`);
      }
      continue;
    }

    // Any active member of staff reads the timetable.
    expect(subject.key, result.counts.timetable_slots === totals.timetable_slots, "could not read the timetable");

    if (["accountant", "fee_collector", "view_only"].includes(role)) {
      expect(subject.key, !sawPupils, `${role} read pupil rows`);
      continue;
    }

    if (["admin", "office", "academic_coordinator", "exam_coordinator"].includes(role)) {
      expect(subject.key, result.counts.enrolments === totals.enrolments, "a school-wide role saw a partial roll");
      expect(
        subject.key,
        result.counts.attendance_registers === totals.attendance_registers,
        "a school-wide role saw a partial set of registers",
      );
      continue;
    }

    if (role === "teacher") {
      const own = await ownKeysOf(profile.id);
      const stray = [...result.enrolledKeys].filter((key) => !own.has(key));
      expect(subject.key, stray.length === 0, `read enrolments of ${stray.length} class(es) not hers`);
      expect(subject.key, result.counts.message_sends === 0, "a teacher read the message queue");
      expect(subject.key, result.counts.collection_request_members === 0 || own.size > 0, "read request snapshots");
      if (own.size === 0) {
        // A teacher with no classes still owns two things: the corrections she
        // asked for and a collection request assigned to her. Exactly those.
        const [{ count: askedFor }, { count: assigned }] = await Promise.all([
          admin.from("attendance_corrections").select("id", { count: "exact", head: true }).eq("requested_by", profile.id),
          admin.from("collection_requests").select("id", { count: "exact", head: true }).eq("assigned_staff_id", profile.id),
        ]);
        for (const table of ["enrolments", "attendance_registers", "attendance_marks", "marks", "student_records", "student_record_history", "student_documents", "report_cards", "message_sends"]) {
          expect(subject.key, result.counts[table] === 0, `a teacher with no classes read ${table}`);
        }
        expect(subject.key, result.counts.attendance_corrections === (askedFor ?? 0), "read corrections she did not ask for");
        expect(subject.key, result.counts.collection_requests === (assigned ?? 0), "read requests not assigned to her");
      }
    }
  }

  // The boundary between two teachers, which is the point of having two.
  const t1 = rows.find((row) => row.key === "teacher");
  const t2 = rows.find((row) => row.key === "teacher2");
  if (t1 && t2) {
    const shared = [...t1.enrolledKeys].filter((key) => t2.enrolledKeys.has(key));
    expect("teacher/teacher2", shared.length === 0, `the two QA teachers see ${shared.length} shared class(es)`);
  }
} finally {
  await admin.auth.admin.deleteUser(orphan.user.id);
}

/* ------------------------------------------------------------- report */

const columns = ["enrolments", "attendance_registers", "notes", "marks", "student_records", "message_sends", "timetable_slots"];
console.log(`\n  Direct PostgREST reads, session ${sessionLabel}, ${columnsHidden ? "columns enforced" : "columns not yet enforced"}\n`);
console.log(["  account".padEnd(24), "role".padEnd(22), ...columns.map((c) => c.slice(0, 10).padStart(11))].join(""));
console.log(["  (service role)".padEnd(24), "".padEnd(22), ...columns.map((c) => String(totals[c]).padStart(11))].join(""));
for (const row of rows) {
  console.log(
    [`  ${row.key}`.padEnd(24), String(row.role).padEnd(22), ...columns.map((c) => String(row.counts[c]).padStart(11))].join(""),
  );
}

console.log(failures.length === 0 ? "\n  PASS — every account read exactly its scope.\n" : `\n  FAIL — ${failures.length}:\n`);
for (const failure of failures) console.log(`   - ${failure}`);

if (asJson) {
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const out = path.join(repoRoot, "docs", "evidence", `P1-access-${day}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        target: "schoolfees-dev",
        sessionLabel,
        columnsEnforced: columnsHidden,
        totals,
        accounts: rows.map((row) => ({
          key: row.key,
          role: row.role,
          counts: row.counts,
          classesSeen: row.enrolledKeys.size,
          hidden: row.hidden,
          authorityCommand: row.authorityCommand,
          rolePermissionsTable: row.rolePermissionsTable,
        })),
        failures,
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${path.relative(repoRoot, out)}`);
}

process.exit(failures.length === 0 ? 0 : 1);
