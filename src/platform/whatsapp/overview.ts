import "server-only";

import { hubWebhookSecrets, readWhatsAppConfig, webhookSecrets, webhookVerifyToken, type WhatsAppProviderName } from "@/platform/whatsapp/config";
import { describeError, type PlainError } from "@/platform/whatsapp/errors";
import { maskNumber, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import { WHATSAPP_FEATURES, type WhatsAppFeature, type WhatsAppSwitches } from "@/platform/whatsapp/policy";
import { RETRY_FROM_OWN_SCREEN } from "@/platform/whatsapp/service";
import { readSwitches, whatsappDb, type MessageStatus } from "@/platform/whatsapp/store";

/**
 * Everything Settings → WhatsApp shows, in one read (D-562, D-566). Admin only: the
 * page checks `settings:manage` before it calls this. Numbers are masked here,
 * before they reach a screen; the log keeps them whole.
 */

export type TemplateView = {
  key: string;
  feature: string;
  language: string;
  status: string;
  reason: string | null;
  label: string;
  checkedAt: string | null;
  /** The hub's quality rating for an approved template (GREEN / YELLOW / RED). */
  quality: string | null;
  /** When One sent it to Meta for approval through the hub. */
  submittedAt: string | null;
};

export type MessageView = {
  id: string;
  at: string;
  feature: string;
  template: string | null;
  to: string;
  toName: string | null;
  status: MessageStatus;
  dryRun: boolean;
  paidAt: string | null;
  problem: PlainError | null;
  /** In-place Retry is possible here. */
  canRetry: boolean;
  /** Where to send it again when this page may not (a fee message, an absence). */
  ownScreen: string | null;
  retried: boolean;
};

export type ReplyView = { id: string; at: string; from: string; name: string | null; text: string | null; type: string; answersTemplate: string | null };

export type WhatsAppOverview = {
  number: string;
  provider: WhatsAppProviderName | null;
  connected: boolean;
  connectionProblem: string | null;
  webhookReady: boolean;
  switches: WhatsAppSwitches | null;
  ownerNumberMasked: string | null;
  sentToday: number | null;
  templates: TemplateView[] | null;
  messages: MessageView[] | null;
  problems: MessageView[] | null;
  replies: ReplyView[] | null;
};

function istDayStartIso(now = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.toISOString().slice(0, 10);
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

type RawMessage = {
  id: string;
  created_at: string;
  feature: string;
  template_key: string | null;
  to_e164: string;
  to_name: string | null;
  status: MessageStatus;
  dry_run: boolean;
  paid_at: string | null;
  error_code: string | null;
  error_title: string | null;
  retried_at: string | null;
};

const MESSAGE_COLUMNS = "id, created_at, feature, template_key, to_e164, to_name, status, dry_run, paid_at, error_code, error_title, retried_at";
const TROUBLED: MessageStatus[] = ["failed", "unknown", "held", "retry_wait"];

function messageView(row: RawMessage): MessageView {
  const troubled = TROUBLED.includes(row.status);
  const ownScreen = RETRY_FROM_OWN_SCREEN[row.feature as WhatsAppFeature] ?? null;
  return {
    id: row.id,
    at: row.created_at,
    feature: row.feature,
    template: row.template_key,
    to: maskNumber(row.to_e164),
    toName: row.to_name,
    status: row.status,
    dryRun: row.dry_run,
    paidAt: row.paid_at,
    problem: troubled ? describeError(row.error_code, row.error_title) : null,
    canRetry: !ownScreen && !row.retried_at && ["failed", "unknown", "held"].includes(row.status),
    ownScreen: troubled ? ownScreen : null,
    retried: Boolean(row.retried_at),
  };
}

export async function loadWhatsAppOverview(): Promise<WhatsAppOverview> {
  const config = readWhatsAppConfig();
  const db = whatsappDb();
  const [switches, templates, messages, problems, replies, today] = await Promise.all([
    readSwitches(db),
    db
      .from("whatsapp_templates")
      .select("key, feature, language_code, status, status_reason, label_en, status_checked_at, quality, submitted_at")
      .order("feature")
      .order("key")
      .then(
        ({ data, error }) => (error ? null : (data ?? [])) as Array<{
          key: string;
          feature: string;
          language_code: string;
          status: string;
          status_reason: string | null;
          label_en: string | null;
          status_checked_at: string | null;
          quality: string | null;
          submitted_at: string | null;
        }> | null,
        () => null,
      ),
    db
      .from("whatsapp_messages")
      .select(MESSAGE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => (error ? null : ((data ?? []) as RawMessage[])), () => null),
    db
      .from("whatsapp_messages")
      .select(MESSAGE_COLUMNS)
      .in("status", TROUBLED)
      .is("retried_at", null)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => (error ? null : ((data ?? []) as RawMessage[])), () => null),
    db
      .from("whatsapp_inbound")
      .select("id, received_at, from_e164, from_name, text_body, message_type, reply_to_message_id")
      .order("received_at", { ascending: false })
      .limit(20)
      .then(
        ({ data, error }) => (error ? null : (data ?? [])) as Array<{ id: string; received_at: string; from_e164: string; from_name: string | null; text_body: string | null; message_type: string; reply_to_message_id: string | null }> | null,
        () => null,
      ),
    db
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", istDayStartIso())
      .in("status", ["sending", "accepted", "sent", "delivered", "read", "failed", "unknown"])
      .then(({ count, error }) => (error ? null : (count ?? 0)), () => null),
  ]);

  // Which template each reply answers, for the reply list.
  const answered = new Map<string, string | null>();
  const replyTargets = [...new Set((replies ?? []).map((reply) => reply.reply_to_message_id).filter((id): id is string => Boolean(id)))];
  if (replyTargets.length > 0) {
    const { data } = await db.from("whatsapp_messages").select("id, template_key").in("id", replyTargets.slice(0, 50));
    for (const row of (data ?? []) as Array<{ id: string; template_key: string | null }>) answered.set(row.id, row.template_key);
  }

  return {
    number: SCHOOL_WHATSAPP_NUMBER,
    provider: config.ok ? config.provider : null,
    connected: config.ok,
    connectionProblem: config.ok ? null : config.reason,
    // The hub signs what it forwards with One's own key; Meta direct needs its
    // app secret and the verify token it echoes when the webhook is set up.
    webhookReady:
      config.ok && config.provider === "hub" ? hubWebhookSecrets().length > 0 : webhookSecrets().length > 0 && Boolean(webhookVerifyToken()),
    switches,
    ownerNumberMasked: switches?.ownerTestNumber ? maskNumber(switches.ownerTestNumber) : null,
    sentToday: today,
    templates: templates
      ? templates.map((row) => ({
          key: row.key,
          feature: row.feature,
          language: row.language_code,
          status: row.status,
          reason: row.status_reason,
          label: row.label_en ?? row.key,
          checkedAt: row.status_checked_at,
          quality: row.quality,
          submittedAt: row.submitted_at,
        }))
      : null,
    messages: messages ? messages.map(messageView) : null,
    problems: problems ? problems.map(messageView) : null,
    replies: replies
      ? replies.map((reply) => ({
          id: reply.id,
          at: reply.received_at,
          from: maskNumber(reply.from_e164),
          name: reply.from_name,
          text: reply.text_body,
          type: reply.message_type,
          answersTemplate: reply.reply_to_message_id ? (answered.get(reply.reply_to_message_id) ?? null) : null,
        }))
      : null,
  };
}

export { WHATSAPP_FEATURES };
