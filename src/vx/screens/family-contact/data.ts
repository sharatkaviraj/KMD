import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { readsEveryClass } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { heldClassIds } from "@/modules/attendance/data/teaching-repo";

import { canLogFamilyContact, isContactOutcome, type ContactEntry } from "./domain";

type Row = {
  id: string;
  outcome: string | null;
  note: string | null;
  agreed_on: string | null;
  created_at: string;
  staff_profiles: { display_name: string } | null;
};

/**
 * May this reader see and record family contact for a child in `classId`?
 * Read once per page; the action asks the same question again before it
 * writes.
 */
export async function familyContactAccess(staff: CurrentStaff, sessionLabel: string, classId: string | null): Promise<boolean> {
  const everyClass = readsEveryClass(staff);
  if (everyClass) return true;
  if (!classId) return false;
  const held = new Set(await heldClassIds(staff.id, sessionLabel).catch(() => [] as string[]));
  return canLogFamilyContact({ readsEveryClass: everyClass, heldClassIds: held }, classId);
}

/** The latest family contacts for one child this session, newest first. */
export async function familyContacts(studentId: string, sessionLabel: string, limit = 5): Promise<ContactEntry[]> {
  const { data, error } = await createAdminClient()
    .from("student_followups")
    .select("id, outcome, note, agreed_on, created_at, staff_profiles!student_followups_created_by_fkey(display_name)")
    .eq("session_label", sessionLabel)
    .eq("student_id", studentId)
    .eq("kind", "contact")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Row[]>();
  if (error) throw new Error("Could not read the family's contact history.");
  return (data ?? []).flatMap((r) =>
    isContactOutcome(r.outcome)
      ? [{ id: r.id, outcome: r.outcome, note: r.note, agreedOn: r.agreed_on, at: r.created_at, by: r.staff_profiles?.display_name ?? "—" }]
      : [],
  );
}
