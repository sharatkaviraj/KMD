#!/usr/bin/env node
/**
 * Build a de-identified replica of the live fee database inside schoolfees-dev.
 *
 *   node scripts/replicate-live.mjs --plan     # say what would move, touch nothing
 *   node scripts/replicate-live.mjs --load     # do it
 *
 * **Why this exists.** `schoolfees-dev` carries the complete fee schema and
 * almost none of the data: 139 students, zero installments, zero receipts,
 * zero payments. Every fee screen therefore opens on an empty state, so no
 * fee workflow has ever been exercised end to end. Inventing amounts was
 * rejected — a fee policy is the school's real money and a made-up one puts
 * fabricated figures on a screen somebody might believe. Copying the real
 * shape and masking the real people gives a database where the arithmetic is
 * true and no child is named.
 *
 * **The live database is opened read-only, and that is structural rather than
 * promised.** `liveRead()` below is the only thing holding the live client,
 * it closes over it, and it only ever calls `.select()`. There is no code path
 * in this file that can insert, update, delete or call an RPC against live —
 * not by discipline, but because no other function can see the client. That is
 * the property CLAUDE.md rule 8 is protecting.
 *
 * **What is preserved exactly**, because it is what makes a test real: every
 * amount, due date, payment date, receipt number, instalment plan, discount,
 * carry-forward, waiver, class, section and academic session label. The money
 * in dev adds up to the same totals as the money in live.
 *
 * **What is replaced**, because it is a person: names, phone numbers, e-mail
 * addresses, street addresses, and free-text notes. Aadhaar, Jan-Aadhaar,
 * APAAR and photographs are dropped rather than masked — a government
 * identifier has no test value that justifies carrying a copy of it around,
 * and a photograph is the one field no masking makes safe.
 *
 * **How you can tell this is not live**, at a glance and in code:
 *   - only twelve surnames exist across the whole roster;
 *   - every phone number is in the 99999xxxxx block;
 *   - every e-mail address ends `.invalid`, which by RFC 2606 can never resolve;
 *   - `aadhaar_no`, `jan_aadhaar_no`, `apaar_id` and `photo_path` are all null;
 *   - `vppsone.data_replica` records the run, and the header badge says dev.
 *
 * Masking is deterministic: the same source row always yields the same fake
 * person, so a test that asserts on a name keeps passing across reloads.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  FEES_SOURCE_PROJECT_REF,
  ONE_MAIN_PROJECT_REF,
  projectRefOf,
  readDeploymentEnvironment,
} from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The only two projects this script will ever touch, and in which direction. */
const LIVE_REF = FEES_SOURCE_PROJECT_REF; // read-only, always
const DEV_REF = ONE_MAIN_PROJECT_REF; // written — and only while its marker says dev

const LIVE_SECRETS = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".schoolfees-secrets",
  "env.local.production.20260915-1137.bak",
);

/** Stable across runs, so the same child always becomes the same fake child. */
const SALT = "vppsone-replica-v1";

/* ------------------------------------------------------------------ env */

function parseEnv(file) {
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        const key = line.slice(0, at).trim();
        let value = line.slice(at + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

const devEnv = parseEnv(path.join(repoRoot, ".env.local"));
const liveEnv = parseEnv(LIVE_SECRETS);

// Exact hostnames, not `url.includes(ref)` (see scripts/target-guard.mjs).
if (projectRefOf(devEnv.NEXT_PUBLIC_SUPABASE_URL) !== DEV_REF) {
  console.error(`Refusing to run: .env.local does not point at ${DEV_REF} (rule 3).`);
  process.exit(1);
}
if (projectRefOf(liveEnv.NEXT_PUBLIC_SUPABASE_URL) !== LIVE_REF) {
  console.error(`Refusing to run: the secrets backup is not ${LIVE_REF}.`);
  process.exit(1);
}

/*
 * **Never on production, in either mode** (D-346). This script overwrites
 * `public` with masked people. Once `vppsone.deployment` says production, the
 * people in `public` are real and the school's, and this is the one tool that
 * is not confined but refused outright. Fail closed: a marker that cannot be
 * read is production.
 */
if ((await readDeploymentEnvironment({ url: devEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: devEnv.SUPABASE_SERVICE_ROLE_KEY })) !== "dev") {
  console.error(
    `Refusing to run: ${DEV_REF} is marked production (or its marker could not be read). ` +
      "replicate-live overwrites public with masked data and never runs on production (D-346).",
  );
  process.exit(1);
}

/* --------------------------------------------------- the two connections */

const dev = createClient(
  devEnv.NEXT_PUBLIC_SUPABASE_URL,
  devEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "public" } },
);

