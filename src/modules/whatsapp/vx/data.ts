import "server-only";

import { createClient } from "@/modules/fees/platform/supabase/server";
import { listRunOutcomes, loadRunRecipients } from "@/modules/whatsapp/data/campaign-store";

/*
 * Reads for the redesigned Reminders screen (/reminders): what the fee app's
 * WhatsApp sender has already sent, and how each run did. Nothing here sends
 * or writes.
 */

export type RunSummary = {
  runId: string;
  name: string;
  startedAt: string;
  messaged: number;
  delivered: number;
  read: number;
  failed: number;
  familiesPaid: number;
  moneyCollected: number;
  moneyQuoted: number;
  source: string;
};

export async function listRuns(sessionLabel: string): Promise<RunSummary[]> {
  const supabase = await createClient();
  try {
    const runs = await listRunOutcomes(supabase, sessionLabel, { limit: 30 });
    return runs.map((r) => ({
      runId: r.runId,
      name: r.campaignName,
      startedAt: r.startedAt,
      messaged: r.messaged,
      delivered: r.delivered,
      read: r.readCount,
      failed: r.failed + r.deliveryFailed,
      familiesPaid: r.familiesPaid,
      moneyCollected: r.moneyCollected,
      moneyQuoted: r.moneyQuoted,
      source: r.source,
    }));
  } catch {
    return [];
  }
}

export type RunRecipient = { studentId: string; studentName: string; dueAmount: number; status: string; error: string | null };

export async function runRecipients(runId: string): Promise<RunRecipient[]> {
  const supabase = await createClient();
  try {
    const rows = await loadRunRecipients(supabase, runId);
    return rows.map((r) => ({ studentId: r.studentId, studentName: r.studentName, dueAmount: r.dueAmount, status: r.status, error: r.error }));
  } catch {
    return [];
  }
}
