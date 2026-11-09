import { FEES_AISENSY_NUMBER, SCHOOL_WHATSAPP_NUMBER, toE164 } from "@/platform/whatsapp/numbers";

/**
 * Which WhatsApp server this deployment talks to, read from the environment
 * and nowhere else (D-562, D-566). Pure: the environment comes in, so every
 * branch is tested without one.
 *
 *   WHATSAPP_PROVIDER=hub         the school's WhatsApp hub, which owns
 *                                 +91 83022 07823 and nothing else
 *                                 (WHATSAPP_HUB_KEY; WHATSAPP_HUB_URL
 *                                 defaults to DEFAULT_HUB_URL)
 *   WHATSAPP_PROVIDER=meta_cloud  Meta's Cloud API directly
 *                                 (WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN)
 *   WHATSAPP_PROVIDER=mock        nothing leaves; refused on a live deployment
 *
 * Unset, the provider is inferred from which credentials are present, the hub
 * first. Nothing present: not configured, and nothing is sent.
 *
 * WHATSAPP_SENDER_NUMBER is the deployment stating which number it sends
 * from. Through Meta directly it must be set, to +91 83022 07823. The hub
 * sends from that number only (its API doc, 9 Nov), so there it may be left
 * unset; set, it must still say the school's number. Any other value, and the
 * fees app's AiSensy number above all, refuses every send.
 */

export type WhatsAppProviderName = "hub" | "meta_cloud" | "mock";

export type WhatsAppEnv = { readonly [name: string]: string | undefined };

export type WhatsAppConfig =
  | {
      ok: true;
      provider: "hub";
      hubUrl: string;
      hubKey: string;
      senderNumber: string;
    }
  | {
      ok: true;
      provider: "meta_cloud";
      phoneNumberId: string;
      accessToken: string;
      businessAccountId: string | null;
      graphVersion: string;
      senderNumber: string;
    }
  | { ok: true; provider: "mock"; senderNumber: string }
  | { ok: false; code: WhatsAppConfigProblem; reason: string; provider: WhatsAppProviderName | null };

export type WhatsAppConfigProblem = "not_configured" | "sender_missing" | "sender_wrong" | "fees_number" | "mock_on_live" | "bad_url";

/**
 * The school's WhatsApp hub, when WHATSAPP_HUB_URL is unset (the hub's API
 * doc, 9 Nov 2026). Not a secret; WHATSAPP_HUB_URL overrides it, for example
 * once the hub has its own domain.
 */
export const DEFAULT_HUB_URL = "https://vpps-whatsapp-hub.raj-39e.workers.dev";

/** Meta's Graph API version when WHATSAPP_GRAPH_VERSION is unset. */
export const DEFAULT_GRAPH_VERSION = "v21.0";