/**
 * The live database, sealed inside a closure.
 *
 * Nothing outside this function can reach the client, so nothing outside this
 * function can write to live. Paginated because PostgREST silently truncates
 * at 1000 rows and a short read here would look like a small school.
 */
const liveRead = (() => {
  const live = createClient(
    liveEnv.NEXT_PUBLIC_SUPABASE_URL,
    liveEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false }, db: { schema: "public" } },
  );

  return async function liveRead(table, { orderBy = "id" } = {}) {
    const out = [];
    const page = 1000;

    for (let from = 0; ; from += page) {
      const read = (column) => {
        const query = live.from(table).select("*").range(from, from + page - 1);
        return column ? query.order(column, { ascending: true }) : query;
      };

      let { data, error } = await read(orderBy);

      // Not every table is keyed on `id`. Ordering only matters for the ones
      // big enough to page, and those all have one — so a bad guess falls
      // back rather than stopping the run.
      if (error && orderBy) ({ data, error } = await read(null));
      if (error) throw new Error(`live read ${table}: ${error.message}`);

      out.push(...data);
      if (data.length < page) return out;
    }
  };
})();

/* --------------------------------------------------------------- masking */

function digest(...parts) {
  return createHash("sha256").update(`${SALT}:${parts.join(":")}`).digest("hex");
}

function pick(list, ...seed) {
  return list[parseInt(digest(...seed).slice(0, 8), 16) % list.length];
}

/**
 * Twelve surnames on purpose.
 *
 * Each name reads as an ordinary name, which is what keeps the screens honest
 * about column widths and Devanagari rendering. Six hundred students sharing
 * twelve surnames is what makes the roster unmistakably generated the moment
 * anybody sorts by name.
 */
const SURNAMES = [
  "Testwal", "Devdas", "Parikhya", "Namuna", "Jaanch", "Pariksha",
  "Anumaan", "Prayog", "Namoona", "Adhyayan", "Nirikshan", "Praroop",
];

const GIVEN_M = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna",
  "Ishaan", "Shaurya", "Atharv", "Rudra", "Kabir", "Ansh", "Dhruv", "Yug",
  "Lakshya", "Mohit", "Naman", "Parth", "Raghav", "Tanmay", "Utkarsh", "Yash",
];
const GIVEN_F = [
  "Aadhya", "Ananya", "Diya", "Saanvi", "Aarohi", "Anika", "Navya", "Kiara",
  "Myra", "Riya", "Ishita", "Kavya", "Pihu", "Shanaya", "Trisha", "Vanya",
  "Bhavya", "Charvi", "Garima", "Hetal", "Jiya", "Lavanya", "Nitya", "Ojasvi",
];
const ELDER_M = [
  "Ramesh", "Suresh", "Mahesh", "Dinesh", "Rajesh", "Naresh", "Mukesh",
  "Bhanwar", "Kailash", "Gopal", "Hukam", "Shyam",
];
const ELDER_F = [
  "Sunita", "Anita", "Kavita", "Savita", "Lalita", "Pushpa", "Manju",
  "Sarita", "Geeta", "Seema", "Rekha", "Meena",
];

function fakeChildName(seed, gender) {
  const female = String(gender ?? "").toLowerCase().startsWith("f");
  const given = pick(female ? GIVEN_F : GIVEN_M, seed, "given");
  return `${given} ${pick(SURNAMES, seed, "surname")}`;
}

function fakeElderName(seed, female = false) {
  const given = pick(female ? ELDER_F : ELDER_M, seed, "elder");
  return `${given} ${pick(SURNAMES, seed, "surname")}`;
}

/**
 * The 99999xxxxx block: ten digits, leading 9 so every format check the app
 * makes still runs, and a prefix no parent of this school has. VPPS One has
 * no WhatsApp send path in dev at all (no AiSensy key), so this is the second
 * lock rather than the only one.
 */
