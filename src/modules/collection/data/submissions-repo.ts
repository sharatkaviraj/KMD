import "server-only";

import { createHash } from "node:crypto";
import { taskSchemaMissing } from "@/modules/teacher-tasks/data/schema";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { supersededIds } from "@/modules/collection/domain/precedence";
import { feeColumnsFor, heldValue } from "@/modules/collection/domain/gaps";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import type { CollectionField } from "@/modules/collection/domain/fields";
import type { CollectionRequest } from "@/modules/collection/domain/requests";
import type {
  Submission,
  SubmissionStatus,
} from "@/modules/collection/domain/review";

/**
 * Answers in, and answers out.
 *
 * The write side runs with no session — it is what the public token page
 * posts to — so everything it touches is scoped by the request the token
 * already resolved to. The read side is the office's queue and runs as
 * themselves.
 */

/* ------------------------------------------------------------- writing */

export type IncomingAnswer = {
  studentId: string;
  fieldId: string;
  /** Already validated and normalised by `validateField()`. */
  value: string | null;
  previousValue: string | null;
};

/**
 * Record what a teacher sent.
 *
 * **Upserted on (request, student, field).** Re-answering replaces: a teacher
 * correcting a typo is fixing her answer, not filing a second one, and an
 * office reading a queue of both would have to work out which is current.
 *
 * A row that has already been decided is left alone. Once the office has
 * accepted an answer, a later flush of the same form — a browser tab somebody
 * left open, an offline retry — must not quietly reopen it.
 */
export async function recordAnswers(
  request: CollectionRequest,
  answers: IncomingAnswer[],
): Promise<{ written: number }> {
  if (answers.length === 0) return { written: 0 };

  const db = createAdminClient();
  const task = await db.from("teacher_tasks").select("id").eq("request_id", request.id).maybeSingle();
  if (task.error && !taskSchemaMissing(task.error)) throw new Error("Could not verify request authority.");
  // Keep legacy requests usable before this additive migration is installed.
  // An absent task row is a legacy request, not evidence of an absent schema.
  // Installed schemas always use the transactional authority check below.
  if (task.error && taskSchemaMissing(task.error)) {
    const decided = await db.from("collection_submissions").select("student_id,field_id").eq("request_id",request.id).neq("status","pending").returns<{student_id:string;field_id:string}[]>();
    if (decided.error) throw new Error("Could not verify decided answers.");
    const locked = new Set(decided.data.map(a=>`${a.student_id}:${a.field_id}`));
    const rows=answers.filter(a=>request.fields.some(f=>f.id===a.fieldId)&&!locked.has(`${a.studentId}:${a.fieldId}`));
    if(!rows.length)return {written:0};
    const result=await db.from("collection_submissions").upsert(rows.map(a=>({request_id:request.id,student_id:a.studentId,field_id:a.fieldId,value:a.value,previous_value:a.previousValue,status:"pending",submitted_at:new Date().toISOString()})),{onConflict:"request_id,student_id,field_id"});
    if(result.error)throw new Error("Could not save proposals.");return {written:rows.length};
  }
  const { data, error } = await createAdminClient().rpc("record_collection_answers", {
    p_request: request.id, p_token: request.token, p_answers: answers,
  });
  if (error) throw new Error("Could not save these proposals.");
  return { written: Number(data ?? 0) };
}

/* ------------------------------------------------------------- reading */

type SubmissionRow = {
  id: string;
  request_id: string;
  student_id: string;
  field_id: string;
  value: string | null;
  previous_value: string | null;
  status: SubmissionStatus;
  submitted_at: string;
  decided_at: string | null;
  decision_note: string | null;
  collection_requests: {
    title_hi: string;
    title_en: string;
    class_label: string | null;
    round_id: string | null;
    audience_kind: string;
    audience_label: string;
    staff_profiles: { display_name: string } | null;
  } | null;
  collection_fields: { key: string; label_hi: string; label_en: string } | null;
  staff_profiles: { display_name: string } | null;
};

const COLUMNS =
  "id, request_id, student_id, field_id, value, previous_value, status, submitted_at, " +
  "decided_at, decision_note, " +
  // Named: a request points at `staff_profiles` three times now (assigned,
  // sent_by, reminded_by), and an unnamed embed fails the whole select.
  "collection_requests!inner(title_hi, title_en, class_label, round_id, " +
  "audience_kind, audience_label, " +
  "staff_profiles!collection_requests_assigned_staff_id_fkey(display_name)), " +
  "collection_fields!inner(key, label_hi, label_en), " +
  "staff_profiles(display_name)";

/**
 * The review queue.
 *
 * Student names come from the fee app in one extra read rather than a join,
 * because the join would cross schemas and the fee side needs the service-role
 * client anyway (D-32).
 */
