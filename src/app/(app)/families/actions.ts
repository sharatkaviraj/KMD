"use server";

import { revalidatePath } from "next/cache";

import { FamilyChangeRefused } from "@/modules/students-fees/vx/domain/family-change";
import { findLocalChildren, linkLocalFamily, previewLocalFamilyChange, unlinkLocalFamily, type FamilyPickChild } from "@/modules/students-fees/vx/family-change";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertFamilyVisible, assertSessionWritable, assertStudentsVisible } from "@/platform/auth/test-session-access";
import { isSessionAccessDenied } from "@/platform/auth/test-session-policy";
import { lookupBridgeDirectory, postBridgeFamilyLink, postBridgeFamilyUnlink, previewBridgeFamilyChange } from "@/platform/fees-bridge/client";
import type { FamilyPreview } from "@/platform/fees-bridge/family-command-contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { familiesReadFees } from "@/vx/screens/families/load";
import { logBulkChange } from "@/vx/screens/student-tools/data";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Brothers and sisters from One's Families screens (owner, 8 Nov 2026):
 * find a child, see what a link or unlink would do, then save it. Real staff
 * on a real year go to Fees, which runs its own student page's engine as
 * them; test accounts and TEST years change One's own copy. Every action:
 * `fees:manage`, the session and the named children checked against the
 * viewer, never while seeing One as somebody else.
 *
 * Answers carry a problem code, never a raw error: the screen says each one
 * in plain words, and a lost answer (`uncertain`) is retried with the same
 * command id, so it can never link twice.
 */

export type FamilyProblem =
  | "not_enabled"
  | "read_only"
  | "signin"
  | "family_changed"
  | "family_conflict"
  | "not_found"
  | "unavailable"
  | "uncertain"
  | "failed";

type Fail = { ok: false; problem: FamilyProblem };

export type FamilySaved = {
  ok: true;
  /** Null when an unlink left fewer than two children and the family ended. */
  familyGroupId: string | null;
  memberIds: string[];
  /** False: saved, but Fees is still working out the 3rd Child Policy or dues; send the same change again. */
  settled: boolean;
};

function problem(error: unknown): FamilyProblem {
  if (error instanceof FamilyChangeRefused) return error.code;
  if (isSessionAccessDenied(error)) return "not_found";
  if (error instanceof FeesBridgeError) {
    // Fees has no family commands yet, so nothing can have been written: a definite answer even on a save.
    if (error.code === "family_commands_disabled") return "not_enabled";
    if (error.uncertain) return "uncertain";
    switch (error.code) {
      case "forbidden":
      case "office_commands_disabled":
        return "not_enabled";
      case "read_only":
        return "read_only";
      case "unauthorized":
        return "signin";
      case "family_changed":
      case "family_conflict":
      case "not_found":
        return error.code;
      case "invalid_request":
      case "idempotency_conflict":
        return "failed";
      default:
        return "unavailable";
    }
  }
  return "failed";
}

/** Children of this year matching a name, SR or father's name, for "Add a brother or sister". */
export async function findFamilyChildrenAction(input: { sessionLabel: string; query: string }): Promise<{ ok: true; children: FamilyPickChild[] } | Fail> {
  try {
    const staff = await assertPermission("fees:manage");
    await assertSessionWritable(staff, input.sessionLabel);
    await assertNotPreviewing();
    const live = familiesReadFees(staff, input.sessionLabel);
    const query = input.query.trim().slice(0, 100);
    if (query.length < 2) return { ok: true, children: [] };
    if (!live) return { ok: true, children: await findLocalChildren(input.sessionLabel, query) };
    const found = await lookupBridgeDirectory({ sessionLabel: input.sessionLabel, query, status: "active", pageSize: 10 });
    return {
      ok: true,
      children: found.students.map((s) => ({ id: s.id, name: s.fullName, sr: s.admissionNo, classLabel: s.classLabel, father: s.fatherName, hasPhoto: s.hasPhoto })),
    };
  } catch (error) {
    return { ok: false, problem: problem(error) };
  }
}

