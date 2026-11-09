import "server-only";

import { randomUUID } from "node:crypto";

import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import { fromWaId, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import { acceptedMessageId, graphError } from "@/platform/whatsapp/payload";

/**
 * The two ways out to WhatsApp, behind one shape (D-562).
 *
 * Both take Meta's Cloud API message JSON (payload.ts) unchanged:
 *
 *   meta_cloud     POST https://graph.facebook.com/{version}/{phone-number-id}/messages
 *                  Authorization: Bearer WHATSAPP_ACCESS_TOKEN
 *   school_server  POST {WHATSAPP_API_URL}/messages
 *                  Authorization: Bearer WHATSAPP_API_KEY
 *
 * The school server's paths are the Meta-compatible default Janmejay agreed on
 * 9 Nov while its own API is being finished; docs/whatsapp/SETUP.md lists what
 * is still to confirm.
 *
 * The answer is one of three things, and only a definite refusal is safe to
 * send again: accepted (with Meta's message id), rejected (a 4xx Meta or the
 * server actually returned), or unknown (no answer, a timeout, a 5xx a gateway
 * may have sent after the message went, or a 2xx without an id).
 */

export type ProviderSendResult =
  | { outcome: "accepted"; messageId: string; httpStatus: number }
  | { outcome: "rejected"; httpStatus: number; errorCode: string | null; errorTitle: string | null; errorDetail: string | null }
  | { outcome: "unknown"; httpStatus: number | null; errorCode: "network" | "server_error" | "no_receipt"; errorTitle: string };

export type ProviderTemplate = {
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejectedReason: string | null;
  /** The URL on the template's URL button, when it has one. */
  buttonUrl: string | null;
  bodyParams: number;
  header: "none" | "document" | "image" | "text";
};

export type ProviderConnection = {
  ok: boolean;
  /** The number the server or Meta says it sends from, when it says. */
  displayNumber: string | null;
  verifiedName: string | null;
  quality: string | null;
  limitTier: string | null;
  problem: string | null;
};

export type WhatsAppProvider = {
  name: "school_server" | "meta_cloud" | "mock";
  send(body: Record<string, unknown>): Promise<ProviderSendResult>;
  listTemplates(): Promise<{ ok: true; templates: ProviderTemplate[] } | { ok: false; problem: string }>;
  checkConnection(): Promise<ProviderConnection>;
};

const TIMEOUT_MS = 15_000;

async function postJson(url: string, token: string, body: Record<string, unknown>): Promise<ProviderSendResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (caught) {
    // The request may have left. One parent missed beats one parent messaged twice.
    return {
      outcome: "unknown",
      httpStatus: null,
      errorCode: "network",
      errorTitle: (caught instanceof Error ? caught.message : "No answer from the WhatsApp server").slice(0, 300),
    };
  }
  const text = await response.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) {
    const id = acceptedMessageId(parsed);
    return id
      ? { outcome: "accepted", messageId: id, httpStatus: response.status }
      : { outcome: "unknown", httpStatus: response.status, errorCode: "no_receipt", errorTitle: "Answered without a message id" };
  }
  if (response.status >= 500) {
    return { outcome: "unknown", httpStatus: response.status, errorCode: "server_error", errorTitle: `Server error ${response.status}` };
  }
  const error = graphError(parsed);
  return {
    outcome: "rejected",
    httpStatus: response.status,
    errorCode: error.code ?? (response.status === 429 ? "130429" : null),
    errorTitle: error.title ?? (text.slice(0, 300) || `Refused (${response.status})`),
    errorDetail: error.detail,
  };
}

async function getJson(url: string, token: string): Promise<{ ok: true; body: unknown } | { ok: false; problem: string }> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, problem: graphError(body).title ?? `The server answered ${response.status}.` };
    return { ok: true, body };
  } catch (caught) {
    return { ok: false, problem: caught instanceof Error ? caught.message : "No answer." };
  }
}

