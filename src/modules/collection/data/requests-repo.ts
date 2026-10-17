import "server-only";

import { randomBytes } from "node:crypto";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { taskSchemaMissing } from "@/modules/teacher-tasks/data/schema";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { toField } from "@/modules/collection/data/fields-repo";
import type { CollectionField } from "@/modules/collection/domain/fields";
import {
  checkRequestAccess,
  type CollectionRequest,
  type RequestInput,
  type RequestStatus,
  type RollRow,
} from "@/modules/collection/domain/requests";

/**
 * ===========================================================================
 * THE ONE PLACE THE PUBLIC LINKS ARE AUTHORIZED.
 * ===========================================================================
 *
 * Ported from `sampark/src/lib/auth/token.ts`, whose own header says a bug in
 * it is the expensive kind. Same here.
 *
 * A token resolves to exactly one request: one class, one field set, one roll.
 * There is no navigation past it, no way to reach another request, and nothing
 * on the page that takes an id from the caller. Every read below is scoped by
 * the request the token resolved to, and never by anything the visitor sent.
 *
 * These functions use the service-role client because there is no session:
 * the pages they serve are open by design. The token is the authorization, the
 * rate limiter makes guessing cost something, and the rejection is always the
 * same 404 — telling a stranger "that link exists but is closed" is telling
 * them their guess was right.
 */

/** 12 random bytes → 16 url-safe characters → ~96 bits. */
export function generateToken(): string {
  return randomBytes(12).toString("base64url");
}

type RequestRow = {
  id: string;
  session_label: string;
  title_hi: string | null;
  title_en: string | null;
  class_id: string;
  class_label: string;
  assigned_staff_id: string | null;
  token: string;
  due_date: string | null;
  status: RequestStatus;
  reason_hi: string | null;
  reason_en: string | null;
  opened_at: string | null;
  closed_at: string | null;
  staff_profiles: { display_name: string; preferred_language: string | null } | null;
};

const REQUEST_COLUMNS =
  "id, session_label, title_hi, title_en, class_id, class_label, assigned_staff_id, " +
  "token, due_date, status, reason_hi, reason_en, opened_at, closed_at, " +
  // **Named, because a request points at `staff_profiles` three times** —
  // assigned_staff_id, sent_by and reminded_by. An unnamed embed was
  // unambiguous until the third column arrived, and then failed the whole
  // select rather than the join (D-101).
  "staff_profiles!collection_requests_assigned_staff_id_fkey(display_name, preferred_language)";

const toRequest = (
  row: RequestRow,
  fields: CollectionField[],
): CollectionRequest => ({
  id: row.id,
  sessionLabel: row.session_label,
  titleHi: row.title_hi,
  titleEn: row.title_en,
  classId: row.class_id,
  classLabel: row.class_label,
  assignedStaffId: row.assigned_staff_id,
  assignedStaffName: row.staff_profiles?.display_name ?? null,
  // The link opens in the language of the teacher it was made for. She has no
  // session to read a preference from, so it travels with the request — rule 9
  // does not stop applying because somebody is not signed in.
  language: resolveLanguage(row.staff_profiles?.preferred_language),
  token: row.token,
  dueDate: row.due_date,
  status: row.status,
  reasonHi: row.reason_hi,
  reasonEn: row.reason_en,
  openedAt: row.opened_at,
  closedAt: row.closed_at,
  fields,
});

type RequestFieldRow = {
  sort_order: number;
  collection_fields: Parameters<typeof toField>[0];
};

const FIELD_JOIN =
  "sort_order, collection_fields!inner(id, key, label_hi, label_en, input_type, mode, " +
  "exact_len, pattern, max_value, options, fee_column, help_hi, help_en, is_active, sort_order)";

async function fieldsForRequest(
  admin: ReturnType<typeof createAdminClient>,
  requestId: string,
): Promise<CollectionField[]> {
  const { data, error } = await admin
    .from("collection_request_fields")
    .select(FIELD_JOIN)
    .eq("request_id", requestId)
    .order("sort_order")
    .returns<RequestFieldRow[]>();

  if (error) throw new Error(`Could not read the request: ${error.message}`);
  return data.map((row) => toField(row.collection_fields));
}

