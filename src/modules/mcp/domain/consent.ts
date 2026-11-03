import { CODE_TTL_SECONDS, GRANT_DAYS, TOKEN_BYTES } from "@/modules/mcp/domain/constants";
import { randomToken, sha256Hex } from "@/modules/mcp/domain/crypto";
import type { AuthorizeRequest } from "@/modules/mcp/domain/oauth";
import { authorizationResponseUrl } from "@/modules/mcp/domain/redirects";
import type { McpStore } from "@/modules/mcp/domain/store";

/**
 * What Approve does once the page and the action have validated the request
 * and the staff member: one store call creates the connection (90 days) and
 * its single-use code (60 seconds), and the browser goes to the registered
 * redirect URI with `code`, `state` and `iss`. Only the code's hash is stored.
 */
export async function approveRequest(
  store: McpStore,
  staff: { staffProfileId: string; authUserId: string },
  request: AuthorizeRequest,
  issuer: string,
): Promise<string | null> {
  const code = randomToken(TOKEN_BYTES);
  const created = await store.createGrant({
    staffProfileId: staff.staffProfileId,
    authUserId: staff.authUserId,
    clientId: request.clientId,
    provider: request.provider,
    scopes: request.scopes,
    codeHash: await sha256Hex(code),
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
    codeTtlSeconds: CODE_TTL_SECONDS,
    grantDays: GRANT_DAYS,
  });
  if (!created.ok) return null;
  return authorizationResponseUrl(request.redirectUri, { code, state: request.state, iss: issuer });
}

/** `error=…` to a validated redirect URI, with `state` and `iss` (RFC 6749 §4.1.2.1, RFC 9207). */
export function authorizationErrorUrl(redirectUri: string, error: string, description: string, state: string | null, issuer: string): string {
  return authorizationResponseUrl(redirectUri, { error, error_description: description, state, iss: issuer });
}
