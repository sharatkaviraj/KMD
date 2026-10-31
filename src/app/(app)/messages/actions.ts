"use server";

import { revalidatePath } from "next/cache";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { contentHash } from "@/modules/collection/data/parent-messages-repo";
import { generalPolicyVersion, NOTICE_TEMPLATE, queueNotice, templateId } from "@/vx/screens/messages/queue";
import { assertNotPreviewing } from "@/vx/view-as";
import { p, type Pair } from "@/vx/text";
import {
  COMPOSE_PROBLEMS,
  composeProblems,
  costPaise,
  isNoticeKind,
  numberPlaceholders,
  templateSlug,
  tenDigits,
  type Audience,
  type NoticeLanguage,
} from "@/vx/screens/messages/domain/messages";

/*
 * Messages (design `Messages`). Every action: `messages:send`, then
 * assertNotPreviewing(). Nothing here sends: notices are queued one row per
 * family or colleague in `message_sends`, and a parent row stops there
 * (D-10, the parent_dispatch switch). Writes are append-only — a resend adds
 * rows, a cancel moves queued rows to cancelled.
 */

export type MessageResult =
  | { ok: true; message: Pair; campaignId?: string; count?: number; costPaise?: number }
  | { ok: false; message: Pair };

const fail = (message: Pair): MessageResult => ({ ok: false, message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Queue a notice to the whole school, some classes, or the staff. Idempotent on clientRequestId. */
export async function queueNoticeAction(input: {
  clientRequestId: string;
  kind: string;
  title: string;
  hi: string;
  en: string;
  language: string;
  audience: string;
  classIds: string[];
}): Promise<MessageResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();

  if (!UUID.test(input.clientRequestId)) return fail(p("Reload the page and try again.", "पेज दोबारा खोलें।"));
  const language: NoticeLanguage = input.language === "hi" || input.language === "en" ? input.language : "both";
  const audience: Audience = input.audience === "classes" || input.audience === "staff" ? input.audience : "school";
  const kind = isNoticeKind(input.kind) ? input.kind : audience === "staff" ? "staff" : "notice";
  const classIds = (Array.isArray(input.classIds) ? input.classIds : []).filter((id) => UUID.test(id)).slice(0, 100);
  const compose = { kind, title: String(input.title ?? ""), hi: String(input.hi ?? ""), en: String(input.en ?? ""), language, audience, classIds };
  const problems = composeProblems(compose);
  if (problems.length) return fail(COMPOSE_PROBLEMS[problems[0]]);

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail(p("No session is open.", "कोई सत्र खुला नहीं है।"));

  const result = await queueNotice({ clientRequestId: input.clientRequestId, sessionLabel, ...compose, createdBy: actor.id });
  if (!result.ok) return fail(result.message);
  revalidatePath("/messages");
  return {
    ok: true,
    campaignId: result.campaignId,
    count: result.count,
    costPaise: costPaise(result.count),
    message: result.duplicate
      ? p("Already queued — this is the same notice.", "यह सूचना पहले से कतार में है।")
      : p(`Queued for ${result.count} ${audience === "staff" ? "staff" : "families"}`, `${result.count} के लिए कतार में`),
  };
}

/** Stop a notice: every row still queued becomes cancelled. Rows already sent stay sent. */
export async function cancelNoticeAction(campaignId: string): Promise<MessageResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(campaignId)) return fail(p("Pick a notice.", "सूचना चुनें।"));
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("message_sends")
    .update({ status: "cancelled" })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "draft"])
    .select("id");
  if (error) return fail(p("Not stopped. Try again.", "रोका नहीं गया।"));
  // A staff notice goes through the staff outbox (go-live Phase F): stop what has not gone.
  const { data: staffRows, error: staffError } = await admin
    .from("staff_notices")
    .update({ status: "cancelled", status_reason: "notice stopped" })
    .like("notice_key", `broadcast:${campaignId}:%`)
    .eq("status", "pending")
    .select("id");
  if (staffError) return fail(p("Not stopped. Try again.", "रोका नहीं गया।"));
  await admin
    .from("message_campaigns")
    .update({ status: "cancelled", cancelled_by: actor.id, cancelled_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "queued");
  revalidatePath("/messages");
  const n = (rows?.length ?? 0) + (staffRows?.length ?? 0);
  return { ok: true, message: p(`Stopped · ${n} not sent`, `रोका गया · ${n} नहीं भेजे गए`) };
}

