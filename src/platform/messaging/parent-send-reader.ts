import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import type { ParentSendReader } from "@/platform/messaging/parent-send-gate";

/**
 * The parent-send gate's reads, from `vppsone` with the service role.
 *
 * Every function answers `null` rather than throwing or guessing when a read
 * fails or a row is missing, and the gate refuses on `null`. Nothing is cached:
 * the switch is meant to take effect on the very next send.
 */
async function flagRow(key: string): Promise<{ enabled: boolean; value: unknown } | null> {
  const { data, error } = await createAdminClient()
    .from("runtime_flags")
    .select("enabled, value")
    .eq("key", key)
    .maybeSingle<{ enabled: boolean; value: unknown }>();
  if (error || !data) return null;
  return data;
}

export const parentSendReader: ParentSendReader = {
  async parentDispatchOn() {
    const row = await flagRow("parent_dispatch");
    return row ? row.enabled === true : null;
  },
  async parentDispatchTestOnly() {
    // A missing row (a deployment ahead of migration 20261031084012) is null:
    // the gate refuses rather than guessing.
    const row = await flagRow("parent_dispatch_test_only");
    return row ? row.enabled === true : null;
  },
  async dispatchCategories() {
    const row = await flagRow("parent_dispatch_categories");
    if (!row) return null;
    // A switch that is turned off lists nothing, whatever its value says.
    return row.enabled === true ? row.value : [];
  },
  async absentNoticeOwner() {
    const row = await flagRow("absent_notice_owner");
    if (!row) return null;
    return row.enabled === true ? row.value : "none";
  },
  async isTestAccount(userId) {
    const { data, error } = await createAdminClient()
      .from("staff_profiles")
      .select("is_test_account")
      .eq("user_id", userId)
      .maybeSingle<{ is_test_account: boolean | null }>();
    if (error || !data) return null;
    return data.is_test_account === true;
  },
  async isTestRecipient(phoneE164) {
    const { data, error } = await createAdminClient()
      .from("message_test_recipients")
      .select("phone_e164")
      .eq("phone_e164", phoneE164)
      .maybeSingle<{ phone_e164: string }>();
    if (error) return null;
    return Boolean(data);
  },
};
