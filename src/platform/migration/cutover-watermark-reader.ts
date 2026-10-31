import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { watermarkFrom, type CutoverWatermark } from "@/platform/migration/cutover-watermark";
import { FEES_SOURCE_PROJECT_REF } from "@/platform/supabase/target-guard";

/**
 * The line for one source table (`public.whatsapp_reminder_sends`, …): the
 * cutover row if there is one, else that table's newest load, else none.
 * Any read error answers `unreadable`, which callers refuse on.
 */
export async function readCutoverWatermark(sourceTable: string): Promise<CutoverWatermark> {
  try {
    const admin = createAdminClient();
    const [cutover, load] = await Promise.all([
      admin
        .from("migration_runs")
        .select("snapshot_at, started_at")
        .eq("kind", "cutover")
        .maybeSingle<{ snapshot_at: string | null; started_at: string }>(),
      admin
        .from("migration_watermarks")
        .select("snapshot_at")
        .eq("source_project", FEES_SOURCE_PROJECT_REF)
        .eq("source_table", sourceTable)
        .maybeSingle<{ snapshot_at: string }>(),
    ]);
    if (cutover.error || load.error) return { state: "unreadable" };
    return watermarkFrom({ cutover: cutover.data ?? null, load: load.data ?? null });
  } catch {
    return { state: "unreadable" };
  }
}
