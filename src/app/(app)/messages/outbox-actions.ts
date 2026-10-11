"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { isReminderLanguage, isTemplateId, TEMPLATES } from "@/modules/whatsapp/vx/domain/reminders";
import { dateLabel, rupees, schoolToday } from "@/vx/format";
import { p, type Pair } from "@/vx/text";
import { assertNotPreviewing } from "@/vx/view-as";
import { tenDigits } from "@/vx/screens/messages/domain/messages";
import { canUndo, noticeCampaigns, outboxText, reminderMessages, waLink, type DueRow } from "@/vx/screens/messages/domain/outbox";
import { generalPolicyVersion, NOTICE_TEMPLATE, parentSendRow, queueCampaign, queueNotice, templateId } from "@/vx/screens/messages/queue";

/*
 * Messages → To send. Every action: `messages:send`, then
 * assertNotPreviewing(). Nothing here sends a message. Send hands back a wa.me
 * link that opens the person's own WhatsApp with the text filled in, and marks
 * the row sent by them (D-10: a parent message is pressed by a person). Undo
 * puts it back for a few minutes, for a tap that did not end in a send.
 */

export type OutboxResult = { ok: true; message: Pair; link?: string } | { ok: false; message: Pair };

const fail = (message: Pair): OutboxResult => ({ ok: false, message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isSource = (s: unknown): s is "send" | "queue" => s === "send" || s === "queue";

async function routeFlagged(phone: string): Promise<boolean> {
  const { data } = await createAdminClient().from("parent_route_flags").select("phone").is("cleared_at", null).returns<{ phone: string }[]>();
  return (data ?? []).some((f) => tenDigits(f.phone) === phone);
}

/** Open WhatsApp for one queued message and mark it sent by this person. */
export async function sendByHandAction(input: { source: string; id: string }): Promise<OutboxResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!isSource(input.source) || !UUID.test(input.id)) return fail(p("Pick a message.", "संदेश चुनें।"));
  const admin = createAdminClient();
  const now = new Date().toISOString();

  if (input.source === "send") {
    const { data: row } = await admin
      .from("message_sends")
      .select("id, to_phone, rendered_hi, rendered_en, status, stale_at")
      .eq("id", input.id)
      .maybeSingle<{ id: string; to_phone: string; rendered_hi: string; rendered_en: string; status: string; stale_at: string | null }>();
    if (!row) return fail(p("That message is gone.", "संदेश नहीं मिला।"));
    if (row.status !== "queued" && row.status !== "draft") return fail(p("Already sent or stopped.", "पहले ही भेजा या रोका जा चुका है।"));
    if (row.stale_at) return fail(p("Something changed since this was queued. It was not sent.", "कतार के बाद कुछ बदल गया। नहीं भेजा।"));
    const phone = tenDigits(row.to_phone);
    const link = waLink(phone, outboxText(row.rendered_hi, row.rendered_en));
    if (!phone || !link) return fail(p("This number is not a WhatsApp mobile number.", "यह व्हाट्सऐप मोबाइल नंबर नहीं है।"));
    if (await routeFlagged(phone)) return fail(p("Somebody reported this number as wrong. It was not sent.", "यह नंबर गलत बताया गया है। नहीं भेजा।"));
    const { data: done, error } = await admin
      .from("message_sends")
      .update({ status: "sent", sent_at: now, requested_by: actor.id })
      .eq("id", row.id)
      .in("status", ["queued", "draft"])
      .select("id");
    if (error || !done?.length) return fail(p("Not marked sent. Try again.", "भेजा दर्ज नहीं हुआ।"));
    revalidatePath("/messages");
    return { ok: true, link, message: p("Opened in WhatsApp · marked sent", "व्हाट्सऐप में खुला · भेजा दर्ज") };
  }

  const { data: row } = await admin
    .from("parent_message_queue")
    .select("id, student_id, body_hi, body_en, status")
    .eq("id", input.id)
    .maybeSingle<{ id: string; student_id: string; body_hi: string; body_en: string | null; status: string }>();
  if (!row) return fail(p("That message is gone.", "संदेश नहीं मिला।"));
  if (row.status !== "queued") return fail(p("Already sent or stopped.", "पहले ही भेजा या रोका जा चुका है।"));
  const { data: kid } = await admin
    .schema(FEE_SCHEMA)
    .from("students")
    .select("guardian_phone, primary_phone")
    .eq("id", row.student_id)
    .maybeSingle<{ guardian_phone: string | null; primary_phone: string | null }>();
  const phone = tenDigits(kid?.guardian_phone) ?? tenDigits(kid?.primary_phone);
  const link = waLink(phone, outboxText(row.body_hi, row.body_en));
  if (!phone || !link) return fail(p("This child has no WhatsApp number on record.", "इस बच्चे का व्हाट्सऐप नंबर दर्ज नहीं है।"));
  if (await routeFlagged(phone)) return fail(p("Somebody reported this number as wrong. It was not sent.", "यह नंबर गलत बताया गया है। नहीं भेजा।"));
  const { data: done, error } = await admin
    .from("parent_message_queue")
    .update({ status: "sent", sent_at: now, sent_by: actor.id })
    .eq("id", row.id)
    .eq("status", "queued")
    .select("id");
  if (error || !done?.length) return fail(p("Not marked sent. Try again.", "भेजा दर्ज नहीं हुआ।"));
  revalidatePath("/messages");
  return { ok: true, link, message: p("Opened in WhatsApp · marked sent", "व्हाट्सऐप में खुला · भेजा दर्ज") };
}