/**
 * Resolve a token to the one request it names, or null.
 *
 * Null for every rejection — unknown, draft, closed — because the page renders
 * the same 404 for all of them and a caller that could tell them apart would
 * eventually leak the difference.
 */
export async function resolveToken(token: string): Promise<CollectionRequest | null> {
  // A token is url-safe base64. Anything else is not a token this app minted,
  // and checking the shape first means a junk string costs no database read.
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("collection_requests")
    .select(REQUEST_COLUMNS)
    .eq("token", token)
    .maybeSingle<RequestRow>();

  if (error || !data) return null;
  if (!checkRequestAccess({ status: data.status }).ok) return null;
  if (!(await currentRequestAuthority(data))) return null;

  return toRequest(data, await fieldsForRequest(admin, data.id));
}

/** The shared task, when present, controls both old /r and new task entry paths. */
async function currentRequestAuthority(row: RequestRow): Promise<boolean> {
  const db = createAdminClient();
  if (row.assigned_staff_id) {
    const staff = await db.from("staff_profiles").select("id").eq("id", row.assigned_staff_id).eq("is_active", true).maybeSingle();
    if (staff.error || !staff.data) return false;
  }
  const task = await db.from("teacher_tasks").select("id").eq("request_id", row.id).maybeSingle<{id:string}>();
  if (task.error) return taskSchemaMissing(task.error);
  if (!task.data) return true;
  const access = await db.rpc("teacher_task_access", { p_id: task.data.id, p_staff: row.assigned_staff_id, p_token: null });
  return !access.error && access.data === true;
}

export async function resolveAssignedRequest(id: string, staffId: string): Promise<CollectionRequest | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("collection_requests").select(REQUEST_COLUMNS).eq("id", id).eq("assigned_staff_id", staffId).eq("status", "open").is("archived_at", null).maybeSingle<RequestRow>();
  if (error || !data || !(await currentRequestAuthority(data))) return null;
  return toRequest(data, await fieldsForRequest(db, data.id));
}

/**
 * Every open request assigned to one member of staff.
 *
 * The `/t/` page: a menu of her own work and nothing else. Each entry has been
 * through the same status check a `/r/` link goes through, and the list is
 * scoped by the staff id the *token's own request* named — never by an id from
 * the URL.
 */
export async function resolveStaffToken(token: string): Promise<{
  staffProfileId: string;
  staffName: string;
  requests: CollectionRequest[];
} | null> {
  const anchor = await resolveToken(token);
  if (!anchor || !anchor.assignedStaffId) return null;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("collection_requests")
    .select(REQUEST_COLUMNS)
    .eq("assigned_staff_id", anchor.assignedStaffId)
    .eq("status", "open")
    .order("due_date", { nullsFirst: false })
    .returns<RequestRow[]>();

  if (error || !data) return null;

  const requests: CollectionRequest[] = [];
  for (const row of data) {
    if (!(await currentRequestAuthority(row))) continue;
    requests.push(toRequest(row, await fieldsForRequest(admin, row.id)));
  }

  return {
    staffProfileId: anchor.assignedStaffId,
    staffName: anchor.assignedStaffName ?? "",
    requests,
  };
}

/* ----------------------------------------------------------- the roll */

/**
 * The children this link asks about, with what the school already held **when
 * the link went out**.
 *
 * **The membership is frozen (S-02, B-07).** It used to be re-read from
 * `enrolments` on every open, so moving a child between classes after a link
 * was sent changed who the teacher was being asked about — and the prefilled
 * values were re-read too, so an office correction changed what "old value"
 * meant on the review screen. A request is a question that was asked at a
 * moment; `collection_request_members` is that moment.
 *
 * A request with no frozen members is one created before this existed. It
 * falls back to deriving the roll, because the alternative is an old link
 * rendering as an empty class — and reading nothing is a worse answer than
 * reading a rebuilt one. New rounds always freeze.
 */
