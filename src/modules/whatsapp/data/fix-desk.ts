import "server-only";

import { cache } from "react";

import { getFeePolicyForSession } from "@/modules/fees/data/policy";
import type { ProblemCause } from "@/modules/whatsapp/domain/failure-cause";
import {
  causeOfSend,
  fixActionFor,
  FIX_WINDOW_DAYS,
  groupIntoFixFamilies,
  laneOfSend,
  owedOnInstallments,
  reachedLater,
  reasonOfSend,
  systemicGroups,
  type FixAction,
  type FixFamily,
  type FixLane,
  type FixSendRow,
} from "@/modules/whatsapp/domain/fix-desk";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import { phoneKey, pickFamilyNumber } from "@/modules/whatsapp/domain/phone-numbers";
import { addDays } from "@/modules/whatsapp/domain/reminder-cadence";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { fetchAllPages, fetchPagesUpTo } from "@/platform/helpers/chunk";
import { isMissingColumn } from "@/platform/supabase/missing-column";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";

/**
 * Everything the failure desk shows, in one read.
 *
 * Every number on the desk comes from here and nowhere else — the tab's red
 * count, the lane chips, the tiles, the list — so the count on the tab is the
 * number of cards on the screen. `cache()` makes the nav's count and the page
 * share one read per request.
 */

export type FixProblem = {
  sendId: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  studentClass: string;
  parentName: string;
  runId: string | null;
  situation: string | null;
  language: string | null;
  installments: number[];
  lastYear: boolean;
  campaignName: string;
  sentOn: string;
  createdAt: string;
  destination: string;
  destinationRole: string;
  dueAmount: number;
  lane: Exclude<FixLane, "no_number" | "left_out">;
  cause: ProblemCause;
  reason: string | null;
  errorCode: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  fatherPhone: string | null;
  motherPhone: string | null;
  /** Other children the failed message covered. */
  siblingNames: string[];
  coveredStudentIds: string[];
  action: FixAction;
};

/** A family the desk lists without a failed message: no number, or left out. */
export type FixPerson = {
  key: string;
  studentIds: string[];
  names: string[];
  admissionNos: string[];
  studentClass: string;
  parentName: string;
  owed: number;
  fatherPhone: string | null;
  motherPhone: string | null;
  destination: string | null;
  reason?: "none" | "unusable" | "dead";
  deadCause?: string | null;
  lastReachedOn: string | null;
};

export type FixDesk = {
  sessionLabel: string;
  today: string;
  families: Array<FixFamily<FixProblem>>;
  /** Failures that sorted themselves out: reached later, or paid since. */
  sortedItself: Array<{ problem: FixProblem; why: "reached" | "paid" }>;
  noNumber: FixPerson[];
  leftOut: FixPerson[];
  /** The day "left out" counts from: the latest passed installment's due date. */
  leftOutSince: string | null;
  passedInstallments: number[];
  systemic: Array<{ cause: ProblemCause; campaignName: string; sendIds: string[]; reason: string | null }>;
  /** Reminders accepted in the window with no delivery result yet. */
  notChecked: number;
  sentInWindow: number;
  lastReportAt: string | null;
  laneCounts: Record<FixLane, number>;
  causeCounts: Partial<Record<ProblemCause, number>>;
  /** Money the families with an open problem were asked for. */
  owedByFailed: number;
  /** Per number: how often it has failed in a row, for "failed 2×". */
  failuresByKey: Record<string, number>;
  /** Set when the new columns are not there yet — the migration has not run. */
  degraded: boolean;
};

type MatviewRow = {
  student_id: string;
  admission_no: string | null;
  student_name: string | null;
  father_name: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  class_label: string | null;
  sort_order: number | null;
  record_status: string | null;
  total_paid: number | null;
  inst1_pending: number | null;
  inst2_pending: number | null;
  inst3_pending: number | null;
  inst4_pending: number | null;
};

const SEND_COLUMNS =
  "id, student_id, run_id, sent_on, created_at, campaign_name, destination, destination_role, due_amount, status, delivery_status, error_message, last_error, attempts, last_attempt_at, pay_scope";
const NEW_SEND_COLUMNS = "failure_cause, delivery_error, delivery_error_code, resolution";

function titleCase(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    .trim();
}

function scopeIds(payScope: unknown): string[] {
  const ids = (payScope as { studentIds?: unknown } | null)?.studentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
}

/**
 * Keyed on the session label alone, so the tab's count and the page share ONE
 * read per request. Keying on a client object would miss every time: each
 * caller makes its own.
 */
