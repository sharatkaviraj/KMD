import "server-only";

import { listStaff } from "@/modules/staff/data/staff-repo";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";

import { tenDigits } from "./domain/messages";
import { canUndo, outboxText, UNDO_MINUTES, type OutboxSource } from "./domain/outbox";

/*
 * Messages → To send. What is waiting for a person to send by hand, and the
 * notices and reminder batches waiting to be turned into messages. Phone
 * numbers stay on the server: the page gets a masked number, and the wa.me
 * link is handed back only when somebody taps Send (sendByHandAction).
 */

export type OutboxItem = {
  source: OutboxSource;
  id: string;
  group: string;
  name: string;
  about: string;
  phone: string;
  preview: string;
  status: "queued" | "sent";
  sentAt: string | null;
  canUndo: boolean;
  blocked: boolean;
  queuedAt: string;
};

export type PendingNotice = { id: string; title: string; audience: string; recipients: number; textHi: string; textEn: string; by: string; at: string };
export type PendingBatch = { id: string; name: string; audienceLine: string; families: number; template: string; scheduledFor: string | null; by: string; at: string };

export type OutboxData = {
  items: OutboxItem[];
  /** Rows not shown because the list is capped. */
  more: number;
  notices: PendingNotice[];
  batches: PendingBatch[];
};

const LIMIT = 500;
const readFailure = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Read unavailable";

const mask = (phone: string | null) => {
  const d = tenDigits(phone) ?? "";
  return d ? `${d.slice(0, 5)} ••${d.slice(-3)}` : "—";
};

const QUEUE_KIND: Record<string, string> = {
  absent_alert: "Absent today",
  birthday: "Birthday",
  note: "Teacher's note",
  support_plan: "Support plan",
};

type SendRow = { id: string; to_phone: string; to_name: string | null; student_id: string | null; staff_profile_id: string | null; rendered_hi: string; rendered_en: string; campaign_id: string | null; status: string; requested_at: string; sent_at: string | null };
type QueueRow = { id: string; kind: string; student_id: string; body_hi: string; body_en: string | null; status: string; created_at: string; sent_at: string | null };
type StudentRow = { id: string; full_name: string | null; father_name: string | null; guardian_name: string | null; guardian_phone: string | null; primary_phone: string | null };

/** How many rows are waiting, for the tab count. Cheap: two head counts. */
export async function countOutbox(): Promise<number> {
  const admin = createAdminClient();
  const [a, b] = await Promise.all([
    admin.from("message_sends").select("id", { count: "exact", head: true }).in("status", ["queued", "draft"]).is("stale_at", null).is("request_id", null),
    admin.from("parent_message_queue").select("id", { count: "exact", head: true }).eq("status", "queued"),
  ]);
  if (a.error) throw new Error(`Could not count messages: ${a.error.message}`);
  if (b.error) throw new Error(`Could not count parent messages: ${b.error.message}`);
  return (a.count ?? 0) + (b.count ?? 0);
}

