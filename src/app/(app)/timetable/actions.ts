"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { m } from "@/messages";
import { assertPermission } from "@/platform/auth/current-staff";
import { t } from "@/platform/i18n/language";
import {
  listClassAliases,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { parseTimetable } from "@/modules/timetable/domain/parse-timetable";
import {
  buildContext,
  resolveImport,
} from "@/modules/timetable/domain/resolve-import";
import {
  idleImportState,
  type ImportState,
} from "@/modules/timetable/domain/import-state";
import {
  createDraft,
  deleteDraft,
  publishVersion,
} from "@/modules/timetable/data/timetable-repo";


/**
 * Read the master data and resolve a pasted sheet against it.
 *
 * Shared by the check and the save, so a draft can never be written from a
 * different resolution than the one the school looked at.
 */
async function check(sheet: string) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;

  const [aliases, subjects, staff] = await Promise.all([
    listClassAliases(sessionLabel),
    listSubjects(),
    listStaff(),
  ]);

  const parsed = parseTimetable(sheet);
  const context = buildContext({
    classAliases: aliases.map((alias) => ({
      timetableLabel: alias.timetableLabel,
      classId: alias.classId,
    })),
    // Only active teaching staff: a timetable naming somebody who has left is
    // a problem the school should see, not something to resolve quietly.
    teachers: staff
      .filter((person) => person.isActive && person.isTeaching)
      .map((person) => ({ shortName: person.shortName, id: person.id })),
    subjects: subjects
      .filter((subject) => subject.isActive)
      .map((subject) => ({ code: subject.code, id: subject.id })),
  });

  return { sessionLabel, parsed, report: resolveImport(parsed, context) };
}

export async function checkSheetAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  await assertPermission("timetable:manage");

  const sheet = (formData.get("sheet") ?? "").toString();
  const label = (formData.get("label") ?? "").toString().trim();

  if (!sheet.trim()) {
    return {
      ...idleImportState,
      status: "error",
      label,
      message: t("शीट खाली है।", "The sheet is empty."),
    };
  }

  const result = await check(sheet);
  if (!result) {
    return { ...idleImportState, status: "error", sheet, label, message: m.noSessionFound };
  }

  return { status: "checked", report: result.report, sheet, label, message: null };
}

export async function saveDraftAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const actor = await assertPermission("timetable:manage");

  const sheet = (formData.get("sheet") ?? "").toString();
  const label = (formData.get("label") ?? "").toString().trim();

  if (!label) {
    return {
      ...idleImportState,
      status: "error",
      sheet,
      message: t("इस शीट को कोई नाम दें।", "Give this sheet a name."),
    };
  }

  const result = await check(sheet);
  if (!result) {
    return { ...idleImportState, status: "error", sheet, label, message: m.noSessionFound };
  }

  // Re-resolved here rather than trusting what the form carries: the master
  // data may have changed since the check, which is the whole point of
  // somebody having gone away to fix it.
  if (!result.report.canPublish) {
    return { status: "checked", report: result.report, sheet, label, message: null };
  }

  let versionId: string;
  try {
    versionId = await createDraft({
      sessionLabel: result.sessionLabel,
      label,
      notes: null,
      sourceText: sheet,
      cellCount: result.report.counts.cells,
      slots: result.report.slots,
      createdByUserId: actor.userId,
    });
  } catch {
    return { ...idleImportState, status: "error", sheet, label, message: m.notSaved };
  }

  revalidatePath("/timetable");
  redirect(`/timetable/${versionId}`);
}

export async function publishVersionAction(formData: FormData) {
  const actor = await assertPermission("timetable:manage");

  const versionId = (formData.get("versionId") ?? "").toString();
  const sessionLabel = await resolveSessionLabel();
  if (!versionId || !sessionLabel) return;

  await publishVersion(versionId, sessionLabel, actor.userId);

  revalidatePath("/timetable");
  revalidatePath(`/timetable/${versionId}`);
}

export async function deleteDraftAction(formData: FormData) {
  await assertPermission("timetable:manage");

  const versionId = (formData.get("versionId") ?? "").toString();
  if (!versionId) return;

  await deleteDraft(versionId);
  revalidatePath("/timetable");
  redirect("/timetable");
}
