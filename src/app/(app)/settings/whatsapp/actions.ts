"use server";

import { redirect } from "next/navigation";

import { submitHubTemplateSet, syncHubTemplates } from "@/modules/whatsapp/data/hub-templates";
import { writeSignInMode } from "@/modules/whatsapp/data/sign-in-codes";
import { syncSettledToSource } from "@/modules/whatsapp/data/whatsapp-source-sync";
import { isSignInMode } from "@/modules/whatsapp/domain/sign-in-code";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { assertNotTestAccount, isSessionAccessDenied } from "@/platform/auth/test-session-access";
import { getSiteUrl } from "@/platform/env";
import { rethrowNextSignal } from "@/platform/helpers/next-signals";
import { feesAppSendsRealYear, isWhatsAppFeature } from "@/platform/whatsapp/policy";
import { checkConnection, retryMessage } from "@/platform/whatsapp/service";
import { readMessage, readSwitches, setFeatureSwitch, setPracticeMode } from "@/platform/whatsapp/store";
import { assertNotPreviewing } from "@/vx/view-as";

/*
 * Settings → WhatsApp (D-562, D-566). Every action: `settings:manage` and an
 * admin by role, not previewing another role. Anything that changes what the
 * whole school sends — a switch, a template check, sending templates to Meta
 * for approval, a Retry — also refuses a test account. "Check connection" only
 * reads, so a test admin may press it.
 *
 * No action here can let a message reach a real parent: real recipients and
 * the owner's test number are not switches this page has. Nor can one mark a
 * template approved: only the hub's own list does that (D-566).
 */

const PAGE = "/settings/whatsapp";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The card a button sits on: a refusal is answered beside it, like any other answer. */
type Area = "conn" | "practice" | "feature" | "hub" | "templates" | "retry" | "signin";

/**
 * After `assertPermission("settings:manage")`, which every action calls first
 * itself. "See One as" and a practice account are refused in plain words on
 * the page (`<area>_locked`), not with the error screen: the button is on
 * screen for them, so pressing it is not a fault. Anything else still throws.
 */
async function adminOnly(actor: CurrentStaff, area: Area, options: { changesSchool: boolean }): Promise<CurrentStaff> {
  try {
    await assertNotPreviewing();
  } catch (caught) {
    rethrowNextSignal(caught);
    back(`${area}_locked`, { why: "preview" });
  }
  if (actor.role !== "admin") throw new Error("Permission denied: admin");
  if (options.changesSchool) {
    try {
      await assertNotTestAccount(actor);
    } catch (caught) {
      if (!isSessionAccessDenied(caught)) throw caught;
      back(`${area}_locked`, { why: "test" });
    }
  }
  return actor;
}

function back(note: string, extra: Record<string, string | number | null | undefined> = {}): never {
  const params = new URLSearchParams({ note });
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && String(value) !== "") params.set(key, String(value).slice(0, 240));
  }
  redirect(`${PAGE}?${params.toString()}#${note.split("_")[0]}`);
}

export async function checkConnectionAction(): Promise<void> {
  await adminOnly(await assertPermission("settings:manage"), "conn", { changesSchool: false });
  const answer = await checkConnection().catch(() => null);
  if (answer?.ok) back("conn_ok", { name: answer.verifiedName, quality: answer.quality });
  back("conn_bad", { why: answer?.problem ?? "No answer." });
}

export async function setPracticeModeAction(formData: FormData): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "practice", { changesSchool: true });
  const on = String(formData.get("on") ?? "");
  if (on !== "true" && on !== "false") back("save_bad");
  const ok = await setPracticeMode(on === "true", actor.id);
  back(ok ? (on === "true" ? "practice_on" : "practice_off") : "save_bad");
}

export async function setFeatureAction(formData: FormData): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "feature", { changesSchool: true });
  const feature = String(formData.get("feature") ?? "");
  const on = String(formData.get("on") ?? "");
  if (!isWhatsAppFeature(feature) || (on !== "true" && on !== "false")) back("save_bad");
  const ok = await setFeatureSwitch(feature, on === "true", actor.id);
  // The Fees app sends this kind to the real families from its own number, so
  // switched on here it is One's for the test year only (policy.ts, D-649):
  // the answer says so in as many words.
  const testYearOnly = ok && on === "true" && feesAppSendsRealYear(feature, (await readSwitches())?.feeSender);
  back(ok ? (testYearOnly ? "feature_test_year" : "feature_saved") : "save_bad", { feature });
}

/**
 * Who may sign in with a WhatsApp code (D-585). Changes the whole school's
 * sign-in page, so a practice account is refused. The hub keeps its own
 * switch for codes to numbers other than the owner's (`auth_send_mode`), so
 * "all staff" here cannot by itself send a code to a number the hub has not
 * been told is allowed.
 */
export async function setSignInModeAction(formData: FormData): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "signin", { changesSchool: true });
  const mode = String(formData.get("mode") ?? "");
  if (!isSignInMode(mode)) back("save_bad");
  const ok = await writeSignInMode(mode, actor.id).catch(() => false);
  back(ok ? "signin_saved" : "signin_bad");
}

export async function syncTemplatesAction(): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "templates", { changesSchool: true });
  const answer = await syncHubTemplates({ staffId: actor.id }, getSiteUrl()).catch(() => ({ ok: false as const, problem: "No answer." }));
  if (answer.ok) back("templates_ok", { approved: answer.approved, checked: answer.checked, missing: answer.missing });
  back("templates_bad", { why: answer.problem });
}

/** The `_v8` set to Meta for review through the hub. Templates only: nothing reaches a parent. */
export async function submitHubTemplatesAction(): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "hub", { changesSchool: true });
  const answer = await submitHubTemplateSet({ staffId: actor.id }).catch(() => ({ ok: false as const, problem: "No answer." }));
  if (!answer.ok) back("hub_bad", { why: answer.problem });
  back("hub_sent", { sent: answer.sent, skipped: answer.skipped, failed: answer.failed.length, why: answer.failed[0]?.problem });
}

export async function retryMessageAction(formData: FormData): Promise<void> {
  const actor = await adminOnly(await assertPermission("settings:manage"), "retry", { changesSchool: true });
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) back("retry_bad");
  const before = await readMessage(id);
  const outcome = await retryMessage(id, { userId: actor.userId }, { confirmUnknown: formData.get("confirmUnknown") === "1" });
  if (outcome.outcome === "cannot_retry") back(`retry_${outcome.code}`, { href: outcome.href });
  if (before) await syncSettledToSource(before, outcome).catch(() => undefined);
  back(`retry_${outcome.outcome}`, { why: "reason" in outcome ? outcome.reason : null });
}
