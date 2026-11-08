import "server-only";

import { linkSiblingsAction, unlinkSiblingAction } from "@/app/(app)/fees/students/sibling-actions";
import { getWorkbookStudentFinancials } from "@/modules/fees/data/queries";
import { buildClassLabel } from "@/modules/fees/domain/policy-shaping";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import type { BridgeFamilyGroup } from "@/platform/fees-bridge/screen-read-contracts";

import { buildFamilyBook, type FamilyGroupRow, type FamilyMemberRow, type FamilyStudentRow } from "./domain/family-book";

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

/**
 * The Families screen's read from One's own copy (test accounts and TEST
 * sessions; real staff on a real year read Fees, `getBridgeFamilies`). Every
 * linked family of the session, or one (`groupId`), in the shape Fees sends.
 */
export async function loadFamilyBook(sessionLabel: string, groupId: string | null = null): Promise<BridgeFamilyGroup[]> {
  await requireStaffPermission("fees:view");
  const admin = createAdminClient();
  const [groups, members] = await Promise.all([
    fetchAllPages<FamilyGroupRow>((from, to) => {
      const q = admin.from("student_family_groups").select("id, family_label, guardian_name, guardian_phone").eq("academic_session_label", sessionLabel);
      return (groupId ? q.eq("id", groupId) : q).order("id").range(from, to);
    }),
    fetchAllPages<FamilyMemberRow>((from, to) => {
      const q = admin.from("student_family_members").select("family_group_id, student_id, sibling_order, is_policy_candidate").eq("academic_session_label", sessionLabel);
      return (groupId ? q.eq("family_group_id", groupId) : q).order("family_group_id").order("student_id").range(from, to);
    }),
  ]);
  if (groups.error || members.error) throw new Error("Could not read families.");
  type ClassRef = { class_name: string; section: string | null; stream_name: string | null; session_label: string };
  type Row = Omit<FamilyStudentRow, "classLabel"> & { class_ref: ClassRef | ClassRef[] | null };
  const ids = [...new Set(members.data.map((m) => m.student_id))];
  const [students, money] = await Promise.all([
    fetchInChunks<Row>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin
        .from("students")
        .select("id, full_name, admission_no, status, father_name, mother_name, primary_phone, secondary_phone, village_city, photo_path, class_ref:classes!inner(class_name, section, stream_name, session_label)")
        .eq("class_ref.session_label", sessionLabel)
        .in("id", chunk),
    ),
    ids.length === 0
      ? Promise.resolve([])
      : getWorkbookStudentFinancials(groupId ? { sessionLabel, studentIds: ids } : { sessionLabel }),
  ]);
  if (students.error) throw new Error("Could not read family members.");
  return buildFamilyBook({
    groups: groups.data,
    members: members.data,
    money,
    students: students.data.map(({ class_ref, ...s }) => {
      const ref = Array.isArray(class_ref) ? (class_ref[0] ?? null) : class_ref;
      return { ...s, classLabel: ref ? buildClassLabel(ref) : "" };
    }),
  });
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
