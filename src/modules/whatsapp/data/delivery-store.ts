import "server-only";

import {
  matchDeliveryReport,
  parseDeliveryReport,
  phoneDigits,
  type DeliveryStatus,
  type DeliveryUpdate,
  type SendRowForMatching,
} from "@/modules/whatsapp/domain/delivery-report";
import { classifyFailure } from "@/modules/whatsapp/domain/failure-cause";
import { fetchAllPages } from "@/platform/helpers/chunk";
import { isMissingColumn } from "@/platform/supabase/missing-column";

/**
 * Writing delivery results, retrying failures, and unsticking pending rows.
 *
 * All three are admin actions on one run, and all three share the rule that a
 * send row is EVIDENCE a parent was messaged: nothing here inserts a second row
 * or deletes an existing one. A retry updates in place and bumps `attempts`; a
 * reconciliation writes a status and an `audit_logs` entry saying who decided it.
 */

export type DeliveryImportSummary = {
  matched: number;
  unmatched: number;
  unchanged: number;
  skipped: number;
  /** Of `matched`, how many were failures — the number the office came for. */
  failed: number;
  delivered: number;
  error: string | null;
};

/**
 * Write one delivery result onto one send row.
 *
 * The ONE write the report import and the webhook share, so a failure learned
 * from either carries the same cause, reason and code. The attempt history and
 * the number's health are written by the database trigger on this update
 * (`20261030190000`), which is why nothing here inserts them.
 *
 * Falls back to the pre-migration columns when the new ones are missing, so a
 * deploy that lands before the migration still records the status.
 */
export async function applyDeliveryResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  update: DeliveryUpdate,
): Promise<void> {
  const now = new Date().toISOString();
  const base = {
    delivery_status: update.status,
    // `delivered_at` and `read_at` are set only by the status that earns
    // them, so a later "read" does not overwrite the delivery time.
    ...(update.status === "delivered" ? { delivered_at: update.at ?? now } : {}),
    ...(update.status === "read" ? { read_at: update.at ?? now } : {}),
    updated_at: now,
  };
  const withCause =
    update.status === "failed"
      ? {
          ...base,
          delivery_error: update.reason ?? null,
          delivery_error_code: update.errorCode ?? null,
          failure_cause: classifyFailure({ text: update.reason, code: update.errorCode }),
        }
      : base;

  const { error } = await supabase
    .from("whatsapp_reminder_sends")
    .update(withCause)
    .eq("id", update.id);

  if (error && (isMissingColumn(error, "failure_cause") || isMissingColumn(error, "delivery_error"))) {
    await supabase.from("whatsapp_reminder_sends").update(base).eq("id", update.id);
  }
}

type SendForImport = {
  id: string;
  provider_message_id: string | null;
  destination: string | null;
  sent_on: string;
  status: string;
  delivery_status: string | null;
};

/** The report's earliest and latest day, padded, for the session-wide read. */
function reportWindow(rows: ReadonlyArray<{ at: string | null }>): { from: string; to: string } {
  const days = rows
    .map((row) => row.at?.slice(0, 10))
    .filter((day): day is string => Boolean(day))
    .sort();
  const pad = (iso: string, by: number) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + by);
    return date.toISOString().slice(0, 10);
  };
  if (days.length === 0) {
    // No dates in the file: the last two months, which covers any campaign
    // report the office could have downloaded this term.
    const today = new Date().toISOString().slice(0, 10);
    return { from: pad(today, -62), to: pad(today, 1) };
  }
  return { from: pad(days[0]!, -2), to: pad(days[days.length - 1]!, 2) };
}

/**
 * Import an AiSensy campaign report.
 *
 * Two scopes:
 *
 * - **One run** (`runId`), from that run's page, as before.
 * - **The whole session** (`sessionLabel`), from the failure desk. One AiSensy
 *   campaign report covers every run that used that template, so per-run
 *   meant uploading the same file on every run's page. The session-wide read is
 *   bounded by the report's own dates, and the phone fallback still only fires
 *   for a report row with no id and exactly one same-day match — so a phone
 *   number recurring across months cannot rewrite history.
 */
