import { waDigits } from "@/platform/whatsapp/numbers";

/**
 * The message JSON, in Meta's WhatsApp Cloud API format (D-562).
 *
 * Both providers take exactly this body: Meta's own `/{phone-number-id}/messages`,
 * and the school's WhatsApp hub's `POST /v1/messages`, a pass-through of the
 * same format (the hub's API doc, 9 Nov). Pure, so the exact bytes are pinned
 * by tests rather than discovered in a refusal from Meta.
 *
 * What AiSensy hid and this now has to say itself:
 *  - a template is named with its LANGUAGE; the same name in Hindi and English
 *    is two templates to Meta;
 *  - a document header and a URL button are their own components, never part
 *    of the body's `{{n}}` list;
 *  - Meta refuses a body value with a line break, a tab or more than four
 *    spaces in a row (error 132018), and an empty one (131008).
 */

export type TemplateDocument = {
  /** Fetchable by Meta with no headers and no session (a signed URL qualifies). */
  url: string;
  /** What the parent sees in WhatsApp. Never carries an admission number. */
  filename: string;
};

export type TemplateMessage = {
  /** E.164. */
  to: string;
  /** The template's name on the school's WhatsApp account. */
  name: string;
  /** Meta's language code: `hi`, `en`, `en_US`. */
  languageCode: string;
  /** The body's `{{1}}`, `{{2}}`, … in order. */
  bodyParams: readonly string[];
  document?: TemplateDocument | null;
  /** The dynamic end of a URL button's link, e.g. a pay code. Button 0. */
  urlButtonSuffix?: string | null;
};

/** One body value, made acceptable to Meta without changing what it says. */
export function cleanParam(value: string | number | null | undefined): string {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim();
  return text.length > 0 ? text : "-";
}

export function templateMessageBody(message: TemplateMessage): Record<string, unknown> {
  const components: Array<Record<string, unknown>> = [];
  if (message.document) {
    components.push({
      type: "header",
      parameters: [{ type: "document", document: { link: message.document.url, filename: message.document.filename } }],
    });
  }
  if (message.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: message.bodyParams.map((value) => ({ type: "text", text: cleanParam(value) })),
    });
  }
  if (message.urlButtonSuffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: message.urlButtonSuffix }],
    });
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waDigits(message.to),
    type: "template",
    template: {
      name: message.name,
      language: { code: message.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };
}

/** Free text. Meta delivers it only inside the 24 hours after the person last wrote. */
export function textMessageBody(to: string, text: string): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: waDigits(to),
    type: "text",
    text: { preview_url: false, body: text.slice(0, 4096) },
  };
}

/** What Meta answers on acceptance: `{ messages: [{ id: "wamid…" }] }`. */
export function acceptedMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const id = (messages[0] as { id?: unknown })?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Meta's error envelope, `{ error: { code, message, error_data: { details } } }`,
 * and the hub's, which is Meta's with `hub_code` beside the code
 * (`window_closed`, `opted_out`, `not_approved`, `sending_off`, `test_mode`,
 * `bad_number` …) and `type: "VppsHubError"`.
 */
export function graphError(body: unknown): { code: string | null; hubCode: string | null; title: string | null; detail: string | null } {
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
  if (!error || typeof error !== "object") return { code: null, hubCode: null, title: null, detail: null };
  const record = error as Record<string, unknown>;
  const data = (record.error_data ?? {}) as Record<string, unknown>;
  const code = record.code ?? null;
  const hubCode = typeof record.hub_code === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(record.hub_code.trim()) ? record.hub_code.trim() : null;
  return {
    code: code === null || code === undefined || String(code).trim() === "" ? null : String(code).trim(),
    hubCode,
    title: typeof record.message === "string" ? record.message.slice(0, 300) : null,
    detail: typeof data.details === "string" ? data.details.slice(0, 500) : null,
  };
}