function fakePhone(seed) {
  return `99999${digest(seed, "phone").replace(/\D/g, "").padEnd(5, "0").slice(0, 5)}`;
}

function fakeEmail(seed) {
  return `student.${digest(seed, "email").slice(0, 8)}@example.invalid`;
}

function fakeAddress(seed) {
  const houses = ["Ward", "Gali", "Mohalla", "Colony", "Basti"];
  const n = (parseInt(digest(seed, "house").slice(0, 4), 16) % 90) + 1;
  return `${pick(houses, seed, "kind")} ${n}, Test Nagar`;
}

function fakePincode(seed) {
  return `3${digest(seed, "pin").replace(/\D/g, "").padEnd(5, "1").slice(0, 5)}`;
}

/** Same shape, different digits: `TEST-CL9-999` stays `TEST-CL4-812`. */
function reshapeId(value, seed) {
  if (typeof value !== "string" || value === "") return value;
  let i = 0;
  const hash = digest(seed, "reshape", value).replace(/\D/g, "").padEnd(40, "7");
  return value.replace(/\d/g, () => hash[i++ % hash.length]);
}

/** Keeps the age distribution, breaks the exact identity. */
function shiftDate(value, seed) {
  if (!value) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const offset = (parseInt(digest(seed, "dob").slice(0, 6), 16) % 361) - 180;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const NOTE_PLACEHOLDER = "[test data — original note not copied]";

/**
 * Two masked columns carry a unique constraint, and masking is what breaks
 * them: twelve surnames across ninety-eight families collide long before the
 * database is asked to store them. Only these two need the guard —
 * `students.admission_no` globally, and `family_label` within its session.
 * Everything else unique in `public` is keyed on values that are copied
 * verbatim, and duplicate *student names* are left alone on purpose, because
 * two children sharing a name is real and worth testing.
 *
 * Deterministic because the rows arrive ordered by id, so a reload produces
 * the same assignment.
 */
const taken = new Map();

function claim(scope, value) {
  let used = taken.get(scope);
  if (!used) taken.set(scope, (used = new Set()));
  if (!used.has(value)) {
    used.add(value);
    return { value, free: true };
  }
  return { value, free: false };
}

/** Keeps the shape by re-rolling the digits, not by appending to them. */
function uniqueReshape(original, seed, scope) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = reshapeId(original, attempt === 0 ? seed : `${seed}:${attempt}`);
    if (claim(scope, candidate).free) return candidate;
  }
  return reshapeId(original, `${seed}:${Math.random()}`);
}

function uniqueLabel(base, scope) {
  if (claim(scope, base).free) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (claim(scope, candidate).free) return candidate;
  }
}

/**
 * Masking by column name, not by a list of tables I remembered to update.
 *
 * A table-by-table list is exactly as good as the day it was written; a column
 * called `guardian_phone` appearing in a table nobody thought about is the
 * failure this shape prevents.
 */
const NAME_COLS = /^(full_name|father_name|mother_name|guardian_name|family_label|import_name|contact_name|emergency_contact_name|driver_name|conductor_name|received_by|contacted_by_name|parent_name|.*_by_label)$/;
const PHONE_COLS = /phone|mobile|whatsapp_number|contact_number/;
const EMAIL_COLS = /email/;
const ADDRESS_COLS = /^(address|village_city|tehsil|street|locality)$/;
const NOTE_COLS = /^(note|notes|remark|remarks|note_text|write_off_note|outcome_note|cancel_reason|reason)$/;
const DROP_COLS = /aadhaar|apaar|photo_path|voice_note_path|signature_path|document_path/;
const PIN_COLS = /^(pincode|pin_code|postal_code)$/;
const REF_COLS = /^(reference_number|cheque_number|utr|transaction_reference)$/;

/**
 * Any column naming a person who did something.
 *
 * Declaring only the columns that carry their own foreign key is not enough,
 * and the audit trigger is why: `capture_audit_event` writes
 * `coalesce(auth.uid(), updated_by, created_by)` into `audit_logs.changed_by`,
 * which *is* a foreign key to `auth.users`. So a table like
 * `student_repayment_plans`, whose own `created_by` is unconstrained, still
 * fails on insert — via the audit row rather than the row itself. Every actor
 * uuid therefore goes through the map, constrained or not.
 *
 * Matched by shape as well as by name: `receipts.received_by` holds a person's
 * name rather than an id, and must reach the name masking below instead.
 */
