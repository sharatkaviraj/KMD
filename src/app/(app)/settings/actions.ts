"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { CACHE_TAGS, expireTag } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { createArchive, runRestoreDrill } from "@/modules/archives/data/archive-repo";
import { checkBuiltinAiKeys, mayChangeBuiltinAiLimit, mayCheckBuiltinAiKeys, setBuiltinAiDailyLimit } from "@/lib/ai/admin";
import { builtinAiPilot } from "@/lib/ai/config";
import { runFreeCheck } from "@/modules/assist/data/free-check";
import { getAssistSettings, saveAssistSettings } from "@/modules/assist/data/settings";
import { isAssistFeature } from "@/modules/assist/domain/features";
import { schoolToday } from "@/vx/format";
import { assertNotPreviewing } from "@/vx/view-as";
import { p, type Pair } from "@/vx/text";
import { changedFields, cleanProfile, EMPTY_PROFILE, PROFILE_PROBLEMS, profileProblems, type SchoolProfile } from "@/vx/screens/settings/domain/settings";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { cleanParentSwitches, DEFAULT_PARENT_SWITCHES, PARENT_SWITCHES_KEY, type ParentSwitches } from "@/vx/screens/settings/domain/parent-switches";

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

/**
 * What One may queue for parents (owner, 6 Nov): the register's absent-child
 * WhatsApp, "Tell parents" on a note, sharing a support plan and birthday
 * wishes. Admin only, with a before/after row like the profile.
 */
export async function saveParentSwitchesAction(input: ParentSwitches): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  const admin = createAdminClient();
  const { data: row, error: readError } = await admin.from("school_settings").select("value").eq("key", PARENT_SWITCHES_KEY).maybeSingle<{ value: unknown }>();
  if (readError) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  const before = row ? cleanParentSwitches(row.value) : DEFAULT_PARENT_SWITCHES;
  const after = cleanParentSwitches(input);
  const { error } = await admin.from("school_settings").upsert({ key: PARENT_SWITCHES_KEY, value: after, updated_by: actor.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  await admin.from("school_settings_history").insert({ key: PARENT_SWITCHES_KEY, before: row ? before : null, after, changed_by: actor.id });
  revalidatePath("/settings");
  revalidatePath("/teach", "layout");
  return { ok: true, message: p("Parent messages saved", "अभिभावक संदेश सहेजे गए") };
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

/**
 * Settings → AI helper → Switches (D-501): the photo and voice jobs' daily
 * limit per person. Only an admin may change it while built-in AI is live
 * (`mayChangeBuiltinAiLimit`); it moved here from the old Built-in AI page.
 */
export async function saveBuiltinAiLimitAction(limit: number): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (!builtinAiPilot() || !mayChangeBuiltinAiLimit(actor)) {
    return { ok: false, message: p("Only an admin can change this limit while photo and voice AI is on.", "फ़ोटो व आवाज़ AI चालू हो तो यह सीमा सिर्फ़ प्रशासक बदल सकते हैं।") };
  }
  if (!Number.isInteger(limit) || limit < 0 || limit > 200) return { ok: false, message: p("The daily limit must be a whole number from 0 to 200.", "रोज़ की सीमा 0 से 200 तक की पूरी संख्या हो।") };
  const ok = await setBuiltinAiDailyLimit(actor.id, limit).catch(() => false);
  if (!ok) return { ok: false, message: p("Not saved. Try again.", "सहेजा नहीं गया।") };
  revalidatePath("/settings");
  return { ok: true, message: p("Photo and voice limit saved", "फ़ोटो व आवाज़ की सीमा सहेजी गई") };
}

/**
 * Settings → AI in One → Cost → Check free models (D-567): every APInex free
 * model writes an invented notice and an invented cover plan, from this
 * server. It costs nothing and sends no school record, so any admin may run
 * it, a practice admin too; once in two minutes, so taps cannot spend the
 * free day's allowance.
 */
export async function checkFreeModelsAction(): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (actor.role !== "admin") return { ok: false, message: p("Only an admin can check the free models.", "मुफ़्त मॉडल सिर्फ़ प्रशासक जाँच सकते हैं।") };
  const last = (await getAssistSettings().catch(() => null))?.freeCheck?.at;
  if (last && Date.now() - Date.parse(last) < 120_000) {
    return { ok: false, message: p("They were checked a moment ago. Try again in two minutes.", "अभी-अभी जाँचे गए हैं। दो मिनट बाद फिर कोशिश करें।") };
  }
  const outcome = await runFreeCheck().catch(() => ({ ok: false as const, problem: "unavailable" as const }));
  revalidatePath("/settings");
  if (!outcome.ok) {
    if (outcome.problem === "no_key") return { ok: false, message: p("The APInex key is not set up on this server.", "इस सर्वर पर APInex कुंजी नहीं जुड़ी है।") };
    if (outcome.problem === "credential") return { ok: false, message: p("APInex did not accept the key.", "APInex ने कुंजी नहीं मानी।") };
    return { ok: false, message: p("APInex did not answer. Try again later.", "APInex ने जवाब नहीं दिया। बाद में कोशिश करें।") };
  }
  const { check } = outcome;
  if (check.blocked) return { ok: false, message: p("APInex's firewall turned this server away. Its free models are skipped for now.", "APInex की फ़ायरवॉल ने इस सर्वर को रोका। अभी इसके मुफ़्त मॉडल छोड़े जा रहे हैं।") };
  const models = [...new Set(check.results.map((r) => r.model))];
  const good = models.filter((m) => check.results.some((r) => r.model === m && r.ok)).length;
  return { ok: good > 0, message: p(`${good} of ${models.length} free models answered`, `${models.length} में से ${good} मुफ़्त मॉडलों ने जवाब दिया`) };
}

/** Settings → AI helper → Cost → Check keys now: one tiny request per key and model, on the server. */
export async function checkAiKeysAction(): Promise<SettingsResult> {
  const actor = await assertPermission("settings:manage");
  await assertNotPreviewing();
  if (!mayCheckBuiltinAiKeys(actor)) return { ok: false, message: p("Only an admin can check the keys.", "कुंजियाँ सिर्फ़ प्रशासक जाँच सकते हैं।") };
  const ok = await checkBuiltinAiKeys(actor.id).then(
    () => true,
    () => false,
  );
  revalidatePath("/settings");
  return ok ? { ok: true, message: p("Keys checked", "कुंजियाँ जाँची गईं") } : { ok: false, message: p("The check could not finish. Try again.", "जाँच पूरी नहीं हुई। फिर कोशिश करें।") };
}
