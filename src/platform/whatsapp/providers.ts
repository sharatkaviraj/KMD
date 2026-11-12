import "server-only";

import { randomUUID } from "node:crypto";

import type { WhatsAppConfig } from "@/platform/whatsapp/config";
import { fromWaId, SCHOOL_WHATSAPP_NUMBER } from "@/platform/whatsapp/numbers";
import { acceptedMessageId, graphError } from "@/platform/whatsapp/payload";

/**
 * The ways out to WhatsApp, behind one shape (D-562, D-566).
 *
 * Both real ones take Meta's Cloud API message JSON (payload.ts) unchanged:
 *
 *   hub         POST {WHATSAPP_HUB_URL}/v1/messages
 *               Authorization: Bearer WHATSAPP_HUB_KEY
 *               The school's own WhatsApp hub, which owns +91 83022 07823 and
 *               nothing else. Also GET/POST /v1/templates and
 *               GET /v1/status/{wamid} (the hub's API doc, 9 Nov 2026).
 *   meta_cloud  POST https://graph.facebook.com/{version}/{phone-number-id}/messages
 *               Authorization: Bearer WHATSAPP_ACCESS_TOKEN
 *
 * The answer is one of three things, and only a definite refusal is safe to
 * send again: accepted (with Meta's message id), rejected (a 4xx Meta or the
 * hub actually returned, or the hub's 502 carrying Meta's own error code), or
 * unknown (no answer, a timeout, a 5xx a gateway may have sent after the
 * message went, or a 2xx without an id).
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
  /** The approved body, exactly, for the byte-for-byte check against One's own. */
  bodyText: string | null;
  header: "none" | "document" | "image" | "text";
  quality: string | null;
};

export type ProviderConnection = {
  ok: boolean;
  /** The number the hub or Meta says it sends from, when it says. */
  displayNumber: string | null;
  verifiedName: string | null;
  quality: string | null;
  limitTier: string | null;
  problem: string | null;
};

/** Where a message is now, as the hub tells it (`GET /v1/status/{wamid}`). Meta's own statuses and codes. */
export type ProviderStatus = {
  wamid: string;
  status: "accepted" | "sent" | "delivered" | "read" | "failed" | "blocked";
  errorCode: string | null;
  errorTitle: string | null;
  at: string | null;
};

/** One template for `POST /v1/templates`, in the hub's own format. */
export type TemplateSubmission = {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  body: string;
  examples: string[];
  footer?: string;
  buttons: Array<{ type: "URL"; text: string; url: string } | { type: "PHONE_NUMBER"; text: string; phone_number: string }>;
};

/**
 * A sign-in code template (D-585): Meta's AUTHENTICATION kind, as the hub
 * takes it since hub PR 4. Meta writes the words itself ("123456 is your
 * verification code. For your security, do not share this code."), adds the
 * expiry footer and a Copy code button; One gives only the minutes.
 */
export type SignInTemplateSubmission = {
  name: string;
  language: string;
  category: "AUTHENTICATION";
  code_expiration_minutes: number;
  message_send_ttl_seconds: number;
  button_text?: string;
};

/** Anything One hands the hub's `POST /v1/templates`. */
export type HubTemplateSubmission = TemplateSubmission | SignInTemplateSubmission;

export type SubmitResult =
  | { ok: true; id: string | null; status: string | null; category: string | null }
  | { ok: false; code: string | null; problem: string };

export type StatusResult = { ok: true; status: ProviderStatus } | { ok: false; notFound: boolean; problem: string };

/**
 * The hub's answer to `POST /v1/typing` (hub PR 3, 12 Nov 2026): whether One,
 * and not the hub's own bot, answers this parent's message. The first claim
 * of a message wins; asking again for the same message answers the same.
 * Only `claimed: true` lets One answer.
 */
export type ClaimResult =
  | {
      ok: true;
      claimed: boolean;
      /** The parent sees the blue ticks and the typing dots. */
      typing: boolean;
      /** A person in the office is handling this chat. */
      staff: boolean;
      /** Too old to answer now. */
      stale: boolean;
      /** Who claimed it first, when it was not One ('bot' is the hub's own). */
      takenBy: string | null;
    }
  | { ok: false; httpStatus: number | null; problem: string };

