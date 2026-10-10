import "server-only";

import { linkSiblingsAction, unlinkSiblingAction } from "@/app/(app)/fees/students/sibling-actions";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

/*
 * Linked families for Student tools → Families. Reads the fee app's own
 * sibling groups; merging and splitting call the School Fees sibling actions,
 * so the third-child rule and the fee recalculation come with them.
 */

export type LinkedFamily = { groupId: string; label: string | null; memberIds: string[] };

export async function loadLinkedFamilies(sessionLabel: string): Promise<LinkedFamily[]> {
  await requireStaffPermission("students:write");
  const admin = createAdminClient();
  const { data: groups, error } = await admin
    .from("student_family_groups")
    .select("id, family_label")
    .eq("academic_session_label", sessionLabel)
    .limit(2000);
  if (error) throw new Error(`Could not read families: ${error.message}`);
  const rows = (groups ?? []) as Array<{ id: string; family_label: string | null }>;
  const members = await fetchInChunks<{ family_group_id: string; student_id: string }>(
    rows.map((g) => g.id),
    IN_FILTER_CHUNK_SIZE,
    (chunk) => admin.from("student_family_members").select("family_group_id, student_id").in("family_group_id", chunk),
  );
  if (members.error) throw new Error("Could not read family members.");
  const byGroup = new Map<string, string[]>();
  for (const m of members.data) byGroup.set(m.family_group_id, [...(byGroup.get(m.family_group_id) ?? []), m.student_id]);
  return rows.map((g) => ({ groupId: g.id, label: g.family_label, memberIds: byGroup.get(g.id) ?? [] })).filter((g) => g.memberIds.length > 0);
}

/** Link children as one family: the first is the anchor, the rest its siblings. */
export async function mergeFamily(studentIds: string[], sessionLabel: string) {
  await requireStaffPermission("students:write");
  const [anchor, ...rest] = studentIds;
  if (!anchor || rest.length === 0) return { ok: false, message: "Pick at least two children." };
  const fd = new FormData();
  fd.set("studentId", anchor);
  fd.set("sessionLabel", sessionLabel);
  for (const id of rest) fd.append("siblingStudentIds", id);
  const state = await linkSiblingsAction({ status: "idle", message: null, familyGroupId: null }, fd);
  return { ok: state.status === "success", message: state.message ?? "", familyGroupId: state.familyGroupId };
}

/** Take one child out of a linked family. */
export async function splitFromFamily(studentId: string, familyGroupId: string, sessionLabel: string) {
  await requireStaffPermission("students:write");
  const fd = new FormData();
  fd.set("studentId", studentId);
  fd.set("familyGroupId", familyGroupId);
  fd.set("sessionLabel", sessionLabel);
  const state = await unlinkSiblingAction({ status: "idle", message: null }, fd);
  return { ok: state.status === "success", message: state.message ?? "" };
}
