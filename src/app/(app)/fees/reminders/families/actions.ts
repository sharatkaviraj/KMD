"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { assertStudentsVisible } from "@/platform/auth/test-session-access";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { writeReminderProfiles } from "@/modules/whatsapp/data/family-profiles";
import {
  isReminderProfile,
  type ReminderProfile,
} from "@/modules/whatsapp/domain/reminder-profile";

/**
 * The query string the office came from, so a save lands them back on the same
 * filtered page rather than the top of an unfiltered one.
 */
function returnQuery(formData: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["profile", "classId", "source", "q", "owing", "page"]) {
    const value = formData.get(`return:${key}`);
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  return params;
}

/** `""` posts as "follow the suggestion". Anything unrecognised is ignored. */
function readChoice(value: FormDataEntryValue | null): ReminderProfile | null | undefined {
  if (value === null) return undefined;
  const text = String(value).trim();
  if (text === "") return null;
  return isReminderProfile(text) ? text : undefined;
}

/**
 * Save the profile dropdowns on one page of the Families screen.
 *
 * Every row posts its choice AND what it was when the page rendered (`was:`),
 * so only the rows the office actually changed are written. A page of sixty
 * families with two changes is two writes, and nobody's "set by" is stamped
 * with a decision they did not make.
 */
export async function saveReminderProfilesAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });
  const params = returnQuery(formData);

  const changes: Array<{ studentId: string; profile: ReminderProfile | null }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("profile:")) continue;
    const studentId = key.slice("profile:".length);
    const next = readChoice(value);
    const was = readChoice(formData.get(`was:${studentId}`));
    if (next === undefined || !studentId) continue;
    if (next === (was ?? null)) continue;
    changes.push({ studentId, profile: next });
  }

  const supabase = createAdminClient();
  try {
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    const saved = await writeReminderProfiles(
      supabase,
      sessionLabel,
      changes,
      String(staff.id ?? staff.sub ?? "") || null,
    );
    params.set("saved", String(saved));
  } catch (caught) {
    params.set("error", caught instanceof Error ? caught.message.slice(0, 200) : "Could not save.");
  }

  redirect(`/fees/reminders/families?${params.toString()}`);
}

/**
 * File every family on the current page under one profile at once, or put them
 * all back on the suggestion.
 *
 * The ids travel as hidden inputs from the rendered page, so this reaches
 * exactly the families the office was looking at — never a re-run of the
 * filters, which could have moved underneath them since the page loaded.
 */
export async function setProfileForShownAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });
  const params = returnQuery(formData);

  // "" is "nothing picked" here, never "clear": clearing every profile on a
  // page is chosen by name ("suggested"), not reached by pressing Apply on the
  // control's opening value.
  const rawBulk = String(formData.get("bulkProfile") ?? "").trim();
  const choice = rawBulk === "" ? undefined : readChoice(rawBulk === "suggested" ? "" : rawBulk);
  const ids = formData
    .getAll("studentId")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (choice === undefined || ids.length === 0) {
    params.set("error", "Pick a profile to apply.");
    redirect(`/fees/reminders/families?${params.toString()}`);
  }

  const supabase = createAdminClient();
  try {
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    // One only (D-340): every student named is in a session this viewer may write.
    await assertStudentsVisible(null, ids);
    const saved = await writeReminderProfiles(
      supabase,
      sessionLabel,
      ids.map((studentId) => ({ studentId, profile: choice ?? null })),
      String(staff.id ?? staff.sub ?? "") || null,
    );
    params.set("saved", String(saved));
  } catch (caught) {
    params.set("error", caught instanceof Error ? caught.message.slice(0, 200) : "Could not save.");
  }

  redirect(`/fees/reminders/families?${params.toString()}`);
}