/** Put a row marked sent by hand back in the list, within a few minutes. */
export async function undoSentAction(input: { source: string; id: string }): Promise<OutboxResult> {
  await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!isSource(input.source) || !UUID.test(input.id)) return fail(p("Pick a message.", "संदेश चुनें।"));
  const admin = createAdminClient();
  const table = input.source === "send" ? "message_sends" : "parent_message_queue";
  const { data: row } = await admin.from(table).select("id, status, sent_at").eq("id", input.id).maybeSingle<{ id: string; status: string; sent_at: string | null }>();
  if (!row || row.status !== "sent" || !canUndo(row.sent_at)) return fail(p("Too late to undo: it stays marked sent.", "अब वापस नहीं हो सकता।"));
  const patch = input.source === "send" ? { status: "queued", sent_at: null } : { status: "queued", sent_at: null, sent_by: null };
  let q = admin.from(table).update(patch).eq("id", row.id).eq("status", "sent");
  if (input.source === "send") q = q.is("provider_message_id", null);
  const { error } = await q;
  if (error) return fail(p("Not undone. Try again.", "वापस नहीं हुआ।"));
  revalidatePath("/messages");
  return { ok: true, message: p("Back in To send", "फिर से भेजने की सूची में") };
}

/** A stable request id for one notice's one audience, so approving twice queues once. */
function requestIdFor(key: string): string {
  const h = createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Approve a calendar notice: one message per family (and colleague) in To send. */
export async function approveCalendarNoticeAction(id: string): Promise<OutboxResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(id)) return fail(p("Pick a notice.", "सूचना चुनें।"));
  const admin = createAdminClient();
  const { data: notice } = await admin
    .from("calendar_notices")
    .select("id, session_label, holiday_day, audience, rendered_hi, rendered_en, status, calendar_events(title)")
    .eq("id", id)
    .maybeSingle<{ id: string; session_label: string; holiday_day: string | null; audience: string; rendered_hi: string; rendered_en: string; status: string; calendar_events: { title: string } | null }>();
  if (!notice) return fail(p("That notice is gone.", "सूचना नहीं मिली।"));
  if (notice.status !== "awaiting_approval") return fail(p("This notice was already decided.", "इस सूचना पर फ़ैसला हो चुका है।"));

  const title = notice.calendar_events?.title ?? (notice.holiday_day ? `Holiday · ${dateLabel(notice.holiday_day)}` : "Notice");
  const hasHi = notice.rendered_hi.trim() && notice.rendered_hi.trim() !== notice.rendered_en.trim();
  let count = 0;
  let campaignId: string | null = null;
  for (const audience of noticeCampaigns(notice.audience)) {
    const result = await queueNotice({
      clientRequestId: requestIdFor(`${notice.id}:${audience}`),
      sessionLabel: notice.session_label,
      kind: audience === "staff" ? "staff" : notice.holiday_day ? "holiday" : "notice",
      title,
      hi: hasHi ? notice.rendered_hi : "",
      en: notice.rendered_en,
      language: hasHi ? "both" : "en",
      audience,
      classIds: [],
      createdBy: actor.id,
    });
    if (!result.ok) return fail(result.message);
    count += result.count;
    campaignId ??= result.campaignId;
  }
  await admin
    .from("calendar_notices")
    .update({ status: "approved", campaign_id: campaignId, decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("id", notice.id)
    .eq("status", "awaiting_approval");
  revalidatePath("/messages");
  revalidatePath("/calendar");
  return { ok: true, message: p(`${count} messages ready to send`, `${count} संदेश भेजने को तैयार`) };
}

export async function declineCalendarNoticeAction(id: string): Promise<OutboxResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(id)) return fail(p("Pick a notice.", "सूचना चुनें।"));
  const { error } = await createAdminClient()
    .from("calendar_notices")
    .update({ status: "cancelled", decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "awaiting_approval");
  if (error) return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  revalidatePath("/messages");
  revalidatePath("/calendar");
  return { ok: true, message: p("Notice not sent", "सूचना नहीं भेजी जाएगी") };
}

