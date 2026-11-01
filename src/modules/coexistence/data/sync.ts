import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/platform/supabase/admin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { claimSchema, schoolDate, SYNC_PATH, synchronizeGeneration, validateSyncOrigin } from "../domain/snapshot";

const envelope = z.object({ version: z.literal(1), data: z.unknown() });
const appliedSchema = z.object({
  applied: z.boolean(), replayed: z.boolean(), revision: z.string(), snapshotId: z.string().uuid(),
});

export async function runFeesBridgeSync(options: { forceVerification?: boolean } = {}) {
  if (isConfinedDeployment() || process.env.FEES_BRIDGE_ENABLED !== "true") {
    throw new Error("bridge_sync_disabled");
  }
  const origin = validateSyncOrigin(process.env.FEES_BRIDGE_ORIGIN);
  const key = process.env.FEES_BRIDGE_SYNC_KEY;
  if (!key || key.length < 32) throw new Error("bridge_sync_unconfigured");
  const db = createAdminClient();
  const observed = await db.from("fees_bridge_state").select("last_checked_at").eq("id", true).single();
  if (observed.error) throw new Error("bridge_target_status_failed");
  const observedCheck = observed.data.last_checked_at as string | null;
  const leaseId = randomUUID();
  async function call(body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${origin}${SYNC_PATH}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-One-Sync-Key": key! },
      body: JSON.stringify({ consumerId: "vppsone", ...body }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(35_000),
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > 15_000_000) throw new Error("bridge_source_oversized");
    const text = await response.text();
    if (Buffer.byteLength(text) > 15_000_000) throw new Error("bridge_source_oversized");
    if (!response.ok) {
      // Overlapping scheduler wakeups are expected. A busy lease belongs to
      // another healthy worker and must not overwrite its global health state.
      const failure = z.object({ error: z.object({ code: z.string() }) }).safeParse(JSON.parse(text));
      if (response.status === 409 && failure.success && failure.data.error.code === "lease_busy") {
        throw new Error("bridge_source_busy");
      }
      throw new Error(`bridge_source_${response.status}`);
    }
    return envelope.parse(JSON.parse(text)).data;
  }
  try {
    const result = await synchronizeGeneration({
      claim: async () => claimSchema.parse(await call({ operation: "claim", leaseId, limit: 250, leaseSeconds: 180 })),
      skipUnchanged: async () => {
        if (options.forceVerification) return false;
        const { data, error } = await db.from("fees_bridge_state").select("last_revision,as_of_date,last_error_code").eq("id", true).single();
        return !error && Number(data?.last_revision) > 0 && data?.as_of_date === schoolDate(new Date()) && !data?.last_error_code;
      },
      release: async (claim) => {
        z.object({ released: z.literal(true) }).parse(await call({ operation: "release", leaseId: claim.leaseId, fence: claim.fence }));
        const { error } = await db.from("fees_bridge_state").update({ last_checked_at: new Date().toISOString() }).eq("id", true);
        if (error) throw new Error("bridge_health_update_failed");
      },
      snapshot: (claim) => call({ operation: "snapshot", leaseId: claim.leaseId, fence: claim.fence }),
      apply: async (snapshot) => {
        const digest = createHash("sha256").update(JSON.stringify({
          version: snapshot.version, sourceProjectRef: snapshot.sourceProjectRef,
          asOfDate: snapshot.asOfDate, activeSessionLabel: snapshot.activeSessionLabel,
          sessions: snapshot.sessions, classes: snapshot.classes,
          students: snapshot.students, households: snapshot.households,
        })).digest("hex");
        const { data, error } = await db.rpc("fees_bridge_apply_snapshot", { p_snapshot: snapshot, p_sha256: digest });
        if (error) throw new Error("bridge_target_apply_failed");
        return appliedSchema.parse(data);
      },
      acknowledge: async (claim) => {
        const ack = z.object({ acknowledged: z.number().int().nonnegative() }).parse(
          await call({ operation: "ack", leaseId: claim.leaseId, fence: claim.fence, eventIds: claim.eventIds }),
        );
        if (ack.acknowledged !== claim.eventIds.length) throw new Error("bridge_ack_incomplete");
      },
    });
    // Roster reads are uncached in bridge mode. This also refreshes Router Cache
    // on the next navigation; open pages recover through their refresh listener.
    if (!("unchanged" in result)) revalidatePath("/", "layout");
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === "bridge_source_busy") return { busy: true };
    const message = error instanceof Error && /^bridge_[a-z0-9_]+$/.test(error.message)
      ? error.message : "bridge_sync_failed";
    // A lease can expire while a slow request is in flight. Never let its
    // failure overwrite a successful newer worker's health (or this worker's
    // already-verified commit when only acknowledgement was lost).
    const failure = db.from("fees_bridge_state").update({ last_error_code: message, last_attempt_at: new Date().toISOString() }).eq("id", true);
    if (observedCheck === null) await failure.is("last_checked_at", null);
    else await failure.eq("last_checked_at", observedCheck);
    // Never log upstream bodies, student data, URLs with credentials or secrets.
    throw new Error(message);
  }
}
