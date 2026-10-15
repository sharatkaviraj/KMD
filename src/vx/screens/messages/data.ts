import "server-only";

import { requirePermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { parentDispatchSwitch } from "@/modules/collection/data/parent-messages-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { dayMonth } from "@/vx/format";

import {
  buildFamilies,
  countSends,
  isNoticeKind,
  latestByRecipient,
  personalFor,
  tenDigits,
  type Family,
  type NoticeKind,
  type RollStudent,
  type SendCounts,
} from "./domain/messages";

/*
 * Everything the Messages screen reads. Fee tables (the roll, guardian
 * numbers) are read through the service role after `messages:send`, the same
 * way the collection screens read them; only counts and one sample family
 * reach the browser, never the whole list of numbers.
 */

export type CampaignView = {
  id: string;
  kind: NoticeKind;
  title: string;
  bodyHi: string;
  bodyEn: string;
  language: string;
  audience: string;
  audienceLabel: string;
  recipientCount: number;
  costPaise: number;
  status: string;
  createdAt: string;
  createdBy: string | null;
  counts: SendCounts;
};

export type RecipientView = {
  id: string;
  name: string;
  about: string;
  phone: string;
  status: string;
  error: string | null;
  at: string;
};

export type TemplateView = {
  id: string;
  code: string;
  label: string;
  bodyHi: string;
  bodyEn: string;
  audience: string;
  isActive: boolean;
  waCategory: string | null;
};

export type ReplyView = {
  id: string;
  fromName: string;
  phone: string;
  studentLabel: string | null;
  studentId: string | null;
  regarding: string | null;
  campaignTitle: string | null;
  campaignBody: string | null;
  body: string;
  receivedAt: string;
  assignedStaffId: string | null;
  status: string;
  answers: { id: string; body: string; at: string; by: string | null }[];
};

export type MessagesData = {
  sessionLabel: string | null;
  campaigns: CampaignView[];
  classes: { id: string; label: string; families: number }[];
  /** One entry per family: the classes its children are in. No names, no numbers. */
  classSets: string[][];
  staffCount: number;
  /** Every active staff member, with a number or not: a staff notice says who it misses (B10). */
  staffActive?: number;
  noPhone: number;
  sample: { parent: string; student: string; className: string } | null;
  templates: TemplateView[];
  replies: ReplyView[];
  staffChoices: { id: string; name: string }[];
  parentDispatchOn: boolean;
  month: { count: number; costPaise: number; queued: number; sent: number };
  detail: { campaign: CampaignView; recipients: RecipientView[] } | null;
};

type StudentRow = {
  id: string;
  full_name: string | null;
  father_name: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  primary_phone: string | null;
  class_id: string | null;
};

/** The active roll for a session, with a guardian number each. */
export async function loadRoll(sessionLabel: string): Promise<{ students: RollStudent[]; labels: Map<string, string> }> {
  const labels = await classLabelMap(sessionLabel);
  const classIds = [...labels.keys()];
  if (classIds.length === 0) return { students: [], labels };
  const admin = createAdminClient();
  const rows = await fetchAllRows<StudentRow>(
    (from, to) =>
      admin
        .schema(FEE_SCHEMA)
        .from("students")
        .select("id, full_name, father_name, guardian_name, guardian_phone, primary_phone, class_id")
        .eq("status", "active")
        .in("class_id", classIds)
        .order("id")
        .range(from, to)
        .returns<StudentRow[]>(),
    "the roll",
  );
  return {
    labels,
    students: rows
      .filter((r) => r.class_id)
      .map((r) => ({
        id: r.id,
        name: r.full_name ?? "Student",
        classId: r.class_id as string,
        classLabel: labels.get(r.class_id as string) ?? "Class",
        parentName: r.guardian_name || r.father_name,
        phone: r.guardian_phone || r.primary_phone,
      })),
  };
}

/** Families for the session: what both the page and the queue action count from. */
export async function loadFamilies(sessionLabel: string): Promise<{ families: Family[]; noPhone: number; labels: Map<string, string> }> {
  const { students, labels } = await loadRoll(sessionLabel);
  return { ...buildFamilies(students), labels };
}

type CampaignRow = {
  id: string;
  kind: string;
  title: string;
  body_hi: string | null;
  body_en: string | null;
  language: string;
  audience: string;
  audience_label: string;
  recipient_count: number;
  cost_paise: number;
  status: string;
  created_at: string;
  created_by: string;
};

type SendRow = { id: string; campaign_id: string; to_phone: string; to_name: string | null; student_id: string | null; staff_profile_id: string | null; status: string; error: string | null; requested_at: string; sent_at: string | null };

const mask = (phone: string) => {
  const d = phone.replace(/\D/g, "").slice(-10);
  return d.length >= 6 ? `${d.slice(0, 5)} ••${d.slice(-3)}` : d;
};

export async function loadMessagesScreen(detailId: string | null): Promise<MessagesData> {
  await requirePermission("messages:send", "/messages");
  const sessionLabel = await resolveSessionLabel();
  const admin = createAdminClient();

  const [roll, staff, campaignRows, templateRows, replyRows, dispatchOn] = await Promise.all([
    sessionLabel ? loadRoll(sessionLabel) : Promise.resolve({ students: [] as RollStudent[], labels: new Map<string, string>() }),
    listStaff(),
    sessionLabel
      ? admin
          .from("message_campaigns")
          .select("id, kind, title, body_hi, body_en, language, audience, audience_label, recipient_count, cost_paise, status, created_at, created_by")
          .eq("session_label", sessionLabel)
          .order("created_at", { ascending: false })
          .limit(200)
          .returns<CampaignRow[]>()
      : Promise.resolve({ data: [] as CampaignRow[] }),
    admin
      .from("message_templates")
      .select("id, code, label_en, body_hi, body_en, audience, is_active, wa_category, sort_order")
      .order("sort_order")
      .returns<{ id: string; code: string; label_en: string; body_hi: string; body_en: string; audience: string; is_active: boolean; wa_category: string | null }[]>(),
    sessionLabel
      ? admin
          .from("parent_replies")
          .select("id, from_name, from_phone, student_id, student_label, campaign_id, regarding, body, received_at, assigned_staff_id, status, parent_reply_answers(id, body, created_at, answered_by)")
          .eq("session_label", sessionLabel)
          .order("received_at", { ascending: false })
          .limit(200)
          .returns<
            {
              id: string;
              from_name: string;
              from_phone: string;
              student_id: string | null;
              student_label: string | null;
              campaign_id: string | null;
              regarding: string | null;
              body: string;
              received_at: string;
              assigned_staff_id: string | null;
              status: string;
              parent_reply_answers: { id: string; body: string; created_at: string; answered_by: string }[] | null;
            }[]
          >()
      : Promise.resolve({ data: [] }),
    parentDispatchSwitch().catch(() => false),
  ]);

  const campaigns = campaignRows.data ?? [];
  const ids = campaigns.map((c) => c.id);
  const sends = ids.length && sessionLabel
    ? await fetchAllRows<SendRow>(
        (from, to) =>
          admin
            .from("message_sends")
            .select("id, campaign_id, to_phone, to_name, student_id, staff_profile_id, status, error, requested_at, sent_at")
            .eq("session_label", sessionLabel)
            .not("campaign_id", "is", null)
            .order("id")
            .range(from, to)
            .returns<SendRow[]>(),
        "the notice log",
      )
    : [];

  const byCampaign = new Map<string, SendRow[]>();
  for (const row of sends) byCampaign.set(row.campaign_id, [...(byCampaign.get(row.campaign_id) ?? []), row]);

  const nameOf = new Map(staff.map((s) => [s.id, s.displayName]));
  const views: CampaignView[] = campaigns.map((c) => ({
    id: c.id,
    kind: isNoticeKind(c.kind) ? c.kind : "notice",
    title: c.title,
    bodyHi: c.body_hi ?? "",
    bodyEn: c.body_en ?? "",
    language: c.language,
    audience: c.audience,
    audienceLabel: c.audience_label,
    recipientCount: c.recipient_count,
    costPaise: c.cost_paise,
    status: c.status,
    createdAt: c.created_at,
    createdBy: nameOf.get(c.created_by) ?? null,
    counts: countSends(latestByRecipient(byCampaign.get(c.id) ?? [])),
  }));

  const { families, noPhone } = buildFamilies(roll.students);
  const perClass = new Map<string, number>();
  const classSets = families.map((f) => {
    const set = [...new Set(f.children.map((c) => c.classId))];
    for (const id of set) perClass.set(id, (perClass.get(id) ?? 0) + 1);
    return set;
  });
  const first = families.find((f) => f.children.length > 0);
  const today = new Date();

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const thisMonth = views.filter((v) => v.createdAt >= monthStart && v.status !== "cancelled");

  const studentLabel = new Map(roll.students.map((s) => [s.id, `${s.name.split(/\s+/)[0]} · ${s.classLabel}`]));
  let detail: MessagesData["detail"] = null;
  const chosen = detailId ? views.find((v) => v.id === detailId) : null;
  if (chosen) {
    const rows = latestByRecipient(byCampaign.get(chosen.id) ?? []).sort((a, b) => (a.to_name ?? "").localeCompare(b.to_name ?? ""));
    detail = {
      campaign: chosen,
      recipients: rows.map((r) => ({
        id: r.id,
        name: r.to_name ?? "—",
        about: r.student_id ? (studentLabel.get(r.student_id) ?? "Family") : r.staff_profile_id ? "Staff" : "",
        phone: mask(r.to_phone),
        status: r.status,
        error: r.error,
        at: r.sent_at ?? r.requested_at,
      })),
    };
  }

  const campaignById = new Map(views.map((v) => [v.id, v]));

  return {
    sessionLabel,
    campaigns: views,
    classes: [...roll.labels.entries()].map(([id, label]) => ({ id, label, families: perClass.get(id) ?? 0 })),
    classSets,
    staffCount: staff.filter((s) => s.isActive && tenDigits(s.whatsappPhone ?? s.phone)).length,
    staffActive: staff.filter((s) => s.isActive).length,
    noPhone,
    sample: first ? (({ parent, student, className }) => ({ parent, student, className }))(personalFor(first, [], dayMonth(today))) : null,
    templates: (templateRows.data ?? []).map((t) => ({
      id: t.id,
      code: t.code,
      label: t.label_en,
      bodyHi: t.body_hi,
      bodyEn: t.body_en,
      audience: t.audience,
      isActive: t.is_active,
      waCategory: t.wa_category,
    })),
    replies: (replyRows.data ?? []).map((r) => {
      const campaign = r.campaign_id ? campaignById.get(r.campaign_id) : undefined;
      return {
        id: r.id,
        fromName: r.from_name,
        phone: mask(r.from_phone),
        studentLabel: r.student_label,
        studentId: r.student_id,
        regarding: r.regarding ?? campaign?.title ?? null,
        campaignTitle: campaign?.title ?? null,
        campaignBody: campaign ? campaign.bodyHi || campaign.bodyEn : null,
        body: r.body,
        receivedAt: r.received_at,
        assignedStaffId: r.assigned_staff_id,
        status: r.status,
        answers: (r.parent_reply_answers ?? [])
          .map((a) => ({ id: a.id, body: a.body, at: a.created_at, by: nameOf.get(a.answered_by) ?? null }))
          .sort((a, b) => a.at.localeCompare(b.at)),
      };
    }),
    staffChoices: staff.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.displayName })),
    parentDispatchOn: dispatchOn,
    month: {
      count: thisMonth.reduce((n, v) => n + v.recipientCount, 0),
      costPaise: thisMonth.reduce((n, v) => n + v.costPaise, 0),
      queued: thisMonth.reduce((n, v) => n + v.counts.queued, 0),
      sent: thisMonth.reduce((n, v) => n + v.counts.sent, 0),
    },
    detail,
  };
}
