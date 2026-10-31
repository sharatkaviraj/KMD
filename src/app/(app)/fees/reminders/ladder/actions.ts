"use server";

import { redirect } from "next/navigation";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { getFeePolicySummary } from "@/modules/fees/data/policy";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import {
  archiveCampaign,
  listCampaigns,
  saveCampaign,
  setCampaignAuto,
} from "@/modules/whatsapp/data/campaign-store";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { isNoticeLanguage, type NoticeLanguage } from "@/modules/whatsapp/domain/campaigns";
import { parseCampaignSchedule, SCHEDULED_SENDS_LIVE } from "@/modules/whatsapp/domain/campaign-schedule";
import {
  DAILY_STEPS,
  dailyCampaignDraft,
  LADDER_STEPS,
  ladderCampaignDraft,
  type LadderCampaignDraft,
} from "@/modules/whatsapp/domain/reminder-ladder";

/**
 * The reminder plan's buttons. Every one of them writes ordinary saved
 * campaigns through `saveCampaign`, so the plan adds no second way to reach a
 * parent: the scheduled runner and the send screen read these exactly as they
 * read a campaign the office built by hand, under the same guards.
 *
 * `settings:write`, the sending permission — a campaign that may send itself is
 * the same authority as pressing Send.
 */

function back(params: Record<string, string>): never {
  redirect(`/fees/reminders/ladder?${new URLSearchParams(params).toString()}`);
}

async function context() {
  const supabase = createAdminClient();
  const sessionLabel = await resolveReminderSessionLabel(supabase);
  const policy = await getFeePolicySummary({ useAdmin: true }).catch(() => null);
  const calendar = buildInstallmentCalendar({
    schedule: policy?.installmentSchedule ?? [],
    today: istToday(),
  });
  return {
    supabase,
    sessionLabel,
    calendar,
    policyLateFeeAmount: Number(policy?.lateFeeFlatAmount ?? 0),
  };
}

async function createDrafts(
  drafts: readonly LadderCampaignDraft[],
  staffId: string | null,
): Promise<{ created: number; skipped: number }> {
  const { supabase, sessionLabel } = await context();
  // Archived ones too: "Remove" archives a step, and the (session, name)
  // unique index still counts archived rows — so re-adding a removed step hit
  // the name, reported "already there", and the step stayed "Not set up"
  // forever. A removed step is now brought back instead.
  const all = await listCampaigns(supabase, sessionLabel, { includeArchived: true });
  const planKey = (schedule: ReturnType<typeof parseCampaignSchedule>) =>
    schedule?.ladderStep
      ? `${schedule.everyDay ? "daily" : schedule.installment}:${schedule.ladderStep}`
      : null;
  // Steps that already have a LIVE campaign — by plan key, not by name, so a
  // step the office renamed is still recognised and never duplicated.
  const taken = new Set(
    all
      .filter((campaign) => !campaign.archivedAt)
      .map((campaign) => planKey(parseCampaignSchedule(campaign.schedule)))
      .filter((key): key is string => Boolean(key)),
  );

  let created = 0;
  let skipped = 0;
  for (const draft of drafts) {
    const key = `${draft.schedule.everyDay ? "daily" : draft.schedule.installment}:${draft.schedule.ladderStep}`;
    if (taken.has(key)) {
      skipped += 1;
      continue;
    }
    const input = {
      sessionLabel,
      name: draft.name,
      situation: draft.situation,
      language: draft.language,
      filters: draft.filters,
      lastDate: draft.lastDate,
      lateFeeAmount: draft.lateFeeAmount,
      lateFeeBasis: draft.lateFeeBasis,
      lateFeeSource: draft.lateFeeSource,
      schedule: { ...draft.schedule },
    };
    // The removed copy of this very step (same plan key, or the plan's name):
    // refresh it to today's draft and un-archive it, keeping its run history.
    const removed = all.find(
      (campaign) =>
        campaign.archivedAt &&
        (planKey(parseCampaignSchedule(campaign.schedule)) === key || campaign.name === draft.name),
    );
    if (removed) {
      const restored = await saveCampaign(supabase, input, staffId, removed.id);
      if ("duplicateName" in restored) {
        skipped += 1;
        continue;
      }
      await archiveCampaign(supabase, removed.id, false);
      created += 1;
      continue;
    }
    const result = await saveCampaign(supabase, input, staffId);
    // A name already in use is a campaign the office made by hand with the
    // plan's name. Leave it alone rather than overwrite their work.
    if ("duplicateName" in result) skipped += 1;
    else created += 1;
  }
  return { created, skipped };
}