const ACTOR_COLS =
  /^(created_by|updated_by|changed_by|approved_by|closed_by|posted_by|triggered_by|applied_by|waived_by|voided_by|activated_by|cancelled_by|processed_by|verified_by|run_by|contacted_by|uploaded_by|reviewed_by|received_by|deleted_by|resolved_by)$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Columns that must reference a row in dev's `auth.users` or be null. */
const AUTH_FK_COLS = new Set(
  `academic_sessions.created_by academic_sessions.updated_by classes.created_by
   classes.updated_by collection_closures.approved_by collection_closures.closed_by
   collection_closures.created_by collection_closures.updated_by
   conventional_discount_policies.created_by conventional_discount_policies.updated_by
   defaulter_contacts.contacted_by defaulter_recovery_state.created_by
   defaulter_recovery_state.updated_by family_payments.posted_by
   fee_policy_configs.created_by fee_policy_configs.updated_by fee_settings.created_by
   fee_settings.updated_by installments.created_by installments.updated_by
   payment_adjustment_reviews.created_by payment_adjustments.created_by payments.created_by
   prev_year_import_batches.created_by prev_year_import_batches.updated_by
   prev_year_import_rows.created_by prev_year_import_rows.updated_by
   promotion_runs.triggered_by receipt_adjustments.created_by
   receipt_finance_adjustments.created_by receipts.created_by refund_requests.approved_by
   refund_requests.created_by refund_requests.processed_by refund_requests.updated_by
   school_fee_defaults.created_by school_fee_defaults.updated_by setup_progress.created_by
   setup_progress.updated_by student_carry_forward_balances.created_by
   student_carry_forward_balances.updated_by student_collection_flags.created_by
   student_collection_flags.updated_by student_conventional_discount_assignments.applied_by
   student_family_groups.created_by student_family_groups.updated_by
   student_fee_overrides.created_by student_fee_overrides.updated_by
   student_late_fee_waivers.voided_by student_late_fee_waivers.waived_by
   student_repayment_plans.activated_by student_repayment_plans.cancelled_by
   student_share_links.created_by students.created_by students.updated_by
   transport_routes.created_by transport_routes.updated_by
   academic_calendar.created_by student_external_ids.created_by
   student_external_ids.verified_by`
    .split(/\s+/)
    .filter(Boolean),
);

/** Columns that are generated by Postgres and cannot be written. */
const GENERATED_COLS = new Set(["installments.amount_due"]);

/**
 * Rows live holds that live's own rules would reject today.
 *
 * `enforce_third_child_traceability` is a BEFORE trigger, so it only ever
 * judged rows written after it existed. Six active third-child discounts
 * predate it: no `family_group_id`, no manual-override flag, so nothing
 * records *why* that family got the discount. Re-inserting them is what
 * surfaced them.
 *
 * Dropping them would change what the school is owed, so the discount is kept
 * and the row is marked as the manual override it effectively always was. The
 * reason text says so, which means the six are findable in dev with a single
 * query rather than being quietly normalised.
 */
const context = { policyCodeById: new Map() };

const FIXUPS = {
  student_conventional_discount_assignments(row, source) {
    // Only `third_child` is judged by the trigger. The 59 RTE and 28
    // staff-child assignments have no family group either and are perfectly
    // legal, so a fix-up that ignored the policy code would rewrite 87 sound
    // rows to work around 6 broken ones.
    const legacyThirdChild =
      context.policyCodeById.get(source.policy_id) === "third_child" &&
      source.is_active &&
      source.family_group_id == null &&
      source.is_manual_override !== true;

    if (!legacyThirdChild) return row;

    return {
      ...row,
      is_manual_override: true,
      manual_override_reason:
        "[replica] legacy row predating enforce_third_child_traceability",
    };
  },
};

const fixupLog = new Map();

const maskedColumnLog = new Map();

