import { LIMITS } from "@/modules/mcp/domain/constants";

/**
 * Where an authorization code may be sent. Exact strings, compared exactly:
 * no prefix, no normalisation, no wildcard. A redirect URI that is not on
 * this list is refused at registration, and at the consent page a URI that is
 * not one the client registered is shown as an error — never redirected to.
 */

export type Provider = "claude" | "chatgpt" | "local";

export type ProviderRedirect = {
  uri: string;
  provider: Exclude<Provider, "local">;
  /** Where the exact string was confirmed, or what is still to be confirmed. */
  evidence: string;
};

export const PROVIDER_REDIRECTS: readonly ProviderRedirect[] = [
  {
    uri: "https://claude.ai/api/mcp/auth_callback",
    provider: "claude",
    evidence:
      "Confirmed 3 Nov 2026: claude.com/docs/connectors/building/authentication.md — the one callback for claude.ai web, Desktop, mobile and Cowork.",
  },
  {
    uri: "https://claude.com/api/mcp/auth_callback",
    provider: "claude",
    evidence:
      "Not in Anthropic's documentation on 3 Nov 2026 (it names only the claude.ai callback). Kept at the lead's instruction for Claude surfaces served from claude.com; confirm or remove in the M0 provider test.",
  },
  {
    uri: "https://chatgpt.com/connector_platform_oauth_redirect",
    provider: "chatgpt",
    evidence:
      "Confirmed 3 Nov 2026: developers.openai.com/apps-sdk/build/auth — the stable redirect when the authorization server meets RFC 9207 (iss in every response), which this one does. The per-server `https://chatgpt.com/connector/oauth/{callback_id}` form is documented too, but its id is shown only on the server's management page, so it is not accepted by prefix; add the exact URI here after the provider test if ChatGPT uses it.",
  },
];

/**
 * A loopback redirect (RFC 8252 §7.3) — Claude Code and local MCP test
 * clients. `http`, host exactly `localhost` or `127.0.0.1`, any port, no
 * credentials or fragment, and written in its canonical form (so
 * `http://LOCALHOST…` or `http://localhost:80@evil…` are not). Accepted only
 * on a confined deployment (Preview, local): never on production.
 */
export function isLoopbackRedirect(uri: string): boolean {
  if (typeof uri !== "string" || uri.length > LIMITS.redirectUri) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return false;
  if (url.username || url.password || url.hash) return false;
  return url.href === uri;
}

/** The provider for a redirect URI this deployment accepts, or null. */
export function redirectProvider(uri: unknown, options: { allowLoopback: boolean }): Provider | null {
  if (typeof uri !== "string" || uri.length === 0 || uri.length > LIMITS.redirectUri) return null;
  const known = PROVIDER_REDIRECTS.find((entry) => entry.uri === uri);
  if (known) return known.provider;
  if (options.allowLoopback && isLoopbackRedirect(uri)) return "local";
  return null;
}

/** How the consent card names the requester: from the redirect host, never from the client's own name. */
export const PROVIDER_NAMES: Record<Provider, { en: string; hi: string }> = {
  claude: { en: "Claude", hi: "Claude" },
  chatgpt: { en: "ChatGPT", hi: "ChatGPT" },
  local: { en: "a local test client", hi: "इसी कंप्यूटर पर चल रहा टेस्ट क्लाइंट" },
};

/**
 * `redirectUri?code=…&state=…&iss=…` — the parameters appended to what the
 * client registered (RFC 6749 §4.1.2; `iss` per RFC 9207 on every response,
 * success or error, so ChatGPT's stable redirect works and mix-up is caught).
 */
export function authorizationResponseUrl(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