/** Meta's template list entry, as `GET /{waba-id}/message_templates` returns it. */
export function readTemplate(raw: unknown): ProviderTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : null;
  const language = typeof record.language === "string" ? record.language : null;
  if (!name || !language) return null;
  const components = Array.isArray(record.components) ? (record.components as Array<Record<string, unknown>>) : [];
  const body = components.find((component) => String(component.type).toUpperCase() === "BODY");
  const header = components.find((component) => String(component.type).toUpperCase() === "HEADER");
  const buttons = components.find((component) => String(component.type).toUpperCase() === "BUTTONS");
  const urlButton = (Array.isArray(buttons?.buttons) ? (buttons.buttons as Array<Record<string, unknown>>) : []).find(
    (button) => String(button.type).toUpperCase() === "URL",
  );
  const bodyText = typeof body?.text === "string" ? body.text : "";
  const slots = new Set([...bodyText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1]));
  const format = String(header?.format ?? "").toUpperCase();
  return {
    name,
    language,
    status: String(record.status ?? "").toUpperCase(),
    category: typeof record.category === "string" ? record.category.toLowerCase() : null,
    rejectedReason: typeof record.rejected_reason === "string" && record.rejected_reason !== "NONE" ? record.rejected_reason : null,
    buttonUrl: typeof urlButton?.url === "string" ? urlButton.url : null,
    bodyParams: slots.size,
    header: !header ? "none" : format === "DOCUMENT" ? "document" : format === "IMAGE" ? "image" : "text",
  };
}

async function pagedTemplates(firstUrl: string, token: string): Promise<{ ok: true; templates: ProviderTemplate[] } | { ok: false; problem: string }> {
  const templates: ProviderTemplate[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < 20; page += 1) {
    const answer = await getJson(url, token);
    if (!answer.ok) return answer;
    const body = (answer.body ?? {}) as { data?: unknown; paging?: { next?: unknown } };
    for (const raw of Array.isArray(body.data) ? body.data : []) {
      const template = readTemplate(raw);
      if (template) templates.push(template);
    }
    url = typeof body.paging?.next === "string" ? body.paging.next : null;
  }
  return { ok: true, templates };
}

function connectionFrom(body: unknown): ProviderConnection {
  const record = (body ?? {}) as Record<string, unknown>;
  const displayNumber = fromWaId(typeof record.display_phone_number === "string" ? record.display_phone_number : null);
  const ok = displayNumber === SCHOOL_WHATSAPP_NUMBER;
  return {
    ok,
    displayNumber,
    verifiedName: typeof record.verified_name === "string" ? record.verified_name : null,
    quality: typeof record.quality_rating === "string" ? record.quality_rating : null,
    limitTier: typeof record.messaging_limit_tier === "string" ? record.messaging_limit_tier : null,
    problem: ok
      ? null
      : displayNumber
        ? "The server sends from a different number than the school's (+91 83022 07823)."
        : "The server did not say which number it sends from.",
  };
}

const TEMPLATE_FIELDS = "name,language,status,category,components,rejected_reason";

export function providerFor(config: Extract<WhatsAppConfig, { ok: true }>): WhatsAppProvider {
  if (config.provider === "meta_cloud") {
    const base = `https://graph.facebook.com/${config.graphVersion}`;
    return {
      name: "meta_cloud",
      send: (body) => postJson(`${base}/${config.phoneNumberId}/messages`, config.accessToken, body),
      listTemplates: async () =>
        config.businessAccountId
          ? pagedTemplates(`${base}/${config.businessAccountId}/message_templates?fields=${TEMPLATE_FIELDS}&limit=100`, config.accessToken)
          : { ok: false, problem: "WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so the template list cannot be read." },
      checkConnection: async () => {
        const answer = await getJson(
          `${base}/${config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
          config.accessToken,
        );
        return answer.ok
          ? connectionFrom(answer.body)
          : { ok: false, displayNumber: null, verifiedName: null, quality: null, limitTier: null, problem: answer.problem };
      },
    };
  }
  if (config.provider === "school_server") {
    return {
      name: "school_server",
      send: (body) => postJson(`${config.apiUrl}/messages`, config.apiKey, body),
      listTemplates: () => pagedTemplates(`${config.apiUrl}/templates`, config.apiKey),
      checkConnection: async () => {
        const answer = await getJson(`${config.apiUrl}/health`, config.apiKey);
        return answer.ok
          ? connectionFrom(answer.body)
          : { ok: false, displayNumber: null, verifiedName: null, quality: null, limitTier: null, problem: answer.problem };
      },
    };
  }
  return {
    name: "mock",
    send: async () => ({ outcome: "accepted", messageId: `mock:${randomUUID()}`, httpStatus: 200 }),
    listTemplates: async () => ({ ok: true, templates: [] }),
    checkConnection: async () => ({
      ok: true,
      displayNumber: SCHOOL_WHATSAPP_NUMBER,
      verifiedName: "Mock (nothing leaves)",
      quality: null,
      limitTier: null,
      problem: null,
    }),
  };
}