function noteMasked(table, column, how) {
  const key = `${table}.${column}`;
  if (!maskedColumnLog.has(key)) maskedColumnLog.set(key, how);
}

function maskRow(table, row, userMap, defer) {
  const out = {};
  const seed = String(row.id ?? row.student_id ?? JSON.stringify(row).slice(0, 64));

  for (const [column, value] of Object.entries(row)) {
    const qualified = `${table}.${column}`;

    if (GENERATED_COLS.has(qualified)) continue;
    if (defer?.includes(column)) {
      out[column] = null;
      continue;
    }

    // An actor column has to point at somebody dev's auth schema knows about.
    if (AUTH_FK_COLS.has(qualified)) {
      out[column] = value ? (userMap.get(value) ?? null) : null;
      continue;
    }

    if (ACTOR_COLS.test(column) && typeof value === "string" && UUID.test(value)) {
      out[column] = userMap.get(value) ?? null;
      noteMasked(table, column, "actor remapped");
      continue;
    }

    if (value === null || value === undefined) {
      out[column] = value;
      continue;
    }

    if (DROP_COLS.test(column)) {
      out[column] = null;
      noteMasked(table, column, "dropped");
      continue;
    }

    if (typeof value === "string" && value !== "") {
      if (NAME_COLS.test(column)) {
        const female =
          column.startsWith("mother") ||
          String(row.gender ?? "").toLowerCase().startsWith("f");
        const name =
          column === "full_name" && table === "students"
            ? fakeChildName(seed, row.gender)
            : fakeElderName(`${seed}:${column}`, female);

        out[column] =
          table === "student_family_groups" && column === "family_label"
            ? uniqueLabel(name, `family_label:${row.academic_session_label}`)
            : name;
        noteMasked(table, column, "name");
        continue;
      }
      if (PHONE_COLS.test(column)) {
        out[column] = fakePhone(`${seed}:${column}`);
        noteMasked(table, column, "phone");
        continue;
      }
      if (EMAIL_COLS.test(column)) {
        out[column] = fakeEmail(`${seed}:${column}`);
        noteMasked(table, column, "email");
        continue;
      }
      if (ADDRESS_COLS.test(column)) {
        out[column] = fakeAddress(`${seed}:${column}`);
        noteMasked(table, column, "address");
        continue;
      }
      if (PIN_COLS.test(column)) {
        out[column] = fakePincode(seed);
        noteMasked(table, column, "pincode");
        continue;
      }
      if (REF_COLS.test(column)) {
        out[column] = reshapeId(value, `${seed}:${column}`);
        noteMasked(table, column, "reshaped");
        continue;
      }
      if (NOTE_COLS.test(column)) {
        out[column] = NOTE_PLACEHOLDER;
        noteMasked(table, column, "note");
        continue;
      }
    }

    out[column] = value;
  }

  // Student-specific fields that are identity rather than money.
  if (table === "students") {
    out.admission_no = uniqueReshape(row.admission_no, seed, "admission_no");
    out.date_of_birth = shiftDate(row.date_of_birth, seed);
    out.previous_school = row.previous_school ? "Test Public School" : null;
    out.tc_number = reshapeId(row.tc_number, seed);
    out.board_registration_no = reshapeId(row.board_registration_no, seed);
    noteMasked("students", "admission_no", "reshaped");
    noteMasked("students", "date_of_birth", "shifted ±180d");
  }

  return out;
}

/**
 * Order rows so that a row arrives after whatever it points at.
 *
 * Repayment plans supersede one another in a two-row cycle: the old plan
 * names its replacement, the replacement names what it replaced. The schema
 * already solved this — `superseded_by_plan_id` is DEFERRABLE INITIALLY
 * DEFERRED, so the backward half is allowed to dangle until commit, while
 * `supersedes_plan_id` is an immediate key on a column a trigger then makes
 * immutable. Both halves therefore have to be correct in a single statement,
 * ordered so the plan being superseded is written first. PostgREST runs one
 * request in one transaction, which is what makes that possible here.
 *
 * Deferring `supersedes_plan_id` and patching afterwards was the obvious
 * approach and is the one the database refuses: `protect_repayment_plan_terms`
 * rejects any update that touches it.
 */
