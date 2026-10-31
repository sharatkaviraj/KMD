"use server";

import { revalidatePath } from "next/cache";

import { payNowButton, sendAisensyCampaignMessage } from "@/modules/whatsapp/data/aisensy";
import { hasPayNowButton } from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { signDocumentUrl } from "@/modules/whatsapp/data/document-store";
import {
  importDeliveryReport,
  loadStuckSends,
  resolveStuckSends,
} from "@/modules/whatsapp/data/delivery-store";
import { onlineLedgerRecheck } from "@/modules/payments/data/online/service";
import { readPayScope } from "@/modules/payments/domain/online/pay-scope";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { isMissingColumn } from "@/platform/supabase/missing-column";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { writtenBeforeWatermark } from "@/platform/migration/cutover-watermark";
import { readCutoverWatermark } from "@/platform/migration/cutover-watermark-reader";

/**
 * The three things an admin does to a finished run: retry what failed, decide
 * what happened to what never answered, and tell it what the provider says.
 *
 * All three treat a send row as EVIDENCE a parent was messaged. Nothing here
 * inserts a second row for a family or deletes one — a retry updates in place,
 * a reconciliation writes a status and an audit trail.
 */

export type RunActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const IDLE_RUN_ACTION: RunActionState = { status: "idle" };

/** How many failed rows one press will retry, so a run cannot hang the request. */
const RETRY_LIMIT = 60;

/**
 * Retry the rows that failed.
 *
 * **Updates in place, never inserts.** A second row would break the unique index
 * that stops a family being messaged twice a day, and would make the send
 * history claim a family was messaged twice when they were messaged once and
 * re-tried. `attempts` is what records the retry.
 *
 * Same day only, implicitly: the row already carries its `sent_on`, and a
 * successful retry does not move it. A failure worth chasing tomorrow is
 * tomorrow's run.
 */
