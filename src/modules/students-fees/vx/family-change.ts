import "server-only";

import { getWorkbookStudentFinancials } from "@/modules/fees/data/queries";
import { buildClassLabel } from "@/modules/fees/domain/policy-shaping";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import {
  familyLinkRequestSchema,
  familyPreviewRequestSchema,
  familyUnlinkRequestSchema,
  type FamilyLinkRequest,
  type FamilyPreview,
  type FamilyPreviewRequest,
  type FamilyUnlinkRequest,
} from "@/platform/fees-bridge/family-command-contracts";

import {
  FamilyChangeRefused,
  familyHousehold,
  linkedTogether,
  predictFamilyChange,
  sameHousehold,
  unlinkAlreadyLanded,
  type FamilyChangeMoney,
  type FamilyChangePolicy,
  type FamilyChangeStudent,
} from "./domain/family-change";
import { mergeFamily, splitFromFamily } from "./families";

/*
 * Brothers and sisters from One's own fee copy (8 Nov 2026): test accounts
 * and TEST years, where real staff on a real year go to Fees
 * (`previewBridgeFamilyChange`, `postBridgeFamily…`). Same shapes as Fees
 * answers, so the screen draws one thing.
 *
 * The preview reads the household, this year's money, Fee Setup's tuition
 * and who holds the 3rd Child Policy or Staff Child now. Saving checks that
 * the household is still the one the preview showed, then calls the ported
 * School Fees sibling actions (`mergeFamily` / `splitFromFamily`), which
 * bring the 3rd Child Policy and the dues recalculation with them.
 */

type ClassRef = { id: string; class_name: string; section: string | null; stream_name: string | null; session_label: string; sort_order: number | null };
type StudentRow = {
  id: string;
  full_name: string;
  admission_no: string | null;
  status: string | null;
  photo_path: string | null;
  class_id: string | null;
  father_name?: string | null;
  class_ref: ClassRef | ClassRef[] | null;
};
type MemberRow = { family_group_id: string; student_id: string };

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);
const rupees = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

/** Membership rows of these children, and then every member of the families they are in. */
async function readHousehold(operation: "link" | "unlink", studentIds: string[], familyGroupId: string | null) {
  const admin = createAdminClient();
  const own = await fetchInChunks<MemberRow>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.from("student_family_members").select("family_group_id, student_id").in("student_id", chunk),
  );
  if (own.error) throw new FamilyChangeRefused("failed", "Could not read the family.");
  const groups = operation === "unlink" ? [familyGroupId as string] : [...new Set(own.data.map((r) => r.family_group_id))];
  if (operation === "unlink" && !own.data.some((r) => r.family_group_id === familyGroupId)) {
    throw new FamilyChangeRefused("not_found", "This child is not in that family.");
  }
  const members = await fetchInChunks<MemberRow>(groups, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.from("student_family_members").select("family_group_id, student_id").in("family_group_id", chunk),
  );
  if (members.error) throw new FamilyChangeRefused("failed", "Could not read the family.");
  return familyHousehold({
    operation,
    studentIds,
    familyGroupId,
    rows: members.data.map((r) => ({ studentId: r.student_id, familyGroupId: r.family_group_id })),
  });
}

