import "server-only";

import { contentHash } from "@/modules/collection/data/parent-messages-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { createAdminClient } from "@/platform/supabase/admin";
import { dayMonth } from "@/vx/format";
import { p, type Pair } from "@/vx/text";

import { loadFamilies } from "./data";
import { composeText, familiesFor, messageVariable, personalFor, tenDigits, type Audience, type NoticeKind, type NoticeLanguage } from "./domain/messages";

/*
 * Queueing a notice: one message_sends row per family or colleague, in one
 * transaction (queue_message_campaign). Shared by Messages → New notice, an
 * approved calendar notice and a prepared fee reminder batch. Nothing here
 * sends; a person sends each row from Messages → To send (D-10).
 */

export const NOTICE_TEMPLATE = { parent: "vx_school_notice", staff: "vx_staff_notice" } as const;

export type QueueResult = { ok: true; campaignId: string; count: number; duplicate: boolean } | { ok: false; message: Pair };

const fail = (message: Pair): QueueResult => ({ ok: false, message });

export async function templateId(code: string): Promise<string | null> {
  const { data } = await createAdminClient().from("message_templates").select("id").eq("code", code).maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

export async function generalPolicyVersion(): Promise<number> {
  const { data } = await createAdminClient()
    .from("parent_message_policies")
    .select("policy_version")
    .eq("category", "general")
    .maybeSingle<{ policy_version: number }>();
  return data?.policy_version ?? 0;
}

export type ParentRow = { phone: string; name: string; studentId: string | null; hi: string; en: string };

/** The message_sends row for one parent, with the snapshot P9 rechecks. */
export function parentSendRow(row: ParentRow, template: string, policyVersion: number): Record<string, unknown> {
  return {
    template_id: template,
    to_phone: row.phone,
    to_name: row.name,
    student_id: row.studentId,
    variables: [messageVariable({ hi: row.hi, en: row.en })],
    rendered_hi: row.hi,
    rendered_en: row.en,
    category: "general",
    snapshot: {
      destination: row.phone,
      contact: row.phone,
      record: row.studentId ? { kind: "student", id: row.studentId, version: null } : { kind: "none", id: null, version: null },
      content: contentHash(row.hi, row.en),
      policyVersion,
    },
  };
}

export async function queueCampaign(
  campaign: {
    clientRequestId: string;
    sessionLabel: string;
    kind: NoticeKind;
    title: string;
    hi: string | null;
    en: string | null;
    language: NoticeLanguage;
    audience: Audience;
    classIds: string[];
    audienceLabel: string;
    createdBy: string;
  },
  rows: Record<string, unknown>[],
): Promise<QueueResult> {
  if (rows.length === 0) return fail(p("Nobody to send to: no usable WhatsApp numbers.", "कोई व्हाट्सऐप नंबर नहीं मिला।"));
  const { data, error } = await createAdminClient().rpc("queue_message_campaign", {
    p_campaign: {
      client_request_id: campaign.clientRequestId,
      session_label: campaign.sessionLabel,
      kind: campaign.kind,
      title: campaign.title.trim().slice(0, 120),
      body_hi: campaign.hi,
      body_en: campaign.en,
      language: campaign.language,
      audience: campaign.audience,
      class_ids: campaign.audience === "classes" ? campaign.classIds : [],
      audience_label: campaign.audienceLabel,
      created_by: campaign.createdBy,
    },
    p_rows: rows,
  });
  const result = data as { ok: boolean; campaign_id?: string; duplicate?: boolean } | null;
  if (error || !result?.ok || !result.campaign_id) return fail(p("Not queued. Nothing was saved.", "कतार में नहीं गया।"));
  return { ok: true, campaignId: result.campaign_id, count: rows.length, duplicate: Boolean(result.duplicate) };
}

/**
 * A notice to the whole school, some classes, or the staff: every family gets
 * its own copy with the placeholders filled in. Idempotent on clientRequestId.
 */
export async function queueNotice(input: {
  clientRequestId: string;
  sessionLabel: string;
  kind: NoticeKind;
  title: string;
  hi: string;
  en: string;
  language: NoticeLanguage;
  audience: Audience;
  classIds: string[];
  createdBy: string;
}): Promise<QueueResult> {
  const compose = { title: input.title, hi: input.hi, en: input.en, language: input.language };
  const date = dayMonth(new Date());
  let rows: Record<string, unknown>[] = [];
  let audienceLabel = "";

  if (input.audience === "staff") {
    const id = await templateId(NOTICE_TEMPLATE.staff);
    if (!id) return fail(p("The staff notice template is missing.", "स्टाफ़ टेम्पलेट नहीं मिला।"));
    const staff = (await listStaff()).filter((s) => s.isActive);
    for (const person of staff) {
      const phone = tenDigits(person.whatsappPhone ?? person.phone);
      if (!phone) continue;
      const text = composeText(compose, { parent: person.displayName, student: "", className: "", date });
      rows.push({ template_id: id, to_phone: phone, to_name: person.displayName, staff_profile_id: person.id, variables: [messageVariable(text)], rendered_hi: text.hi, rendered_en: text.en, category: "general" });
    }
    audienceLabel = `All staff · ${rows.length}`;
  } else {
    const id = await templateId(NOTICE_TEMPLATE.parent);
    if (!id) return fail(p("The school notice template is missing.", "सूचना टेम्पलेट नहीं मिला।"));
    const { families, labels } = await loadFamilies(input.sessionLabel);
    const chosen = familiesFor(families, input.audience, input.classIds);
    const policyVersion = await generalPolicyVersion();
    rows = chosen.map((family) => {
      const text = composeText(compose, personalFor(family, input.classIds, date));
      const lead = family.children.find((c) => input.classIds.includes(c.classId)) ?? family.children[0];
      return parentSendRow({ phone: family.phone, name: family.parentName, studentId: lead?.id ?? null, hi: text.hi, en: text.en }, id, policyVersion);
    });
    audienceLabel =
      input.audience === "school"
        ? `All parents · ${rows.length}`
        : `${input.classIds.map((c) => labels.get(c) ?? "Class").slice(0, 4).join(", ")}${input.classIds.length > 4 ? ` +${input.classIds.length - 4}` : ""} parents · ${rows.length}`;
  }

  return queueCampaign(
    {
      clientRequestId: input.clientRequestId,
      sessionLabel: input.sessionLabel,
      kind: input.kind,
      title: input.title,
      hi: input.language === "en" ? null : input.hi.trim(),
      en: input.language === "hi" ? null : input.en.trim(),
      language: input.language,
      audience: input.audience,
      classIds: input.classIds,
      audienceLabel,
      createdBy: input.createdBy,
    },
    rows,
  );
}
