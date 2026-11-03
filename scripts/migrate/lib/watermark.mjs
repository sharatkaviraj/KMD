/**
 * Which watermark a tail tool reads after (critique0 #6): the one recorded by
 * the last APPLIED load (the cutover load, C1, once there is one) — never a
 * wall-clock time written down beforehand.
 *
 *   --watermark <run-id>   that extract's manifest (rehearsals, dry runs)
 *   otherwise              the newest succeeded load-snapshot run in
 *                          vppsone.migration_runs (summary.watermark)
 *   otherwise              the newest local extract, labelled as such
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { latestRunId, runDir } from "./env.mjs";

function fromManifest(runId) {
  const file = path.join(runDir(runId, { create: false }), "manifest.json");
  if (!existsSync(file)) throw new Error(`Run ${runId} has no manifest.json.`);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  return { ...manifest.watermark, source: `extract ${runId}` };
}

export async function resolveWatermark({ watermarkRun, sql } = {}) {
  if (watermarkRun) return fromManifest(watermarkRun);
  if (sql) {
    const [row] = await sql`
      select id, summary->'watermark' as watermark, finished_at
      from vppsone.migration_runs
      where script = 'load-snapshot' and kind = 'run' and status = 'succeeded'
      order by finished_at desc limit 1`;
    if (row?.watermark?.newestChangeAt) return { ...row.watermark, source: `load ${row.id}` };
  }
  const latest = latestRunId();
  if (latest) return { ...fromManifest(latest), source: `latest local extract ${latest} (no applied load found)` };
  throw new Error("No watermark: no applied load and no local extract. Pass --watermark <run-id>.");
}
