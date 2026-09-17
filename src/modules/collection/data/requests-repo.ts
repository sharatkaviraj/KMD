import "server-only";

import { randomBytes } from "node:crypto";

import { FEE_SCHEMA } from "@/platform/env";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
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
  title_hi: string;
  title_en: string;
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
  "staff_profiles(display_name, preferred_language)";

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

  return toRequest(data, await fieldsForRequest(admin, data.id));
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
 * The children this link asks about, with what the school already holds.
 *
 * Two sources, joined here: the enrolment record says who is in the class,
 * the fee app says what their names are, and `student_records` says what VPPS
 * One has already accepted. Where a field names a `fee_column`, the fee app's
 * own value is what the teacher is asked to confirm — that is the whole point
 * of the comparison.
 */
export async function rollForRequest(
  request: CollectionRequest,
): Promise<RollRow[]> {
  const admin = createAdminClient();

  const { data: enrolments, error } = await admin
    .from("enrolments")
    .select("student_id, roll_no")
    .eq("class_id", request.classId)
    .eq("session_label", request.sessionLabel)
    .eq("status", "enrolled")
    .returns<{ student_id: string; roll_no: string | null }[]>();

  if (error) throw new Error(`Could not read the roll: ${error.message}`);
  if (enrolments.length === 0) return [];

  const studentIds = enrolments.map((row) => row.student_id);
  const feeColumns = [
    ...new Set(
      request.fields
        .map((field) => field.feeColumn)
        .filter((column): column is string => Boolean(column)),
    ),
  ];

  const [students, records, answers] = await Promise.all([
    admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select(["id", "full_name", "father_name", ...feeColumns].join(", "))
      .in("id", studentIds)
      .returns<Record<string, string | null>[]>(),
    admin
      .from("student_records")
      .select("student_id, field_id, value")
      .in("student_id", studentIds)
      .returns<{ student_id: string; field_id: string; value: string | null }[]>(),
    admin
      .from("collection_submissions")
      .select("student_id, field_id, value")
      .eq("request_id", request.id)
      .returns<{ student_id: string; field_id: string; value: string | null }[]>(),
  ]);

  const byStudent = new Map(
    (students.data ?? []).map((row) => [String(row.id), row]),
  );

  const recorded = new Map<string, string | null>();
  for (const row of records.data ?? []) {
    recorded.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  const answered = new Map<string, string | null>();
  for (const row of answers.data ?? []) {
    answered.set(`${row.student_id}|${row.field_id}`, row.value);
  }

  return enrolments
    .map((enrolment) => {
      const student = byStudent.get(enrolment.student_id);
      const current: Record<string, string | null> = {};
      const already: Record<string, string | null> = {};

      for (const field of request.fields) {
        // VPPS One's own accepted answer wins over the fee app's column: it is
        // the later, human one. Where there is none, the fee app is what the
        // school holds.
        const own = recorded.get(`${enrolment.student_id}|${field.id}`);
        const fee = field.feeColumn ? (student?.[field.feeColumn] ?? null) : null;
        current[field.key] = own ?? fee ?? null;

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

export async function listRequests(
  sessionLabel: string,
): Promise<CollectionRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
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
  const supabase = await createClient();
  const { data, error } = await supabase
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
  return data.id;
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
