import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import type { ConnectionListRow } from "@/modules/mcp/domain/card";
import type { Provider } from "@/modules/mcp/domain/redirects";
import type { RevokeReason } from "@/modules/mcp/domain/store";

/**
 * Reads and writes behind One's own AI-connection screens: the admin page
 * (switch, every connection, Disconnect) and a person's card. Service role,
 * so every caller has checked its permission first — the actions do, and so
 * does `changeStaffAuthority` before it calls `revokeStaffAiConnections`.
 */

type ListRow = {
  id: string;
  staff_profile_id: string;
  staff_name: string;
  provider: Provider;
  created_at: string;
  activated_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  last_used_at: string | null;
  calls_30d: number | null;
};

export async function listAiConnections(staffProfileId?: string): Promise<ConnectionListRow[]> {
  const { data, error } = await createAdminClient().rpc("ai_connection_list", {
    p_staff_profile_id: staffProfileId ?? null,
    p_limit: 200,
  });
  if (error) throw new Error("Could not read the AI connections.");
  return ((data ?? []) as ListRow[]).map((row) => ({
    id: row.id,
    staffProfileId: row.staff_profile_id,
    staffName: row.staff_name,
    provider: row.provider,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    lastUsedAt: row.last_used_at,
    calls30d: row.calls_30d ?? 0,
  }));
}

/** Whose connection this is, or null. */
export async function aiConnectionOwner(connectionId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("ai_connections")
    .select("staff_profile_id")
    .eq("id", connectionId)
    .maybeSingle<{ staff_profile_id: string }>();
  if (error) throw new Error("Could not read the AI connection.");
  return data?.staff_profile_id ?? null;
}

export async function revokeAiConnection(connectionId: string, reason: RevokeReason, byStaffProfileId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("ai_revoke_connection", {
    p_connection_id: connectionId,
    p_reason: reason,
    p_by: byStaffProfileId,
  });
  if (error) throw new Error("Could not end the AI connection.");
}

export async function revokeStaffAiConnections(staffProfileId: string, reason: RevokeReason, byStaffProfileId: string | null): Promise<number> {
  const { data, error } = await createAdminClient().rpc("ai_revoke_staff_connections", {
    p_staff_profile_id: staffProfileId,
    p_reason: reason,
    p_by: byStaffProfileId,
  });
  if (error) throw new Error("Could not end the AI connections.");
  return typeof data === "number" ? data : 0;
}

/** The kill switch as stored; null when it cannot be read (which the pipeline treats as off). */
export async function readAiConnectionSwitch(): Promise<{ enabled: boolean; updatedAt: string | null } | null> {
  const { data, error } = await createAdminClient()
    .from("runtime_flags")
    .select("enabled, updated_at")
    .eq("key", "ai_connection")
    .maybeSingle<{ enabled: boolean; updated_at: string | null }>();
  if (error || !data) return null;
  return { enabled: data.enabled === true, updatedAt: data.updated_at };
}

/** Throw the switch, recording who and when (`updated_by`, `updated_at`), as the cover switches do. */
export async function setAiConnectionSwitch(enabled: boolean, actorStaffId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("runtime_flags")
    .update({ enabled, updated_by: actorStaffId, updated_at: new Date().toISOString() })
    .eq("key", "ai_connection")
    .select("key");
  return !error && Array.isArray(data) && data.length === 1;
}
