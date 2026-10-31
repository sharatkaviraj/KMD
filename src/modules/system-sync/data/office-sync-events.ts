import "server-only";

import { createClient } from "@/modules/fees/platform/supabase/server";

export type OfficeSyncEventEntity =
  | "student"
  | "fee_setup"
  | "payment"
  | "import"
  | "session"
  | "master_data";

export type PublishOfficeSyncEventPayload = {
  sessionLabel: string;
  entityType: OfficeSyncEventEntity;
  entityId?: string | null;
  action: string;
  affectedStudentIds?: readonly string[];
  metadata?: Record<string, unknown>;
};

export async function publishOfficeSyncEvent(payload: PublishOfficeSyncEventPayload) {
  try {
    await publishOfficeSyncEventWith(await createClient(), payload);
  } catch (error) {
    console.warn("Unable to publish office sync event.", error);
  }
}

/**
 * The same event through a client the caller already holds. A webhook or a
 * cron has no staff session, so the cookie client above would insert nothing
 * under RLS; they pass the service-role client instead.
 */
export async function publishOfficeSyncEventWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  payload: PublishOfficeSyncEventPayload,
) {
  try {
    const { error } = await supabase.from("office_sync_events").insert({
      session_label: payload.sessionLabel,
      entity_type: payload.entityType,
      entity_id: payload.entityId ?? null,
      action: payload.action,
      affected_student_ids: payload.affectedStudentIds ? [...payload.affectedStudentIds] : [],
      metadata: payload.metadata ?? {},
    });

    if (error) {
      console.warn(`Unable to publish office sync event: ${error.message}`);
    }
  } catch (error) {
    console.warn("Unable to publish office sync event.", error);
  }
}