export async function loadOutbox(): Promise<OutboxData> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - UNDO_MINUTES * 60_000).toISOString();

  const [sends, recentSends, queue, recentQueue, flags, noticeRows, batchRows, staff] = await Promise.all([
    admin
      .from("message_sends")
      .select("id, to_phone, to_name, student_id, staff_profile_id, rendered_hi, rendered_en, campaign_id, status, requested_at, sent_at", { count: "exact" })
      .in("status", ["queued", "draft"])
      .is("stale_at", null)
      .is("request_id", null)
      .order("requested_at", { ascending: true })
      .limit(LIMIT)
      .returns<SendRow[]>(),
    admin
      .from("message_sends")
      .select("id, to_phone, to_name, student_id, staff_profile_id, rendered_hi, rendered_en, campaign_id, status, requested_at, sent_at")
      .eq("status", "sent")
      .is("provider_message_id", null)
      .is("request_id", null)
      .gte("sent_at", since)
      .returns<SendRow[]>(),
    admin
      .from("parent_message_queue")
      .select("id, kind, student_id, body_hi, body_en, status, created_at, sent_at", { count: "exact" })
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(LIMIT)
      .returns<QueueRow[]>(),
    admin.from("parent_message_queue").select("id, kind, student_id, body_hi, body_en, status, created_at, sent_at").eq("status", "sent").gte("sent_at", since).returns<QueueRow[]>(),
    admin.from("parent_route_flags").select("phone").is("cleared_at", null).returns<{ phone: string }[]>(),
    admin
      .from("calendar_notices")
      .select("id, event_id, holiday_day, audience, recipients, rendered_hi, rendered_en, requested_by, requested_at, calendar_events(title)")
      .eq("status", "awaiting_approval")
      .order("requested_at", { ascending: true })
      .returns<{ id: string; event_id: string | null; holiday_day: string | null; audience: string; recipients: number; rendered_hi: string; rendered_en: string; requested_by: string; requested_at: string; calendar_events: { title: string } | null }[]>(),
    admin
      .from("fee_reminder_batches")
      .select("id, name, audience_line, family_count, template, scheduled_for, created_by_name, created_at")
      .in("status", ["queued", "scheduled"])
      .order("created_at", { ascending: true })
      .returns<{ id: string; name: string; audience_line: string | null; family_count: number; template: string; scheduled_for: string | null; created_by_name: string | null; created_at: string }[]>(),
    listStaff(),
  ]);

  for (const result of [sends, recentSends, queue, recentQueue, flags, noticeRows, batchRows]) {
    if (result.error) throw new Error(`Could not read To send: ${result.error.message}`);
    if (!Array.isArray(result.data)) throw new Error("Could not read To send. Reload and try again.");
  }

  const sendRows = [...(sends.data ?? []), ...(recentSends.data ?? [])];
  const queueRows = [...(queue.data ?? []), ...(recentQueue.data ?? [])];
  const flagged = new Set((flags.data ?? []).map((f) => tenDigits(f.phone)).filter(Boolean));
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));

  const campaignIds = [...new Set(sendRows.map((r) => r.campaign_id).filter((id): id is string => Boolean(id)))];
  const studentIds = [...new Set([...sendRows.map((r) => r.student_id), ...queueRows.map((r) => r.student_id)].filter((id): id is string => Boolean(id)))];
  const [campaigns, students] = await Promise.all([
    fetchInChunks<{ id: string; title: string }>(campaignIds, IN_FILTER_CHUNK_SIZE, (chunk) => admin.from("message_campaigns").select("id, title").in("id", chunk)),
    fetchInChunks<StudentRow>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin.schema(FEE_SCHEMA).from("students").select("id, full_name, father_name, guardian_name, guardian_phone, primary_phone").in("id", chunk),
    ),
  ]);
  if (campaigns.error) throw new Error(`Could not read message groups: ${readFailure(campaigns.error)}`);
  if (students.error) throw new Error(`Could not read message recipients: ${readFailure(students.error)}`);
  const titleOf = new Map(campaigns.data.map((c) => [c.id, c.title]));
  const studentOf = new Map(students.data.map((s) => [s.id, s]));
  const now = new Date();

  const items: OutboxItem[] = [
    ...sendRows.map((r): OutboxItem => {
      const kid = r.student_id ? studentOf.get(r.student_id) : undefined;
      return {
        source: "send",
        id: r.id,
        group: r.campaign_id ? (titleOf.get(r.campaign_id) ?? "Notice") : "Reply to a parent",
        name: r.to_name ?? "—",
        about: kid?.full_name ? kid.full_name.split(/\s+/)[0] : r.staff_profile_id ? "Staff" : "",
        phone: mask(r.to_phone),
        preview: outboxText(r.rendered_hi, r.rendered_en).slice(0, 280),
        status: r.status === "sent" ? "sent" : "queued",
        sentAt: r.sent_at,
        canUndo: r.status === "sent" && canUndo(r.sent_at, now),
        blocked: flagged.has(tenDigits(r.to_phone)),
        queuedAt: r.requested_at,
      };
    }),
    ...queueRows.map((r): OutboxItem => {
      const kid = studentOf.get(r.student_id);
      const phone = kid ? tenDigits(kid.guardian_phone) ?? tenDigits(kid.primary_phone) : null;
      return {
        source: "queue",
        id: r.id,
        group: QUEUE_KIND[r.kind] ?? "From a teacher",
        name: kid?.guardian_name || kid?.father_name || "Parent",
        about: kid?.full_name ? kid.full_name.split(/\s+/)[0] : "",
        phone: mask(phone),
        preview: outboxText(r.body_hi, r.body_en).slice(0, 280),
        status: r.status === "sent" ? "sent" : "queued",
        sentAt: r.sent_at,
        canUndo: r.status === "sent" && canUndo(r.sent_at, now),
        blocked: !phone || flagged.has(phone),
        queuedAt: r.created_at,
      };
    }),
  ];

  return {
    items,
    more: Math.max(0, (sends.count ?? 0) - (sends.data?.length ?? 0)) + Math.max(0, (queue.count ?? 0) - (queue.data?.length ?? 0)),
    notices: (noticeRows.data ?? []).map((n) => ({
      id: n.id,
      title: n.calendar_events?.title ?? (n.holiday_day ? `Holiday · ${n.holiday_day}` : "Notice"),
      audience: n.audience,
      recipients: n.recipients,
      textHi: n.rendered_hi,
      textEn: n.rendered_en,
      by: staffName.get(n.requested_by) ?? "—",
      at: n.requested_at,
    })),
    batches: (batchRows.data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      audienceLine: b.audience_line ?? "",
      families: b.family_count,
      template: b.template,
      scheduledFor: b.scheduled_for,
      by: b.created_by_name ?? "—",
      at: b.created_at,
    })),
  };
}
