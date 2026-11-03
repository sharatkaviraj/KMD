import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionVisible } from "@/platform/auth/test-session-access";
import { adapterSchema, manualReferenceAdapter, preflightReturn, type GovernmentAdapter, type GovernmentBatch, type ReturnPreflight, type ReturnStudent } from "../domain/exchange";
import { readinessCounts, readinessGrid, returnDestinations, type Destination, type ReadinessCounts, type ReadinessGrid } from "../domain/readiness";
import { copilotCounts } from "./copilot";
import { externalRecords, returnWorkspace, schoolOfficeRoster, withExternalRecords, type AdapterRow } from "./repo";

/*
 * Reads for the readiness board and one destination's detail. One roster RPC
 * per page (it is the same children for every destination), plus portal IDs
 * only for a verified format whose columns use them. Every count is the
 * prepare command's own preflight, so the board and the file cannot disagree.
 */

export type ManualProgress = { batchId: string; total: number; entered: number; mismatch: number };
export type DestinationCard = {
  destination: Destination;
  counts: ReadinessCounts | null;
  latest: Pick<GovernmentBatch, "id" | "state" | "created_at"> | null;
  manual: ManualProgress | null;
};

function adapterFor(destination: Destination, sessionLabel: string, adapters: AdapterRow[]): GovernmentAdapter {
  const row = destination.adapterId ? adapters.find((a) => a.id === destination.adapterId) : null;
  return row ? adapterSchema.parse(row.adapter) : manualReferenceAdapter(destination.portal, destination.module, sessionLabel, destination.schoolCode);
}
function usesPortalIds(adapter: GovernmentAdapter): boolean {
  return adapter.matchField === "externalId" || adapter.columns.some((c) => c.field === "externalId" || c.field === "registrationStatus");
}
async function destinationRows(roster: ReturnStudent[], sessionLabel: string, adapter: GovernmentAdapter): Promise<ReturnStudent[]> {
  return withExternalRecords(roster, adapter, usesPortalIds(adapter) ? await externalRecords(sessionLabel, adapter) : []);
}
function batchesFor(destination: Destination, batches: GovernmentBatch[]): GovernmentBatch[] {
  return batches.filter((b) => b.portal === destination.portal && b.module === destination.module);
}
/** The manual batch an operator would continue: newest prepared reference sheet not yet accepted. */
function openManualBatch(batches: GovernmentBatch[]): GovernmentBatch | null {
  return batches.find((b) => b.direction === "export" && b.adapter.mode === "manual_reference" && !!b.file_path && b.state !== "accepted" && b.state !== "preparing") ?? null;
}
async function manualProgress(batch: GovernmentBatch | null): Promise<ManualProgress | null> {
  if (!batch) return null;
  const counts = await copilotCounts(batch.id).catch(() => null);
  return counts ? { batchId: batch.id, total: batch.payload.rows?.length ?? 0, ...counts } : null;
}

export async function returnsBoard(sessionLabel: string): Promise<{ cards: DestinationCard[]; sourceUnavailable: boolean }> {
  const staff = await assertPermission("government:view"); await assertSessionVisible(staff, sessionLabel);
  const [workspace, roster] = await Promise.all([returnWorkspace(sessionLabel), schoolOfficeRoster(sessionLabel).catch(() => null)]);
  const destinations = returnDestinations(workspace.adapters, workspace.batches);
  const cards = await Promise.all(destinations.map(async (destination): Promise<DestinationCard> => {
    const mine = batchesFor(destination, workspace.batches);
    const [counts, manual] = await Promise.all([
      roster ? (async () => { const adapter = adapterFor(destination, sessionLabel, workspace.adapters); return readinessCounts(preflightReturn(await destinationRows(roster, sessionLabel, adapter), adapter)); })().catch(() => null) : Promise.resolve(null),
      manualProgress(openManualBatch(mine)),
    ]);
    const latest = mine[0] ? { id: mine[0].id, state: mine[0].state, created_at: mine[0].created_at } : null;
    return { destination, counts, latest, manual };
  }));
  return { cards, sourceUnavailable: !roster };
}

export type DestinationDetail = {
  destination: Destination; adapter: GovernmentAdapter; batches: GovernmentBatch[]; manual: ManualProgress | null;
  readiness: { rows: ReturnStudent[]; preflight: ReturnPreflight[]; counts: ReadinessCounts; grid: ReadinessGrid; sourceRevision: string } | null;
};
export async function destinationDetail(sessionLabel: string, key: string): Promise<DestinationDetail | null> {
  const staff = await assertPermission("government:view"); await assertSessionVisible(staff, sessionLabel);
  const workspace = await returnWorkspace(sessionLabel);
  const destination = returnDestinations(workspace.adapters, workspace.batches).find((d) => d.key === key);
  if (!destination) return null;
  const adapter = adapterFor(destination, sessionLabel, workspace.adapters);
  const batches = batchesFor(destination, workspace.batches);
  const [readiness, manual] = await Promise.all([
    (async () => {
      const rows = await destinationRows(await schoolOfficeRoster(sessionLabel), sessionLabel, adapter);
      const preflight = preflightReturn(rows, adapter);
      return { rows, preflight, counts: readinessCounts(preflight), grid: readinessGrid(rows, preflight), sourceRevision: rows[0]?.sourceRevision ?? "" };
    })().catch(() => null),
    manualProgress(openManualBatch(batches)),
  ]);
  return { destination, adapter, batches, manual, readiness };
}
