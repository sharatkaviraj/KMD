"use server";

import { redirect } from "next/navigation";

import { leaveLessonToPeople, removeLesson, teachLesson, type LessonChange } from "@/modules/whatsapp/data/helper-lessons";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { viewingTestSession } from "@/platform/auth/staff-scope";
import { rethrowNextSignal } from "@/platform/helpers/next-signals";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Settings → WhatsApp → Veer Patta AI → Teach it once (D-589). Every action:
 * `settings:manage` and an admin by role, not previewing another person.
 *
 * Which list a button changes is never read from the form: it is the list the
 * admin is looking at. A practice account, or an admin whose year pill is on
 * a test session, changes the practice family's list; only a real admin in
 * the real year changes real families'. So a practice account can teach the
 * practice helper freely and can never reach what real parents are told.
 */

const PAGE = "/settings/whatsapp/helper";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function back(note: string, extra: Record<string, string> = {}): never {
  const params = new URLSearchParams({ tab: "teach", note, ...extra });
  redirect(`${PAGE}?${params.toString()}#teach`);
}

/** Who may teach, after the action's own `settings:manage` check. */
async function teacher(actor: CurrentStaff): Promise<{ actor: CurrentStaff; practice: boolean }> {
  try {
    await assertNotPreviewing();
  } catch (caught) {
    rethrowNextSignal(caught);
    back("teach_locked", { why: "preview" });
  }
  if (actor.role !== "admin") back("teach_locked", { why: "role" });
  const practice = actor.isTestAccount === true || (await viewingTestSession());
  return { actor, practice };
}

function answered(change: LessonChange, done: string): never {
  back(change === "saved" ? done : `teach_${change}`);
}

function lessonId(formData: FormData): string {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) back("teach_gone");
  return id;
}

export async function teachLessonAction(formData: FormData): Promise<void> {
  const { actor, practice } = await teacher(await assertPermission("settings:manage"));
  const id = lessonId(formData);
  const change = await teachLesson({
    id,
    practice,
    question: String(formData.get("question") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    actorId: actor.id,
  }).catch((): LessonChange => "failed");
  answered(change, "teach_saved");
}

export async function leaveToPeopleAction(formData: FormData): Promise<void> {
  const { actor, practice } = await teacher(await assertPermission("settings:manage"));
  const id = lessonId(formData);
  const change = await leaveLessonToPeople({ id, practice, actorId: actor.id }).catch((): LessonChange => "failed");
  answered(change, "teach_people");
}

export async function removeLessonAction(formData: FormData): Promise<void> {
  const { practice } = await teacher(await assertPermission("settings:manage"));
  const id = lessonId(formData);
  const change = await removeLesson({ id, practice }).catch((): LessonChange => "failed");
  answered(change, "teach_removed");
}