function languageFrom(formData: FormData): NoticeLanguage {
  const raw = formData.get("language");
  return isNoticeLanguage(raw) ? raw : "hi";
}

/** Create the missing steps for one installment. */
export async function setUpInstallmentPlanAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });
  const installment = Number(formData.get("installment"));
  if (!Number.isInteger(installment) || installment < 1 || installment > 4) {
    back({ error: "Pick an installment." });
  }
  // One only: never "sends itself" while the timer is off
  // (SCHEDULED_SENDS_LIVE), as setStepAutoAction and the campaign form hold.
  const auto = SCHEDULED_SENDS_LIVE && formData.get("auto") === "on";
  const language = languageFrom(formData);

  let result: Record<string, string>;
  try {
    const { calendar, policyLateFeeAmount } = await context();
    const drafts = LADDER_STEPS.map((step) =>
      ladderCampaignDraft({ installment, step, calendar, language, policyLateFeeAmount, auto }),
    );
    const { created, skipped } = await createDrafts(drafts, String(staff.id ?? "") || null);
    result = {
      done: `Installment ${installment}: ${created} step${created === 1 ? "" : "s"} set up${
        skipped ? `, ${skipped} already there` : ""
      }.`,
    };
  } catch (caught) {
    result = { error: errorText(caught, "Could not set up the plan.") };
  }
  back(result);
}

/** Create the every-morning promise steps. */
export async function setUpDailyStepsAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });
  // One only: never "sends itself" while the timer is off (as above).
  const auto = SCHEDULED_SENDS_LIVE && formData.get("auto") === "on";
  const language = languageFrom(formData);
  let result: Record<string, string>;
  try {
    const { policyLateFeeAmount } = await context();
    const drafts = DAILY_STEPS.map((step) =>
      dailyCampaignDraft({ step, language, policyLateFeeAmount, auto }),
    );
    const { created, skipped } = await createDrafts(drafts, String(staff.id ?? "") || null);
    result = {
      done: `Every-morning steps: ${created} set up${skipped ? `, ${skipped} already there` : ""}.`,
    };
  } catch (caught) {
    result = { error: errorText(caught, "Could not set up the steps.") };
  }
  back(result);
}

/** "Sends itself" on or off, for one step. */
export async function setStepAutoAction(formData: FormData): Promise<void> {
  const staff = await requireStaffPermission("settings:write", { onDenied: "redirect" });
  const id = String(formData.get("campaignId") ?? "").trim();
  const auto = formData.get("auto") === "on";
  if (!id) back({ error: "No step named." });
  // Turning ON is refused while the timer is off — it would promise a send
  // nothing makes. Turning off is always allowed.
  if (auto && !SCHEDULED_SENDS_LIVE) {
    back({ error: "The 9:30 timer is off, so a step cannot send itself. Press Send when it is due." });
  }
  let result: Record<string, string>;
  try {
    const { supabase } = await context();
    await setCampaignAuto(supabase, id, auto, String(staff.id ?? "") || null);
    result = {
      done: auto
        ? "That step now sends itself at 9:30."
        : "That step now waits for somebody to press Send.",
    };
  } catch (caught) {
    result = { error: errorText(caught, "Could not change that step.") };
  }
  back(result);
}

/** Take one step out of the plan. Archived, never deleted: its runs are the record. */
export async function removeStepAction(formData: FormData): Promise<void> {
  await requireStaffPermission("settings:write", { onDenied: "redirect" });
  const id = String(formData.get("campaignId") ?? "").trim();
  if (!id) back({ error: "No step named." });
  let result: Record<string, string>;
  try {
    const { supabase } = await context();
    await archiveCampaign(supabase, id, true);
    result = { done: "Step removed from the plan. Its past runs are kept." };
  } catch (caught) {
    result = { error: errorText(caught, "Could not remove that step.") };
  }
  back(result);
}

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message.slice(0, 200) : fallback;
}