export async function rollForRequest(
  request: CollectionRequest,
): Promise<RollRow[]> {
  const admin = createAdminClient();

  const members = await fetchAllRows<{student_id:string;roll_no:string|null;snapshot:Record<string,string|null>|null;ask_note:string|null}>((from,to)=>admin
    .from("collection_request_members").select("student_id, roll_no, snapshot, ask_note")
    .eq("request_id",request.id).order("student_id").range(from,to),"request members");

  const isFrozen = members.length > 0;

  let enrolments: { student_id: string; roll_no: string | null }[];

  if (isFrozen) {
    enrolments = members.map((row) => ({
      student_id: row.student_id,
      roll_no: row.roll_no,
    }));
  } else {
    // A legacy request, from before rounds existed. Its class is still set —
    // `collection_requests_class_kind_has_a_class` guarantees that for a class
    // request, and every request made before this migration was one.
    const { data, error } = await admin
      .from("enrolments")
      .select("student_id, roll_no")
      .eq("class_id", request.classId ?? "")
      .eq("session_label", request.sessionLabel)
      .eq("status", "enrolled")
      .returns<{ student_id: string; roll_no: string | null }[]>();

    if (error) throw new Error(`Could not read the roll: ${error.message}`);
    enrolments = data;
  }

  if (enrolments.length === 0) return [];

  const snapshots = new Map(
    members.map((row) => [row.student_id, row.snapshot ?? {}]),
  );
  const notes = new Map(members.map((row) => [row.student_id, row.ask_note]));

  const studentIds = enrolments.map((row) => row.student_id);
  const feeColumns = [
    ...new Set(
      request.fields
        .map((field) => field.feeColumn)
        .filter((column): column is string => Boolean(column)),
    ),
  ];

  const [students, records, answers] = await Promise.all([
    fetchInChunks<Record<string, string | null>>(studentIds, IN_FILTER_CHUNK_SIZE, chunk => admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select(["id", "full_name", "father_name", ...feeColumns].join(", "))
      .in("id", chunk)
      .returns<Record<string, string | null>[]>()),
    fetchInChunks<{ student_id: string; field_id: string; value: string | null }>(studentIds, IN_FILTER_CHUNK_SIZE, async chunk => ({ data: await fetchAllRows<{ student_id: string; field_id: string; value: string | null }>((from, to) => admin
      .from("student_records")
      .select("student_id, field_id, value")
      .in("student_id", chunk).order("student_id").order("field_id").range(from,to), "student records"), error: null })),
    fetchAllRows<{ student_id: string; field_id: string; value: string | null }>((from,to) => admin
      .from("collection_submissions")
      .select("student_id, field_id, value")
      .eq("request_id", request.id).order("id").range(from,to), "answers"),
  ]);
  if (students.error || records.error) throw new Error("Could not read the request records.");

  const byStudent = new Map(
    (students.data ?? []).map((row) => [String(row.id), row]),
  );

  const recorded = new Map<string, string | null>();
  for (const row of records.data ?? []) {
    recorded.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  const answered = new Map<string, string | null>();
  for (const row of answers) {
    answered.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  return enrolments
    .map((enrolment) => {
      const student = byStudent.get(enrolment.student_id);
      const current: Record<string, string | null> = {};
      const already: Record<string, string | null> = {};

      const snapshot = snapshots.get(enrolment.student_id);

      for (const field of request.fields) {
        if (isFrozen) {
          // **What she was shown, not what is true now.** Re-deriving here is
          // exactly the bug: the teacher confirms a number, the office edits
          // the record, and the review queue compares her answer against a
          // value she never saw.
          current[field.key] = snapshot?.[field.key] ?? null;
        } else {
          // VPPS One's own accepted answer wins over the fee app's column: it
          // is the later, human one. Where there is none, the fee app is what
          // the school holds.
          const own = recorded.get(`${enrolment.student_id}|${field.id}`);
          const fee = field.feeColumn ? (student?.[field.feeColumn] ?? null) : null;
          current[field.key] = own ?? fee ?? null;
        }

        const key = `${enrolment.student_id}|${field.id}`;
        if (answered.has(key)) already[field.key] = answered.get(key) ?? null;
      }

      return {
        studentId: enrolment.student_id,
        rollNo: enrolment.roll_no,
        // A child on the roll whose fee record has gone still appears, with a
        // placeholder: dropping them would silently shrink the register.
        fullName: student?.full_name ?? "—",
        fatherName: student?.father_name ?? null,
        current,
        answered: already,
        // One line about this child on this link, from the office's own ask
        // list. Null for every ordinary round, which is almost all of them.
        askNote: notes.get(enrolment.student_id) ?? null,
      };
    })
    .sort((a, b) => {
      const aRoll = Number((a.rollNo ?? "").replace(/\D/g, "")) || Number.MAX_SAFE_INTEGER;
      const bRoll = Number((b.rollNo ?? "").replace(/\D/g, "")) || Number.MAX_SAFE_INTEGER;
      if (aRoll !== bRoll) return aRoll - bRoll;
      return a.fullName.localeCompare(b.fullName, "en");
    });
}

/* -------------------------------------------------------- the office */

/*
 * The office's two reads go through the service role, after the permission.
 *
 * A request's `token` is the whole authorization for its link, and before P1
 * any signed-in account could read every one of them straight from PostgREST.
 * The column is no longer readable directly; the office still needs it — to
 * copy a link — so these two read it themselves, for `collection:view` only.
 */

export async function listRequests(
  sessionLabel: string,
): Promise<CollectionRequest[]> {
  await assertPermission("collection:view");
  const { data, error } = await createAdminClient()
    .from("collection_requests")
    .select(REQUEST_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<RequestRow[]>();

  if (error) throw new Error(`Could not read the requests: ${error.message}`);

  const admin = createAdminClient();
  const out: CollectionRequest[] = [];
  for (const row of data) {
    out.push(toRequest(row, await fieldsForRequest(admin, row.id)));
  }
  return out;
}

export async function getRequest(id: string): Promise<CollectionRequest | null> {
  await assertPermission("collection:view");
  const { data, error } = await createAdminClient()
    .from("collection_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", id)
    .maybeSingle<RequestRow>();

  if (error) throw new Error(`Could not read that request: ${error.message}`);
  if (!data) return null;

  return toRequest(data, await fieldsForRequest(createAdminClient(), data.id));
}

export async function createRequest(
  input: RequestInput,
  classLabel: string,
  sessionLabel: string,
  createdByUserId: string,
): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("collection_requests")
    .insert({
      session_label: sessionLabel,
      title_hi: input.titleHi,
      title_en: input.titleEn,
      class_id: input.classId,
      class_label: classLabel,
      // Every request made through this form is one class. A round with any
      // other audience is created by `createRound`, which sets these itself.
      audience_kind: "class",
      audience_label: classLabel,
      assigned_staff_id: input.assignedStaffId,
      token: generateToken(),
      due_date: input.dueDate,
      reason_hi: input.reasonHi,
      reason_en: input.reasonEn,
      status: "draft",
      created_by: createdByUserId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw error;

  const { error: fieldError } = await admin
    .from("collection_request_fields")
    .insert(
      input.fieldIds.map((fieldId, index) => ({
        request_id: data.id,
        field_id: fieldId,
        sort_order: index,
      })),
    );

  if (fieldError) throw fieldError;

  await freezeMembers(data.id, input.classId, sessionLabel);

  return data.id;
}

/**
 * Write down who is being asked, and what we hold about them, right now.
 *
 * **This is the whole of S-02.** Doing it at creation rather than at open is
 * the difference between "the question we asked" and "the question we would
 * ask today": a child who moves class next week was still on this link, and a
 * number the office corrects tomorrow is still the number the teacher was
 * shown.
 *
 * Called after the fields are attached, because the snapshot is per field —
 * freezing first would record a roster with nothing in it.
 *
 * Upsert, not insert: a fan-out that failed halfway is finished by running
 * this again, and a member that is already frozen keeps the values it was
 * frozen with rather than being refreshed to today's.
 *
 * Two ways in — a class, or an explicit list — and both resolve through
 * `enrolments` with `status = 'enrolled'`. The fields come from the request
 * itself rather than from a parameter, so there is one answer to "what was
 * asked for" and it is the one the link will render.
 */
export async function freezeMembers(
  requestId: string,
  classId: string | null,
  sessionLabel: string,
  studentIds?: readonly string[],
): Promise<number> {
  const admin = createAdminClient();

  let roll: { student_id: string; roll_no: string | null }[];

  if (studentIds && studentIds.length > 0) {
    // **`enrolled` still applies to a hand-picked list.** A list is where the
    // stalest ids in the app come from — a spreadsheet typed last term, an
    // audience frozen before a transfer — and a child who has left is not
    // somebody to ask a teacher about, whatever that list says. Without this
    // the two branches disagree about who counts, which is the kind of
    // difference that only shows up as one teacher being asked about a child
    // who is no longer hers.
    const { data, error } = await admin
      .from("enrolments")
      .select("student_id, roll_no")
      .eq("session_label", sessionLabel)
      .eq("status", "enrolled")
      .in("student_id", [...studentIds])
      .returns<{ student_id: string; roll_no: string | null }[]>();

    if (error) throw new Error(`Could not read the roll: ${error.message}`);
    roll = data;
  } else {
    if (!classId) return 0;

    const { data, error } = await admin
      .from("enrolments")
      .select("student_id, roll_no")
      .eq("class_id", classId)
      .eq("session_label", sessionLabel)
      .eq("status", "enrolled")
      .returns<{ student_id: string; roll_no: string | null }[]>();

    if (error) throw new Error(`Could not read the roll: ${error.message}`);
    roll = data;
  }

  if (roll.length === 0) return 0;

  const fields = await fieldsForRequest(admin, requestId);
  const ids = roll.map((row) => row.student_id);
  const feeColumns = [
    ...new Set(
      fields.map((field) => field.feeColumn).filter((c): c is string => Boolean(c)),
    ),
  ];

  const [students, records] = await Promise.all([
    admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select(["id", ...feeColumns].join(", "))
      .in("id", ids)
      .returns<Record<string, string | null>[]>(),
    admin
      .from("student_records")
      .select("student_id, field_id, value")
      .in("student_id", ids)
      .returns<{ student_id: string; field_id: string; value: string | null }[]>(),
  ]);

  const byStudent = new Map((students.data ?? []).map((row) => [String(row.id), row]));
  const recorded = new Map<string, string | null>();
  for (const row of records.data ?? []) {
    recorded.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  const rows = roll.map((entry) => {
    const snapshot: Record<string, string | null> = {};

    for (const field of fields) {
      // VPPS One's own accepted answer wins over the fee app's column: it is
      // the later, human one. This is the same precedence the form used to
      // apply at render — it just happens once, now, and is kept.
      const own = recorded.get(`${entry.student_id}|${field.id}`);
      const fee = field.feeColumn
        ? (byStudent.get(entry.student_id)?.[field.feeColumn] ?? null)
        : null;
      snapshot[field.key] = own ?? fee ?? null;
    }

    return {
      request_id: requestId,
      student_id: entry.student_id,
      roll_no: entry.roll_no,
      snapshot,
    };
  });

  const { error } = await admin
    .from("collection_request_members")
    .upsert(rows, { onConflict: "request_id,student_id", ignoreDuplicates: true });

  if (error) throw new Error(`Could not record who was asked: ${error.message}`);

  return rows.length;
}

/** Who this link was issued to, frozen. Empty for a pre-rounds request. */
export async function frozenMembers(requestId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("collection_request_members")
    .select("student_id", { count: "exact", head: true })
    .eq("request_id", requestId);

  if (error) throw new Error(`Could not count who was asked: ${error.message}`);
  return count ?? 0;
}

export async function setRequestStatus(
  id: string,
  status: RequestStatus,
): Promise<void> {
  const now = new Date().toISOString();

  const { error } = await createAdminClient()
    .from("collection_requests")
    .update({
      status,
      opened_at: status === "open" ? now : null,
      closed_at: status === "closed" ? now : null,
    })
    .eq("id", id);

  if (error) throw error;
}

/**
 * Mint a new token for a link that has got out.
 *
 * The old one stops working the moment this returns, which is the only thing
 * that makes a leaked link recoverable — closing the request would also stop
 * the teacher who is halfway through it.
 */
export async function rotateToken(id: string): Promise<string> {
  const token = generateToken();

  const { error } = await createAdminClient()
    .from("collection_requests")
    .update({ token })
    .eq("id", id);

  if (error) throw error;
  return token;
}
