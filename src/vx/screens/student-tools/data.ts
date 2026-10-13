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

export type BulkChange = { id: string; kind: string; title: string; detail: Record<string, unknown>; doneAt: string; doneBy: string | null };

export async function listBulkChanges(limit = 8): Promise<BulkChange[]> {
  await assertPermission("fees:manage");
  const admin = createAdminClient();
  const { data, error } = await admin.from("bulk_changes").select("id, kind, title, detail, done_at, done_by").order("done_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not read recent changes: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; kind: string; title: string; detail: Record<string, unknown>; done_at: string; done_by: string | null }>;
  // Who did it, for the hub's second line. A short list, so one small read.
  const ids = [...new Set(rows.map((r) => r.done_by).filter((x): x is string => Boolean(x)))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: staff } = await admin.from("staff_profiles").select("id, display_name").in("id", ids);
    for (const s of (staff ?? []) as Array<{ id: string; display_name: string }>) names.set(s.id, s.display_name);
  }
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, doneAt: r.done_at, doneBy: r.done_by ? (names.get(r.done_by) ?? null) : null }));
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