export async function listSubmissions(
  status: SubmissionStatus | "all" = "pending",
): Promise<Submission[]> {
  await assertPermission("collection:view");

  const supabase = await createClient();

  let query = supabase
    .from("collection_submissions")
    .select(COLUMNS)
    .order("submitted_at", { ascending: false })
    .limit(500);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query.returns<SubmissionRow[]>();
  if (error) throw new Error(`Could not read the answers: ${error.message}`);
  if (data.length === 0) return [];

  const studentIds = [...new Set(data.map((row) => row.student_id))];

  // The fields these answers are about, so `heldNow` can follow the same
  // precedence the link did rather than a second, shorter one.
  const askedAbout = new Set(data.map((row) => row.field_id));
  const fields = (await listFieldsPublic()).filter((field) => askedAbout.has(field.id));

  const students = await fetchInChunks<{id:string;full_name:string;roll_no:string|null}>(studentIds,IN_FILTER_CHUNK_SIZE,chunk=>createAdminClient()
    .schema(FEE_SCHEMA).from("students").select("id, full_name, roll_no").in("id",chunk));
  if(students.error)throw new Error("Could not read the review students.");
  const byId = new Map(students.data.map(row=>[row.id,row]));

  // **What the school holds today**, read once for the whole queue.
  //
  // Not to replace `previous_value` — that is what the teacher was shown and
  // re-reading it is the bug freezing exists to remove (D-142). This is the
  // other side of the comparison: the office needs to see that the record has
  // moved *since*, because accepting the answer would quietly revert whoever
  // moved it (S-07).
  const heldNow = await currentlyHeld(studentIds, fields);

  const superseded = supersededIds(
    data.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      fieldId: row.field_id,
      status: row.status,
      submittedAt: row.submitted_at,
    })),
  );

  return data.map((row) => ({
    // Every collection answer is a proposal, including legacy /r requests.
    requiresAdmin: true,
    id: row.id,
    requestId: row.request_id,
    requestTitleHi: row.collection_requests?.title_hi ?? "—",
    requestTitleEn: row.collection_requests?.title_en ?? "—",
    classLabel: row.collection_requests?.class_label ?? "—",
    studentId: row.student_id,
    studentName: byId.get(row.student_id)?.full_name ?? "—",
    rollNo: byId.get(row.student_id)?.roll_no ?? null,
    fieldId: row.field_id,
    fieldKey: row.collection_fields?.key ?? "",
    fieldLabelHi: row.collection_fields?.label_hi ?? "—",
    fieldLabelEn: row.collection_fields?.label_en ?? "—",
    value: row.value,
    previousValue: row.previous_value,
    status: row.status,
    submittedAt: row.submitted_at,
    submittedByName: row.collection_requests?.staff_profiles?.display_name ?? null,
    decidedByName: row.staff_profiles?.display_name ?? null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    roundId: row.collection_requests?.round_id ?? null,
    audienceKind: row.collection_requests?.audience_kind ?? "class",
    audienceLabel:
      row.collection_requests?.audience_label ??
      row.collection_requests?.class_label ??
      "—",
    heldNow: heldNow.get(`${row.student_id}|${row.field_id}`) ?? null,
    isSuperseded: superseded.has(row.id),
  }));
}

/**
 * What the school holds per (student, field) right now.
 *
 * **The same precedence the link itself used** — VPPS One's own accepted
 * answer, then the fee app's column — through the same `heldValue()` the gap
 * filter and the freeze use. Reading only `student_records` made "no record
 * row" indistinguishable from "the value was cleared", so every answer whose
 * shown value came from the fee column looked stale: four flags out of four
 * rows in the dev fixture, which is a flag nobody reads.
 */
async function currentlyHeld(
  studentIds: string[],
  fields: CollectionField[],
): Promise<Map<string, string | null>> {
  const held = new Map<string, string | null>();
  if (studentIds.length === 0 || fields.length === 0) return held;

  const admin = createAdminClient();
  const feeColumns = feeColumnsFor(fields);

  const recorded = new Map<string, string | null>();
  const feeOf = new Map<string, Record<string, string | null>>();

  for (let i = 0; i < studentIds.length; i += 200) {
    const slice = studentIds.slice(i, i + 200);

    const rows = await fetchAllRows<{
      student_id: string;
      field_id: string;
      value: string | null;
    }>(
      (from, to) =>
        admin
          .from("student_records")
          .select("student_id, field_id, value")
          .in("student_id", slice)
          .in("field_id", fields.map((field) => field.id))
          .order("student_id")
          .range(from, to)
          .returns<{ student_id: string; field_id: string; value: string | null }[]>(),
      "what the school holds",
    );

    for (const row of rows) {
      recorded.set(`${row.student_id}|${row.field_id}`, row.value);
    }

    if (feeColumns.length > 0) {
      const { data: feeRows } = await admin
        .schema(FEE_SCHEMA)
        .from("students")
        .select(["id", ...feeColumns].join(", "))
        .in("id", slice)
        .returns<Record<string, string | null>[]>();

      for (const row of feeRows ?? []) feeOf.set(String(row.id), row);
    }
  }

  for (const studentId of studentIds) {
    for (const field of fields) {
      held.set(
        `${studentId}|${field.id}`,
        heldValue({
          recorded: recorded.get(`${studentId}|${field.id}`) ?? null,
          fee: field.feeColumn
            ? (feeOf.get(studentId)?.[field.feeColumn] ?? null)
            : null,
        }),
      );
    }
  }

  return held;
}

