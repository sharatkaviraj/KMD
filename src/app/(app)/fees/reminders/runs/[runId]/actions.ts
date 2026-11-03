"use server";

import { revalidatePath } from "next/cache";

import {
  importDeliveryReport,
  loadStuckSends,
  resolveStuckSends,
} from "@/modules/whatsapp/data/delivery-store";
import { resendFailuresAction } from "@/app/(app)/fees/reminders/fix/actions";
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

/** How many failed rows one press will resend, so a run cannot hang the request. */
const RETRY_LIMIT = 60;

/**
 * Resend what failed on this run — refused by AiSensy, or reported undelivered.
 *
 * **Through the failure desk's resend, which goes through the Send screen's own
 * action.** This used to read the failed rows and re-send their STORED params
 * with no claim: a two-child family message went out with the morning's
 * figures, and two people pressing Retry together both sent. Now each family is
 * rebuilt from today's ledger, every child, and the sender's claim — an update
 * guarded on the row's status — lets exactly one press through.
 */
export async function retryFailedSendsAction(
  _prev: RunActionState,
  formData: FormData,
): Promise<RunActionState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Permission denied." };
  }

  const runId = String(formData.get("runId") ?? "").trim();
  if (!runId) return { status: "error", message: "No run given." };

  const supabase = createAdminClient();
  const failedOnRun = (withResolution: boolean) => {
    const query = supabase
      .from("whatsapp_reminder_sends")
      .select("id, created_at, sent_on, session_label")
      .eq("run_id", runId)
      .or("status.eq.failed,delivery_status.eq.failed");
    return (withResolution ? query.is("resolution", null) : query).limit(RETRY_LIMIT);
  };
  let { data, error } = await failedOnRun(true);
  // Before `20261030190000` there is no `resolution`: every failure is open.
  if (isMissingColumn(error, "resolution")) ({ data, error } = await failedOnRun(false));
  if (error) return { status: "error", message: `Could not read the failed rows: ${error.message}` };

  // One: a row the fees app wrote before cutover is never re-sent from One —
  // the fees app may already have retried it, with a pay code of its own
  // (critique0 #12). Unreadable line: nothing real is retried.
  const watermark = await readCutoverWatermark("public.whatsapp_reminder_sends");
  const rows = (data ?? []) as Array<{ id: string; created_at: string; sent_on: string; session_label: string }>;
  const imported = rows.filter((row) => writtenBeforeWatermark(row, watermark)).length;
  const ids = rows.filter((row) => !writtenBeforeWatermark(row, watermark)).map((row) => row.id);
  if (ids.length === 0) {
    return {
      status: "error",
      message: imported > 0
        ? `Nothing re-sent: ${imported} were sent by the fees app before the move to VPPS One.`
        : "Nothing on this run is still failing.",
    };
  }

  const form = new FormData();
  for (const id of ids) form.append("sendId", id);
  const result = await resendFailuresAction({ status: "idle" }, form);

  revalidatePath(`/fees/reminders/runs/${runId}`);
  const skipped = imported > 0 ? ` ${imported} not re-sent: they were sent by the fees app before the move to VPPS One.` : "";
  return {
    status: result.status === "success" && imported === 0 ? "success" : "error",
    message: `${result.message ?? "Nothing was sent."}${skipped}`,
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
      (row) => !writtenBeforeWatermark({ created_at: row.createdAt, session_label: row.sessionLabel }, watermark),
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
      summary.failed > 0 ? `${summary.failed} not delivered` : null,
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
