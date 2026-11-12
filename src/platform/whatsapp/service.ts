import "server-only";

import { readWhatsAppConfig, type WhatsAppConfig } from "@/platform/whatsapp/config";
import { describeError } from "@/platform/whatsapp/errors";
import { SCHOOL_WHATSAPP_NUMBER, toE164 } from "@/platform/whatsapp/numbers";
import { templateMessageBody, textMessageBody, type TemplateDocument } from "@/platform/whatsapp/payload";
import {
  checkWhatsAppSend,
  type WhatsAppFeature,
  type WhatsAppRefusal,
  type WhatsAppSwitches,
} from "@/platform/whatsapp/policy";
import {
  providerFor,
  type ProviderConnection,
  type ProviderSendResult,
  type ProviderStatus,
  type TemplateSubmission,
  type WhatsAppProvider,
} from "@/platform/whatsapp/providers";
import {
  claimSend,
  readMessage,
  readSwitches,
  readTemplateRow,
  recordAttempt,
  recordStatus,
  takeDue,
  takePollable,
  whatsappDb,
  wroteWithin24h,
  type MessageRow,
  type MessageStatus,
  type StatusAnswer,
} from "@/platform/whatsapp/store";
import type { WebhookTemplateEvent } from "@/platform/whatsapp/webhook";

/**
 * The one WhatsApp service in One (D-562). Everything that messages anybody
 * — fee reminders, receipts, school notices, staff notices, teacher tasks —
 * comes through here:
 *
 *   sendTemplate(phone, templateName, language, variables, { feature, … })
 *   sendText(phone, text, { feature, … })
 *   getStatus(messageId)
 *
 * It talks to the school's WhatsApp hub or straight to Meta's Cloud API
 * (config.ts), in Meta's message format either way, and it writes every
 * message to `vppsone.whatsapp_messages` — sent, refused, practice or queued.
 *
 * It does NOT decide whether a parent should hear about something: the
 * parent-send gate and the staff gates do, before they call here. This decides
 * whether the school's number may send this message now (policy.ts), and
 * keeps the day's limit (in Postgres).
 */

export type SendOptions = {
  feature: WhatsAppFeature;
  toName?: string | null;
  document?: TemplateDocument | null;
  /** The dynamic end of the template's URL button (a pay code, a task token). */
  urlButton?: string | null;
  /** The row in the sending module this message belongs to, for the webhook and the queue. */
  link?: { table: string; id: string } | null;
  sessionLabel?: string | null;
  /** The staff member's auth user id, or null for a scheduled send. */
  requestedBy?: string | null;
  /** The same key twice is one message: the second call answers the first. */
  idempotencyKey?: string | null;
  /** The Pay now code this message carries, so a payment can mark it paid. */
  payCode?: string | null;
  /** `queue` leaves it for the queue job; `now` (default) sends in this request. */
  delivery?: "now" | "queue";
  /**
   * How many tries in all a busy-server failure gets from the queue. 1 (the
   * default) means none: the sending module keeps its own retry. Never
   * applied to an UNKNOWN result, which may already have reached the phone.
   */
  maxAttempts?: number;
  retryOf?: string | null;
};

export type SendOutcome =
  | { outcome: "accepted"; logId: string; providerMessageId: string }
  | { outcome: "queued"; logId: string; nextAttemptAt: string; reason: string }
  | { outcome: "dry_run"; logId: string | null; reason: string }
  | { outcome: "refused"; logId: string | null; code: WhatsAppRefusal; reason: string }
  | { outcome: "rejected"; logId: string; code: string | null; reason: string }
  | { outcome: "unknown"; logId: string; code: string; reason: string }
  | { outcome: "duplicate"; logId: string; status: MessageStatus; providerMessageId: string | null };

/** Minutes between the queue's tries of a busy-server failure. */
const RETRY_DELAYS_MINUTES = [5, 20, 60, 180] as const;

/* --------------------------------------------------------- the sender check */

/**
 * Meta is asked, once per server instance every ten minutes, which number
 * this phone-number ID sends from. A deployment whose ID belongs to any other
 * number than the school's sends nothing, whatever WHATSAPP_SENDER_NUMBER
 * says. The hub is not asked: it owns +91 83022 07823 and no other number,
 * and it never uses the fees app's (its API doc, 9 Nov).
 */
let senderCheck: { at: number; key: string; connection: ProviderConnection } | null = null;
const SENDER_CHECK_MS = 10 * 60 * 1000;

