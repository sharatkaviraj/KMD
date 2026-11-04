import "server-only";

import { assertStaff } from "@/platform/auth/current-staff";
import { can, resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
import { assertActorStaff, type VerifiedActor } from "@/platform/auth/verified-actor";
import { revokeStaffAiConnections } from "@/modules/mcp/data/connections";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import type {
  AuthorityRefusal,
  CreateStaffInput,
  StaffProfile,
  UpdateStaffInput,
} from "@/modules/staff/domain/staff";

/**
 * Reads and writes for `vppsone.staff_profiles`.
 *
 * **Reads go through the service role, after `assertStaff()`.** They used to
 * go through the cookie client, which worked only because every signed-in JWT
 * could read every column — phone numbers included (P1). The phone columns
 * are no longer readable directly, so this module reads them itself and hands
 * them back only to somebody whose screen shows them (`staff:view`). Names and
 * roles go to any active member of staff, because half the app puts a
 * colleague's name on the screen.
 *
 * Writes go through the service role too. Role and activation are not among
 * them: those are `changeStaffAuthority()`, an admin-only database command.
 */

const COLUMNS =
  "id, user_id, display_name, short_name, role, phone, whatsapp_phone, " +
  "is_teaching, is_active, preferred_language, created_at";

type Row = {
  id: string;
  user_id: string | null;
  display_name: string;
  short_name: string;
  role: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  is_teaching: boolean;
  is_active: boolean;
  preferred_language: string | null;
  created_at: string;
};

function toStaffProfile(row: Row, showContact: boolean): StaffProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    shortName: row.short_name,
    role: resolveStaffRole(row.role),
    phone: showContact ? row.phone : null,
    whatsappPhone: showContact ? row.whatsapp_phone : null,
    isTeaching: row.is_teaching,
    isActive: row.is_active,
    language: resolveLanguage(row.preferred_language),
    createdAt: row.created_at,
  };
}

/** Whether the person asking may see colleagues' phone numbers. */
async function readerSeesContact(): Promise<boolean> {
  const reader = await assertStaff();
  return can(reader, "staff:view");
}

export async function listStaff(): Promise<StaffProfile[]> {
  return readStaffList(await readerSeesContact());
}

/**
 * `listStaff` for a member of staff verified by the AI connection: names to
 * any active staff, phone numbers withheld always — the AI connection's
 * projections never carry one, so it never reads one (plan §4.3).
 */
export async function listStaffAs(actor: VerifiedActor): Promise<StaffProfile[]> {
  assertActorStaff(actor);
  return readStaffList(false);
}

async function readStaffList(showContact: boolean): Promise<StaffProfile[]> {
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select(COLUMNS)
    .order("display_name")
    // The column list is a constant string, so supabase-js cannot infer the
    // row shape from it. Row is asserted here, next to the SELECT it belongs to.
    .returns<Row[]>();

  if (error) {
    throw new Error(`Could not read the staff list: ${error.message}`);
  }

  return data.map((row) => toStaffProfile(row, showContact));
}

export async function getStaffById(id: string): Promise<StaffProfile | null> {
  const showContact = await readerSeesContact();
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle<Row>();

  if (error) {
    throw new Error(`Could not read that staff member: ${error.message}`);
  }

  return data ? toStaffProfile(data, showContact) : null;
}

/**
 * Case-insensitive, because the unique index is. Used to answer "is this short
 * name taken" before the insert, so the form can say which field is wrong
 * instead of surfacing a constraint violation.
 */
export async function findByShortName(
  shortName: string,
): Promise<StaffProfile | null> {
  const showContact = await readerSeesContact();
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select(COLUMNS)
    .ilike("short_name", shortName)
    .maybeSingle<Row>();

  if (error) {
    throw new Error(`Could not check that short name: ${error.message}`);
  }

  return data ? toStaffProfile(data, showContact) : null;
}

/**
 * Is this profile a test account (`is_test_account`)? Fail closed: a read we
 * could not make, or no such profile, is "no".
 */
export async function isTestProfile(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select("is_test_account")
    .eq("id", id)
    .maybeSingle<{ is_test_account: boolean | null }>();
  if (error) return false;
  return data?.is_test_account === true;
}

/**
 * Phase 3 (D-340; PR #143 review): a test account — and, on a confined
 * deployment, everybody — manages only test accounts. A real admin manages
 * anybody. The database says the same in `change_staff_authority`.
 */
export async function actorMayManage(actor: { isTestAccount?: boolean }, targetId: string): Promise<boolean> {
  if (actor.isTestAccount !== true) return true;
  return isTestProfile(targetId);
}

export async function createStaff(
  input: CreateStaffInput,
  createdByUserId: string,
  options: { isTestAccount?: boolean } = {},
): Promise<StaffProfile> {
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .insert({
      display_name: input.displayName,
      short_name: input.shortName,
      role: input.role,
      phone: input.phone,
      whatsapp_phone: input.whatsappPhone,
      is_teaching: input.isTeaching,
      preferred_language: input.preferredLanguage,
      is_active: true,
      created_by: createdByUserId,
      // A profile a test account creates is a test account (service role: the
      // flag guard lets the service role set it, never a signed-in user).
      ...(options.isTestAccount ? { is_test_account: true } : {}),
    })
    .select(COLUMNS)
    .single<Row>();

  if (error) {
    throw error;
  }

  return toStaffProfile(data, true);
}

/**
 * The ordinary edit: name, contact, teaching flag, language.
 *
 * `short_name` is absent on purpose — it is immutable, enforced by a trigger.
 * Sending it would turn an ordinary save into a constraint error. `role` and
 * `is_active` are absent too: who somebody is allowed to be is not an ordinary
 * edit, and the office may make this one (D-205).
 */
export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({
      display_name: input.displayName,
      phone: input.phone,
      whatsapp_phone: input.whatsappPhone,
      is_teaching: input.isTeaching,
      preferred_language: input.preferredLanguage,
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

/**
 * Change somebody's role or switch their access on or off.
 *
 * One database command, `vppsone.change_staff_authority`, which re-reads the
 * actor *now* (an hour-old admin page does not make somebody an admin), refuses
 * a change to one's own authority, keeps at least one active administrator
 * under concurrent requests, and appends the change to
 * `staff_authority_changes` with who made it.
 *
 * Deactivating rather than deleting, still: a profile is referenced by the
 * timetable, attendance and marks, and `short_name` is the join key.
 */
export async function changeStaffAuthority(input: {
  actorStaffId: string;
  targetStaffId: string;
  role: StaffRole;
  isActive: boolean;
  reason?: string | null;
}): Promise<{ ok: true; changed: boolean } | { ok: false; reason: AuthorityRefusal }> {
  const { data, error } = await createAdminClient().rpc("change_staff_authority", {
    p_actor_staff_id: input.actorStaffId,
    p_target_staff_id: input.targetStaffId,
    p_role: input.role,
    p_is_active: input.isActive,
    p_reason: input.reason ?? null,
  });

  if (error) throw error;

  const result = data as { ok: boolean; changed?: boolean; reason?: AuthorityRefusal };
  if (!result.ok) return { ok: false, reason: result.reason ?? "not_admin" };

  // Disabling a login ends their AI connections too (plan §5.4). The call
  // pipeline refuses an inactive account on its next call whatever happens
  // here, so a failure is not the action's failure — the check that counts
  // is the per-call one.
  if (!input.isActive) {
    await revokeStaffAiConnections(input.targetStaffId, "staff_disabled", input.actorStaffId).catch(() => 0);
  }
  return { ok: true, changed: Boolean(result.changed) };
}
