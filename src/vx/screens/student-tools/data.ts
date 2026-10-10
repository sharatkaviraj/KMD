import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";

import type { PromoMark, QualityIssue } from "@/vx/screens/student-tools/logic";

/*
 * VPPS One's own Student tools records (`vppsone` schema): the bulk-change
 * log, held-back/leaving marks beside a promotion run, and data-quality
 * items put off for later. Service role after `fees:manage`, as in
 * src/vx/screens/admissions/data.ts.
 */

export type BulkChange = { id: string; kind: string; title: string; detail: Record<string, unknown>; doneAt: string };

export async function listBulkChanges(limit = 8): Promise<BulkChange[]> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient().from("bulk_changes").select("id, kind, title, detail, done_at").order("done_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not read recent changes: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; kind: string; title: string; detail: Record<string, unknown>; done_at: string }>).map((r) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, doneAt: r.done_at }));
}

export async function logBulkChange(input: { kind: "promote" | "promote_undo" | "import" | "merge" | "split" | "quality"; title: string; detail?: Record<string, unknown>; staffId: string }) {
  await assertPermission("fees:manage");
  const { error } = await createAdminClient().from("bulk_changes").insert({ kind: input.kind, title: input.title.slice(0, 200), detail: input.detail ?? {}, done_by: input.staffId });
  if (error) throw new Error(`Could not log the change: ${error.message}`);
}

export async function loadPromotionMarks(runId: string): Promise<Record<string, PromoMark>> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient().from("promotion_marks").select("student_id, kind").eq("run_id", runId);
  if (error) throw new Error(`Could not read promotion marks: ${error.message}`);
  const out: Record<string, PromoMark> = {};
  for (const r of (data ?? []) as Array<{ student_id: string; kind: PromoMark }>) out[r.student_id] = r.kind;
  return out;
}

export async function saveMark(input: { runId: string; entryId: string; studentId: string; kind: PromoMark | null; staffId: string }) {
  await assertPermission("fees:manage");
  const admin = createAdminClient();
  if (input.kind === null) {
    const { error } = await admin.from("promotion_marks").delete().eq("run_id", input.runId).eq("entry_id", input.entryId);
    if (error) throw new Error(`Could not clear the mark: ${error.message}`);
    return;
  }
  const { error } = await admin
    .from("promotion_marks")
    .upsert({ run_id: input.runId, entry_id: input.entryId, student_id: input.studentId, kind: input.kind, marked_by: input.staffId, marked_at: new Date().toISOString() }, { onConflict: "run_id,entry_id" });
  if (error) throw new Error(`Could not save the mark: ${error.message}`);
}

/** "<studentId>|<issue>" for every skip still in force. */
export async function loadQualitySkips(today: string): Promise<Set<string>> {
  await assertPermission("fees:manage");
  const { data, error } = await createAdminClient().from("data_quality_skips").select("student_id, issue").gte("skipped_until", today).limit(5000);
  if (error) throw new Error(`Could not read skipped items: ${error.message}`);
  return new Set(((data ?? []) as Array<{ student_id: string; issue: string }>).map((r) => `${r.student_id}|${r.issue}`));
}

export async function skipQualityItem(input: { studentId: string; issue: QualityIssue; until: string; staffId: string }) {
  await assertPermission("fees:manage");
  const { error } = await createAdminClient()
    .from("data_quality_skips")
    .upsert({ student_id: input.studentId, issue: input.issue, skipped_until: input.until, skipped_by: input.staffId, skipped_at: new Date().toISOString() }, { onConflict: "student_id,issue" });
  if (error) throw new Error(`Could not skip the item: ${error.message}`);
}

export async function unskipQualityItem(studentId: string, issue: QualityIssue) {
  await assertPermission("fees:manage");
  const { error } = await createAdminClient().from("data_quality_skips").delete().eq("student_id", studentId).eq("issue", issue);
  if (error) throw new Error(`Could not undo the skip: ${error.message}`);
}