/** What a link or unlink would do, from One's copy. Writes nothing. */
export async function previewLocalFamilyChange(raw: FamilyPreviewRequest): Promise<FamilyPreview> {
  await requireStaffPermission("students:write");
  const input = familyPreviewRequestSchema.parse(raw);
  const session = input.sessionLabel;
  const named = input.operation === "link" ? input.studentIds : [input.studentId];
  const familyGroupId = input.operation === "unlink" ? input.familyGroupId : null;
  const { expectedMemberIds, memberGroups } = await readHousehold(input.operation, named, familyGroupId);

  const admin = createAdminClient();
  const [students, policies] = await Promise.all([
    fetchInChunks<StudentRow>(expectedMemberIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin
        .from("students")
        .select("id, full_name, admission_no, status, photo_path, class_id, class_ref:classes(id, class_name, section, stream_name, session_label, sort_order)")
        .in("id", chunk),
    ),
    admin
      .from("conventional_discount_policies")
      .select("id, code, calculation_type, fixed_tuition_amount, percentage, is_active")
      .eq("academic_session_label", session)
      .in("code", ["third_child", "staff_child"]),
  ]);
  if (students.error || policies.error) throw new FamilyChangeRefused("failed", "Could not read the family.");

  const rows: FamilyChangeStudent[] = students.data.map((s) => {
    const ref = one(s.class_ref);
    return {
      id: s.id,
      fullName: s.full_name,
      admissionNo: s.admission_no ?? "",
      status: s.status ?? "active",
      classId: s.class_id,
      classSessionLabel: ref?.session_label ?? null,
      classSortOrder: ref?.sort_order ?? null,
      classLabel: ref ? buildClassLabel(ref) : null,
      hasPhoto: Boolean(s.photo_path),
    };
  });
  // Every child the request names must be in this year's classes.
  for (const id of named) {
    if (rows.find((s) => s.id === id)?.classSessionLabel !== session) throw new FamilyChangeRefused("not_found", "A child is not in this year.");
  }

  type PolicyRow = { id: string; code: string; calculation_type: string; fixed_tuition_amount: number | null; percentage: number | null; is_active: boolean };
  const policyRows = (policies.data ?? []) as PolicyRow[];
  const third = policyRows.find((p) => p.code === "third_child" && p.is_active) ?? null;
  const thirdIds = policyRows.filter((p) => p.code === "third_child").map((p) => p.id);
  const staffIds = policyRows.filter((p) => p.code === "staff_child" && p.is_active).map((p) => p.id);
  const policyIds = [...thirdIds, ...staffIds];

  type AssignmentRow = { student_id: string; policy_id: string; is_manual_override: boolean | null };
  const classIds = [...new Set(rows.filter((s) => s.classSessionLabel === session && s.classId).map((s) => s.classId as string))];
  const [assignments, fees, money] = await Promise.all([
    policyIds.length === 0
      ? Promise.resolve({ data: [] as AssignmentRow[], error: null })
      : fetchInChunks<AssignmentRow>(expectedMemberIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
          admin
            .from("student_conventional_discount_assignments")
            .select("student_id, policy_id, is_manual_override")
            .eq("academic_session_label", session)
            .eq("is_active", true)
            .in("policy_id", policyIds)
            .in("student_id", chunk),
        ),
    classIds.length === 0
      ? Promise.resolve({ data: [] as Array<{ class_id: string; tuition_fee_amount: number }>, error: null })
      : admin.from("fee_settings").select("class_id, tuition_fee_amount").eq("is_active", true).in("class_id", classIds),
    getWorkbookStudentFinancials({ sessionLabel: session, studentIds: expectedMemberIds }).catch(() => []),
  ]);
  if (assignments.error || fees.error) throw new FamilyChangeRefused("failed", "Could not read the family.");

  const thirdChildNow = new Map<string, { manual: boolean }>();
  const staffChildIds = new Set<string>();
  for (const a of assignments.data ?? []) {
    if (thirdIds.includes(a.policy_id)) thirdChildNow.set(a.student_id, { manual: Boolean(a.is_manual_override) });
    if (staffIds.includes(a.policy_id)) staffChildIds.add(a.student_id);
  }
  const moneyById = new Map<string, FamilyChangeMoney>(
    money.map((m) => [m.studentId, { yearFees: rupees(m.baseChargeTotal), feesPending: rupees(m.outstandingAmount), lateFeePending: rupees(m.lateFeeOutstandingAmount) }]),
  );
  const baseTuitionByClass = new Map<string, number>();
  for (const row of (fees.data ?? []) as Array<{ class_id: string; tuition_fee_amount: number }>) {
    if (!baseTuitionByClass.has(row.class_id)) baseTuitionByClass.set(row.class_id, rupees(row.tuition_fee_amount));
  }
  const thirdChildPolicy: FamilyChangePolicy | null = third
    ? { calculationType: third.calculation_type as FamilyChangePolicy["calculationType"], fixedTuitionAmount: third.fixed_tuition_amount, percentage: third.percentage }
    : null;

  return predictFamilyChange({
    household: { sessionLabel: session, operation: input.operation, studentIds: named, familyGroupId, expectedMemberIds, memberGroups },
    students: rows,
    money: moneyById,
    baseTuitionByClass,
    thirdChildPolicy,
    staffChildIds,
    thirdChildNow,
    // One's ported 3rd Child step does not know the Staff Child rule yet.
    staffChildOutranks: false,
  });
}

export type LocalFamilyChangeResult = {
  familyGroupId: string | null;
  memberIds: string[];
  message: string;
  /** False: the family changed, but the 3rd Child Policy or dues step after it stopped. "Finish" sends it again. */
  settled: boolean;
};

type EngineRun = { ok: boolean; message: string; familyGroupId?: string | null };

/**
 * Run a ported sibling action and keep what it threw. The engine saves the
 * family first and then works out the 3rd Child Policy and dues; when a later
 * step fails the family is already saved, so the caller reads the table
 * before it says anything (8 Nov 2026: a TEST link said "nothing was changed"
 * about a family it had made).
 */
