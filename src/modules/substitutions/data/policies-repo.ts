import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  CoverPolicy,
  CoverPolicyInput,
  CoverRole,
} from "@/modules/substitutions/domain/policies";

type PolicyRow = {
  id: string;
  staff_profile_id: string;
  allowed_periods: number[];
  cover_role: CoverRole;
  max_auto_covers: number;
  note: string | null;
  staff_profiles: { display_name: string; short_name: string } | null;
};

const COLUMNS =
  "id, staff_profile_id, allowed_periods, cover_role, max_auto_covers, note, " +
  "staff_profiles!inner(display_name, short_name)";

export async function listCoverPolicies(
  sessionLabel: string,
): Promise<CoverPolicy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cover_policies")
    .select(COLUMNS)
    .eq("session_label", sessionLabel)
    .returns<PolicyRow[]>();

  if (error) throw new Error(`Could not read the cover policies: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    staffProfileId: row.staff_profile_id,
    staffName: row.staff_profiles?.display_name ?? "—",
    shortName: row.staff_profiles?.short_name ?? "—",
    allowedPeriods: row.allowed_periods,
    coverRole: row.cover_role,
    maxAutoCovers: row.max_auto_covers,
    note: row.note,
  }));
}

/**
 * Save one person's policy.
 *
 * An upsert on (session, staff): the editor offers one row per member of
 * staff, so saving it twice is an edit rather than a duplicate — the same
 * shape as the class-alias editor in task 1.4.
 */
export async function upsertCoverPolicy(
  input: CoverPolicyInput,
  sessionLabel: string,
  createdByUserId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("cover_policies")
    .upsert(
      {
        session_label: sessionLabel,
        staff_profile_id: input.staffProfileId,
        allowed_periods: input.allowedPeriods,
        cover_role: input.coverRole,
        max_auto_covers: input.maxAutoCovers,
        note: input.note,
        created_by: createdByUserId,
      },
      { onConflict: "session_label,staff_profile_id" },
    );

  if (error) throw error;
}

/**
 * Return somebody to the defaults.
 *
 * Deleting the row rather than writing the default values into it, because
 * "nobody has said anything about this person" and "somebody decided they work
 * the full day" should not look the same to the next coordinator.
 */
export async function clearCoverPolicy(
  staffProfileId: string,
  sessionLabel: string,
): Promise<void> {
  await assertPermission("substitutions:manage");

  const { error } = await createAdminClient()
    .from("cover_policies")
    .delete()
    .eq("staff_profile_id", staffProfileId)
    .eq("session_label", sessionLabel);

  if (error) throw error;
}
