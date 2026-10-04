import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import {
  mayDispatch,
  render,
  type MessageAudience,
  type MessageSend,
  type MessageTemplate,
  type QueueInput,
  type SendStatus,
  type TemplateInput,
} from "@/modules/collection/domain/messages";
import { normalisePhone } from "@/modules/collection/domain/fields";
import {
  ProviderMisconfigured,
  selectProvider,
  type DispatchResult,
  type MessageProvider,
} from "@/modules/collection/data/message-provider";
import {
  categoryFor,
  markStale,
  parentDispatchSwitch,
  parentPolicies,
  pinSnapshot,
  snapshotNow,
  staleness,
} from "@/modules/collection/data/parent-messages-repo";
import { mayDispatchToParent } from "@/modules/collection/domain/parent-policy";

/**
 * Templates and the send queue.
 *
 * The queue is deliberately one step short of a sender. It works out exactly
 * what would go out and to whom, records it, and stops — because D-10 says a
 * parent-facing message is pressed by a person, and because the day one goes
 * out wrong it goes out wrong to four hundred families at once.
 *
 * `dispatch()` at the bottom is the seam where a provider would go. It is
 * unconfigured on purpose; see its own note.
 */

type TemplateRow = {
  id: string;
  code: string;
  label_hi: string;
  label_en: string;
  body_hi: string;
  body_en: string;
  variables: string[];
  has_url_button: boolean;
  audience: MessageAudience;
  is_active: boolean;
  sort_order: number;
};

const TEMPLATE_COLUMNS =
  "id, code, label_hi, label_en, body_hi, body_en, variables, has_url_button, " +
  "audience, is_active, sort_order";

const toTemplate = (row: TemplateRow): MessageTemplate => ({
  id: row.id,
  code: row.code,
  labelHi: row.label_hi,
  labelEn: row.label_en,
  bodyHi: row.body_hi,
  bodyEn: row.body_en,
  variables: row.variables ?? [],
  hasUrlButton: row.has_url_button,
  audience: row.audience,
  isActive: row.is_active,
  sortOrder: row.sort_order,
});

export async function listTemplates(): Promise<MessageTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_templates")
    .select(TEMPLATE_COLUMNS)
    .order("sort_order")
    .returns<TemplateRow[]>();

  if (error) throw new Error(`Could not read the templates: ${error.message}`);
  return data.map(toTemplate);
}

export async function upsertTemplate(input: TemplateInput): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_templates")
    .upsert(
      {
        code: input.code,
        label_hi: input.labelHi,
        label_en: input.labelEn,
        body_hi: input.bodyHi,
        body_en: input.bodyEn,
        variables: input.variables,
        has_url_button: input.hasUrlButton,
        audience: input.audience,
        sort_order: input.sortOrder,
      },
      { onConflict: "code" },
    );

  if (error) throw error;
}

export async function setTemplateActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_templates")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) throw error;
}

/* --------------------------------------------------------- the queue */

type SendRow = {
  id: string;
  template_id: string;
  to_phone: string;
  to_name: string | null;
  student_id: string | null;
  request_id: string | null;
  staff_profile_id: string | null;
  variables: string[];
  rendered_hi: string;
  rendered_en: string;
  status: SendStatus;
  provider_message_id: string | null;
  error: string | null;
  requested_at: string;
  sent_at: string | null;
  approved_at: string | null;
  stale_reason: string | null;
  message_templates: {
    code: string;
    label_hi: string;
    label_en: string;
    audience: MessageAudience;
  } | null;
  staff_profiles: { display_name: string } | null;
};

const SEND_COLUMNS =
  "id, template_id, to_phone, to_name, student_id, request_id, staff_profile_id, " +
  "variables, rendered_hi, rendered_en, status, provider_message_id, error, " +
  "requested_at, sent_at, approved_at, stale_reason, " +
  "message_templates!inner(code, label_hi, label_en, audience), " +
  // **Named, because `message_sends` points at `staff_profiles` twice** —
  // `requested_by` is who asked for the message and `staff_profile_id` is who
  // it is going to. An unqualified embed cannot choose between them, and
  // PostgREST answers "more than one relationship was found" rather than
  // picking one, so this screen returned an error page from the day it shipped
  // until somebody signed in and opened it. The one wanted here is who asked.
  "staff_profiles!message_sends_requested_by_fkey(display_name)";

const toSend = (row: SendRow): MessageSend => ({
  id: row.id,
  templateId: row.template_id,
  templateCode: row.message_templates?.code ?? "—",
  templateLabelHi: row.message_templates?.label_hi ?? "—",
  templateLabelEn: row.message_templates?.label_en ?? "—",
  audience: row.message_templates?.audience ?? "staff",
  toPhone: row.to_phone,
  toName: row.to_name,
  studentId: row.student_id,
  requestId: row.request_id,
  staffProfileId: row.staff_profile_id,
  variables: row.variables ?? [],
  renderedHi: row.rendered_hi,
  renderedEn: row.rendered_en,
  status: row.status,
  providerMessageId: row.provider_message_id,
  error: row.error,
  requestedByName: row.staff_profiles?.display_name ?? null,
  requestedAt: row.requested_at,
  sentAt: row.sent_at,
  approvedAt: row.approved_at,
  staleReason: row.stale_reason,
});

export async function listSends(sessionLabel: string): Promise<MessageSend[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_sends")
    .select(SEND_COLUMNS)
    .eq("session_label", sessionLabel)
    .order("requested_at", { ascending: false })
    .limit(300)
    .returns<SendRow[]>();

  if (error) throw new Error(`Could not read the messages: ${error.message}`);
  return data.map(toSend);
}

