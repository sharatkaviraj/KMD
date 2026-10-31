import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { assertNoPhoneNumber } from "@/modules/staff-notices/domain/notices";
import type { OutboxKind } from "@/modules/staff-notices/domain/kinds";

/**
 * Putting a staff WhatsApp in the outbox (go-live Phase F). The only way the
 * app queues a notice of a payload kind: both go through the database's
 * `queue_staff_notice` (one person) or `queue_staff_notice_to_permission`
 * (every active holder of a permission), which skip an inactive profile and
 * never tell a test account about a real session. Idempotent on the key: the
 * same event queued twice is one notice.
 *
 * Queueing is not sending. The dispatcher asks consent, the switches and the
 * limits at the moment it claims (`domain/gates.ts`).
 *
 * A payload never carries a phone number: it is checked here before it is
 * written, and the rendered message is checked again before it is sent.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type QueueInput = {
  key: string;
  kind: Exclude<OutboxKind, "cover_assigned" | "cover_changed" | "cover_cancelled" | "cover_escalation" | "attendance_reminder">;
  sessionLabel: string;
  payload: Record<string, unknown>;
  /** After this it is not worth sending. Default: three days. */
  notAfter?: Date;
  client?: Db;
};

function checkPayload(payload: Record<string, unknown>): void {
  // Ids are uuids, not text a person reads; everything else is checked.
  const values = Object.entries(payload)
    .filter(([key]) => !/_id$/.test(key))
    .map(([, value]) => (typeof value === "string" ? value : JSON.stringify(value ?? "")));
  assertNoPhoneNumber({ params: values, text: { hi: "", en: "" } });
}

/** One person. Returns the notice id, or null when nothing was queued (already queued, inactive, a test account on a real session). */
export async function queueStaffNotice(input: QueueInput & { staffId: string; requestedBy?: string | null }): Promise<string | null> {
  checkPayload(input.payload);
  const { data, error } = await (input.client ?? createAdminClient()).rpc("queue_staff_notice", {
    p_key: input.key,
    p_kind: input.kind,
    p_staff: input.staffId,
    p_session: input.sessionLabel,
    p_payload: input.payload,
    p_not_after: input.notAfter ? input.notAfter.toISOString() : null,
    p_requested_by: input.requestedBy ?? null,
  });
  if (error) throw new Error(`Could not queue the staff notice: ${error.message}`);
  return (data as string | null) ?? null;
}

/** Every active holder of a permission (keys are `${keyPrefix}:${staffId}`). Returns how many were queued. */
export async function queueStaffNoticeToPermission(
  input: QueueInput & { permission: string; exclude?: string | null },
): Promise<number> {
  checkPayload(input.payload);
  const { data, error } = await (input.client ?? createAdminClient()).rpc("queue_staff_notice_to_permission", {
    p_key_prefix: input.key,
    p_kind: input.kind,
    p_permission: input.permission,
    p_session: input.sessionLabel,
    p_payload: input.payload,
    p_not_after: input.notAfter ? input.notAfter.toISOString() : null,
    p_exclude: input.exclude ?? null,
    p_exclude_too: null,
  });
  if (error) throw new Error(`Could not queue the staff notices: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * Take back notices queued by hand that have not gone yet. Only the person who
 * queued them, and only while they are still pending.
 */
export async function cancelQueuedStaffNotices(ids: string[], requestedBy: string, client?: Db): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await (client ?? createAdminClient())
    .from("staff_notices")
    .update({ status: "cancelled", status_reason: "taken back" })
    .in("id", ids.slice(0, 200))
    .eq("requested_by", requestedBy)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(`Could not take the notices back: ${error.message}`);
  return data?.length ?? 0;
}