export async function submissionsForRequest(
  requestId: string,
): Promise<Submission[]> {
  const all = await listSubmissions("all");
  return all.filter((entry) => entry.requestId === requestId);
}

export async function pendingSubmissionCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("collection_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) throw new Error(`Could not count the answers: ${error.message}`);
  return count ?? 0;
}

/**
 * Which children already hold each phone number.
 *
 * For the neutral "also on N other children" line. **Never a validation** —
 * siblings share a parent's number, and refusing the correct answer teaches a
 * teacher that the screen is wrong about her own class.
 */
export async function phoneOwners(): Promise<Map<string, string[]>> {
  const supabase = await createClient();

  const rows = await fetchAllRows<{ student_id: string; value: string | null }>(
    (from, to) =>
      supabase
        .from("student_records")
        .select("student_id, value, collection_fields!inner(input_type)")
        .eq("collection_fields.input_type", "tel")
        .order("id")
        .range(from, to)
        .returns<{ student_id: string; value: string | null }[]>(),
    "the phone numbers",
  );

  const owners = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.value) continue;
    owners.set(row.value, [...(owners.get(row.value) ?? []), row.student_id]);
  }

  return owners;
}

/* ------------------------------------------------------------ deciding */

export type RefusalReason = "superseded" | "record_moved";

export type DecisionReceipt =
  | {
      ok: true;
      decided: number;
      /** Values that changed the record. */
      recorded: number;
      /** Accepted without changing the record: blank, or the value already held. */
      confirmed: number;
      /** Somebody else decided these first; theirs stands. */
      alreadyDecided: number;
      refused: { submissionId: string; reason: RefusalReason }[];
      replayed: boolean;
    }
  | { ok: false; reason: "not_permitted" | "id_reused" | "bad_request" | "unavailable" };

/**
 * Accept or reject, as one command (P10, D-233).
 *
 * `vppsone.accept_submissions` does all of it in one transaction: re-checks
 * the actor, decides only what is still pending, and writes every accepted
 * value through `write_student_value` — the one writer of `student_records`,
 * which keeps every write in `student_record_history`. **It never writes the
 * fee app** (rule 2).
 *
 * Two cases are refused rather than guessed, and come back by name: an answer
 * with a newer one for the same child and field waiting behind it, and an
 * answer about a value that has moved since the teacher was shown it — the
 * second only until a person who has seen both says `replaceNewer`.
 *
 * The ids travel in the body, not the URL, so a bulk confirmation of four
 * hundred is one call (rule 3b is about `.in()` filters).
 */
export async function decideSubmissions(input: {
  commandId: string;
  submissionIds: string[];
  accept: boolean;
  note: string | null;
  replaceNewer: boolean;
  deciderStaffId: string;
  sessionLabel: string;
}): Promise<DecisionReceipt> {
  const ids = [...new Set(input.submissionIds)].sort();
  const decision = input.accept ? "accept" : "reject";
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ decision, ids, note: input.note ?? "", replace: input.replaceNewer }))
    .digest("hex");

  const { data, error } = await createAdminClient().rpc("accept_submissions", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.deciderStaffId,
      session_label: input.sessionLabel,
      decision,
      submission_ids: ids,
      note: input.note,
      replace_newer: input.replaceNewer,
      payload_hash: payloadHash,
    },
  });
  if (error?.message?.includes("tasks:admin_review_required")) return { ok: false, reason: "not_permitted" };
  if (error || !data) return { ok: false, reason: "unavailable" };

  const receipt = data as {
    ok: boolean;
    reason?: string;
    decided?: number;
    recorded?: number;
    confirmed?: number;
    already_decided?: number;
    refused?: { submission_id: string; reason: RefusalReason }[];
    replayed?: boolean;
  };
  if (!receipt.ok) {
    const reason = receipt.reason;
    return {
      ok: false,
      reason: reason === "not_permitted" || reason === "id_reused" || reason === "bad_request" ? reason : "unavailable",
    };
  }
  return {
    ok: true,
    decided: receipt.decided ?? 0,
    recorded: receipt.recorded ?? 0,
    confirmed: receipt.confirmed ?? 0,
    alreadyDecided: receipt.already_decided ?? 0,
    refused: (receipt.refused ?? []).map((entry) => ({ submissionId: entry.submission_id, reason: entry.reason })),
    replayed: receipt.replayed === true,
  };
}
