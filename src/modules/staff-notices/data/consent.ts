import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { evaluateTeacherTaskSend, hasConsent } from "@/modules/staff-notices/domain/gates";
import { isStaffMessageKind, STAFF_MESSAGE_KINDS, type StaffMessageKind } from "@/modules/staff-notices/domain/kinds";

/**
 * A member of staff's WhatsApp consent and their own per-kind switches (go-live
 * Phase F, plan §8.3). Read and written with the service role: the columns are
 * not granted to the browser, and every caller has decided who may act first
 * (`/preferences` acts on the signed-in person's own row only; `/staff` is an
 * administrator recording consent collected in person).
 */

export type ConsentSource = "form" | "self" | "admin_recorded";

export type StaffConsent = {
  optInAt: string | null;
  optInSource: ConsentSource | null;
  optOutAt: string | null;
  state: "yes" | "no_consent" | "opted_out";
  hasNumber: boolean;
};

export async function readStaffConsent(staffId: string): Promise<StaffConsent> {
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select("whatsapp_opt_in_at, whatsapp_opt_in_source, whatsapp_opt_out_at, whatsapp_phone, phone")
    .eq("id", staffId)
    .maybeSingle<{
      whatsapp_opt_in_at: string | null;
      whatsapp_opt_in_source: ConsentSource | null;
      whatsapp_opt_out_at: string | null;
      whatsapp_phone: string | null;
      phone: string | null;
    }>();
  if (error || !data) {
    // Unreadable reads as "not asked": nothing is sent on a guess.
    return { optInAt: null, optInSource: null, optOutAt: null, state: "no_consent", hasNumber: false };
  }
  return {
    optInAt: data.whatsapp_opt_in_at,
    optInSource: data.whatsapp_opt_in_source,
    optOutAt: data.whatsapp_opt_out_at,
    state: hasConsent({ optInAt: data.whatsapp_opt_in_at, optOutAt: data.whatsapp_opt_out_at }),
    hasNumber: (data.whatsapp_phone ?? data.phone ?? "").replace(/\D/g, "").length >= 10,
  };
}

/**
 * Record a yes or a no. A yes stamps when and how and clears an earlier
 * opt-out; a no stamps the opt-out and keeps the record of the yes it ends.
 */
export async function writeStaffConsent(input: {
  staffId: string;
  optIn: boolean;
  source: ConsentSource;
  recordedBy: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const values = input.optIn
    ? {
        whatsapp_opt_in_at: now,
        whatsapp_opt_in_source: input.source,
        whatsapp_opt_in_recorded_by: input.recordedBy,
        whatsapp_opt_out_at: null,
      }
    : { whatsapp_opt_out_at: now };
  const { error } = await createAdminClient().from("staff_profiles").update(values).eq("id", input.staffId);
  if (error) throw new Error(`Could not save the WhatsApp consent: ${error.message}`);
}

/** Their own switches: every kind, on unless they turned it off. */
export async function readNoticePrefs(staffId: string): Promise<Record<StaffMessageKind, boolean>> {
  const prefs = Object.fromEntries(STAFF_MESSAGE_KINDS.map((kind) => [kind, true])) as Record<StaffMessageKind, boolean>;
  const { data } = await createAdminClient()
    .from("staff_notice_prefs")
    .select("kind, enabled")
    .eq("staff_profile_id", staffId);
  for (const row of (data ?? []) as Array<{ kind: string; enabled: boolean }>) {
    if (isStaffMessageKind(row.kind)) prefs[row.kind] = row.enabled === true;
  }
  return prefs;
}

/**
 * The facts the teacher-task link's send asks (`evaluateTeacherTaskSend`), for
 * the queued `message_sends` row: its teacher, its session and its number.
 * Null when anything could not be read — which refuses.
 */
export async function teacherTaskGateFacts(sendId: string): Promise<Parameters<typeof evaluateTeacherTaskSend>[0]["facts"]> {
  const admin = createAdminClient();
  const { data: send, error } = await admin
    .from("message_sends")
    .select("staff_profile_id, session_label, to_phone")
    .eq("id", sendId)
    .maybeSingle<{ staff_profile_id: string | null; session_label: string | null; to_phone: string | null }>();
  if (error || !send?.staff_profile_id) return null;
  const [profile, pref, flag] = await Promise.all([
    admin
      .from("staff_profiles")
      .select("whatsapp_opt_in_at, whatsapp_opt_out_at, is_test_account")
      .eq("id", send.staff_profile_id)
      .maybeSingle<{ whatsapp_opt_in_at: string | null; whatsapp_opt_out_at: string | null; is_test_account: boolean | null }>(),
    admin
      .from("staff_notice_prefs")
      .select("enabled")
      .eq("staff_profile_id", send.staff_profile_id)
      .eq("kind", "teacher_task")
      .maybeSingle<{ enabled: boolean }>(),
    admin.from("runtime_flags").select("enabled, value").eq("key", "staff_notice_kinds_enabled").maybeSingle<{ enabled: boolean; value: unknown }>(),
  ]);
  if (profile.error || !profile.data || pref.error || flag.error || !flag.data) return null;
  const digits = String(send.to_phone ?? "").replace(/\D/g, "").slice(-10);
  const listed = digits.length === 10
    ? await admin.from("message_test_recipients").select("phone_e164").eq("phone_e164", `+91${digits}`).maybeSingle()
    : { data: null, error: null };
  if (listed.error) return null;
  return {
    optInAt: profile.data.whatsapp_opt_in_at,
    optOutAt: profile.data.whatsapp_opt_out_at,
    isTestAccount: profile.data.is_test_account === true,
    isTestSession: isTestSessionLabel(send.session_label) || !send.session_label,
    prefEnabled: pref.data ? pref.data.enabled === true : null,
    kindsEnabled: flag.data.enabled ? flag.data.value : null,
    allowlisted: Boolean(listed.data),
  };
}

export async function writeNoticePrefs(staffId: string, prefs: Partial<Record<StaffMessageKind, boolean>>): Promise<void> {
  const rows = Object.entries(prefs)
    .filter(([kind]) => isStaffMessageKind(kind))
    .map(([kind, enabled]) => ({ staff_profile_id: staffId, kind, enabled: enabled === true, updated_at: new Date().toISOString() }));
  if (rows.length === 0) return;
  const { error } = await createAdminClient()
    .from("staff_notice_prefs")
    .upsert(rows, { onConflict: "staff_profile_id,kind" });
  if (error) throw new Error(`Could not save the choices: ${error.message}`);
}