export type WhatsAppProvider = {
  name: "hub" | "meta_cloud" | "mock";
  send(body: Record<string, unknown>): Promise<ProviderSendResult>;
  listTemplates(): Promise<{ ok: true; templates: ProviderTemplate[] } | { ok: false; problem: string }>;
  checkConnection(): Promise<ProviderConnection>;
  /** The hub only: Meta's latest status for one message. */
  fetchStatus?(wamid: string): Promise<StatusResult>;
  /** The hub only: hand one template to Meta for review on the hub's account. */
  submitTemplate?(template: HubTemplateSubmission): Promise<SubmitResult>;
  /** The hub only: claim a parent's message so One answers it, and show the typing dots. */
  claimMessage?(wamid: string): Promise<ClaimResult>;
};

const TIMEOUT_MS = 15_000;
/** A claim answers in well under a second; the hub's own bot waits only a few. */
const CLAIM_TIMEOUT_MS = 4_000;

/** The hub's own refusals, each meaning nothing went (the hub's API doc). */
export const HUB_CODES = ["window_closed", "opted_out", "not_approved", "sending_off", "test_mode", "bad_number"] as const;
const HUB_CODE_SET: ReadonlySet<string> = new Set(HUB_CODES);

/**
 * The one code a refusal is filed under. The hub's own reason first (it names
 * what the hub decided, before Meta was asked); then Meta's number, which the
 * failure desk and errors.ts read; then whatever else either said.
 */
export function refusalCode(parsed: unknown, httpStatus: number): string | null {
  const error = graphError(parsed);
  if (error.hubCode && HUB_CODE_SET.has(error.hubCode)) return error.hubCode;
  if (error.code && /^\d+$/.test(error.code)) return error.code;
  // The hub's key check answers `{ ok: false, error: "bad_api_key" }`.
  const flat = parsed && typeof parsed === "object" ? (parsed as { error?: unknown }).error : null;
  if (typeof flat === "string" && /^[a-z][a-z0-9_]{1,40}$/.test(flat)) return flat;
  return error.hubCode ?? error.code ?? (httpStatus === 429 ? "130429" : httpStatus === 401 ? "bad_api_key" : null);
}

function parseText(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>,
  options: { hub: boolean },
): Promise<ProviderSendResult> {
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
  const parsed = parseText(text);
  if (response.ok) {
    const id = acceptedMessageId(parsed);
    return id
      ? { outcome: "accepted", messageId: id, httpStatus: response.status }
      : { outcome: "unknown", httpStatus: response.status, errorCode: "no_receipt", errorTitle: "Answered without a message id" };
  }
  const error = graphError(parsed);
  // The hub answers 502 when Meta refused the message and passes Meta's code
  // on: that is Meta's definite no. A 5xx with no code may have gone.
  const metaSaidNo = options.hub && response.status === 502 && Boolean(error.code && /^\d+$/.test(error.code));
  if (response.status >= 500 && !metaSaidNo) {
    return { outcome: "unknown", httpStatus: response.status, errorCode: "server_error", errorTitle: `Server error ${response.status}` };
  }
  return {
    outcome: "rejected",
    httpStatus: response.status,
    errorCode: refusalCode(parsed, response.status),
    errorTitle: error.title ?? (text.slice(0, 300) || `Refused (${response.status})`),
    errorDetail: error.detail,
  };
}

type GetAnswer = { ok: true; body: unknown } | { ok: false; httpStatus: number | null; problem: string };

