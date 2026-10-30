"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { CACHE_TAGS, expireTag } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { createArchive, runRestoreDrill } from "@/modules/archives/data/archive-repo";
import { saveAssistSettings } from "@/modules/assist/data/settings";
import { isAssistFeature } from "@/modules/assist/domain/features";
import { schoolToday } from "@/vx/format";
import { assertNotPreviewing } from "@/vx/view-as";
import { p, type Pair } from "@/vx/text";
import { changedFields, cleanProfile, EMPTY_PROFILE, PROFILE_PROBLEMS, profileProblems, type SchoolProfile } from "@/vx/screens/settings/domain/settings";
import { assertSessionWritable } from "@/platform/auth/test-session-access";

/*
 * Settings (design `Settings`). Every action: permission first, then
 * assertNotPreviewing(). The profile keeps a before/after row for every save;
 * backups and archives go through the existing archive engine (`jobs:run`).
 */

export type SettingsResult = { ok: boolean; message: Pair };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** History rows say whether an image changed, not the image itself. */
const forHistory = (profile: SchoolProfile) => ({ ...profile, logo: profile.logo ? "image" : null, signature: profile.signature ? "image" : null });

export async function saveProfileAction(input: unknown): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  const admin = createAdminClient();
  const { data: row } = await admin.from("school_settings").select("value").eq("key", "profile").maybeSingle<{ value: unknown }>();
  const before = row ? cleanProfile(row.value) : EMPTY_PROFILE;
  const after = cleanProfile(input, before);
  const problems = profileProblems(after);
  if (problems.length) return { ok: false, message: PROFILE_PROBLEMS[problems[0]] };
  const changed = changedFields(before, after);
  if (changed.length === 0 && row) return { ok: true, message: p("Nothing changed", "कुछ नहीं बदला") };

  const { error } = await admin.from("school_settings").upsert({ key: "profile", value: after, updated_by: actor.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  await admin.from("school_settings_history").insert({ key: "profile", before: row ? forHistory(before) : null, after: forHistory(after), changed_by: actor.id });
  revalidatePath("/settings");
  return { ok: true, message: p("School profile saved", "स्कूल प्रोफ़ाइल सहेजी गई") };
}

const ALERT_KEYS = ["day_not_closed", "big_payment", "absent_teacher", "parent_reply"] as const;

/** Large text and alerts, for the signed-in person only. */
export async function savePrefsAction(input: { largeText: boolean; alerts: Record<string, boolean> }): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  const alerts = Object.fromEntries(ALERT_KEYS.map((k) => [k, input.alerts?.[k] === true]));
  const { error } = await createAdminClient()
    .from("staff_ui_preferences")
    .upsert({ staff_profile_id: actor.id, large_text: input.largeText === true, alerts, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  // Large text is applied by the shell, so every screen re-renders with it.
  expireTag(CACHE_TAGS.uiPrefs);
  revalidatePath("/", "layout");
  return { ok: true, message: p("Saved", "सहेजा गया") };
}

/** A full copy now: an archive of every VPPS One table and document. */
export async function backupNowAction(): Promise<SettingsResult> {
  await assertPermission("settings:manage");
  const actor = await assertPermission("jobs:run");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false, message: p("No session is open.", "कोई सत्र खुला नहीं है।") };
  const result = await createArchive({ label: `Backup ${schoolToday()}`, sessionLabel, actorStaffId: actor.id });
  revalidatePath("/settings");
  return result.ok ? { ok: true, message: p("Copy made and sealed", "प्रति बन गई") } : { ok: false, message: p("The copy failed. Nothing was changed.", "प्रति नहीं बनी।") };
}

/** Archive a session under a name. */
export async function archiveSessionAction(input: { label: string; sessionLabel: string }): Promise<SettingsResult> {
  await assertPermission("settings:manage");
  const actor = await assertPermission("jobs:run");
  await assertSessionWritable(actor, input.sessionLabel);
  await assertNotPreviewing();
  const label = String(input.label ?? "").trim().slice(0, 120);
  const sessionLabel = String(input.sessionLabel ?? "").trim().slice(0, 40);
  if (!label || !sessionLabel) return { ok: false, message: p("Name the archive and pick a session.", "नाम और सत्र चुनें।") };
  const result = await createArchive({ label, sessionLabel, actorStaffId: actor.id });
  revalidatePath("/settings");
  return result.ok ? { ok: true, message: p("Archive built", "संग्रह बन गया") } : { ok: false, message: p("The archive failed.", "संग्रह नहीं बना।") };
}

/**
 * Restore, as far as this app goes: prove a copy restores by loading it into
 * scratch tables and re-hashing every file. Replacing live data is not done
 * from a screen.
 */
export async function restoreDrillAction(archiveId: string): Promise<SettingsResult> {
  await assertPermission("settings:manage");
  const actor = await assertPermission("jobs:run");
  await assertNotPreviewing();
  if (!UUID.test(archiveId)) return { ok: false, message: p("Pick a copy.", "प्रति चुनें।") };
  const report = await runRestoreDrill({ archiveId, actorStaffId: actor.id });
  revalidatePath("/settings");
  if (!report) return { ok: false, message: p("That copy is not ready.", "यह प्रति तैयार नहीं।") };
  return report.ok ? { ok: true, message: p("Restore check passed: every table and file came back", "जाँच सफल") } : { ok: false, message: p("Restore check failed — see the archive", "जाँच विफल") };
}

/**
 * Settings → AI helper (D-324): the master switch, the monthly budget in US
 * dollars, the daily cap per person and the features switched off. The
 * Claude Console key itself is never entered here: it lives in the
 * deployment's environment, where only the people who manage the deployment
 * can set it.
 */
export async function saveAssistSettingsAction(input: {
  enabled: boolean;
  monthlyBudgetUsd: number;
  dailyCapPerStaff: number;
  disabledFeatures: string[];
}): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  const budget = Number(input?.monthlyBudgetUsd);
  const cap = Number(input?.dailyCapPerStaff);
  if (!Number.isFinite(budget) || budget < 0 || budget > 1000) return { ok: false, message: p("The monthly budget must be between $0 and $1,000.", "मासिक बजट $0 से $1,000 के बीच हो।") };
  if (!Number.isInteger(cap) || cap < 0 || cap > 1000) return { ok: false, message: p("The daily limit must be a whole number up to 1,000.", "रोज़ की सीमा 1,000 तक की पूरी संख्या हो।") };
  const disabled = Array.isArray(input?.disabledFeatures) ? input.disabledFeatures.filter(isAssistFeature) : [];
  try {
    await saveAssistSettings(
      { enabled: input?.enabled === true, monthlyBudgetUsd: Math.round(budget * 100) / 100, dailyCapPerStaff: cap, disabledFeatures: [...new Set(disabled)] },
      actor.id,
    );
  } catch {
    return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  }
  revalidatePath("/settings");
  // The shell decides which AI buttons each person sees.
  revalidatePath("/", "layout");
  return { ok: true, message: p("AI helper settings saved", "AI सहायक की सेटिंग्स सहेजी गईं") };
}
