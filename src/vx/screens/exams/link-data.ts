import "server-only";

import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";

/*
 * The no-login marks link (`/t/marks/<token>`). The token is the whole
 * authorization, the way a collection link's is (D-68): it names one teacher
 * and one exam, and reaches only the papers the timetable gives her in it.
 * A revoked link, a deactivated teacher or a teacher without marks:write
 * resolves to nothing.
 */

export type MarksLink = {
  id: string;
  assessmentId: string;
  sessionLabel: string;
  examLabel: { en: string; hi: string };
  staffId: string;
  staffName: string;
  language: Language;
};

export async function resolveMarksLink(token: string): Promise<MarksLink | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("exam_marks_links")
    .select(
      "id, assessment_id, staff_profile_id, revoked_at, assessments(session_label, label_en, label_hi), staff_profiles!exam_marks_links_staff_profile_id_fkey(display_name, role, is_active, preferred_language)",
    )
    .eq("token", token)
    .is("revoked_at", null)
    .maybeSingle<{
      id: string;
      assessment_id: string;
      staff_profile_id: string;
      assessments: { session_label: string; label_en: string; label_hi: string } | null;
      staff_profiles: { display_name: string; role: string; is_active: boolean; preferred_language: string | null } | null;
    }>();
  if (!data || !data.assessments || !data.staff_profiles?.is_active) return null;

  const { data: allowed } = await db
    .from("role_permissions")
    .select("permission")
    .eq("role", data.staff_profiles.role)
    .eq("permission", "marks:write")
    .maybeSingle();
  if (!allowed) return null;

  return {
    id: data.id,
    assessmentId: data.assessment_id,
    sessionLabel: data.assessments.session_label,
    examLabel: { en: data.assessments.label_en, hi: data.assessments.label_hi },
    staffId: data.staff_profile_id,
    staffName: data.staff_profiles.display_name,
    language: resolveLanguage(data.staff_profiles.preferred_language),
  };
}

export async function touchMarksLink(id: string): Promise<void> {
  await createAdminClient().from("exam_marks_links").update({ last_opened_at: new Date().toISOString() }).eq("id", id);
}