export const loadFixDesk = cache(async function loadFixDesk(sessionLabel: string): Promise<FixDesk> {
  const supabase = createAdminClient();
  const today = istToday();
  const now = new Date();
  const windowStart = addDays(today, -FIX_WINDOW_DAYS);

  const policy = await getFeePolicyForSession(sessionLabel, { useAdmin: true }).catch(() => null);
  const calendar = buildInstallmentCalendar({ schedule: policy?.installmentSchedule ?? [], today });
  const passed = calendar.passed;
  const latestPassed = calendar.timings
    .filter((timing) => passed.includes(timing.installmentNo))
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
  const leftOutSince = latestPassed?.dueDate ?? null;
  const reachedFrom = leftOutSince && leftOutSince < windowStart ? leftOutSince : windowStart;

  // ------------------------------------------------------------- problems
  let degraded = false;
  // Paged and bounded: PostgREST answers a wider `.limit()` with 1,000 rows and
  // no sign it stopped, and a short list of failures looks exactly like a
  // complete one. 2,000 problems in thirty days would be a broken account, not
  // a desk to work through, so the cap is a ceiling rather than a target.
  const problemQuery = (columns: string, withResolution: boolean) =>
    fetchPagesUpTo<Record<string, unknown>>((from, to) => {
      let query = supabase
        .from("whatsapp_reminder_sends")
        .select(columns)
        .eq("session_label", sessionLabel)
        .eq("notice_kind", "reminder")
        .gte("sent_on", windowStart)
        .or("status.eq.failed,status.eq.pending,delivery_status.eq.failed");
      if (withResolution) query = query.is("resolution", null);
      return query
        .order("sent_on", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
    }, 2000);
  let { data: problemData, error: problemError } = await problemQuery(
    `${SEND_COLUMNS}, ${NEW_SEND_COLUMNS}`,
    true,
  );
  const missing = problemError as { code?: string; message?: string } | null;
  if (missing && (isMissingColumn(missing, "failure_cause") || isMissingColumn(missing, "resolution"))) {
    degraded = true;
    ({ data: problemData, error: problemError } = await problemQuery(SEND_COLUMNS, false));
  }
  if (problemError) throw new Error(`Could not read failed reminders: ${errorText(problemError)}`);

  const rawProblems: FixSendRow[] = ((problemData ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    studentId: String(row.student_id),
    runId: (row.run_id as string | null) ?? null,
    sentOn: String(row.sent_on),
    createdAt: String(row.created_at),
    campaignName: String(row.campaign_name ?? ""),
    destination: String(row.destination ?? ""),
    destinationRole: String(row.destination_role ?? "primary"),
    dueAmount: Number(row.due_amount ?? 0),
    status: String(row.status),
    deliveryStatus: (row.delivery_status as string | null) ?? null,
    failureCause: (row.failure_cause as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    deliveryError: (row.delivery_error as string | null) ?? null,
    deliveryErrorCode: (row.delivery_error_code as string | null) ?? null,
    attempts: Number(row.attempts ?? 1),
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
    scopeStudentIds: scopeIds(row.pay_scope),
  }));

  // ------------------------------------------------- everything else, at once
  const runIds = [...new Set(rawProblems.map((row) => row.runId).filter((id): id is string => Boolean(id)))];

  const [matview, reachedRows, runs, noCall, health, lastReport, notChecked, sentInWindow] =
    await Promise.all([
      fetchAllPages<MatviewRow>((from, to) =>
        supabase
          .from("v_workbook_student_financials")
          .select(
            "student_id, admission_no, student_name, father_name, father_phone, mother_phone, class_label, sort_order, record_status, total_paid, inst1_pending, inst2_pending, inst3_pending, inst4_pending",
          )
          .eq("session_label", sessionLabel)
          .order("student_id", { ascending: true })
          .range(from, to),
      ),
      fetchAllPages<{ id: string; student_id: string; sent_on: string; created_at: string }>((from, to) =>
        supabase
          .from("whatsapp_reminder_sends")
          .select("id, student_id, sent_on, created_at")
          .eq("session_label", sessionLabel)
          .eq("notice_kind", "reminder")
          .gte("sent_on", reachedFrom)
          .in("status", ["sent", "covered_by_sibling"])
          .or("delivery_status.is.null,delivery_status.neq.failed")
          .order("id", { ascending: true })
          .range(from, to),
      ),
      runIds.length > 0
        ? supabase
            .from("whatsapp_campaign_runs")
            .select("id, situation, language, last_date, filters")
            .in("id", runIds.slice(0, 300))
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("student_collection_flags")
        .select("student_id")
        .eq("session_label", sessionLabel)
        .eq("no_call", true),
      fetchAllPages<{ phone_key: string; last_cause: string | null; failures_in_a_row: number }>(
        (from, to) =>
          supabase
            .from("whatsapp_number_health")
            .select("phone_key, last_cause, failures_in_a_row")
            .gt("failures_in_a_row", 0)
            .order("phone_key", { ascending: true })
            .range(from, to),
      ),
      supabase
        .from("whatsapp_send_attempts")
        .select("created_at")
        .eq("session_label", sessionLabel)
        .eq("source", "report")
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("whatsapp_reminder_sends")
        .select("id", { count: "exact", head: true })
        .eq("session_label", sessionLabel)
        .eq("notice_kind", "reminder")
        .eq("status", "sent")
        .is("delivery_status", null)
        .gte("sent_on", windowStart),
      supabase
        .from("whatsapp_reminder_sends")
        .select("id", { count: "exact", head: true })
        .eq("session_label", sessionLabel)
        .eq("notice_kind", "reminder")
        .eq("status", "sent")
        .gte("sent_on", windowStart),
    ]);

  if (matview.error) throw new Error(`Could not read student financials: ${errorText(matview.error)}`);

  const students = new Map(matview.data.map((row) => [row.student_id, row]));
  const pendingByStudent = new Map(
    matview.data.map((row) => [
      row.student_id,
      [row.inst1_pending, row.inst2_pending, row.inst3_pending, row.inst4_pending].map((value) =>
        Number(value ?? 0),
      ),
    ]),
  );
  const noCallIds = new Set(
    ((noCall.data ?? []) as Array<{ student_id: string }>).map((row) => row.student_id),
  );

  // Health fails soft: before the migration the table is not there.
  const DEAD = new Set(["not_on_whatsapp", "invalid_number", "opted_out"]);
  const healthRows = (health.error ? [] : (health.data ?? [])) as Array<{
    phone_key: string;
    last_cause: string | null;
    failures_in_a_row: number;
  }>;
  const deadByKey = new Map(
    healthRows.filter((row) => DEAD.has(String(row.last_cause))).map((row) => [row.phone_key, String(row.last_cause)]),
  );
  const failuresByKey = Object.fromEntries(healthRows.map((row) => [row.phone_key, row.failures_in_a_row]));

  const runById = new Map(
    ((runs.data ?? []) as Array<{
      id: string;
      situation: string | null;
      language: string | null;
      last_date: string | null;
      filters: { installments?: unknown; lastYear?: unknown } | null;
    }>).map((run) => [run.id, run]),
  );

  const reached = reachedRows.data.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    sentOn: row.sent_on,
    createdAt: row.created_at,
  }));

  // ------------------------------------------------------- problems, enriched
  const open: FixProblem[] = [];
  const sortedItself: FixDesk["sortedItself"] = [];
  for (const row of rawProblems) {
    const lane = laneOfSend(row, now);
    if (!lane) continue;
    const student = students.get(row.studentId);
    const run = row.runId ? runById.get(row.runId) : undefined;
    const installments = Array.isArray(run?.filters?.installments)
      ? (run!.filters!.installments as unknown[]).map(Number).filter((n) => n >= 1 && n <= 4)
      : [];
    const lastYear = run?.filters?.lastYear === true || run?.situation === "prevyear";
    const covered = row.scopeStudentIds.length > 0 ? row.scopeStudentIds : [row.studentId];
    const picked = pickFamilyNumber(student?.father_phone, student?.mother_phone, (key) =>
      deadByKey.get(key),
    );
    const cause = causeOfSend(row, lane);
    const problem: FixProblem = {
      sendId: row.id,
      studentId: row.studentId,
      admissionNo: String(student?.admission_no ?? ""),
      studentName: titleCase(student?.student_name) || "Student",
      studentClass: String(student?.class_label ?? ""),
      parentName: titleCase(student?.father_name),
      runId: row.runId,
      situation: run?.situation ?? null,
      language: run?.language ?? null,
      installments,
      lastYear,
      campaignName: row.campaignName,
      sentOn: row.sentOn,
      createdAt: row.createdAt,
      destination: row.destination,
      destinationRole: row.destinationRole,
      dueAmount: row.dueAmount,
      lane,
      cause,
      reason: reasonOfSend(row, lane),
      errorCode: row.deliveryErrorCode,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      fatherPhone: student?.father_phone ?? null,
      motherPhone: student?.mother_phone ?? null,
      siblingNames: covered
        .filter((id) => id !== row.studentId)
        .map((id) => titleCase(students.get(id)?.student_name))
        .filter(Boolean),
      coveredStudentIds: covered,
      action: fixActionFor({
        cause,
        failedDestination: row.destination,
        nextDestination: picked.destination,
        nextParent: picked.parent,
        sentOn: row.sentOn,
        today,
      }),
    };

    if (reachedLater(row, reached)) {
      sortedItself.push({ problem, why: "reached" });
      continue;
    }
    // Paid since: only when we know what the message asked for. A message on
    // last session's balance is never auto-cleared here — that balance is not
    // in the installment columns.
    if (
      installments.length > 0 &&
      !lastYear &&
      owedOnInstallments(pendingByStudent, covered, installments) <= 0
    ) {
      sortedItself.push({ problem, why: "paid" });
      continue;
    }
    open.push(problem);
  }

  const families = groupIntoFixFamilies(open);
  const openStudentIds = new Set(open.flatMap((problem) => problem.coveredStudentIds));

  // ------------------------------------------- no number, and left out
  const lastReachedOn = new Map<string, string>();
  for (const row of reached) {
    const existing = lastReachedOn.get(row.studentId);
    if (!existing || row.sentOn > existing) lastReachedOn.set(row.studentId, row.sentOn);
  }

  const noNumberByStudent: FixPerson[] = [];
  const leftOutByKey = new Map<string, FixPerson>();
  for (const row of matview.data) {
    const collectable = row.record_status === "active" || Number(row.total_paid ?? 0) > 0;
    if (!collectable || noCallIds.has(row.student_id) || openStudentIds.has(row.student_id)) continue;
    const owed = passed.reduce(
      (total, installment) => total + Number(pendingByStudent.get(row.student_id)?.[installment - 1] ?? 0),
      0,
    );
    if (owed <= 0) continue;

    const picked = pickFamilyNumber(row.father_phone, row.mother_phone, (key) => deadByKey.get(key));
    const base = {
      studentIds: [row.student_id],
      names: [titleCase(row.student_name)],
      admissionNos: [String(row.admission_no ?? "")],
      studentClass: String(row.class_label ?? ""),
      parentName: titleCase(row.father_name),
      owed,
      fatherPhone: row.father_phone,
      motherPhone: row.mother_phone,
      lastReachedOn: lastReachedOn.get(row.student_id) ?? null,
    };

    if (!picked.destination) {
      const none = !row.father_phone?.trim() && !row.mother_phone?.trim();
      noNumberByStudent.push({
        ...base,
        key: `student:${row.student_id}`,
        destination: null,
        reason: none ? "none" : picked.fatherUsable || picked.motherUsable ? "dead" : "unusable",
        deadCause: picked.fatherDead ?? picked.motherDead ?? null,
      });
      continue;
    }

    const last = lastReachedOn.get(row.student_id);
    if (leftOutSince && (!last || last < leftOutSince)) {
      const key = phoneKey(picked.destination) ?? `student:${row.student_id}`;
      const existing = leftOutByKey.get(key);
      if (existing) {
        existing.studentIds.push(row.student_id);
        existing.names.push(titleCase(row.student_name));
        existing.admissionNos.push(String(row.admission_no ?? ""));
        existing.owed += owed;
      } else {
        leftOutByKey.set(key, { ...base, key, destination: picked.destination });
      }
    }
  }
  const noNumber = noNumberByStudent.sort((a, b) => b.owed - a.owed);
  const leftOut = [...leftOutByKey.values()].sort((a, b) => b.owed - a.owed);

  // ------------------------------------------------------------- summaries
  const laneCounts: Record<FixLane, number> = {
    refused: 0,
    not_delivered: 0,
    stuck: 0,
    no_number: noNumber.length,
    left_out: leftOut.length,
  };
  const causeCounts: Partial<Record<ProblemCause, number>> = {};
  for (const family of families) {
    laneCounts[family.latest.lane] += 1;
    causeCounts[family.latest.cause] = (causeCounts[family.latest.cause] ?? 0) + 1;
  }
  if (noNumber.length > 0) causeCounts.no_number = noNumber.length;

  const systemic = systemicGroups(
    families.map((family) => ({
      cause: family.latest.cause,
      campaignName: family.latest.campaignName,
      sendId: family.latest.sendId,
      reason: family.latest.reason,
    })),
  ).map((group) => ({
    cause: group.cause,
    campaignName: group.campaignName,
    sendIds: group.sendIds,
    reason: group.sample.reason,
  }));

  return {
    sessionLabel,
    today,
    families,
    sortedItself,
    noNumber,
    leftOut,
    leftOutSince,
    passedInstallments: passed,
    systemic,
    notChecked: Number(notChecked.count ?? 0),
    sentInWindow: Number(sentInWindow.count ?? 0),
    lastReportAt: lastReport.error
      ? null
      : (((lastReport.data ?? []) as Array<{ created_at: string }>)[0]?.created_at ?? null),
    laneCounts,
    causeCounts,
    owedByFailed: families.reduce((total, family) => total + family.latest.dueAmount, 0),
    failuresByKey,
    degraded,
  };
});

