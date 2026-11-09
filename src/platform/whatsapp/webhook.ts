import { createHmac, timingSafeEqual } from "node:crypto";

import { fromWaId, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";

/**
 * The status webhook, read (D-562, D-566). Pure: no database, no request object.
 *
 * Meta, and the school's WhatsApp hub forwarding Meta's JSON unchanged, POST
 * a `whatsapp_business_account` payload signed with HMAC-SHA256 of the RAW
 * body in `X-Hub-Signature-256: sha256=<hex>` (Meta: the app secret; the hub:
 * One's own hub key). The signature is checked over the exact bytes
 * received; parsing first and re-serialising would change them.
 *
 * Three kinds of change are read: `messages` (statuses and replies),
 * `message_template_status_update` (Meta approved, rejected or paused a
 * template) and `template_category_update` (Meta moved one to another
 * category). Anything else is left unread.
 */

export type WebhookStatus = {
  providerMessageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string | null;
  recipient: string | null;
  errorCode: string | null;
  errorTitle: string | null;
  errorDetail: string | null;
};

export type WebhookInbound = {
  providerMessageId: string;
  from: string;
  fromName: string | null;
  type: string;
  text: string | null;
  replyTo: string | null;
  at: string;
  raw: Record<string, unknown>;
};

/** A template's review or category changed on the school's account. */
export type WebhookTemplateEvent = {
  name: string;
  language: string;
  kind: "status" | "category";
  /** Meta's event, upper case: APPROVED, REJECTED, PAUSED, PENDING, DISABLED, FLAGGED, REINSTATED … */
  event: string | null;
  reason: string | null;
  /** The category Meta moved it to, lower case. */
  newCategory: string | null;
};

export type ParsedWebhook = {
  /** The receiving number as each change states it, for the route to check. */
  numbers: Array<{ displayNumber: string | null; phoneNumberId: string | null }>;
  statuses: WebhookStatus[];
  inbound: WebhookInbound[];
  templates: WebhookTemplateEvent[];
  /** Changes for any number but the school's, left unread. */
  otherNumber: number;
};

/** Whether `header` is a valid `sha256=` signature of `rawBody` under any one of `secrets`. */
export function verifySignature(rawBody: string, header: string | null | undefined, secrets: readonly string[]): boolean {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(String(header ?? "").trim());
  if (!match || secrets.length === 0) return false;
  const given = Buffer.from(match[1].toLowerCase(), "hex");
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Meta's timestamps are Unix seconds as a string. */
function isoFromUnix(value: unknown): string | null {
  const seconds = Number(stringOf(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

const STATUSES = new Set(["sent", "delivered", "read", "failed"]);

/** What a parent's reply says, whatever kind of message it was. */
function inboundText(message: Record<string, unknown>): string | null {
  const type = stringOf(message.type);
  if (type === "text") return stringOf(asRecord(message.text).body);
  if (type === "button") return stringOf(asRecord(message.button).text);
  if (type === "interactive") {
    const interactive = asRecord(message.interactive);
    return stringOf(asRecord(interactive.button_reply).title) ?? stringOf(asRecord(interactive.list_reply).title);
  }
  if (type === "reaction") return stringOf(asRecord(message.reaction).emoji);
  const media = asRecord(message[type ?? ""]);
  return stringOf(media.caption);
}

/** A template change's value, as Meta sends it for either field. */
function templateEvent(field: string, value: Record<string, unknown>): WebhookTemplateEvent | null {
  const name = stringOf(value.message_template_name);
  const language = stringOf(value.message_template_language);
  if (!name || !language || !/^[a-z0-9_]{1,512}$/.test(name)) return null;
  if (field === "message_template_status_update") {
    const reason = stringOf(value.reason) ?? stringOf(asRecord(value.other_info).description);
    return {
      name,
      language,
      kind: "status",
      event: stringOf(value.event)?.toUpperCase() ?? null,
      reason: reason && reason.toUpperCase() !== "NONE" ? reason.slice(0, 300) : null,
      newCategory: null,
    };
  }
  const category = stringOf(value.new_category) ?? stringOf(value.correct_category);
  return { name, language, kind: "category", event: null, reason: null, newCategory: category ? category.toLowerCase() : null };
}

const TEMPLATE_FIELDS = new Set(["message_template_status_update", "template_category_update"]);

export function parseWebhook(payload: unknown, nowIso: string = new Date().toISOString()): ParsedWebhook {
  const parsed: ParsedWebhook = { numbers: [], statuses: [], inbound: [], templates: [], otherNumber: 0 };
  const root = asRecord(payload);
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const changeRecord = asRecord(change);
      const field = typeof changeRecord.field === "string" ? changeRecord.field : undefined;
      if (field && TEMPLATE_FIELDS.has(field)) {
        const event = templateEvent(field, asRecord(changeRecord.value));
        if (event) parsed.templates.push(event);
        continue;
      }
      if (field !== undefined && field !== "messages") continue;
      const value = asRecord(changeRecord.value);
      const metadata = asRecord(value.metadata);
      const displayNumber = fromWaId(stringOf(metadata.display_phone_number));
      parsed.numbers.push({ displayNumber, phoneNumberId: stringOf(metadata.phone_number_id) });
      // A change that says it is for another number is not the school's
      // business: never the fees app's AiSensy number, never anybody else's.
      if (displayNumber && displayNumber !== SCHOOL_WHATSAPP_NUMBER) {
        parsed.otherNumber += 1;
        continue;
      }

      for (const item of asArray(value.statuses)) {
        const status = asRecord(item);
        const id = stringOf(status.id);
        const name = stringOf(status.status);
        if (!id || !name || !STATUSES.has(name)) continue;
        const firstError = asRecord(asArray(status.errors)[0]);
        parsed.statuses.push({
          providerMessageId: id,
          status: name as WebhookStatus["status"],
          at: isoFromUnix(status.timestamp),
          recipient: fromWaId(stringOf(status.recipient_id)),
          errorCode: stringOf(firstError.code),
          errorTitle: stringOf(firstError.title) ?? stringOf(firstError.message),
          errorDetail: stringOf(asRecord(firstError.error_data).details),
        });
      }

      const names = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const record = asRecord(contact);
        const waId = fromWaId(stringOf(record.wa_id));
        const name = stringOf(asRecord(record.profile).name);
        if (waId && name) names.set(waId, name.slice(0, 120));
      }

      for (const item of asArray(value.messages)) {
        const message = asRecord(item);
        const id = stringOf(message.id);
        const from = fromWaId(stringOf(message.from));
        if (!id || !from) continue;
        const text = inboundText(message);
        parsed.inbound.push({
          providerMessageId: id,
          from,
          fromName: names.get(from) ?? null,
          type: stringOf(message.type) ?? "unknown",
          text: text ? text.slice(0, 4096) : null,
          replyTo: stringOf(asRecord(message.context).id),
          at: isoFromUnix(message.timestamp) ?? nowIso,
          raw: message,
        });
      }
    }
  }
  return parsed;
}