async function senderProblem(config: Extract<WhatsAppConfig, { ok: true }>, provider: WhatsAppProvider): Promise<string | null> {
  if (config.provider !== "meta_cloud") return null;
  const key = `meta:${config.phoneNumberId}`;
  if (!senderCheck || senderCheck.key !== key || Date.now() - senderCheck.at > SENDER_CHECK_MS) {
    senderCheck = { at: Date.now(), key, connection: await provider.checkConnection() };
  }
  const connection = senderCheck.connection;
  if (connection.displayNumber && connection.displayNumber !== SCHOOL_WHATSAPP_NUMBER) {
    return "The WhatsApp server sends from a different number than the school's. Nothing was sent.";
  }
  if (!connection.ok) {
    // Not cached as a pass: try again next time.
    senderCheck = null;
    return connection.problem ?? "Could not confirm the school's number with Meta. Nothing was sent.";
  }
  return null;
}

/** For tests: forget the cached sender check. */
export function forgetSenderCheck() {
  senderCheck = null;
}

/* ------------------------------------------------------------------ sending */

type Prepared = {
  kind: "template" | "text";
  body: Record<string, unknown>;
  log: Record<string, unknown>;
};

function logFields(to: string, options: SendOptions): Record<string, unknown> {
  return {
    feature: options.feature,
    to_e164: to,
    to_name: options.toName?.slice(0, 120) ?? null,
    session_label: options.sessionLabel ?? null,
    source_table: options.link?.table ?? null,
    source_id: options.link?.id ?? null,
    requested_by: options.requestedBy ?? null,
    pay_code: options.payCode ?? null,
    idempotency_key: options.idempotencyKey ?? null,
    retry_of: options.retryOf ?? null,
    max_attempts: Math.max(1, Math.min(5, Math.trunc(options.maxAttempts ?? 1))),
  };
}

async function dispatch(
  prepared: Prepared,
  verdict: ReturnType<typeof checkWhatsAppSend>,
  switches: WhatsAppSwitches | null,
  config: WhatsAppConfig,
  options: SendOptions,
): Promise<SendOutcome> {
  if (verdict.decision === "refuse") {
    // A number the log cannot hold (not a mobile number, or the fees app's)
    // is refused without a row; everything else is kept, so the office can see
    // what was held back and why.
    if (!verdict.to || verdict.code === "fees_number" || verdict.code === "own_number") {
      return { outcome: "refused", logId: null, code: verdict.code, reason: verdict.reason };
    }
    const held = await claimSend(
      { ...prepared.log, error_code: verdict.code, error_title: verdict.reason, idempotency_key: null },
      "held",
      0,
    );
    return { outcome: "refused", logId: held.ok ? held.id : null, code: verdict.code, reason: verdict.reason };
  }

  if (verdict.decision === "dry_run") {
    const logged = await claimSend({ ...prepared.log, idempotency_key: null }, "dry_run", 0);
    return {
      outcome: "dry_run",
      logId: logged.ok ? logged.id : null,
      reason: "Practice mode is on: written to the WhatsApp log, not sent.",
    };
  }

  if (!config.ok) return { outcome: "refused", logId: null, code: "not_configured", reason: config.reason };
  const provider = providerFor(config);

  const problem = await senderProblem(config, provider);
  if (problem) {
    const held = await claimSend({ ...prepared.log, error_code: "not_configured", error_title: problem, idempotency_key: null }, "held", 0);
    return { outcome: "refused", logId: held.ok ? held.id : null, code: "not_configured", reason: problem };
  }

  const claim = await claimSend(
    { ...prepared.log, provider: provider.name },
    options.delivery === "queue" ? "queued" : "sending",
    switches?.dailyLimit ?? 0,
  );
  if (!claim.ok) {
    if (claim.reason === "duplicate") {
      return { outcome: "duplicate", logId: claim.id, status: claim.status, providerMessageId: claim.provider_message_id };
    }
    if (claim.reason === "daily_limit") {
      return { outcome: "refused", logId: claim.id, code: "daily_limit", reason: describeError("daily_limit").text.en };
    }
    return { outcome: "refused", logId: null, code: "read_failed", reason: "Could not write the WhatsApp log, so nothing was sent." };
  }
  if (claim.status === "queued") {
    return { outcome: "queued", logId: claim.id, nextAttemptAt: new Date().toISOString(), reason: "Waiting in the WhatsApp queue." };
  }

  const result = await provider.send(prepared.body);
  return settle(claim.id, result, 1, Number(prepared.log.max_attempts ?? 1), provider.name);
}