async function getJson(url: string, token: string): Promise<GetAnswer> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const problem =
        response.status === 401
          ? "The WhatsApp server refused One's key."
          : (graphError(body).title ?? `The server answered ${response.status}.`);
      return { ok: false, httpStatus: response.status, problem };
    }
    return { ok: true, body };
  } catch (caught) {
    return { ok: false, httpStatus: null, problem: caught instanceof Error ? caught.message : "No answer." };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function quality(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
  const score = asRecord(value).score;
  return typeof score === "string" && score.trim() ? score.trim().toUpperCase() : null;
}

/** A template list entry, as Meta's `message_templates` and the hub's `GET /v1/templates` both give it. */
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
  const bodyText = typeof body?.text === "string" ? body.text : typeof record.body === "string" ? record.body : null;
  const slots = new Set([...(bodyText ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1]));
  // Meta writes an AUTHENTICATION template's words itself ("{{1}} is your
  // verification code."): exactly one blank, the code. The hub lists back what
  // it submitted, `add_security_recommendation` and no text, so a missing
  // wording there is still one blank, not none (D-587, 12 Nov 2026).
  const authentication = String(record.category ?? "").toUpperCase() === "AUTHENTICATION";
  const bodyParams = authentication && bodyText === null ? 1 : slots.size;
  const format = String(header?.format ?? "").toUpperCase();
  const reason = typeof record.rejected_reason === "string" ? record.rejected_reason.trim() : "";
  return {
    name,
    language,
    status: String(record.status ?? "").toUpperCase(),
    category: typeof record.category === "string" ? record.category.toLowerCase() : null,
    rejectedReason: reason && reason.toUpperCase() !== "NONE" ? reason : null,
    buttonUrl: typeof urlButton?.url === "string" ? urlButton.url : null,
    bodyParams,
    bodyText,
    header: !header ? "none" : format === "DOCUMENT" ? "document" : format === "IMAGE" ? "image" : "text",
    quality: quality(record.quality ?? record.quality_score),
  };
}

/** The list wherever the answer keeps it: Meta's `data`, the hub's `templates`, or the answer itself. */
function templateList(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const record = asRecord(body);
  if (Array.isArray(record.templates)) return record.templates;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

async function pagedTemplates(firstUrl: string, token: string): Promise<{ ok: true; templates: ProviderTemplate[] } | { ok: false; problem: string }> {
  const origin = new URL(firstUrl).origin;
  const templates: ProviderTemplate[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < 20; page += 1) {
    const answer = await getJson(url, token);
    if (!answer.ok) return { ok: false, problem: answer.problem };
    for (const raw of templateList(answer.body)) {
      const template = readTemplate(raw);
      if (template) templates.push(template);
    }
    const next = asRecord(asRecord(answer.body).paging).next;
    // The key goes with every page: never to a host it was not meant for.
    url = typeof next === "string" && URL.canParse(next) && new URL(next).origin === origin ? next : null;
  }
  return { ok: true, templates };
}

function connectionFrom(body: unknown): ProviderConnection {
  const record = asRecord(body);
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
        ? "Meta sends from a different number than the school's (+91 83022 07823)."
        : "Meta did not say which number it sends from.",
  };
}

const PROVIDER_STATUSES = new Set(["accepted", "sent", "delivered", "read", "failed", "blocked"]);

/** The hub's `GET /v1/status/{wamid}` answer. */
export function readHubStatus(body: unknown, wamid: string): ProviderStatus | null {
  const record = asRecord(body);
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
  if (!PROVIDER_STATUSES.has(status)) return null;
  const code = record.error_code;
  const at = typeof record.status_at === "string" || typeof record.status_at === "number" ? record.status_at : null;
  const iso = (() => {
    if (at === null) return null;
    const asNumber = Number(at);
    const date = Number.isFinite(asNumber) && String(at).trim() !== "" ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber) : new Date(String(at));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  })();
  return {
    wamid: typeof record.wamid === "string" && record.wamid ? record.wamid : wamid,
    status: status as ProviderStatus["status"],
    errorCode: code === null || code === undefined || String(code).trim() === "" ? null : String(code).trim(),
    errorTitle: typeof record.error_title === "string" && record.error_title.trim() ? record.error_title.trim().slice(0, 300) : null,
    at: iso,
  };
}

const TEMPLATE_FIELDS = "name,language,status,category,components,rejected_reason,quality_score";

/** The hub's `POST /v1/typing` answer, read strictly: anything unexpected is not a claim. */
export function readClaim(body: unknown): ClaimResult {
  const record = asRecord(body);
  if (record.ok !== true || typeof record.claimed !== "boolean") {
    return { ok: false, httpStatus: null, problem: "The hub's answer did not say whether One may answer." };
  }
  return {
    ok: true,
    claimed: record.claimed,
    typing: record.typing === true,
    staff: record.staff === true,
    stale: record.stale === true,
    takenBy: typeof record.taken_by === "string" && record.taken_by.trim() ? record.taken_by.trim().slice(0, 60) : null,
  };
}

