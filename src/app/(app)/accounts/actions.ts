"use server";

import { revalidatePath } from "next/cache";

import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { describeStudentForQueue, searchFamilies } from "@/modules/finance-controls/vx/books-data";
import type { FamilyHit } from "@/modules/finance-controls/vx/types";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertStudentVisible } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/platform/supabase/admin";
import { schoolToday } from "@/vx/format";
import { assertNotPreviewing } from "@/vx/view-as";

export type HomeActionResult = { ok: boolean; message: string };

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail = (error: unknown): HomeActionResult => ({ ok: false, message: error instanceof Error ? error.message : "Could not save. Please try again." });

/** The big search box on Today. Read-only. */
export async function searchFamiliesAction(query: string): Promise<FamilyHit[]> {
  await assertPermission("fees:view");
  const session = await resolveViewSession({ cookieSession: await getViewSessionCookie() });
  return searchFamilies(query, schoolToday(), session.sessionLabel);
}

export async function addToQueueAction(studentId: string, note?: string): Promise<HomeActionResult> {
  try {
    const staff = await assertPermission("fees:collect");
    await assertNotPreviewing();
    if (!isUuid(studentId)) throw new Error("Pick a student.");
    await assertStudentVisible(staff, studentId);
    const who = await describeStudentForQueue(studentId);
    if (!who) throw new Error("That student is not on the roll.");
    const db = createAdminClient();
    const { data: waiting } = await db.from("acc_counter_queue").select("id").eq("student_id", studentId).is("served_at", null).is("left_at", null).limit(1);
    if (waiting?.length) throw new Error("Already waiting at the counter.");
    const { error } = await db.from("acc_counter_queue").insert({ student_id: studentId, family_label: who.familyLabel, note: note?.trim().slice(0, 120) || null, added_by: staff.id });
    if (error) throw new Error(error.message);
    revalidatePath("/accounts");
    return { ok: true, message: `${who.familyLabel} is waiting at the counter` };
  } catch (error) {
    return fail(error);
  }
}

/** Someone left the counter, was served, or "left" is undone. The queue is not money; its rows change. */
export async function updateQueueAction(id: string, change: "left" | "served" | "back"): Promise<HomeActionResult> {
  try {
    await assertPermission("fees:collect");
    await assertNotPreviewing();
    if (!isUuid(id)) throw new Error("Pick someone in the queue.");
    const db = createAdminClient();
    const now = new Date().toISOString();
    const patch = change === "left" ? { left_at: now } : change === "served" ? { served_at: now } : { left_at: null, served_at: null };
    const { error } = await db.from("acc_counter_queue").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/accounts");
    return { ok: true, message: change === "left" ? "Left the counter · kept on today’s dues list" : change === "served" ? "Served" : "Back in the queue" };
  } catch (error) {
    return fail(error);
  }
}

/** Pause or resume today's 4 pm fee reminders. Each change is a new row. */
export async function setRemindersPausedAction(paused: boolean): Promise<HomeActionResult> {
  try {
    const staff = await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const db = createAdminClient();
    const { error } = await db.from("acc_reminder_pauses").insert({ day: schoolToday(), paused, created_by: staff.id });
    if (error) throw new Error(error.message);
    revalidatePath("/accounts");
    return { ok: true, message: paused ? "Reminders paused for today" : "Reminders will go out at 4:00 pm" };
  } catch (error) {
    return fail(error);
  }
}
