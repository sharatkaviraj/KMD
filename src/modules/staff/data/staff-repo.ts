import "server-only";

import { resolveStaffRole } from "@/platform/auth/permissions";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  CreateStaffInput,
  StaffProfile,
  UpdateStaffInput,
} from "@/modules/staff/domain/staff";

/**
 * Reads and writes for `vppsone.staff_profiles`.
 *
 * Reads go through the cookie client so RLS applies. Writes go through the
 * service-role client, which bypasses RLS — every caller has already run
 * `assertPermission("staff:manage")`, which is where the decision is made.
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

function toStaffProfile(row: Row): StaffProfile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    shortName: row.short_name,
    role: resolveStaffRole(row.role),
    phone: row.phone,
    whatsappPhone: row.whatsapp_phone,
    isTeaching: row.is_teaching,
    isActive: row.is_active,
    language: resolveLanguage(row.preferred_language),
    createdAt: row.created_at,
  };
}

export async function listStaff(): Promise<StaffProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select(COLUMNS)
    .order("display_name")
    // The column list is a constant string, so supabase-js cannot infer the
    // row shape from it. Row is asserted here, next to the SELECT it belongs to.
    .returns<Row[]>();

  if (error) {
    throw new Error(`Could not read the staff list: ${error.message}`);
  }

  return data.map(toStaffProfile);
}

export async function getStaffById(id: string): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle<Row>();

  if (error) {
    throw new Error(`Could not read that staff member: ${error.message}`);
  }

  return data ? toStaffProfile(data) : null;
}

/**
 * Case-insensitive, because the unique index is. Used to answer "is this short
 * name taken" before the insert, so the form can say which field is wrong
 * instead of surfacing a constraint violation.
 */
export async function findByShortName(
  shortName: string,
): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select(COLUMNS)
    .ilike("short_name", shortName)
    .maybeSingle<Row>();

  if (error) {
    throw new Error(`Could not check that short name: ${error.message}`);
  }

  return data ? toStaffProfile(data) : null;
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

  return toStaffProfile(data);
}

/**
 * `short_name` is absent on purpose — it is immutable, enforced by a trigger.
 * Sending it would turn an ordinary save into a constraint error.
 */
export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({
      display_name: input.displayName,
      role: input.role,
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
 * Deactivate and reactivate, rather than delete.
 *
 * A profile is referenced by the timetable, by attendance and by marks, and
 * `short_name` is the join key — so deleting one would orphan history that is
 * still true. Inactive means "not in the pickers", not "never existed".
 */
export async function setStaffActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await createAdminClient()
    .from("staff_profiles")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    throw error;
  }
}