/** The tab's red count: families with a failed reminder that is still open. */
export async function countFixFamilies(sessionLabel: string): Promise<number> {
  try {
    return (await loadFixDesk(sessionLabel)).families.length;
  } catch {
    return 0;
  }
}

export type FixTimelineEntry = {
  at: string;
  kind: "attempt" | "payment";
  result: string;
  destination: string | null;
  text: string | null;
  cause: string | null;
};

/**
 * One family's story: every attempt, every delivery result, every person's
 * note, and the payments in between — so a collector can see at a glance
 * whether the family was never reached or was reached and did not pay.
 */
export async function loadFixTimeline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  args: { sendIds: string[]; studentIds: string[]; since: string },
): Promise<FixTimelineEntry[]> {
  if (args.sendIds.length === 0) return [];
  const [attempts, receipts] = await Promise.all([
    supabase
      .from("whatsapp_send_attempts")
      .select("created_at, result, destination, error_text, error_code, cause, note")
      .in("send_id", args.sendIds.slice(0, 50))
      .order("created_at", { ascending: true }),
    supabase
      .from("receipts")
      .select("payment_date, total_amount, payment_mode, created_at")
      .in("student_id", args.studentIds.slice(0, 20))
      .gte("payment_date", args.since)
      .neq("payment_mode", "discount")
      .order("payment_date", { ascending: true }),
  ]);

  const entries: FixTimelineEntry[] = [];
  for (const row of (attempts.error ? [] : attempts.data ?? []) as Array<Record<string, unknown>>) {
    const code = row.error_code ? ` (${String(row.error_code)})` : "";
    entries.push({
      at: String(row.created_at),
      kind: "attempt",
      result: String(row.result),
      destination: (row.destination as string | null) ?? null,
      text: row.note ? String(row.note) : row.error_text ? `${String(row.error_text)}${code}` : null,
      cause: (row.cause as string | null) ?? null,
    });
  }
  for (const row of (receipts.error ? [] : receipts.data ?? []) as Array<Record<string, unknown>>) {
    entries.push({
      at: String(row.created_at ?? `${String(row.payment_date)}T12:00:00Z`),
      kind: "payment",
      result: "paid",
      destination: null,
      text: `${Number(row.total_amount ?? 0)}`,
      cause: null,
    });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

export type StudentWhatsappEvent = {
  at: string;
  result: string;
  destination: string | null;
  text: string | null;
  cause: string | null;
  campaignName: string | null;
};

/**
 * A student's reminder history, newest first: what was sent, what AiSensy and
 * WhatsApp said, and what staff recorded. Empty, never an error, before the
 * attempts table exists.
 */
export async function loadStudentWhatsappHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  studentId: string,
  limit = 8,
): Promise<StudentWhatsappEvent[]> {
  try {
    const { data, error } = await supabase
      .from("whatsapp_send_attempts")
      .select("created_at, result, destination, error_text, error_code, cause, note, whatsapp_reminder_sends(campaign_name)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const send = row.whatsapp_reminder_sends as { campaign_name?: string | null } | null;
      const code = row.error_code ? ` (${String(row.error_code)})` : "";
      return {
        at: String(row.created_at),
        result: String(row.result),
        destination: (row.destination as string | null) ?? null,
        text: row.note ? String(row.note) : row.error_text ? `${String(row.error_text)}${code}` : null,
        cause: (row.cause as string | null) ?? null,
        campaignName: send?.campaign_name ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** Plain words for a timeline line's result. */
export function describeAttemptResult(result: string): string {
  switch (result) {
    case "accepted":
      return "Sent · AiSensy accepted";
    case "refused":
      return "Refused by AiSensy";
    case "submitted":
      return "Report: submitted";
    case "delivered":
      return "Report: delivered";
    case "read":
      return "Report: read";
    case "failed":
      return "Report: not delivered";
    case "resolved":
      return "Marked by staff";
    case "paid":
      return "Payment received";
    default:
      return result;
  }
}