export type FamilyPreviewInput =
  | { sessionLabel: string; operation: "link"; studentIds: string[] }
  | { sessionLabel: string; operation: "unlink"; studentId: string; familyGroupId: string };

/** What the change would do. Writes nothing. */
export async function previewFamilyChangeAction(input: FamilyPreviewInput): Promise<{ ok: true; preview: FamilyPreview } | Fail> {
  try {
    const ids = input.operation === "link" ? input.studentIds : [input.studentId];
    const staff = await assertPermission("fees:manage");
    await assertSessionWritable(staff, input.sessionLabel);
    await assertStudentsVisible(staff, ids);
    if (input.operation === "unlink") await assertFamilyVisible(staff, input.familyGroupId);
    await assertNotPreviewing();
    const live = familiesReadFees(staff, input.sessionLabel);
    const preview = live ? await previewBridgeFamilyChange(input) : await previewLocalFamilyChange(input);
    return { ok: true, preview };
  } catch (error) {
    return { ok: false, problem: problem(error) };
  }
}

export type FamilySaveInput =
  | { kind: "family_link"; commandId: string; sessionLabel: string; studentIds: string[]; expectedMemberIds: string[] }
  | { kind: "family_unlink"; commandId: string; sessionLabel: string; studentId: string; familyGroupId: string; expectedMemberIds: string[] };

/** Save the change the preview showed. The same `commandId` again never changes the family twice. */
export async function saveFamilyChangeAction(input: FamilySaveInput): Promise<FamilySaved | Fail> {
  try {
    const ids = input.kind === "family_link" ? input.studentIds : [input.studentId];
    const staff = await assertPermission("fees:manage");
    await assertSessionWritable(staff, input.sessionLabel);
    await assertStudentsVisible(staff, ids);
    if (input.kind === "family_unlink") await assertFamilyVisible(staff, input.familyGroupId);
    await assertNotPreviewing();
    const live = familiesReadFees(staff, input.sessionLabel);
    let saved: FamilySaved;
    if (input.kind === "family_link") {
      const body = { commandId: input.commandId, sessionLabel: input.sessionLabel, studentIds: input.studentIds, expectedMemberIds: input.expectedMemberIds };
      if (live) {
        const r = await postBridgeFamilyLink(body);
        saved = { ok: true, familyGroupId: r.familyGroupId, memberIds: r.memberStudentIds, settled: r.after.settled };
      } else {
        const r = await linkLocalFamily(body);
        saved = { ok: true, familyGroupId: r.familyGroupId, memberIds: r.memberIds, settled: true };
      }
    } else {
      const body = { commandId: input.commandId, sessionLabel: input.sessionLabel, studentId: input.studentId, familyGroupId: input.familyGroupId, expectedMemberIds: input.expectedMemberIds };
      if (live) {
        const r = await postBridgeFamilyUnlink(body);
        saved = { ok: true, familyGroupId: r.familyGroupId, memberIds: r.familyGroupId ? r.memberStudentIds : [], settled: r.after.settled };
      } else {
        const r = await unlinkLocalFamily(body);
        saved = { ok: true, familyGroupId: r.familyGroupId, memberIds: r.memberIds, settled: true };
      }
    }
    // One's own record of who changed which family; Fees keeps its own audit too.
    await logBulkChange({
      kind: input.kind === "family_link" ? "merge" : "split",
      title: input.kind === "family_link" ? `Linked ${ids.length} children as one family` : "Took a child out of a family",
      detail: { studentIds: ids, familyGroupId: saved.familyGroupId, commandId: input.commandId, viaFees: live },
      staffId: staff.id,
    }).catch(() => undefined);
    revalidatePath("/families");
    if (saved.familyGroupId) revalidatePath(`/families/${saved.familyGroupId}`);
    if (input.kind === "family_unlink") revalidatePath(`/families/${input.familyGroupId}`);
    return saved;
  } catch (error) {
    return { ok: false, problem: problem(error) };
  }
}