/** Write one attempt's answer and say what it means to the caller. */
async function settle(
  logId: string,
  result: ProviderSendResult,
  attempt: number,
  maxAttempts: number,
  providerName: string,
): Promise<SendOutcome> {
  if (result.outcome === "accepted") {
    await recordAttempt(logId, {
      status: "accepted",
      providerMessageId: result.messageId,
      httpStatus: result.httpStatus,
      attempts: attempt,
      provider: providerName,
    });
    return { outcome: "accepted", logId, providerMessageId: result.messageId };
  }

  if (result.outcome === "unknown") {
    await recordAttempt(logId, {
      status: "unknown",
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      errorTitle: result.errorTitle,
      attempts: attempt,
      provider: providerName,
    });
    return { outcome: "unknown", logId, code: result.errorCode, reason: describeError(result.errorCode).text.en };
  }

  const plainWords = describeError(result.errorCode, result.errorTitle);
  if (plainWords.retryable && attempt < maxAttempts) {
    const delay = RETRY_DELAYS_MINUTES[Math.min(attempt - 1, RETRY_DELAYS_MINUTES.length - 1)];
    const nextAttemptAt = new Date(Date.now() + delay * 60_000).toISOString();
    await recordAttempt(logId, {
      status: "retry_wait",
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      errorTitle: result.errorTitle,
      errorDetail: result.errorDetail,
      nextAttemptAt,
      attempts: attempt,
      provider: providerName,
    });
    return { outcome: "queued", logId, nextAttemptAt, reason: `${plainWords.text.en} One will try again by itself in ${delay} minutes.` };
  }

  await recordAttempt(logId, {
    status: "failed",
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    errorTitle: result.errorTitle,
    errorDetail: result.errorDetail,
    attempts: attempt,
    provider: providerName,
  });
  return { outcome: "rejected", logId, code: result.errorCode, reason: plainWords.text.en };
}

/**
 * Send one approved template. `templateName` is the registry key
 * (`vppsone.whatsapp_templates.key`); the name and language Meta knows it by
 * come from the registry row, and `language` must agree with it.
 */
export async function sendTemplate(
  phone: string,
  templateName: string,
  language: string | null,
  variables: readonly string[],
  options: SendOptions,
): Promise<SendOutcome> {
  const config = readWhatsAppConfig();
  const [switches, template] = await Promise.all([readSwitches(), readTemplateRow(templateName).catch(() => null)]);
  const verdict = checkWhatsAppSend({
    feature: options.feature,
    to: phone,
    switches,
    config,
    kind: "template",
    template,
    language,
    bodyParamCount: variables.length,
    hasDocument: Boolean(options.document),
    hasUrlButton: Boolean(options.urlButton),
  });

  const to = verdict.to ?? toE164(phone) ?? "";
  const providerName = template?.provider_name ?? templateName;
  const languageCode = template?.language_code ?? language ?? "hi";
  const prepared: Prepared = {
    kind: "template",
    body: templateMessageBody({
      to,
      name: providerName,
      languageCode,
      bodyParams: variables,
      document: options.document ?? null,
      urlButtonSuffix: options.urlButton ?? null,
    }),
    log: {
      ...logFields(to, options),
      kind: "template",
      template_key: templateName,
      provider_template_name: providerName,
      language_code: languageCode,
      body_params: [...variables],
      // The signed URL expires; the filename is what the office needs to see.
      header: options.document ? { type: "document", filename: options.document.filename, url: options.document.url } : null,
      button_params: options.urlButton ? [options.urlButton] : [],
    },
  };
  return dispatch(prepared, verdict, switches, config, options);
}

/** Send typed text. WhatsApp delivers it only within 24 hours of the person's last message. */
export async function sendText(phone: string, text: string, options: SendOptions): Promise<SendOutcome> {
  const config = readWhatsAppConfig();
  const to = toE164(phone);
  const [switches, wrote] = await Promise.all([readSwitches(), to ? wroteWithin24h(to).catch(() => null) : Promise.resolve(null)]);
  const verdict = checkWhatsAppSend({ feature: options.feature, to: phone, switches, config, kind: "text", wroteInLast24h: wrote });
  const body = text.trim().slice(0, 4096);
  const prepared: Prepared = {
    kind: "text",
    body: textMessageBody(verdict.to ?? to ?? "", body),
    log: { ...logFields(verdict.to ?? to ?? "", options), kind: "text", text_body: body || "-" },
  };
  return dispatch(prepared, verdict, switches, config, options);
}