async function runEngine(run: () => Promise<EngineRun>): Promise<{ res: EngineRun | null; thrown: unknown }> {
  try {
    return { res: await run(), thrown: null };
  } catch (thrown) {
    return { res: null, thrown };
  }
}

/** Every child in this family, straight from the table. */
async function familyMembers(familyGroupId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("student_family_members").select("student_id").eq("family_group_id", familyGroupId);
  if (error) throw new FamilyChangeRefused("failed", "Could not read the family.");
  return [...new Set(((data ?? []) as Array<{ student_id: string }>).map((r) => r.student_id))].sort();
}

/** Link children, if the household is still the one the preview showed. */
export async function linkLocalFamily(raw: FamilyLinkRequest): Promise<LocalFamilyChangeResult> {
  await requireStaffPermission("students:write");
  const input = familyLinkRequestSchema.parse(raw);
  const now = await readHousehold("link", input.studentIds, null);
  if (!sameHousehold(now.expectedMemberIds, input.expectedMemberIds)) throw new FamilyChangeRefused("family_changed");
  const { res, thrown } = await runEngine(() => mergeFamily(input.studentIds, input.sessionLabel));
  const after = await readHousehold("link", input.studentIds, null);
  const holder = linkedTogether(input.studentIds, after.memberGroups);
  const message = res?.message ?? "";
  if (res?.ok) return { familyGroupId: res.familyGroupId ?? holder, memberIds: after.expectedMemberIds, message, settled: true };
  if (holder) return { familyGroupId: holder, memberIds: after.expectedMemberIds, message, settled: false };
  if (thrown) throw thrown;
  throw new FamilyChangeRefused("failed", message);
}

/** Take one child out, if the family is still the one the preview showed. */
export async function unlinkLocalFamily(raw: FamilyUnlinkRequest): Promise<LocalFamilyChangeResult> {
  await requireStaffPermission("students:write");
  const input = familyUnlinkRequestSchema.parse(raw);
  const members = await familyMembers(input.familyGroupId);
  if (members.includes(input.studentId)) {
    if (!sameHousehold(members, input.expectedMemberIds)) throw new FamilyChangeRefused("family_changed");
  } else if (!unlinkAlreadyLanded(members, input.studentId, input.expectedMemberIds)) {
    throw new FamilyChangeRefused("not_found", "This child is not in that family.");
  }
  const { res, thrown } = await runEngine(() => splitFromFamily(input.studentId, input.familyGroupId, input.sessionLabel));
  const left = input.expectedMemberIds.filter((id) => id.toLowerCase() !== input.studentId.toLowerCase());
  const result = { familyGroupId: left.length >= 2 ? input.familyGroupId : null, memberIds: left.length >= 2 ? left : [], message: res?.message ?? "" };
  if (res?.ok) return { ...result, settled: true };
  if (!(await familyMembers(input.familyGroupId)).includes(input.studentId)) return { ...result, settled: false };
  if (thrown) throw thrown;
  throw new FamilyChangeRefused("failed", result.message);
}

export type FamilyPickChild = {
  id: string;
  name: string;
  sr: string;
  classLabel: string;
  father: string | null;
  hasPhoto: boolean;
};

/** Up to ten children of this year whose name, SR or father's name matches, for the "Add a brother or sister" picker. */
export async function findLocalChildren(sessionLabel: string, query: string): Promise<FamilyPickChild[]> {
  await requireStaffPermission("students:view");
  // PostgREST's or() filter splits on commas and brackets; a name never needs them.
  const words = query.replace(/[%*,().:"\\]/g, " ").trim().replace(/\s+/g, " ");
  if (words.length < 2) return [];
  const like = `%${words}%`;
  const { data, error } = await createAdminClient()
    .from("students")
    .select("id, full_name, admission_no, status, photo_path, class_id, father_name, class_ref:classes!inner(id, class_name, section, stream_name, session_label, sort_order)")
    .eq("class_ref.session_label", sessionLabel)
    .eq("status", "active")
    .or(`full_name.ilike.${like},admission_no.ilike.${like},father_name.ilike.${like}`)
    .order("full_name")
    .limit(10);
  if (error) throw new FamilyChangeRefused("failed", "Could not search the children.");
  return ((data ?? []) as StudentRow[]).map((s) => {
    const ref = one(s.class_ref);
    return {
      id: s.id,
      name: s.full_name,
      sr: s.admission_no ?? "",
      classLabel: ref ? buildClassLabel(ref) : "",
      father: s.father_name ?? null,
      hasPhoto: Boolean(s.photo_path),
    };
  });
}