export async function importDeliveryReport(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  csv: string;
  runId?: string;
  sessionLabel?: string;
}): Promise<DeliveryImportSummary> {
  const empty = { matched: 0, unmatched: 0, unchanged: 0, failed: 0, delivered: 0 };
  const parsed = parseDeliveryReport(args.csv);
  if (parsed.error) {
    return { ...empty, skipped: parsed.skipped, error: parsed.error };
  }
  if (!args.runId && !args.sessionLabel) {
    return { ...empty, skipped: parsed.skipped, error: "No run or session given for the report." };
  }

  const columns = "id, provider_message_id, destination, sent_on, status, delivery_status";
  let data: SendForImport[] = [];
  let error: unknown = null;
  if (args.runId) {
    const result = await args.supabase
      .from("whatsapp_reminder_sends")
      .select(columns)
      .eq("run_id", args.runId);
    data = (result.data ?? []) as SendForImport[];
    error = result.error;
  } else {
    const window = reportWindow(parsed.rows);
    const result = await fetchAllPages<SendForImport>((from, to) =>
      args.supabase
        .from("whatsapp_reminder_sends")
        .select(columns)
        .eq("session_label", args.sessionLabel)
        .eq("status", "sent")
        .gte("sent_on", window.from)
        .lte("sent_on", window.to)
        .order("id", { ascending: true })
        .range(from, to),
    );
    data = result.data;
    error = result.error;
  }

  if (error) {
    const message =
      error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? error);
    return { ...empty, skipped: parsed.skipped, error: `Could not read the sends: ${message}` };
  }

  const sends: SendRowForMatching[] = data.map((row) => ({
    id: row.id,
    providerMessageId: row.provider_message_id,
    destinationDigits: phoneDigits(row.destination),
    sentOn: row.sent_on,
    status: row.status,
    currentDeliveryStatus: (row.delivery_status as DeliveryStatus | null) ?? null,
  }));

  const result = matchDeliveryReport(parsed.rows, sends);

  // One update per row whose status actually moved. A few hundred at most.
  for (const update of result.updates) {
    await applyDeliveryResult(args.supabase, update);
  }

  return {
    matched: result.updates.length,
    unmatched: result.unmatched,
    unchanged: result.unchanged,
    failed: result.updates.filter((update) => update.status === "failed").length,
    delivered: result.updates.filter(
      (update) => update.status === "delivered" || update.status === "read",
    ).length,
    skipped: parsed.skipped,
    error: null,
  };
}

/** A person's word on a failure. Stored in `whatsapp_reminder_sends.resolution`. */
export type SendResolution = "called" | "slip_sent" | "dismissed";

/**
 * Close failures by hand: the family was rung, a slip went home, or the office
 * has decided not to chase this one. The history row is written by trigger.
 *
 * Only OPEN failures are touched — a row that has since been resent and gone
 * through is not a failure any more, and stamping "called" on it would be a
 * claim about a message that arrived.
 */
