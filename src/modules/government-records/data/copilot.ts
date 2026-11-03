import "server-only";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { createClient } from "@/platform/supabase/server";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { assertNotPreviewing } from "@/vx/view-as";
import type { CopilotMark } from "../domain/copilot";
import type { GovernmentBatch } from "../domain/exchange";
import { returnBatchForViewer } from "./repo";

/*
 * Row marks for the manual entry assistant. Reads go through the viewer's
 * own client (the table's policy follows the batch's); the one write is a
 * database command that rechecks the actor, the TEST fence and that the row
 * belongs to this prepared reference sheet.
 */

const PAGE = 1000;
type MarkRow = { row_key: string; state: CopilotMark["state"]; note: string | null; updated_at: string };

/** A batch is at most 2,000 rows (the roster limit); read in pages under PostgREST's row cap. */
export async function copilotMarks(batchId: string): Promise<Record<string, CopilotMark>> {
  const db = await createClient(), marks: Record<string, CopilotMark> = {};
  for (let from = 0; from < 2000; from += PAGE) {
    const { data, error } = await db.from("school_return_copilot_rows").select("row_key,state,note,updated_at").eq("batch_id", batchId).order("row_key").range(from, from + PAGE - 1);
    if (error) throw new Error("Manual entry marks unavailable");
    for (const row of (data ?? []) as MarkRow[]) marks[row.row_key] = { state: row.state, note: row.note, updatedAt: row.updated_at };
    if ((data ?? []).length < PAGE) break;
  }
  return marks;
}
export async function copilotCounts(batchId: string): Promise<{ entered: number; mismatch: number }> {
  const db = await createClient();
  const count = (state: CopilotMark["state"]) => db.from("school_return_copilot_rows").select("row_key", { count: "exact", head: true }).eq("batch_id", batchId).eq("state", state);
  const [entered, mismatch] = await Promise.all([count("entered"), count("mismatch")]);
  if (entered.error || mismatch.error) throw new Error("Manual entry progress unavailable");
  return { entered: entered.count ?? 0, mismatch: mismatch.count ?? 0 };
}

/** Prepared, manual, not yet accepted: the only batches a person can still be typing in. */
export function isCopilotBatch(batch: Pick<GovernmentBatch, "direction" | "adapter" | "file_path" | "state">): boolean {
  return batch.direction === "export" && batch.adapter.mode === "manual_reference" && !!batch.file_path && ["exported", "submitted", "partially_accepted", "rejected"].includes(batch.state);
}

const markSchema = z.object({ batchId: z.uuid(), rowKey: z.uuid(), state: z.enum(["entered", "mismatch"]), note: z.string().trim().max(500).optional() }).strict()
  .refine((value) => value.state !== "mismatch" || !!value.note, "A mismatch needs a note");

export async function markCopilotRow(input: unknown): Promise<CopilotMark> {
  const staff = await assertPermission("government:export"); await assertNotPreviewing();
  const value = markSchema.parse(input);
  const batch = await returnBatchForViewer(value.batchId);
  if (!batch || !isCopilotBatch(batch)) throw new Error("Manual entry is not open for this batch");
  await assertSessionWritable(staff, batch.session_label);
  if (!(batch.payload.rows ?? []).some((row) => row.studentId === value.rowKey)) throw new Error("Row is not in this batch");
  const { data, error } = await createAdminClient().rpc("school_return_copilot_mark", { p_actor: staff.id, p_batch: batch.id, p_row: value.rowKey, p_state: value.state, p_note: value.state === "mismatch" ? value.note ?? null : null, p_confined: isConfinedDeployment() });
  if (error || !data) throw new Error("Mark could not be recorded");
  const row = data as MarkRow;
  return { state: row.state, note: row.note, updatedAt: row.updated_at };
}
