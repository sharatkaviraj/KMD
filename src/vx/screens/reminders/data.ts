import "server-only";

import { parseAudience, type AudienceFilters, type ReminderLanguage, type TemplateId } from "@/modules/whatsapp/vx/domain/reminders";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";

/*
 * The Reminders screen's own records in `vppsone`: batches prepared on the
 * wizard (QUEUED ONLY: nothing here sends, CLAUDE.md rule 8) and the settings
 * of the automatic rules. Reads use the signed-in client and RLS; writes the
 * service-role client, from actions that checked first.
 */

export type BatchRow = {
  id: string;
  name: string;
  template: TemplateId;
  language: ReminderLanguage;
  audience: AudienceFilters;
  audienceLine: string | null;
  studentIds: string[];
  familyCount: number;
  moneyQuoted: number;
  costEstimate: number;
  status: "queued" | "scheduled" | "cancelled";
  scheduledFor: string | null;
  createdByName: string | null;
  createdAt: string;
};

type BatchDb = {
  id: string;
  name: string;
  template: TemplateId;
  language: ReminderLanguage;
  audience: unknown;
  audience_line: string | null;
  student_ids: string[] | null;
  family_count: number;
  money_quoted: number | string;
  cost_estimate: number | string;
  status: BatchRow["status"];
  scheduled_for: string | null;
  created_by_name: string | null;
  created_at: string;
};

const BATCH_COLUMNS = "id, name, template, language, audience, audience_line, student_ids, family_count, money_quoted, cost_estimate, status, scheduled_for, created_by_name, created_at";

function toBatch(r: BatchDb): BatchRow {
  return {
    id: r.id,
    name: r.name,
    template: r.template,
    language: r.language,
    audience: parseAudience(r.audience),
    audienceLine: r.audience_line,
    studentIds: r.student_ids ?? [],
    familyCount: r.family_count,
    moneyQuoted: Number(r.money_quoted) || 0,
    costEstimate: Number(r.cost_estimate) || 0,
    status: r.status,
    scheduledFor: r.scheduled_for,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  };
}

export async function listBatches(sessionLabel: string): Promise<BatchRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_reminder_batches")
    .select(BATCH_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return ((data ?? []) as BatchDb[]).map(toBatch);
}

export async function getBatch(id: string): Promise<BatchRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("fee_reminder_batches").select(BATCH_COLUMNS).eq("id", id).limit(1);
  const row = ((data ?? []) as BatchDb[])[0];
  return row ? toBatch(row) : null;
}

export async function insertBatch(b: {
  sessionLabel: string;
  name: string;
  template: TemplateId;
  language: ReminderLanguage;
  audience: AudienceFilters;
  audienceLine: string;
  studentIds: string[];
  familyCount: number;
  moneyQuoted: number;
  costEstimate: number;
  scheduledFor: string | null;
  createdBy: string;
  createdByName: string;
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("fee_reminder_batches")
    .insert({
      session_label: b.sessionLabel,
      name: b.name,
      template: b.template,
      language: b.language,
      audience: b.audience,
      audience_line: b.audienceLine,
      student_ids: b.studentIds,
      family_count: b.familyCount,
      money_quoted: b.moneyQuoted,
      cost_estimate: b.costEstimate,
      status: b.scheduledFor ? "scheduled" : "queued",
      scheduled_for: b.scheduledFor,
      created_by: b.createdBy,
      created_by_name: b.createdByName,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function cancelBatch(id: string): Promise<void> {
  const { error } = await createAdminClient().from("fee_reminder_batches").update({ status: "cancelled" }).eq("id", id).neq("status", "cancelled");
  if (error) throw new Error(error.message);
}

export type RuleRow = {
  ruleKey: string;
  titleEn: string;
  titleHi: string | null;
  icon: string;
  timingOptions: string[];
  timingChoice: string;
  sendTime: string;
  audience: "all" | "skip_promised";
  template: TemplateId;
  quietHours: boolean;
  enabled: boolean;
  updatedAt: string;
};

export async function listRules(): Promise<RuleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_reminder_rules")
    .select("rule_key, title_en, title_hi, icon, timing_options, timing_choice, send_time, audience, template, quiet_hours, enabled, updated_at")
    .order("sort_order", { ascending: true });
  if (error) return [];
  return ((data ?? []) as {
    rule_key: string;
    title_en: string;
    title_hi: string | null;
    icon: string;
    timing_options: string[] | null;
    timing_choice: string;
    send_time: string;
    audience: "all" | "skip_promised";
    template: TemplateId;
    quiet_hours: boolean;
    enabled: boolean;
    updated_at: string;
  }[]).map((r) => ({
    ruleKey: r.rule_key,
    titleEn: r.title_en,
    titleHi: r.title_hi,
    icon: r.icon,
    timingOptions: r.timing_options ?? [],
    timingChoice: r.timing_choice,
    sendTime: r.send_time,
    audience: r.audience,
    template: r.template,
    quietHours: r.quiet_hours,
    enabled: r.enabled,
    updatedAt: r.updated_at,
  }));
}

export async function updateRule(
  ruleKey: string,
  patch: { enabled: boolean; timingChoice: string; sendTime: string; audience: "all" | "skip_promised"; template: TemplateId; quietHours: boolean; updatedBy: string },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("fee_reminder_rules")
    .update({
      enabled: patch.enabled,
      timing_choice: patch.timingChoice,
      send_time: patch.sendTime,
      audience: patch.audience,
      template: patch.template,
      quiet_hours: patch.quietHours,
      updated_by: patch.updatedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("rule_key", ruleKey);
  if (error) throw new Error(error.message);
}