export async function resolveFailedSends(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  sendIds: string[];
  resolution: SendResolution;
  note: string;
  staffId: string | null;
}): Promise<number> {
  if (args.sendIds.length === 0) return 0;
  const { data, error } = await args.supabase
    .from("whatsapp_reminder_sends")
    .update({
      resolution: args.resolution,
      resolution_note: args.note || null,
      resolved_by: args.staffId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", args.sendIds)
    .is("resolution", null)
    .or("status.eq.failed,status.eq.pending,delivery_status.eq.failed")
    .select("id");
  if (error) throw new Error(`Could not record that: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
}

/**
 * A person's word on a NUMBER: "this one does not work" or "try it again".
 *
 * The audience switches a family away from a dead number on its own once
 * WhatsApp has said so. This is the same lever by hand — for a failure whose
 * reason was unclear, or for a number the office has checked and knows works.
 */
export async function markNumberHealth(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  phoneKey: string;
  working: boolean;
  note: string;
  staffId: string | null;
}): Promise<void> {
  if (!/^[0-9]{10}$/.test(args.phoneKey)) throw new Error("That is not a 10-digit number.");
  const now = new Date().toISOString();
  const { data: existing } = await args.supabase
    .from("whatsapp_number_health")
    .select("failures_in_a_row")
    .eq("phone_key", args.phoneKey)
    .maybeSingle();
  const row = args.working
    ? { phone_key: args.phoneKey, failures_in_a_row: 0 }
    : {
        phone_key: args.phoneKey,
        failures_in_a_row: Number(existing?.failures_in_a_row ?? 0) + 1,
        last_failed_at: now,
        last_cause: "not_on_whatsapp",
      };
  const { error } = await args.supabase.from("whatsapp_number_health").upsert(
    {
      ...row,
      marked_by: args.staffId,
      marked_at: now,
      marked_note: args.note || null,
      updated_at: now,
    },
    { onConflict: "phone_key" },
  );
  if (error) throw new Error(`Could not record that: ${error.message}`);
}

/** A row still `pending` long after its run finished. */
export type StuckSend = {
  id: string;
  studentName: string;
  admissionNo: string;
  destination: string;
  createdAt: string;
  /** The row's session, so the cutover line leaves TEST-session rows alone (One-only). */
  sessionLabel: string | null;
};

/**
 * How long a `pending` row waits before it counts as stuck.
 *
 * Fifteen minutes. A run of a few hundred takes under a minute, so anything
 * still pending a quarter of an hour later did not fail slowly — the request
 * died between claiming the row and hearing back, and the day is already
 * claimed.
 */
export const STUCK_AFTER_MINUTES = 15;

export async function loadStuckSends(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  runId: string;
  now?: Date;
}): Promise<StuckSend[]> {
  const cutoff = new Date((args.now ?? new Date()).getTime() - STUCK_AFTER_MINUTES * 60_000);

  const { data, error } = await args.supabase
    .from("whatsapp_reminder_sends")
    .select("id, destination, created_at, session_label, students(full_name, admission_no)")
    // `pending` ONLY. `covered_by_sibling` is not pending and never will be —
    // no provider call is made for one — so sweeping it here would offer the
    // office a list of rows there is nothing to reconcile about.
    .eq("run_id", args.runId)
    .eq("status", "pending")
    .lt("created_at", cutoff.toISOString());

  if (error) throw new Error(`Could not read stuck sends: ${error.message}`);

  return (
    (data ?? []) as Array<{
      id: string;
      destination: string | null;
      created_at: string;
      session_label?: string | null;
      students: { full_name: string | null; admission_no: string | null } | null;
    }>
  ).map((row) => ({
    id: row.id,
    studentName: row.students?.full_name ?? "",
    admissionNo: row.students?.admission_no ?? "",
    destination: row.destination ?? "",
    createdAt: row.created_at,
    sessionLabel: row.session_label ?? null,
  }));
}

/**
 * An admin's decision about what really happened to a stuck row.
 *
 * Both outcomes are a judgement, not a fact this app can establish — the whole
 * point is that the provider never answered — so both write an `audit_logs` row
 * naming who decided it and why.
 */
export async function resolveStuckSends(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  sendIds: string[];
  outcome: "sent" | "failed";
  reason: string;
  staffId: string | null;
}): Promise<number> {
  if (args.sendIds.length === 0) return 0;

  const { error } = await args.supabase
    .from("whatsapp_reminder_sends")
    .update({
      status: args.outcome,
      last_error: args.outcome === "failed" ? args.reason : null,
      updated_at: new Date().toISOString(),
    })
    .in("id", args.sendIds);

  if (error) throw new Error(`Could not update those sends: ${error.message}`);

  // Best-effort, and deliberately after the update: the decision is recorded
  // even if the audit write fails, rather than the reverse.
  try {
    await args.supabase.from("audit_logs").insert(
      args.sendIds.map((id) => ({
        table_name: "whatsapp_reminder_sends",
        record_id: id,
        action: "UPDATE",
        after_data: {
          status: args.outcome,
          reason: args.reason,
          resolved_as: "stuck_pending_reconciliation",
        },
        changed_by: args.staffId,
      })),
    );
  } catch (caught) {
    console.warn("[whatsapp-reminders] reconciliation audit failed", caught);
  }

  return args.sendIds.length;
}

/**
 * Families whose notice was READ some days ago with no receipt since.
 *
 * The strongest signal this system produces. A family who did not see the
 * message has an excuse; a family who read it and did nothing has made a
 * decision, and that is who a collector should ring first.
 *
 * Requires imported delivery data, so it is empty until a report has been
 * uploaded — which the screen says rather than showing an empty list as if it
 * were good news.
 */
export async function loadSeenButNotPaid(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  sessionLabel: string;
  minDaysSinceRead?: number;
  runId?: string;
}): Promise<Array<{ studentId: string; readAt: string; dueAmount: number }>> {
  const days = args.minDaysSinceRead ?? 3;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  let query = args.supabase
    .from("whatsapp_reminder_sends")
    .select("student_id, read_at, due_amount, sent_on")
    .eq("session_label", args.sessionLabel)
    .eq("status", "sent")
    .eq("delivery_status", "read")
    .lt("read_at", cutoff);

  if (args.runId) query = query.eq("run_id", args.runId);

  const { data, error } = await query;
  if (error) throw new Error(`Could not read seen-but-not-paid: ${error.message}`);

  const rows = (data ?? []) as Array<{
    student_id: string;
    read_at: string;
    due_amount: number | null;
    sent_on: string;
  }>;
  if (rows.length === 0) return [];

  // Who has paid since. Scoped by student id, and deliberately NOT by
  // `.in("id", ids)` on a roster-sized list — that URL has died three times in
  // this codebase past ~17k characters.
  const earliest = rows.reduce(
    (oldest, row) => (row.sent_on < oldest ? row.sent_on : oldest),
    rows[0]!.sent_on,
  );
  const { data: receipts } = await args.supabase
    .from("receipts")
    .select("student_id, payment_date")
    .gte("payment_date", earliest)
    .neq("payment_mode", "discount");

  const paidSince = new Map<string, string>();
  for (const receipt of (receipts ?? []) as Array<{ student_id: string; payment_date: string }>) {
    const existing = paidSince.get(receipt.student_id);
    if (!existing || receipt.payment_date > existing) {
      paidSince.set(receipt.student_id, receipt.payment_date);
    }
  }

  return rows
    .filter((row) => {
      const paid = paidSince.get(row.student_id);
      return !paid || paid < row.sent_on;
    })
    .map((row) => ({
      studentId: row.student_id,
      readAt: row.read_at,
      dueAmount: Number(row.due_amount ?? 0),
    }));
}
