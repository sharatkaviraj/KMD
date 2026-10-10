"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

export type ScheduleResult = { ok: boolean; message: string };

const REPORTS = { collection: "Daily collection", defaulters: "Defaulter list", classwise: "Pending by class", daybook: "Day book" } as const;
const RECIPIENTS = ["Principal", "Admin", "Accountant", "Class teachers"] as const;
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * A scheduled report is recorded here. Nothing is sent from this action: the
 * sender job that would deliver it on WhatsApp costs money per message and is
 * not switched on (CLAUDE.md rule 8).
 */
export async function createScheduleAction(input: {
  reportKey: string;
  recipients: string[];
  frequency: string;
  weekday: number | null;
  sendTime: string;
}): Promise<ScheduleResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    if (!(input.reportKey in REPORTS)) throw new Error("Pick a report.");
    const recipients = [...new Set(input.recipients)].filter((r) => (RECIPIENTS as readonly string[]).includes(r));
    if (recipients.length === 0) throw new Error("Pick who gets it.");
    if (!["daily", "weekly", "monthly"].includes(input.frequency)) throw new Error("Pick how often.");
    if (!/^\d{2}:\d{2}$/.test(input.sendTime)) throw new Error("Pick a time.");
    const weekday = input.frequency === "weekly" ? Math.max(0, Math.min(6, Math.trunc(Number(input.weekday ?? 1)))) : null;
    const db = createAdminClient();
    const { error } = await db.from("acc_report_schedules").insert({
      report_key: input.reportKey,
      title: REPORTS[input.reportKey as keyof typeof REPORTS],
      recipients,
      frequency: input.frequency,
      weekday,
      send_time: input.sendTime,
      created_by: staff.id,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/reports");
    return { ok: true, message: "Scheduled" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not schedule." };
  }
}

export async function toggleScheduleAction(id: string, active: boolean): Promise<ScheduleResult> {
  try {
    await assertPermission("fees:view");
    await assertNotPreviewing();
    if (!isUuid(id)) throw new Error("Pick a schedule.");
    const db = createAdminClient();
    const { error } = await db.from("acc_report_schedules").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/reports");
    return { ok: true, message: active ? "Turned on" : "Turned off" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not change it." };
  }
}
