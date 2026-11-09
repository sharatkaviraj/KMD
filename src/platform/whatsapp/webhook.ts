import { createHmac, timingSafeEqual } from "node:crypto";

import { fromWaId, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";

/**
 * The status webhook, read (D-562). Pure: no database, no request object.
 *
 * Meta, and the school's WhatsApp server in the same format, POST a
 * `whatsapp_business_account` payload signed with HMAC-SHA256 of the RAW body
 * in `X-Hub-Signature-256: sha256=<hex>`. The signature is checked over the
 * exact bytes received; parsing first and re-serialising would change them.
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

export type ParsedWebhook = {
  /** The receiving number as each change states it, for the route to check. */
  numbers: Array<{ displayNumber: string | null; phoneNumberId: string | null }>;
  statuses: WebhookStatus[];
  inbound: WebhookInbound[];
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

export function parseWebhook(payload: unknown, nowIso: string = new Date().toISOString()): ParsedWebhook {
  const parsed: ParsedWebhook = { numbers: [], statuses: [], inbound: [], otherNumber: 0 };
  const root = asRecord(payload);
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const changeRecord = asRecord(change);
      if (changeRecord.field !== undefined && changeRecord.field !== "messages") continue;
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