function referencedFirst(column) {
  return (rows) => {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const placed = new Set();
    const out = [];

    const visit = (row, seen) => {
      if (!row || placed.has(row.id) || seen.has(row.id)) return;
      seen.add(row.id);
      visit(byId.get(row[column]), seen);
      if (!placed.has(row.id)) {
        placed.add(row.id);
        out.push(row);
      }
    };

    for (const row of rows) visit(row, new Set());
    return out;
  };
}

/* ------------------------------------------------------------- the order */

/**
 * Foreign keys decide this list, and two cycles decide the `defer` entries.
 * `installments.carry_forward_balance_id` points at a table that points back
 * at installments; repayment plans supersede each other. Both are filled in a
 * second pass once every row exists.
 */
const PLAN = [
  { table: "academic_sessions" },
  { table: "transport_routes" },
  { table: "classes" },
  { table: "fee_settings" },
  { table: "conventional_discount_policies" },
  { table: "school_fee_defaults" },
  { table: "fee_policy_configs" },
  { table: "app_settings", orderBy: "key" },
  { table: "school_holidays" },
  { table: "setup_progress" },
  { table: "academic_calendar" },
  { table: "student_family_groups" },
  { table: "students" },
  { table: "student_family_members" },
  { table: "student_fee_overrides" },
  { table: "student_conventional_discount_assignments" },
  { table: "prev_year_import_batches" },
  { table: "installments", defer: ["carry_forward_balance_id"] },
  { table: "prev_year_import_rows" },
  { table: "student_carry_forward_balances" },
  { table: "family_payments" },
  { table: "receipts" },
  { table: "payments" },
  { table: "payment_adjustments" },
  { table: "payment_adjustment_reviews" },
  { table: "receipt_adjustments" },
  { table: "receipt_finance_adjustments" },
  { table: "refund_requests" },
  { table: "student_late_fee_waivers" },
  { table: "student_collection_flags" },
  { table: "defaulter_contacts" },
  { table: "defaulter_recovery_state" },
  { table: "student_external_ids" },
  { table: "student_share_links" },
  { table: "student_repayment_plans", sort: referencedFirst("supersedes_plan_id") },
  { table: "student_repayment_plan_items" },
  { table: "student_repayment_schedule" },
  { table: "student_repayment_emi_late_fees" },
  { table: "student_repayment_receipt_links" },
  { table: "promotion_runs" },
  { table: "promotion_run_entries" },
  { table: "collection_closures" },
];

/**
 * Deliberately not copied, and why.
 *
 * Every one of these is either a log, an import staging area, or a payload
 * whose JSON embeds the names this whole exercise exists to remove. Audit
 * rows in particular carry `before_data` and `after_data` as whole-row JSON,
 * so masking them means re-masking every historic value; leaving dev's audit
 * trail to fill up with the test activity is both cheaper and more honest.
 */
const SKIPPED = {
  audit_logs: "whole-row JSON of every historic value; dev logs its own activity instead",
  user_activity_events: "per-user telemetry, no screen depends on it",
  import_batches: "import staging",
  import_rows: "import staging",
  payment_import_batches: "import staging",
  payment_import_rows: "import staging",
  ledger_regeneration_batches: "maintenance log",
  ledger_regeneration_rows: "maintenance log",
  late_fee_rule_change_snapshot: "config-change snapshot",
  settlement_pool_change_snapshot: "config-change snapshot",
  late_fee_waiver_pool_snapshot: "config-change snapshot",
  config_change_batches: "config-change log",
  config_change_blocked_installments: "config-change log",
  notion_sync_log: "external integration log",
  office_sync_events: "realtime fan-out log, regenerates itself",
  session_reconcile_log: "maintenance log",
  student_session_reanchor_log: "maintenance log",
  backup_runs: "belongs to the fee app's own cron",
  whatsapp_campaigns: "message bodies embed real names",
  whatsapp_campaign_runs: "message bodies embed real names",
  whatsapp_reminder_sends: "message bodies and real phone numbers",
  whatsapp_run_holdouts: "keyed to campaign runs that are not copied",
  whatsapp_test_sends: "message bodies embed real names",
  workbook_materialized_view_refresh_queue: "rebuilt by the refresh at the end",
  users: "handled separately — each one needs a dev auth account first",
};