/* ------------------------------------------------------------------- status */

export type MessageStatusView = {
  id: string;
  status: MessageStatus;
  providerMessageId: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  paidAt: string | null;
  errorCode: string | null;
  /** Why, in plain words, when it did not go. */
  problem: { hi: string; en: string } | null;
};

/**
 * Where a message is now, by the log's id or WhatsApp's own message id. Kept
 * current by the webhook; `refresh` asks the hub first
 * (`GET /v1/status/{wamid}`), for anything that cannot wait for a webhook
 * the hub delivers only best-effort.
 */
export async function getStatus(messageId: string, options: { refresh?: boolean } = {}): Promise<MessageStatusView | null> {
  let row = await readMessage(messageId);
  if (!row) return null;
  if (options.refresh && row.provider_message_id && ["accepted", "sent", "delivered", "unknown"].includes(row.status)) {
    const polled = await pollOne(row.provider_message_id).catch(() => null);
    if (polled?.changed) row = (await readMessage(row.id)) ?? row;
  }
  const troubled = ["failed", "unknown", "held", "retry_wait"].includes(row.status);
  return {
    id: row.id,
    status: row.status,
    providerMessageId: row.provider_message_id,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    failedAt: row.failed_at,
    paidAt: row.paid_at,
    errorCode: row.error_code,
    problem: troubled ? describeError(row.error_code, row.error_title).text : null,
  };
}

/* -------------------------------------------------------------------- queue */

export type QueueSettled = { row: MessageRow; outcome: SendOutcome };

/**
 * Send what is due: `queued` rows and busy-server failures whose wait is over.
 * Each row is checked against today's switches again before it goes: a feature
 * switched off, a template paused or practice mode turned on since it was
 * queued stops it here.
 */
export async function drainQueue(limit = 20): Promise<{ taken: number; settled: QueueSettled[] }> {
  const rows = await takeDue(limit);
  const settled: QueueSettled[] = [];
  if (rows.length === 0) return { taken: 0, settled };

  const config = readWhatsAppConfig();
  const switches = await readSwitches();
  const db = whatsappDb();

  for (const row of rows) {
    const template = row.kind === "template" && row.template_key ? await readTemplateRow(row.template_key, db).catch(() => null) : null;
    const verdict =
      row.kind === "template"
        ? checkWhatsAppSend({
            feature: row.feature as WhatsAppFeature,
            to: row.to_e164,
            switches,
            config,
            kind: "template",
            template,
            language: row.language_code,
            bodyParamCount: row.body_params.length,
            hasDocument: Boolean(row.header),
            hasUrlButton: row.button_params.length > 0,
          })
        : checkWhatsAppSend({
            feature: row.feature as WhatsAppFeature,
            to: row.to_e164,
            switches,
            config,
            kind: "text",
            wroteInLast24h: await wroteWithin24h(row.to_e164, db).catch(() => null),
          });

    if (verdict.decision !== "send" || !config.ok) {
      const code = verdict.decision === "refuse" ? verdict.code : verdict.decision === "dry_run" ? "dry_run" : "not_configured";
      const reason = verdict.decision === "refuse" ? verdict.reason : describeError(code).text.en;
      await recordAttempt(row.id, {
        status: verdict.decision === "dry_run" ? "dry_run" : "held",
        errorCode: code,
        errorTitle: reason,
        attempts: row.attempts,
        provider: row.provider,
      });
      settled.push({
        row,
        outcome:
          verdict.decision === "dry_run"
            ? { outcome: "dry_run", logId: row.id, reason }
            : { outcome: "refused", logId: row.id, code: (code as WhatsAppRefusal) ?? "not_configured", reason },
      });
      continue;
    }

    const provider = providerFor(config);
    const problem = await senderProblem(config, provider);
    if (problem) {
      await recordAttempt(row.id, { status: "held", errorCode: "not_configured", errorTitle: problem, attempts: row.attempts, provider: provider.name });
      settled.push({ row, outcome: { outcome: "refused", logId: row.id, code: "not_configured", reason: problem } });
      continue;
    }

    const body =
      row.kind === "template"
        ? templateMessageBody({
            to: row.to_e164,
            name: row.provider_template_name ?? row.template_key ?? "",
            languageCode: row.language_code ?? "hi",
            bodyParams: row.body_params,
            document: row.header ? { url: row.header.url, filename: row.header.filename } : null,
            urlButtonSuffix: row.button_params[0] ?? null,
          })
        : textMessageBody(row.to_e164, row.text_body ?? "");
    const outcome = await settle(row.id, await provider.send(body), row.attempts + 1, row.max_attempts, provider.name);
    settled.push({ row, outcome });
  }
  return { taken: rows.length, settled };
}