/** Queue the failed recipients again. Appends new rows; the failed ones stay as the record. */
export async function resendFailedAction(campaignId: string): Promise<MessageResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(campaignId)) return fail(p("Pick a notice.", "सूचना चुनें।"));
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("message_sends")
    .select("session_label, template_id, to_phone, to_name, student_id, staff_profile_id, variables, rendered_hi, rendered_en, status, category, snapshot, requested_at")
    .eq("campaign_id", campaignId)
    .order("requested_at", { ascending: true })
    .returns<{ session_label: string; template_id: string; to_phone: string; to_name: string | null; student_id: string | null; staff_profile_id: string | null; variables: string[]; rendered_hi: string; rendered_en: string; status: string; category: string; snapshot: unknown; requested_at: string }[]>();
  if (error) return fail(p("Could not read the notice.", "सूचना नहीं पढ़ी जा सकी।"));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows ?? []) latest.set(row.to_phone, row);
  const failed = [...latest.values()].filter((r) => r.status === "failed");
  if (failed.length === 0) return { ok: true, message: p("Nothing failed — nothing to resend.", "कुछ विफल नहीं हुआ।") };
  const { error: insertError } = await admin.from("message_sends").insert(
    failed.map((r) => ({
      session_label: r.session_label,
      template_id: r.template_id,
      to_phone: r.to_phone,
      to_name: r.to_name,
      student_id: r.student_id,
      staff_profile_id: r.staff_profile_id,
      variables: r.variables,
      rendered_hi: r.rendered_hi,
      rendered_en: r.rendered_en,
      status: "queued",
      category: r.category,
      snapshot: r.snapshot,
      requested_by: actor.id,
      campaign_id: campaignId,
    })),
  );
  if (insertError) return fail(p("Not queued again. Try again.", "दोबारा कतार में नहीं गया।"));
  revalidatePath("/messages");
  return { ok: true, message: p(`${failed.length} queued again`, `${failed.length} दोबारा कतार में`) };
}

/** A new WhatsApp template, saved off until WhatsApp approves it. */
export async function createTemplateAction(input: { name: string; category: string; hi: string; en: string }): Promise<MessageResult> {
  await assertPermission("messages:send");
  await assertNotPreviewing();
  const name = String(input.name ?? "").trim();
  const code = templateSlug(name);
  if (!code) return fail(p("Give the template a name.", "टेम्पलेट का नाम लिखें।"));
  const hi = String(input.hi ?? "").trim();
  const en = String(input.en ?? "").trim();
  if (!hi && !en) return fail(p("Write the message in Hindi or English.", "संदेश लिखें।"));
  if (hi.length > 1024 || en.length > 1024) return fail(COMPOSE_PROBLEMS.too_long);
  const category = input.category === "marketing" ? "marketing" : "utility";
  const numbered = numberPlaceholders(hi, en);
  const admin = createAdminClient();
  const { data: clash } = await admin.from("message_templates").select("id").eq("code", code).maybeSingle();
  if (clash) return fail(p("A template with that name already exists.", "इस नाम का टेम्पलेट पहले से है।"));
  const { error } = await admin.from("message_templates").insert({
    code,
    label_hi: name,
    label_en: name,
    body_hi: numbered.hi || numbered.en,
    body_en: numbered.en || numbered.hi,
    variables: numbered.variables,
    audience: "parent",
    is_active: false,
    wa_category: category,
    sort_order: 100,
  });
  if (error) return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  revalidatePath("/messages");
  return { ok: true, message: p("Saved · waiting for WhatsApp approval", "सहेजा गया · व्हाट्सऐप स्वीकृति बाकी") };
}