/* ----------------------------------------------------------------- users */

/**
 * Give every live staff account a dev twin.
 *
 * Seventy-five columns across `public` are foreign keys to `auth.users`, so a
 * copied `created_by` is a failed insert unless that person exists here too.
 * Each twin is passwordless and lives on the QA domain, so `dev:login` can
 * mint a link for it and nothing can be signed into with a password.
 */
async function replicateUsers() {
  const liveUsers = await liveRead("users");
  const map = new Map();
  const made = [];

  for (const [index, user] of liveUsers.entries()) {
    const seed = String(user.id);
    const email = `fee.user.${String(index + 1).padStart(2, "0")}@qa.vpps.local`;

    const { data: created, error } = await dev.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { replica_of_role: user.role, seeded_by: "replicate-live" },
    });

    let authId = created?.user?.id;

    if (error) {
      // Already there from an earlier run: find it rather than fail.
      const { data: list } = await dev.auth.admin.listUsers({ perPage: 200 });
      authId = list?.users?.find((candidate) => candidate.email === email)?.id;
      if (!authId) throw new Error(`could not create or find ${email}: ${error.message}`);
    }

    map.set(user.id, authId);
    made.push({
      id: authId,
      full_name: fakeElderName(seed, false),
      role: user.role,
      phone: fakePhone(seed),
      is_active: user.is_active,
      preferred_locale: user.preferred_locale,
      notes: NOTE_PLACEHOLDER,
    });
  }

  const { error } = await dev.from("users").upsert(made, { onConflict: "id" });
  if (error) throw new Error(`dev write users: ${error.message}`);

  return { map, count: made.length, emails: made.length };
}

/* ------------------------------------------------------------------ main */

const mode = process.argv.includes("--load") ? "load" : "plan";

console.log(
  `\n  Replica  ${LIVE_REF} (read-only)  ->  ${DEV_REF}\n  Mode: ${mode}\n`,
);

const report = { mode, at: new Date().toISOString(), tables: [], skipped: SKIPPED };

