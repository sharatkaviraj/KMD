import "server-only";

import { assertStaff } from "@/platform/auth/current-staff";
import { can, resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
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
  const showContact = await readerSeesContact();
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

export async function createStaff(
  input: CreateStaffInput,
  createdByUserId: string,
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
  return result.ok
    ? { ok: true, changed: Boolean(result.changed) }
    : { ok: false, reason: result.reason ?? "not_admin" };
}