export async function retryFailedSendsAction(
  _prev: RunActionState,
  formData: FormData,
): Promise<RunActionState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const runId = String(formData.get("runId") ?? "").trim();
  if (!runId) return { status: "error", message: "No run given." };

  const supabase = createAdminClient();

  const failedToday = (columns: string) =>
    supabase
      .from("whatsapp_reminder_sends")
      .select(columns)
      .eq("run_id", runId)
      .eq("status", "failed")
      // Today's only. A week-old failed row carries a week-old amount and
      // pay-by date, and re-sending it would quote a family who has since paid.
      .eq("sent_on", istToday())
      .limit(RETRY_LIMIT);
  const baseColumns =
    "id, campaign_name, destination, template_params, attempts, document_path, pay_code, due_amount, sent_on, session_label, created_at";
  let { data, error } = await failedToday(`${baseColumns}, pay_scope`);
  // Before `20261028140100` there is no `pay_scope`: retry as before, unchecked.
  if (isMissingColumn(error, "pay_scope")) ({ data, error } = await failedToday(baseColumns));

  if (error) return { status: "error", message: `Could not read the failed rows: ${error.message}` };

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    campaign_name: string;
    destination: string;
    template_params: string[];
    attempts: number | null;
    document_path: string | null;
    pay_code: string | null;
    pay_scope: unknown;
    due_amount: number | null;
    sent_on: string;
    session_label: string;
    created_at: string;
  }>;
  if (rows.length === 0) {
    return {
      status: "error",
      message: "Nothing failed on this run today. Older failures are not re-sent — their amounts and dates have moved on; run the notice again from the Send tab.",
    };
  }

  // A row the fees app wrote before cutover is never re-sent from One: the
  // fees app may already have retried it, with a pay code of its own
  // (critique0 #12). Unreadable line: nothing real is retried.
  const watermark = await readCutoverWatermark("public.whatsapp_reminder_sends");
  let imported = 0;

  let sent = 0;
  let stillFailing = 0;
  let missingDocument = 0;
  let stoppedByLedger = 0;
  // A retry re-sends the STORED params, so with online payments on, each
  // one-child Pay now row is re-quoted first: a family who paid since this
  // morning is not chased, and a figure that moved is not re-sent.
  const recheck = await onlineLedgerRecheck();

  for (const row of rows) {
    if (writtenBeforeWatermark(row, watermark)) {
      imported += 1;
      continue;
    }
    const scope = readPayScope(row.pay_scope);
    if (recheck && scope && scope.studentIds.length === 1 && row.pay_code) {
      const quote = await recheck({
        studentId: scope.studentIds[0],
        installments: scope.installments,
        lastYear: scope.lastYear,
        situation: scope.situation,
      });
      if (
        quote === null ||
        (quote !== "not_applicable" &&
          (quote.reasons.includes("nothing_due") ||
            (quote.eligible && quote.total !== Number(row.due_amount ?? 0))))
      ) {
        stoppedByLedger += 1;
        continue;
      }
    }

    /**
     * Re-sign, never re-send the old link.
     *
     * A signed URL is not a template param and was never stored, because it
     * expires within the hour — long before anyone looks at a failed run. What
     * the row carries is the object PATH, and a retry mints a fresh signature
     * from it.
     *
     * When the object is gone the retry is SKIPPED rather than sent without
     * media: a document template with no media is rejected by AiSensy outright,
     * and the row would just fail again with a more confusing error.
     */
    let media: { url: string; filename: string } | undefined;
    if (row.document_path) {
      const signedUrl = await signDocumentUrl({ supabase, path: row.document_path });
      if (!signedUrl) {
        missingDocument += 1;
        continue;
      }
      media = {
        url: signedUrl,
        // The parent-facing name is derived from the path's own basename, which
        // is the only thing still true about a row whose student may since have
        // been renamed.
        filename: row.document_path.split("/").pop() || "document.pdf",
      };
    }

    const result = await sendAisensyCampaignMessage({
      campaignName: row.campaign_name,
      destination: row.destination,
      // The parent name is already inside the stored params; the provider's
      // `userName` is only used for its own reporting.
      userName: row.template_params?.[0] ?? "",
      templateParams: row.template_params ?? [],
      source: "vppsone/retry",
      gate: { kind: "fee_reminder", sessionLabel: row.session_label, actor: staffId ? { userId: staffId } : "unknown" },
      ...(media ? { media } : {}),
      // The `_v6` notices carry Pay now, whose code is NOT in the stored
      // params (it rides as the param after them). Without it AiSensy refused
      // every v6 retry: "Template params does not match the campaign".
      ...(row.pay_code && hasPayNowButton(row.campaign_name)
        ? { buttons: [payNowButton(row.pay_code)] }
        : {}),
    });

    await supabase
      .from("whatsapp_reminder_sends")
      .update({
        status: result.ok ? "sent" : "failed",
        provider_message_id: result.ok ? result.messageId : null,
        // Cleared on success, kept on failure. `error_message` holds what went
        // wrong the FIRST time and is deliberately not overwritten.
        last_error: result.ok ? null : result.error,
        attempts: (row.attempts ?? 1) + 1,
        last_attempt_at: new Date().toISOString(),
        sent_by: staffId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (result.ok) sent += 1;
    else stillFailing += 1;
  }

  revalidatePath(`/fees/reminders/runs/${runId}`);

  const skipped =
    (missingDocument > 0
      ? ` ${missingDocument} could not be retried because the attached document is no longer on file.`
      : "") +
    (stoppedByLedger > 0
      ? ` ${stoppedByLedger} not re-sent: paid since, or the amount has changed — send the notice again from the Send tab.`
      : "") +
    (imported > 0
      ? ` ${imported} not re-sent: they were sent by the fees app before the move to VPPS One.`
      : "");

  return {
    status:
      stillFailing > 0 || missingDocument > 0 || stoppedByLedger > 0 || imported > 0 ? "error" : "success",
    message:
      stillFailing > 0
        ? `${sent} went through, ${stillFailing} failed again.${skipped}`
        : `${sent} retried successfully.${skipped}`,
  };
}

/**
 * Decide what happened to rows that never answered.
 *
 * The provider never told us, so this is a person's judgement rather than a
 * fact this app can establish — which is why both outcomes write an
 * `audit_logs` row naming who decided and why.
 */
export async function reconcileStuckSendsAction(
  _prev: RunActionState,
  formData: FormData,
): Promise<RunActionState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const runId = String(formData.get("runId") ?? "").trim();
  const outcome = String(formData.get("outcome") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (outcome !== "sent" && outcome !== "failed") {
    return { status: "error", message: "Pick whether these went out or not." };
  }
  if (reason.length < 3) {
    // A reconciliation with no reason is an unexplained edit to the record of
    // what a parent was told.
    return { status: "error", message: "Say why, so the record explains itself." };
  }

  const supabase = createAdminClient();

  try {
    const stuck = await loadStuckSends({ supabase, runId });
    if (stuck.length === 0) {
      return { status: "error", message: "Nothing on this run is still pending." };
    }
    // The fees app's own pending rows are the fees app's to decide
    // (critique0 #12): One never writes a verdict on a send it did not make.
    const watermark = await readCutoverWatermark("public.whatsapp_reminder_sends");
    const ours = stuck.filter(
      (row) => !writtenBeforeWatermark({ created_at: row.createdAt }, watermark),
    );
    if (ours.length === 0) {
      return {
        status: "error",
        message: "These were sent by the fees app before the move to VPPS One; reconcile them there.",
      };
    }

    const count = await resolveStuckSends({
      supabase,
      sendIds: ours.map((row) => row.id),
      outcome,
      reason,
      staffId,
    });

    revalidatePath(`/fees/reminders/runs/${runId}`);
    return {
      status: "success",
      message: `${count} marked ${outcome}.`,
    };
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not reconcile those rows.",
    };
  }
}

/** How large an AiSensy report may be. A run is hundreds of rows, not millions. */
const MAX_REPORT_BYTES = 2_000_000;

/**
 * Import the AiSensy campaign report.
 *
 * The Basic plan has no delivery webhooks, so this CSV is the only way to learn
 * whether a message arrived. Scoped to one run: a file covering another day must
 * not quietly rewrite months of history because a phone number recurs.
 */
export async function importDeliveryReportAction(
  _prev: RunActionState,
  formData: FormData,
): Promise<RunActionState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const runId = String(formData.get("runId") ?? "").trim();
  const file = formData.get("report");

  if (!runId) return { status: "error", message: "No run given." };
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose the campaign report CSV first." };
  }
  if (file.size > MAX_REPORT_BYTES) {
    return { status: "error", message: "That file is larger than a campaign report should be." };
  }

  try {
    const csv = await file.text();
    const summary = await importDeliveryReport({
      supabase: createAdminClient(),
      runId,
      csv,
    });

    if (summary.error) return { status: "error", message: summary.error };

    revalidatePath(`/fees/reminders/runs/${runId}`);

    const parts = [
      `${summary.matched} updated`,
      summary.unchanged > 0 ? `${summary.unchanged} already up to date` : null,
      summary.unmatched > 0 ? `${summary.unmatched} matched nothing in this run` : null,
      summary.skipped > 0 ? `${summary.skipped} rows unreadable` : null,
    ].filter(Boolean);

    return { status: "success", message: parts.join(", ") };
  } catch (caught) {
    return {
      status: "error",
      message: caught instanceof Error ? caught.message : "Could not read that file.",
    };
  }
}