/** Answer a parent: the reply is recorded and queued, never sent from here. */
export async function answerReplyAction(input: { replyId: string; body: string }): Promise<MessageResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(input.replyId)) return fail(p("Pick a message.", "संदेश चुनें।"));
  const body = String(input.body ?? "").trim();
  if (!body) return fail(p("Write a reply.", "जवाब लिखें।"));
  if (body.length > 1024) return fail(COMPOSE_PROBLEMS.too_long);
  const admin = createAdminClient();
  const { data: reply } = await admin
    .from("parent_replies")
    .select("id, session_label, from_name, from_phone, student_id")
    .eq("id", input.replyId)
    .maybeSingle<{ id: string; session_label: string; from_name: string; from_phone: string; student_id: string | null }>();
  if (!reply) return fail(p("That message is gone.", "संदेश नहीं मिला।"));
  const phone = tenDigits(reply.from_phone);
  const id = await templateId(NOTICE_TEMPLATE.parent);
  let sendId: string | null = null;
  if (phone && id) {
    const policyVersion = await generalPolicyVersion();
    const { data: send, error: sendError } = await admin
      .from("message_sends")
      .insert({
        session_label: reply.session_label,
        template_id: id,
        to_phone: phone,
        to_name: reply.from_name,
        student_id: reply.student_id,
        variables: [body],
        rendered_hi: body,
        rendered_en: "",
        status: "queued",
        requested_by: actor.id,
        category: "general",
        snapshot: {
          destination: phone,
          contact: phone,
          record: reply.student_id ? { kind: "student", id: reply.student_id, version: null } : { kind: "none", id: null, version: null },
          content: contentHash(body, ""),
          policyVersion,
        },
      })
      .select("id")
      .single<{ id: string }>();
    if (sendError) return fail(p("The reply could not be queued. Try again.", "जवाब कतार में नहीं जुड़ा। फिर कोशिश करें।"));
    sendId = send?.id ?? null;
  }
  const { error } = await admin.from("parent_reply_answers").insert({ reply_id: reply.id, body, message_send_id: sendId, answered_by: actor.id });
  if (error) return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  revalidatePath("/messages");
  return { ok: true, message: sendId ? p("Reply queued", "जवाब कतार में") : p("Reply noted · no WhatsApp number", "जवाब दर्ज · नंबर नहीं") };
}

/** Give a parent's message to a colleague, or take it back. */
export async function assignReplyAction(input: { replyId: string; staffId: string | null }): Promise<MessageResult> {
  await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(input.replyId) || (input.staffId !== null && !UUID.test(input.staffId))) return fail(p("Pick a person.", "व्यक्ति चुनें।"));
  const { error } = await createAdminClient().from("parent_replies").update({ assigned_staff_id: input.staffId }).eq("id", input.replyId);
  if (error) return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  revalidatePath("/messages");
  return { ok: true, message: input.staffId ? p("Assigned", "सौंपा गया") : p("Not assigned", "किसी को नहीं सौंपा") };
}

/** Mark a parent's message done, or open it again. */
export async function setReplyDoneAction(input: { replyId: string; done: boolean }): Promise<MessageResult> {
  const actor = await assertPermission("messages:send");
  await assertNotPreviewing();
  if (!UUID.test(input.replyId)) return fail(p("Pick a message.", "संदेश चुनें।"));
  const { error } = await createAdminClient()
    .from("parent_replies")
    .update(input.done ? { status: "done", done_by: actor.id, done_at: new Date().toISOString() } : { status: "open", done_by: null, done_at: null })
    .eq("id", input.replyId);
  if (error) return fail(p("Not saved. Try again.", "सहेजा नहीं गया।"));
  revalidatePath("/messages");
  return { ok: true, message: input.done ? p("Marked done", "पूरा") : p("Opened again", "फिर से खुला") };
}