type BalanceRow = { student_id: string; student_name: string | null; father_name: string | null; father_phone: string | null; due_date: string | null; pending_amount: number | string | null };

/**
 * Prepare a fee reminder batch: one message per family, from what each owes
 * now. A family that has paid since gets nothing; late fee is never quoted.
 */
export async function prepareReminderBatchAction(id: string): Promise<OutboxResult> {
  const actor = await assertPermission("messages:send");
  await assertPermission("fees:view");
  await assertNotPreviewing();
  if (!UUID.test(id)) return fail(p("Pick a batch.", "बैच चुनें।"));
  const admin = createAdminClient();
  const { data: batch } = await admin
    .from("fee_reminder_batches")
    .select("id, session_label, name, template, language, audience_line, student_ids, status")
    .eq("id", id)
    .maybeSingle<{ id: string; session_label: string; name: string; template: string; language: string; audience_line: string | null; student_ids: string[]; status: string }>();
  if (!batch) return fail(p("That batch is gone.", "बैच नहीं मिला।"));
  if (batch.status !== "queued" && batch.status !== "scheduled") return fail(p("This batch was already prepared or stopped.", "यह बैच पहले ही तैयार या रद्द हो चुका है।"));
  if (!isTemplateId(batch.template) || !isReminderLanguage(batch.language)) return fail(p("This batch has an unknown message.", "इस बैच का संदेश पहचाना नहीं गया।"));
  const template = batch.template;
  const language = batch.language;

  const balances = await fetchInChunks<BalanceRow>(batch.student_ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin
      .schema(FEE_SCHEMA)
      .from("v_workbook_installment_balances")
      .select("student_id, student_name, father_name, father_phone, due_date, pending_amount")
      .eq("session_label", batch.session_label)
      .gt("pending_amount", 0)
      .in("student_id", chunk),
  );
  if (balances.error) return fail(p("Could not read what each family owes. Try again.", "बकाया नहीं पढ़ा जा सका।"));
  const rows: DueRow[] = balances.data
    .filter((r) => r.due_date)
    .map((r) => ({
      studentId: r.student_id,
      studentName: r.student_name ?? "Student",
      fatherName: r.father_name,
      phone: r.father_phone,
      dueDate: String(r.due_date).slice(0, 10),
      pending: Number(r.pending_amount) || 0,
    }));
  const { messages, noPhone, nothingOwed } = reminderMessages(rows, template, language, schoolToday(), rupees, dateLabel);
  if (messages.length === 0) return fail(p("Nobody in this batch owes this now, or no family has a WhatsApp number.", "इस बैच में अभी किसी पर यह बकाया नहीं, या नंबर नहीं।"));

  const parentTemplate = await templateId(NOTICE_TEMPLATE.parent);
  if (!parentTemplate) return fail(p("The school notice template is missing.", "सूचना टेम्पलेट नहीं मिला।"));
  const policyVersion = await generalPolicyVersion();
  const t = TEMPLATES[template];
  const result = await queueCampaign(
    {
      clientRequestId: batch.id,
      sessionLabel: batch.session_label,
      kind: "fee",
      title: `${t.label.en} · ${batch.audience_line ?? batch.name}`,
      hi: language === "en" ? null : t.hi,
      en: language === "hi" ? null : t.en,
      language,
      audience: "school",
      classIds: [],
      audienceLabel: `${batch.audience_line ?? "Families"} · ${messages.length}`,
      createdBy: actor.id,
    },
    messages.map((m) => parentSendRow({ phone: m.phone, name: m.parent, studentId: m.studentIds[0] ?? null, hi: m.hi, en: m.en }, parentTemplate, policyVersion)),
  );
  if (!result.ok) return fail(result.message);
  await admin
    .from("fee_reminder_batches")
    .update({ status: "prepared", campaign_id: result.campaignId, prepared_by: actor.id, prepared_at: new Date().toISOString() })
    .eq("id", batch.id)
    .in("status", ["queued", "scheduled"]);
  revalidatePath("/messages");
  revalidatePath("/reminders");
  const skipped = [nothingOwed ? `${nothingOwed} owe nothing now` : "", noPhone ? `${noPhone} without a number` : ""].filter(Boolean).join(", ");
  const skippedHi = [nothingOwed ? `${nothingOwed} पर अब बकाया नहीं` : "", noPhone ? `${noPhone} का नंबर नहीं` : ""].filter(Boolean).join(", ");
  return {
    ok: true,
    message: p(`${messages.length} messages ready to send${skipped ? ` · ${skipped}` : ""}`, `${messages.length} संदेश भेजने को तैयार${skippedHi ? ` · ${skippedHi}` : ""}`),
  };
}
