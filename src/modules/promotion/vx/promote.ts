import "server-only";

import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { currentSessionViewer } from "@/platform/auth/test-session-access";
import { defaultSessionFor, UNREADABLE_VIEWER } from "@/platform/auth/test-session-policy";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { createClient } from "@/modules/fees/platform/supabase/server";
import {
  applyPromotionRun,
  createPromotionPreview,
  getPromotionRun,
  listPromotionRuns,
  rollbackPromotionRun,
  type PromotionPreviewResult,
  type PromotionRunSummary,
} from "@/modules/promotion/data/queries";
import { revalidateTagAfterWrite } from "@/modules/system-sync/data/finance-revalidation";
import { getNextAcademicSessionLabel } from "@/platform/config/fee-rules";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

/*
 * Student tools → Promote, on top of the School Fees promotion module. The
 * run, its dues guard, apply and rollback are that module's; this file adds
 * what the redesigned screen needs: the target session's classes, and a way
 * to set an entry's new class (the old screen only set the decision, which
 * left every senior class "manual" because the matcher cannot guess streams).
 */

export type TargetClass = { id: string; label: string; sortOrder: number };

export type PromotionBoard = {
  sourceSessionLabel: string;
  targetSessionLabel: string;
  run: PromotionRunSummary | null;
  detail: PromotionPreviewResult | null;
  sourceClasses: TargetClass[];
  targetClasses: TargetClass[];
};

function label(row: { class_name: string; section: string | null; stream_name: string | null }) {
  const parts = [row.class_name];
  if (row.section?.trim()) parts.push(row.section.trim());
  if (row.stream_name?.trim()) parts.push(`(${row.stream_name.trim()})`);
  return parts.join(" ");
}

async function classesOf(sessionLabel: string): Promise<TargetClass[]> {
  const { data, error } = await createAdminClient()
    .from("classes")
    .select("id, class_name, section, stream_name, sort_order")
    .eq("session_label", sessionLabel)
    .eq("status", "active")
    .order("sort_order");
  if (error) throw new Error(`Could not read classes: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; class_name: string; section: string | null; stream_name: string | null; sort_order: number | null }>).map((c, i) => ({
    id: c.id,
    label: label(c),
    sortOrder: c.sort_order ?? i,
  }));
}

/** The active session, the next one, and the newest run between them. */
export async function loadPromotionBoard(runId?: string | null): Promise<PromotionBoard> {
  await requireStaffPermission("students:write");
  // A test account promotes TEST-2026-27; everyone else the active year. An
  // unreadable viewer fails closed onto TEST, as the session resolver does.
  const viewer = (await currentSessionViewer().catch(() => UNREADABLE_VIEWER)) ?? UNREADABLE_VIEWER;
  const sourceSessionLabel = defaultSessionFor(viewer, await getActiveSessionLabel());
  const targetSessionLabel = getNextAcademicSessionLabel(sourceSessionLabel);
  const runs = await listPromotionRuns(25);
  const run =
    (runId ? runs.find((r) => r.id === runId) : null) ??
    runs.find((r) => r.sourceSessionLabel === sourceSessionLabel && r.targetSessionLabel === targetSessionLabel && r.status !== "rolled_back") ??
    null;
  const [detail, sourceClasses, targetClasses] = await Promise.all([run ? getPromotionRun(run.id) : null, classesOf(sourceSessionLabel), classesOf(targetSessionLabel)]);
  return { sourceSessionLabel, targetSessionLabel, run, detail, sourceClasses, targetClasses };
}

/** The two years a run moves children between, for the session fence; null when there is no such run. */
export async function promotionRunSessions(runId: string): Promise<{ source: string; target: string } | null> {
  await requireStaffPermission("students:write");
  const detail = await getPromotionRun(runId);
  return detail ? { source: detail.run.sourceSessionLabel, target: detail.run.targetSessionLabel } : null;
}

export async function buildPromotionList(sourceSessionLabel: string, targetSessionLabel: string) {
  await requireStaffPermission("students:write");
  const result = await createPromotionPreview({ sourceSessionLabel, targetSessionLabel });
  return result.run.id;
}

/** Write decisions and new classes, one update per group of entries. */
export async function setEntryTargets(runId: string, groups: { decision: "promote" | "graduate" | "skip" | "manual"; newClassId: string | null; entryIds: string[] }[]) {
  await requireStaffPermission("students:write");
  const supabase = await createClient();
  const { data: run, error: runError } = await supabase.from("promotion_runs").select("status").eq("id", runId).maybeSingle();
  if (runError) throw new Error(`Could not read the promotion run: ${runError.message}`);
  if ((run as { status: string } | null)?.status !== "preview") throw new Error("This promotion has already been applied.");
  for (const g of groups) {
    for (const chunk of chunkArray(g.entryIds, IN_FILTER_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("promotion_run_entries")
        .update({ decision: g.decision, new_class_id: g.newClassId })
        .eq("run_id", runId)
        .in("id", chunk);
      if (error) throw new Error(`Could not save the promotion plan: ${error.message}`);
    }
  }
}

export async function applyPromotion(runId: string) {
  await requireStaffPermission("students:write");
  await applyPromotionRun(runId);
  // Same bust as the old screen: apply copies the fee policy into the new year.
  revalidateTagAfterWrite("fee-policy");
}

export async function rollbackPromotion(runId: string) {
  await requireStaffPermission("students:write");
  await rollbackPromotionRun(runId);
  revalidateTagAfterWrite("fee-policy");
}