/* ------------------------------------------------------------------- retry */

/**
 * Features whose failed messages are sent again from their own screen, never
 * from the WhatsApp log: a fee message must be re-checked against the ledger
 * first (the parent may have paid since), an absence must not be told twice,
 * and staff and task messages have their own consent and reconcile rules.
 */
export const RETRY_FROM_OWN_SCREEN: Partial<Record<WhatsAppFeature, string>> = {
  fee_reminder: "/fees/reminders/fix",
  receipt: "/fees/reminders/fix",
  reversal: "/fees/reminders/fix",
  fee_statement: "/fees/reminders/fix",
  absent_notice: "/fees/reminders",
  collection_request: "/messages",
  report_delivery: "/messages",
  general: "/messages",
  staff_notice: "/messages",
  teacher_task: "/inbox?tasks=all",
};

export type RetryRefusal = "not_found" | "not_failed" | "own_screen" | "confirm_unknown" | "already_retried";

/**
 * Send a failed message again, as a new message (the old row stays as it was,
 * with `retried_at`). Only for messages One owns outright; the rest answer
 * `own_screen` with where to go. An UNKNOWN message may already be on the
 * parent's phone, so it needs `confirmUnknown`.
 */
export async function retryMessage(
  logId: string,
  actor: { userId: string },
  options: { confirmUnknown?: boolean } = {},
): Promise<SendOutcome | { outcome: "cannot_retry"; code: RetryRefusal; href?: string }> {
  const row = await readMessage(logId);
  if (!row) return { outcome: "cannot_retry", code: "not_found" };
  const ownScreen = RETRY_FROM_OWN_SCREEN[row.feature as WhatsAppFeature];
  if (ownScreen) return { outcome: "cannot_retry", code: "own_screen", href: ownScreen };
  if (row.retried_at) return { outcome: "cannot_retry", code: "already_retried" };
  if (!["failed", "unknown", "held"].includes(row.status)) return { outcome: "cannot_retry", code: "not_failed" };
  if (row.status === "unknown" && !options.confirmUnknown) return { outcome: "cannot_retry", code: "confirm_unknown" };

  const db = whatsappDb();
  const { data: marked } = await db
    .from("whatsapp_messages")
    .update({ retried_at: new Date().toISOString(), retried_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("retried_at", null)
    .select("id");
  if (!Array.isArray(marked) || marked.length !== 1) return { outcome: "cannot_retry", code: "already_retried" };
  await db.from("whatsapp_message_events").insert({ message_id: row.id, event: "retry", status: row.status, detail: { by: actor.userId } });

  const again: SendOptions = {
    feature: row.feature as WhatsAppFeature,
    toName: row.to_name,
    link: row.source_table && row.source_id ? { table: row.source_table, id: row.source_id } : null,
    sessionLabel: row.session_label,
    requestedBy: actor.userId,
    payCode: row.pay_code,
    retryOf: row.id,
    maxAttempts: row.max_attempts,
    document: row.header ? { url: row.header.url, filename: row.header.filename } : null,
    urlButton: row.button_params[0] ?? null,
  };
  return row.kind === "template"
    ? sendTemplate(row.to_e164, row.template_key ?? "", row.language_code, row.body_params, again)
    : sendText(row.to_e164, row.text_body ?? "", again);
}

/* ---------------------------------------------------------------- templates */

const STATUS_FROM_META: Record<string, string> = {
  APPROVED: "approved",
  PENDING: "pending",
  IN_APPEAL: "pending",
  PENDING_DELETION: "disabled",
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
  LIMIT_EXCEEDED: "disabled",
};

/**
 * Read every template's status from the school's WhatsApp account (the hub's
 * `GET /v1/templates`, or Meta's own list) and write it to the registry. The
 * hub's list is the source of truth: a row reads `approved` only when that
 * list says APPROVED, and only once it passes three more checks, each failing
 * to `disabled` with the reason on screen:
 *
 *  - a URL button opens One's own host: a Pay now link to the wrong host is
 *    how a parent pays the wrong app;
 *  - the blanks and the PDF header are the ones One fills;
 *  - where the caller knows the wording (`expectedBodies`, the `_v8` set),
 *    the approved body is that wording to the byte.
 */
export async function syncTemplates(
  actor: { staffId: string | null },
  siteOrigin: string,
  options: { expectedBodies?: ReadonlyMap<string, string> } = {},
): Promise<{ ok: true; checked: number; approved: number; missing: number } | { ok: false; problem: string }> {
  const config = readWhatsAppConfig();
  if (!config.ok) return { ok: false, problem: config.reason };
  const listed = await providerFor(config).listTemplates();
  if (!listed.ok) return { ok: false, problem: listed.problem };

  const db = whatsappDb();
  const { data: rows, error } = await db
    .from("whatsapp_templates")
    .select("key, provider_name, language_code, body_params, header, url_button, status, status_reason, submitted_at");
  if (error || !rows) return { ok: false, problem: "Could not read the template list." };

  let approved = 0;
  let missing = 0;
  const host = (() => {
    try {
      return new URL(siteOrigin).host;
    } catch {
      return "one.vpps.co.in";
    }
  })();
  const now = new Date().toISOString();
  type Row = {
    key: string;
    provider_name: string;
    language_code: string;
    body_params: number;
    header: string;
    url_button: boolean;
    status: string;
    status_reason: string | null;
    submitted_at: string | null;
  };
  for (const row of rows as Row[]) {
    const found = listed.templates.find((template) => template.name === row.provider_name && template.language === row.language_code);
    let status = found ? (STATUS_FROM_META[found.status] ?? "pending") : "not_submitted";
    let reason: string | null = found?.rejectedReason ?? null;
    if (!found && !row.submitted_at && row.status === "not_submitted") {
      // Never with Meta: keep why the hub refused it, if it did. That reason
      // is what keeps the hourly check from sending it again (D-573).
      reason = row.status_reason;
    }
    if (!found && row.submitted_at) {
      // Sent for approval from here, and not in the list yet: still Meta's.
      status = "pending";
      reason = "Sent for approval; not in the hub's list yet.";
    }
    if (found && status === "approved") {
      const buttonHost = (() => {
        try {
          return found.buttonUrl ? new URL(found.buttonUrl.replace(/\{\{\s*\d+\s*\}\}/g, "x")).host : null;
        } catch {
          return "unreadable";
        }
      })();
      const expected = options.expectedBodies?.get(row.key);
      if (row.url_button && buttonHost !== host) {
        status = "disabled";
        reason = `Its button opens ${buttonHost ?? "nothing"}, not ${host}.`;
      } else if (found.bodyParams !== row.body_params) {
        status = "disabled";
        reason = `The approved template has ${found.bodyParams} blanks; One fills ${row.body_params}.`;
      } else if ((found.header === "document") !== (row.header === "document")) {
        status = "disabled";
        reason = row.header === "document" ? "The approved template has no PDF header." : "The approved template expects a PDF.";
      } else if (expected !== undefined && found.bodyText !== expected) {
        status = "disabled";
        reason = "The approved wording is not the wording One sends.";
      }
    }
    if (status === "approved") approved += 1;
    if (!found) missing += 1;
    const category = found?.category && ["utility", "marketing", "authentication"].includes(found.category) ? found.category : null;
    await db
      .from("whatsapp_templates")
      .update({
        status,
        status_reason: reason,
        status_checked_at: now,
        quality: found?.quality ?? null,
        ...(category ? { category } : {}),
        updated_at: now,
        updated_by: actor.staffId,
      })
      .eq("key", row.key);
  }
  return { ok: true, checked: rows.length, approved, missing };
}

/* ------------------------------------------------------------- the hub's status */

/** A status from the hub, as the log's never-backwards write takes it. `accepted` is not news. */
export function statusWrite(status: ProviderStatus): { status: "sent" | "delivered" | "read" | "failed"; errorCode: string | null } | null {
  if (status.status === "accepted") return null;
  if (status.status === "blocked") return { status: "failed", errorCode: status.errorCode ?? "blocked" };
  return { status: status.status, errorCode: status.status === "failed" ? (status.errorCode ?? null) : null };
}

/** Ask the hub where one message is, and write it to the log. Null when the hub cannot say. */
export async function pollOne(wamid: string): Promise<(StatusAnswer & { status: ProviderStatus }) | null> {
  const config = readWhatsAppConfig();
  if (!config.ok) return null;
  const provider = providerFor(config);
  if (!provider.fetchStatus) return null;
  const answer = await provider.fetchStatus(wamid);
  if (!answer.ok) return null;
  const write = statusWrite(answer.status);
  if (!write) return { matched: true, changed: false, id: null, previous: null, source_table: null, source_id: null, status: answer.status };
  const recorded = await recordStatus({
    providerMessageId: wamid,
    status: write.status,
    at: answer.status.at,
    errorCode: write.errorCode,
    errorTitle: answer.status.errorTitle,
    detail: { via: "hub_status_poll", hub_status: answer.status.status },
  });
  return recorded ? { ...recorded, status: answer.status } : null;
}

export type PolledRow = { row: MessageRow; answer: (StatusAnswer & { status: ProviderStatus }) | null };

/**
 * The queue job's second half: ask the hub about messages it has not heard
 * back on. Each message is asked at most four times — ten minutes, an hour,
 * four hours and sixteen hours after it went (`whatsapp_take_pollable`) — so
 * a phone that is switched off for a day costs four reads, not hundreds.
 */
export async function pollPendingStatuses(limit = 20): Promise<PolledRow[]> {
  const config = readWhatsAppConfig();
  if (!config.ok || config.provider !== "hub") return [];
  const rows = await takePollable(limit);
  const polled: PolledRow[] = [];
  for (const row of rows) {
    if (!row.provider_message_id) continue;
    polled.push({ row, answer: await pollOne(row.provider_message_id).catch(() => null) });
  }
  return polled;
}

/* --------------------------------------------------- templates on the hub */

const STATUS_FROM_EVENT: Record<string, string> = {
  REJECTED: "rejected",
  PAUSED: "paused",
  DISABLED: "disabled",
  PENDING_DELETION: "disabled",
  DELETED: "disabled",
  LIMIT_EXCEEDED: "disabled",
  PENDING: "pending",
  IN_APPEAL: "pending",
};

/**
 * A template's review changed (the webhook). A step DOWN — rejected, paused,
 * disabled, back to pending — is written at once: refusing to send is always
 * safe. A step UP (approved, reinstated) is never taken from the event alone:
 * `needsSync` asks the caller to read the hub's list, where the button host,
 * the blanks and the wording are checked before a row reads approved.
 */
export async function applyTemplateEvents(events: readonly WebhookTemplateEvent[]): Promise<{ written: number; needsSync: boolean }> {
  const db = whatsappDb();
  const now = new Date().toISOString();
  let written = 0;
  let needsSync = false;
  for (const event of events) {
    if (event.kind === "category") {
      if (event.newCategory && ["utility", "marketing", "authentication"].includes(event.newCategory)) {
        const { data } = await db
          .from("whatsapp_templates")
          .update({ category: event.newCategory, status_reason: `Meta moved it to ${event.newCategory}.`, status_checked_at: now, updated_at: now })
          .eq("provider_name", event.name)
          .eq("language_code", event.language)
          .select("key");
        written += Array.isArray(data) ? data.length : 0;
      }
      continue;
    }
    const down = event.event ? STATUS_FROM_EVENT[event.event] : undefined;
    if (!down) {
      if (event.event === "APPROVED" || event.event === "REINSTATED") needsSync = true;
      continue;
    }
    const { data } = await db
      .from("whatsapp_templates")
      .update({ status: down, status_reason: event.reason ?? `Meta: ${event.event?.toLowerCase()}.`, status_checked_at: now, updated_at: now })
      .eq("provider_name", event.name)
      .eq("language_code", event.language)
      .select("key");
    written += Array.isArray(data) ? data.length : 0;
  }
  return { written, needsSync };
}

/**
 * Hand templates to Meta for review on the hub's account (`POST /v1/templates`).
 * Only a registry row that is not yet with Meta — `not_submitted` or
 * `rejected` — is sent: a pending or approved one is never resubmitted. Each
 * row sent reads `pending` until the hub's list or its webhook says more.
 */
export async function submitTemplates(
  submissions: readonly TemplateSubmission[],
  actor: { staffId: string | null },
  options: {
    /** At most this many go in one call; the rest wait for the next. */
    limit?: number;
    /**
     * Only rows never sent and never refused (`not_submitted` with no reason):
     * the hourly check's rule, so a refusal is not repeated every hour.
     */
    newOnly?: boolean;
  } = {},
): Promise<{ ok: true; sent: number; skipped: number; failed: Array<{ name: string; problem: string }> } | { ok: false; problem: string }> {
  const config = readWhatsAppConfig();
  if (!config.ok) return { ok: false, problem: config.reason };
  const provider = providerFor(config);
  const submitTemplate = provider.submitTemplate;
  if (!submitTemplate) return { ok: false, problem: "Only the school's WhatsApp hub takes templates from One." };
  const db = whatsappDb();
  const { data: rows, error } = await db
    .from("whatsapp_templates")
    .select("key, provider_name, language_code, status, status_reason")
    .in("provider_name", submissions.map((submission) => submission.name));
  if (error || !rows) return { ok: false, problem: "Could not read the template list." };

  let sent = 0;
  let skipped = 0;
  const failed: Array<{ name: string; problem: string }> = [];
  const todo: Array<{ submission: TemplateSubmission; row: { key: string; status: string } }> = [];
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  for (const submission of submissions) {
    const row = (rows as Array<{ key: string; provider_name: string; language_code: string; status: string; status_reason: string | null }>).find(
      (candidate) => candidate.provider_name === submission.name && candidate.language_code === submission.language,
    );
    const wanted = row && (options.newOnly ? row.status === "not_submitted" && !row.status_reason : SUBMITTABLE.includes(row.status));
    if (!row || !wanted || todo.length >= limit) skipped += 1;
    else todo.push({ submission, row });
  }

  await eachAtMost(SUBMIT_AT_ONCE, todo, async ({ submission, row }) => {
    // Take the row first. A second press while this one is still sending (it
    // did happen: 22 at ~5 s each) finds it taken and leaves it alone, instead
    // of sending it again and writing Meta's "already there" over a row that
    // went through (9 Nov).
    const takenAt = new Date().toISOString();
    const { data: taken } = await db
      .from("whatsapp_templates")
      .update({ status: "pending", status_reason: "Being sent to Meta.", status_checked_at: takenAt, updated_at: takenAt, updated_by: actor.staffId })
      .eq("key", row.key)
      .in("status", SUBMITTABLE)
      .select("key");
    if (!taken || taken.length === 0) {
      skipped += 1;
      return;
    }
    const answer = await submitTemplate(submission).catch(
      (caught: unknown): { ok: false; problem: string } => ({ ok: false, problem: caught instanceof Error ? caught.message : "No answer from the hub." }),
    );
    const now = new Date().toISOString();
    if (!answer.ok) {
      failed.push({ name: submission.name, problem: answer.problem });
      // Back to where it was, so it can be sent again.
      await db
        .from("whatsapp_templates")
        .update({ status: row.status, status_reason: `Not sent for approval: ${answer.problem}`.slice(0, 300), status_checked_at: now, updated_at: now, updated_by: actor.staffId })
        .eq("key", row.key)
        .eq("status", "pending");
      return;
    }
    sent += 1;
    const status = answer.status === "APPROVED" ? "pending" : (STATUS_FROM_EVENT[answer.status ?? ""] ?? "pending");
    await db
      .from("whatsapp_templates")
      .update({
        status,
        status_reason: answer.status === "APPROVED" ? "Approved on submission; press Check templates to confirm." : "Sent to Meta for approval.",
        submitted_at: now,
        status_checked_at: now,
        updated_at: now,
        updated_by: actor.staffId,
      })
      .eq("key", row.key);
  });
  return { ok: true, sent, skipped, failed };
}

/** Rows Meta has not seen yet, or turned down: the only ones Send for approval sends. */
const SUBMITTABLE = ["not_submitted", "rejected"];

/** Three at a time: 22 one after another took 100 seconds and somebody pressed again. */
const SUBMIT_AT_ONCE = 3;

async function eachAtMost<T>(limit: number, items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Is the school's WhatsApp connected, from which number, and how healthy? */
export async function checkConnection(): Promise<ProviderConnection & { provider: string | null; configured: boolean }> {
  const config = readWhatsAppConfig();
  if (!config.ok) {
    return { ok: false, configured: false, provider: config.provider, displayNumber: null, verifiedName: null, quality: null, limitTier: null, problem: config.reason };
  }
  forgetSenderCheck();
  const connection = await providerFor(config).checkConnection();
  return { ...connection, configured: true, provider: config.provider };
}

export function isWhatsAppConfigured(): boolean {
  return readWhatsAppConfig().ok;
}
