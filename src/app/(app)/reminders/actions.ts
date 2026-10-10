"use server";

import { revalidatePath } from "next/cache";

import {
  audienceLine,
  isReminderLanguage,
  isSendTime,
  isTemplateId,
  messageCost,
  parseAudience,
  pickAudience,
  quotedAmount,
} from "@/modules/whatsapp/vx/domain/reminders";
import { isIsoDate } from "@/modules/receipts/vx/domain/day-close";
import { assertPermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/vx/format";
import { cancelBatch, insertBatch, listRules, updateRule } from "@/vx/screens/reminders/data";
import { loadAudience, resolveSession } from "@/vx/screens/reminders/load";
import { assertNotPreviewing } from "@/vx/view-as";

export type ReminderActionResult = { ok: true; id?: string } | { ok: false; error: string };

function failure(caught: unknown): { ok: false; error: string } {
  return { ok: false, error: caught instanceof Error ? caught.message : "Something went wrong. Try again." };
}

/**
 * Queue a reminder batch. QUEUED ONLY (CLAUDE.md rule 8): VPPS One never sends a
 * WhatsApp message; the fee app's sender does, after its own preview. The
 * audience is worked out again here, never trusted from the browser.
 */
export async function queueReminderAction(input: {
  audience: unknown;
  template: string;
  language: string;
  scheduleDay?: string | null;
  scheduleTime?: string | null;
}): Promise<ReminderActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    if (!isTemplateId(input.template)) return { ok: false, error: "Choose a message." };
    if (!isReminderLanguage(input.language)) return { ok: false, error: "Choose a language." };
    let scheduledFor: string | null = null;
    if (input.scheduleDay) {
      if (!isIsoDate(input.scheduleDay) || input.scheduleDay < schoolToday()) return { ok: false, error: "Pick a day from today on." };
      if (!isSendTime(input.scheduleTime)) return { ok: false, error: "Pick a time." };
      scheduledFor = `${input.scheduleDay}T${input.scheduleTime.padStart(2, "0")}:00:00+05:30`;
    }
    const filters = parseAudience(input.audience);
    const sessionLabel = await resolveSession();
    const { families } = await loadAudience(sessionLabel, schoolToday());
    const picked = pickAudience(families, filters);
    if (picked.length === 0) return { ok: false, error: "Nobody matches these filters." };
    const id = await insertBatch({
      sessionLabel,
      name: `${audienceLine(filters)} · ${input.template}`,
      template: input.template,
      language: input.language,
      audience: filters,
      audienceLine: audienceLine(filters),
      studentIds: picked.flatMap((f) => f.studentIds),
      familyCount: picked.length,
      moneyQuoted: picked.reduce((s, f) => s + quotedAmount(f, filters), 0),
      costEstimate: messageCost(picked.length),
      scheduledFor,
      createdBy: staff.id,
      createdByName: staff.displayName,
    });
    revalidatePath("/reminders");
    return { ok: true, id };
  } catch (caught) {
    return failure(caught);
  }
}

export async function cancelBatchAction(id: string): Promise<ReminderActionResult> {
  try {
    await assertPermission("fees:view");
    await assertNotPreviewing();
    await cancelBatch(id);
    revalidatePath("/reminders");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

/** Change an automatic rule's settings. Admin only; the sender itself is untouched. */
export async function saveRuleAction(input: {
  ruleKey: string;
  enabled: boolean;
  timingChoice: string;
  sendTime: string;
  audience: string;
  template: string;
  quietHours: boolean;
}): Promise<ReminderActionResult> {
  try {
    const staff = await assertPermission("fees:manage");
    await assertNotPreviewing();
    const rule = (await listRules()).find((r) => r.ruleKey === input.ruleKey);
    if (!rule) return { ok: false, error: "Rule not found." };
    if (!rule.timingOptions.includes(input.timingChoice)) return { ok: false, error: "Choose when." };
    if (!isSendTime(input.sendTime)) return { ok: false, error: "Choose a time." };
    if (input.audience !== "all" && input.audience !== "skip_promised") return { ok: false, error: "Choose who." };
    if (!isTemplateId(input.template)) return { ok: false, error: "Choose a message." };
    await updateRule(input.ruleKey, {
      enabled: input.enabled,
      timingChoice: input.timingChoice,
      sendTime: input.sendTime,
      audience: input.audience,
      template: input.template,
      quietHours: input.quietHours,
      updatedBy: staff.id,
    });
    revalidatePath("/reminders");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}