/**
 * Put one message in the queue, with its text already resolved.
 *
 * The rendered text is stored rather than recomputed later, because a template
 * can be edited afterwards and "what did we actually send" must still have an
 * answer a year on.
 */
export async function queueSend(input: {
  queue: QueueInput;
  template: MessageTemplate;
  sessionLabel: string;
  requestedByStaffId: string;
}): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("message_sends")
    .insert({
      session_label: input.sessionLabel,
      template_id: input.template.id,
      to_phone: normalisePhone(input.queue.toPhone),
      to_name: input.queue.toName,
      student_id: input.queue.studentId,
      request_id: input.queue.requestId,
      staff_profile_id: input.queue.staffProfileId,
      variables: input.queue.variables,
      rendered_hi: render(input.template.bodyHi, input.queue.variables),
      rendered_en: render(input.template.bodyEn, input.queue.variables),
      status: "queued",
      requested_by: input.requestedByStaffId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) throw error;

  // A parent message keeps what it rests on, so an approval given later can
  // be checked against what is true then (P9).
  if (input.template.audience === "parent") {
    const category = categoryFor({ requestId: input.queue.requestId });
    const snapshot = await snapshotNow({
      toPhone: input.queue.toPhone,
      studentId: input.queue.studentId,
      requestId: input.queue.requestId,
      renderedHi: render(input.template.bodyHi, input.queue.variables),
      renderedEn: render(input.template.bodyEn, input.queue.variables),
      category,
    });
    await pinSnapshot(data.id, category, snapshot);
  }
  return data.id;
}

export async function getSend(id: string): Promise<MessageSend | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("message_sends")
    .select(SEND_COLUMNS)
    .eq("id", id)
    .maybeSingle<SendRow>();

  if (error) throw new Error(`Could not read that message: ${error.message}`);
  return data ? toSend(data) : null;
}

export async function cancelSend(id: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_sends")
    .update({ status: "cancelled" })
    .eq("id", id)
    .neq("status", "sent");

  if (error) throw error;
}

/**
 * Mark a message as sent by a person, by hand.
 *
 * This is the path D-10 actually describes: somebody opened WhatsApp from the
 * queue, read the text, pressed send, and came back to say so. It is the only
 * way a parent-facing row ever reaches `sent`, and the log is honest about
 * that — `provider_message_id` stays null, because no provider was involved.
 */
export async function markSentByHand(
  id: string,
  staffProfileId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("message_sends")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      requested_by: staffProfileId,
    })
    .eq("id", id)
    .neq("status", "sent");

  if (error) throw error;
}

/* ------------------------------------------------------- the provider */

/**
 * Hand one queued message to whichever provider this deployment has.
 *
 * **The guards come first, and they are the point.**
 *
 * `mayDispatch()` refuses a parent-facing row outright — that is D-10 in
 * executable form, and it holds whatever a screen or a future scheduled job
 * believes. What is left is staff messaging: a teacher's own token link, which
 * is a message to a colleague about their own work.
 *
 * Only then does it ask `selectProvider()` who is sending. Unset means AiSensy,
 * which still refuses without an `AISENSY_API_KEY` this repository does not
 * carry (rule 8: sending costs money). `MESSAGE_PROVIDER=mock` is how a QA run
 * gets a 429 or a timeout without a handset or an invoice, and it is refused
 * outright on a live deployment.
 *
 * A misconfigured provider is reported as a refusal rather than thrown, because
 * the caller is a screen: the queue keeps the row either way, and an error page
 * would lose the sentence that says what to fix.
 */
export async function dispatch(send: MessageSend): Promise<DispatchResult> {
  if (send.audience === "parent") {
    // A parent message goes from the app only under the school's switch, a
    // named automatic exception for its category, and nothing stale (P9) —
    // otherwise it is D-10: a person sends it.
    if (send.status === "sent" || send.status === "cancelled") {
      const refused = mayDispatch(send);
      if (!refused.ok) return { ok: false, error: refused.reason.en };
    }
    const [switchOn, policies, check] = await Promise.all([
      parentDispatchSwitch(),
      parentPolicies(),
      staleness(send),
    ]);
    const policy = policies.find((entry) => entry.category === (check.extras?.category ?? categoryFor(send))) ?? null;
    const verdict = mayDispatchToParent({ switchOn, policy, stale: check.reasons });
    if (!verdict.ok) {
      if (check.reasons.length > 0) await markStale(send.id, check.reasons);
      return { ok: false, error: verdict.reason.en };
    }
  } else {
    const allowed = mayDispatch(send);
    if (!allowed.ok) return { ok: false, error: allowed.reason.en };
  }

  let provider: MessageProvider;
  try {
    provider = selectProvider();
  } catch (thrown) {
    return {
      ok: false,
      error:
        thrown instanceof ProviderMisconfigured
          ? thrown.message
          : "No messaging provider is configured.",
    };
  }

  return provider.send(send);
}

export async function recordDispatch(
  id: string,
  result: DispatchResult,
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("message_sends")
    .update(
      result.ok
        ? {
            status: "sent" as const,
            sent_at: new Date().toISOString(),
            provider_message_id: result.providerMessageId,
            error: null,
          }
        : { status: "failed" as const, error: result.error },
    )
    .eq("id", id)
    .neq("status", "sent");

  if (error) throw error;
}