if (mode === "plan") {
  for (const { table } of PLAN) {
    const rows = await liveRead(table, { orderBy: null });
    console.log(`  ${table.padEnd(46)} ${String(rows.length).padStart(6)}`);
    report.tables.push({ table, live: rows.length });
  }
  console.log(`\n  Nothing was written. Re-run with --load.\n`);
} else {
  /*
   * Refuse to load on top of a database that already has fee rows.
   *
   * Every insert here is a plain `insert`, not an upsert — the ids come from
   * live and are meant to be preserved — so a second run would either collide
   * on the primary key half way through or, on the tables without one that
   * matters, quietly double the money. Neither is a state anybody would notice
   * quickly: the totals would simply be wrong.
   *
   * The wipe is not done here on purpose. `receipts` and `payments` carry
   * `BEFORE DELETE` triggers that make them append-only, so a DELETE is
   * refused outright and only TRUNCATE gets through — and a script that
   * truncates the fee schema as a side effect of being run twice is a worse
   * thing to have lying around than one that stops and says what to do.
   */
  const { count: existingStudents } = await dev
    .from("students")
    .select("id", { count: "exact", head: true });

  if ((existingStudents ?? 0) > 0) {
    console.error(
      `  Refusing to load: ${existingStudents} students are already here.\n\n` +
        `  Every insert below is a plain insert with live's own ids, so a second\n` +
        `  run duplicates or collides. Clear the fee schema first — TRUNCATE, not\n` +
        `  DELETE, because receipts and payments are append-only:\n\n` +
        `    do $$ declare stmt text; begin\n` +
        `      select 'truncate table ' || string_agg(format('public.%I', c.relname), ', ')\n` +
        `             || ' cascade'\n` +
        `        into stmt\n` +
        `        from pg_class c join pg_namespace n on n.oid = c.relnamespace\n` +
        `       where n.nspname = 'public' and c.relkind = 'r';\n` +
        `      execute stmt;\n` +
        `    end $$;\n\n` +
        `  Then re-run, and re-seed the academic side:\n` +
        `    npm run seed:timetable && npm run seed:scenarios && npm run qa:seed\n`,
    );
    process.exit(1);
  }

  const users = await replicateUsers();
  console.log(`  users${" ".repeat(41)} ${String(users.count).padStart(6)}  (dev auth twins)`);
  report.tables.push({ table: "users", live: users.count, dev: users.count });

  const deferred = [];

  for (const { table, orderBy, defer, sort } of PLAN) {
    const read = await liveRead(table, { orderBy: orderBy === undefined ? "id" : orderBy });
    const rows = sort ? sort(read) : read;
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(46)} ${"0".padStart(6)}`);
      report.tables.push({ table, live: 0, dev: 0 });
      continue;
    }

    if (table === "conventional_discount_policies") {
      for (const policy of rows) context.policyCodeById.set(policy.id, policy.code);
    }

    const fixup = FIXUPS[table];
    const masked = rows.map((row) => {
      const out = maskRow(table, row, users.map, defer);
      if (!fixup) return out;
      const fixed = fixup(out, row);
      if (fixed !== out) fixupLog.set(table, (fixupLog.get(table) ?? 0) + 1);
      return fixed;
    });

    for (let at = 0; at < masked.length; at += 500) {
      const batch = masked.slice(at, at + 500);
      const { error } = await dev.from(table).insert(batch);
      if (error) {
        console.error(`\n  FAILED ${table} rows ${at}..${at + batch.length}`);
        console.error(`  ${error.message}`);
        console.error(`  columns: ${Object.keys(batch[0]).join(", ")}\n`);
        process.exit(1);
      }
    }

    if (defer) {
      deferred.push({
        table,
        defer,
        patches: rows
          .filter((row) => defer.some((column) => row[column] != null))
          .map((row) => ({
            id: row.id,
            ...Object.fromEntries(defer.map((column) => [column, row[column] ?? null])),
          })),
      });
    }

    console.log(`  ${table.padEnd(46)} ${String(masked.length).padStart(6)}`);
    report.tables.push({ table, live: rows.length, dev: masked.length });
  }

  // Second pass: the columns held back to break the two cycles.
  for (const { table, patches } of deferred) {
    for (const patch of patches) {
      const { id, ...set } = patch;
      const { error } = await dev.from(table).update(set).eq("id", id);
      if (error) throw new Error(`deferred ${table} ${id}: ${error.message}`);
    }
    console.log(`  ${`${table} (deferred fk)`.padEnd(46)} ${String(patches.length).padStart(6)}`);
  }

  // Without this every fee dashboard reads zero: the three matviews are what
  // the money screens select from, and the load only enqueued a refresh.
  console.log(`\n  Refreshing financial materialized views...`);
  const { error: refreshError } = await dev.rpc("refresh_financial_materialized_views", {
    p_concurrently: false,
  });
  if (refreshError) throw new Error(`matview refresh: ${refreshError.message}`);

  if (fixupLog.size > 0) {
    console.log(`\n  Rows live would reject today, carried over and flagged:`);
    for (const [table, count] of fixupLog) console.log(`    ${table.padEnd(52)} ${count}`);
    report.fixups = Object.fromEntries(fixupLog);
  }

  console.log(`\n  Columns masked:`);
  for (const [column, how] of [...maskedColumnLog].sort()) {
    console.log(`    ${column.padEnd(52)} ${how}`);
  }
  report.masked = Object.fromEntries(maskedColumnLog);
  console.log("");

  // The marker that makes "is this live data?" answerable with a query
  // rather than by recognising twelve surnames.
  const copied = report.tables.filter((row) => (row.dev ?? 0) > 0);
  const { error: markError } = await dev.schema("vppsone").from("data_replica").insert({
    source_project: LIVE_REF,
    target_project: DEV_REF,
    tables_copied: copied.length,
    rows_copied: copied.reduce((total, row) => total + row.dev, 0),
    tables_skipped: SKIPPED,
    masked_columns: Object.fromEntries(maskedColumnLog),
    carried_exceptions: Object.fromEntries(fixupLog),
    note: "Masked replica. Amounts, dates and receipt numbers are exact; people are not.",
  });
  if (markError) throw new Error(`data_replica: ${markError.message}`);
}

const out = path.join(repoRoot, "docs", "replica-report.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`  Report: ${path.relative(repoRoot, out)}\n`);