function read(env: WhatsAppEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function isLive(env: WhatsAppEnv): boolean {
  return env.VPPSONE_ENV?.trim().toLowerCase() === "live" || env.VERCEL_ENV?.trim() === "production";
}

function problem(code: WhatsAppConfigProblem, reason: string, provider: WhatsAppProviderName | null): WhatsAppConfig {
  return { ok: false, code, reason, provider };
}

export function readWhatsAppConfig(env: WhatsAppEnv = process.env): WhatsAppConfig {
  const declared = read(env, "WHATSAPP_PROVIDER")?.toLowerCase() ?? null;
  const provider: WhatsAppProviderName | null =
    declared === "hub" || declared === "meta_cloud" || declared === "mock"
      ? declared
      : declared
        ? null
        : read(env, "WHATSAPP_HUB_URL") || read(env, "WHATSAPP_HUB_KEY")
          ? "hub"
          : read(env, "WHATSAPP_PHONE_NUMBER_ID")
            ? "meta_cloud"
            : null;

  if (declared && !provider) {
    return problem("not_configured", `WHATSAPP_PROVIDER="${declared}" is not one of hub, meta_cloud or mock.`, null);
  }
  if (!provider) {
    return problem("not_configured", "The school's WhatsApp hub is not connected yet (WHATSAPP_HUB_KEY is not set).", null);
  }

  // The sender is checked before anything else about the provider: a
  // deployment pointed at the wrong number must say so even half set up.
  const declaredSender = read(env, "WHATSAPP_SENDER_NUMBER");
  const sender = declaredSender ? toE164(declaredSender) : null;
  if (sender === FEES_AISENSY_NUMBER) {
    return problem("fees_number", "WHATSAPP_SENDER_NUMBER is the fees app's AiSensy number. One never sends from it.", provider);
  }
  if (provider === "meta_cloud" || (provider === "hub" && declaredSender)) {
    if (!declaredSender) {
      return problem("sender_missing", "WHATSAPP_SENDER_NUMBER is not set. It must be the school's number, +91 83022 07823.", provider);
    }
    if (sender !== SCHOOL_WHATSAPP_NUMBER) {
      return problem("sender_wrong", "WHATSAPP_SENDER_NUMBER is not the school's number (+91 83022 07823). Nothing is sent.", provider);
    }
  }

  if (provider === "mock") {
    if (isLive(env)) {
      return problem("mock_on_live", "WHATSAPP_PROVIDER=mock is refused on a live deployment: it would log messages as sent that nobody received.", provider);
    }
    return { ok: true, provider, senderNumber: SCHOOL_WHATSAPP_NUMBER };
  }

  if (provider === "hub") {
    const hubUrl = read(env, "WHATSAPP_HUB_URL") ?? DEFAULT_HUB_URL;
    const hubKey = read(env, "WHATSAPP_HUB_KEY");
    if (!hubKey) {
      return problem("not_configured", "The school's WhatsApp hub needs WHATSAPP_HUB_KEY.", provider);
    }
    let url: URL;
    try {
      url = new URL(hubUrl);
    } catch {
      return problem("bad_url", "WHATSAPP_HUB_URL is not a web address.", provider);
    }
    // A key sent in the clear is a key anybody on the way can read.
    if (url.protocol !== "https:" && !(url.protocol === "http:" && !isLive(env) && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
      return problem("bad_url", "WHATSAPP_HUB_URL must start with https://.", provider);
    }
    // The base, without a trailing slash or a `/v1` someone pasted with it.
    const base = hubUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
    return { ok: true, provider, hubUrl: base, hubKey, senderNumber: SCHOOL_WHATSAPP_NUMBER };
  }

  const phoneNumberId = read(env, "WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = read(env, "WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId || !accessToken) {
    return problem("not_configured", `Meta's Cloud API needs ${!phoneNumberId ? "WHATSAPP_PHONE_NUMBER_ID" : "WHATSAPP_ACCESS_TOKEN"}.`, provider);
  }
  if (!/^\d{5,20}$/.test(phoneNumberId)) {
    return problem("not_configured", "WHATSAPP_PHONE_NUMBER_ID must be the number's ID from Meta (digits only), not the phone number.", provider);
  }
  const graphVersion = read(env, "WHATSAPP_GRAPH_VERSION") ?? DEFAULT_GRAPH_VERSION;
  return {
    ok: true,
    provider,
    phoneNumberId,
    accessToken,
    businessAccountId: read(env, "WHATSAPP_BUSINESS_ACCOUNT_ID"),
    graphVersion: /^v\d+\.\d+$/.test(graphVersion) ? graphVersion : DEFAULT_GRAPH_VERSION,
    senderNumber: SCHOOL_WHATSAPP_NUMBER,
  };
}

/** Meta's own webhook (`/api/webhooks/whatsapp`), when One talks to Meta directly: signed with the app secret. */
export function webhookSecrets(env: WhatsAppEnv = process.env): string[] {
  return [read(env, "WHATSAPP_APP_SECRET")].filter((value): value is string => Boolean(value));
}

/**
 * The hub's forwarded webhook (`/api/webhooks/whatsapp-hub`): signed with One's
 * own hub key, the same `WHATSAPP_HUB_KEY` One sends with (the hub's API doc).
 */
export function hubWebhookSecrets(env: WhatsAppEnv = process.env): string[] {
  return [read(env, "WHATSAPP_HUB_KEY")].filter((value): value is string => Boolean(value));
}

/** The token Meta echoes when the webhook is first set up. */
export function webhookVerifyToken(env: WhatsAppEnv = process.env): string | null {
  return read(env, "WHATSAPP_VERIFY_TOKEN");
}

/** Every variable this reads, for the setup page and the env-names check. */
export const WHATSAPP_ENV_NAMES = [
  "WHATSAPP_PROVIDER",
  "WHATSAPP_SENDER_NUMBER",
  "WHATSAPP_HUB_URL",
  "WHATSAPP_HUB_KEY",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  "WHATSAPP_GRAPH_VERSION",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
] as const;