/**
 * A refusal the hub wrote as `{ ok: false, error: "…" }` or `{ message: "…" }`
 * rather than Meta's `{ error: { message } }`. Without this a template refusal
 * read only "The hub answered 400." (9 Nov).
 */
function plainRefusal(record: Record<string, unknown>): string | null {
  for (const value of [record.error, record.message, record.detail]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return null;
}

function hubProvider(config: Extract<WhatsAppConfig, { ok: true; provider: "hub" }>): WhatsAppProvider {
  const base = `${config.hubUrl}/v1`;
  return {
    name: "hub",
    send: (body) => postJson(`${base}/messages`, config.hubKey, body, { hub: true }),
    listTemplates: () => pagedTemplates(`${base}/templates`, config.hubKey),
    // The hub owns the school's number and no other (its API doc), and has no
    // health route: a template list read with One's key is the connection.
    checkConnection: async () => {
      const answer = await getJson(`${base}/templates`, config.hubKey);
      return answer.ok
        ? { ok: true, displayNumber: SCHOOL_WHATSAPP_NUMBER, verifiedName: "Veer Patta School", quality: null, limitTier: null, problem: null }
        : {
            ok: false,
            displayNumber: null,
            verifiedName: null,
            quality: null,
            limitTier: null,
            problem: answer.httpStatus === 401 ? "The school's WhatsApp hub refused One's key (WHATSAPP_HUB_KEY)." : answer.problem,
          };
    },
    fetchStatus: async (wamid) => {
      const answer = await getJson(`${base}/status/${encodeURIComponent(wamid)}`, config.hubKey);
      if (!answer.ok) return { ok: false, notFound: answer.httpStatus === 404, problem: answer.problem };
      const status = readHubStatus(answer.body, wamid);
      return status ? { ok: true, status } : { ok: false, notFound: false, problem: "The hub's answer had no status." };
    },
    submitTemplate: async (template) => {
      let response: Response;
      try {
        response = await fetch(`${base}/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.hubKey}` },
          body: JSON.stringify(template),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (caught) {
        return { ok: false, code: "network", problem: caught instanceof Error ? caught.message : "No answer from the hub." };
      }
      const parsed = parseText(await response.text().catch(() => ""));
      const record = asRecord(parsed);
      if (response.ok && record.ok !== false) {
        return {
          ok: true,
          id: typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : null,
          status: typeof record.status === "string" ? record.status.toUpperCase() : null,
          category: typeof record.category === "string" ? record.category.toLowerCase() : null,
        };
      }
      return {
        ok: false,
        code: refusalCode(parsed, response.status),
        problem: graphError(parsed).title ?? plainRefusal(record) ?? `The hub answered ${response.status}.`,
      };
    },
    claimMessage: async (wamid) => {
      let response: Response;
      try {
        response = await fetch(`${base}/typing`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.hubKey}` },
          body: JSON.stringify({ message_id: wamid }),
          signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (caught) {
        return { ok: false, httpStatus: null, problem: caught instanceof Error ? caught.message : "No answer from the hub." };
      }
      const parsed = parseText(await response.text().catch(() => ""));
      // A hub without `/v1/typing` (not yet updated) answers 404: not a claim, so One stays quiet.
      if (!response.ok) {
        return { ok: false, httpStatus: response.status, problem: plainRefusal(asRecord(parsed)) ?? `The hub answered ${response.status}.` };
      }
      return readClaim(parsed);
    },
  };
}

export function providerFor(config: Extract<WhatsAppConfig, { ok: true }>): WhatsAppProvider {
  if (config.provider === "hub") return hubProvider(config);
  if (config.provider === "meta_cloud") {
    const base = `https://graph.facebook.com/${config.graphVersion}`;
    return {
      name: "meta_cloud",
      send: (body) => postJson(`${base}/${config.phoneNumberId}/messages`, config.accessToken, body, { hub: false }),
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
