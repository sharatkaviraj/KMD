import { verifiedOrigin } from "@/platform/config/app-origins";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import {
  AUTHORIZATION_SCOPES,
  AUTHORIZATION_SERVER_PATH,
  AUTHORIZE_PATH,
  MCP_PATH,
  PROTECTED_RESOURCE_PATH,
  REGISTER_PATH,
  RESOURCE_SCOPES,
  REVOKE_PATH,
  TOKEN_PATH,
} from "@/modules/mcp/domain/constants";

export type DeploymentEnv = { readonly [name: string]: string | undefined };

/**
 * The one origin this deployment's issuer and resource are built from.
 *
 * Production (`VERCEL_ENV=production`, `isConfinedDeployment` false) answers
 * with the verified school origin, `https://one.vpps.co.in`, whatever Host the
 * request carried: a forged Host header cannot move the issuer or the
 * resource. A confined deployment (Preview, local) has no fixed name, so it
 * uses the request's own origin — but only when that is one of its own:
 * Vercel's `VERCEL_URL` / `VERCEL_BRANCH_URL` (set by the platform), or
 * `localhost` / `127.0.0.1` on any port. Anything else is null and the
 * caller refuses the request.
 */
export function canonicalOrigin(requestUrl: string | URL, env: DeploymentEnv): string | null {
  if (!isConfinedDeployment(env)) return verifiedOrigin("vppsone").origin;

  let origin: string;
  try {
    origin = new URL(requestUrl).origin;
  } catch {
    return null;
  }
  return confinedOrigins(env).some((allowed) => (typeof allowed === "string" ? allowed === origin : allowed.test(origin)))
    ? origin
    : null;
}

function confinedOrigins(env: DeploymentEnv): (string | RegExp)[] {
  const vercel = [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .map((host) => host?.trim().toLowerCase())
    .filter((host): host is string => Boolean(host) && /^[a-z0-9.-]+$/.test(host!))
    .map((host) => `https://${host}`);
  return [...vercel, /^http:\/\/localhost(:\d{1,5})?$/, /^http:\/\/127\.0\.0\.1(:\d{1,5})?$/];
}

export type Endpoints = {
  issuer: string;
  /** The canonical MCP URL: the OAuth `resource` and the token audience. */
  resource: string;
  protectedResourceMetadata: string;
  authorizationServerMetadata: string;
  authorization: string;
  token: string;
  registration: string;
  revocation: string;
};

export function endpointsFor(origin: string): Endpoints {
  return {
    issuer: origin,
    resource: `${origin}${MCP_PATH}`,
    // RFC 9728 §3.1: the well-known path inserted between host and resource path.
    protectedResourceMetadata: `${origin}${PROTECTED_RESOURCE_PATH}${MCP_PATH}`,
    authorizationServerMetadata: `${origin}${AUTHORIZATION_SERVER_PATH}`,
    authorization: `${origin}${AUTHORIZE_PATH}`,
    token: `${origin}${TOKEN_PATH}`,
    registration: `${origin}${REGISTER_PATH}`,
    revocation: `${origin}${REVOKE_PATH}`,
  };
}

/** RFC 9728 protected-resource metadata for the MCP endpoint. */
export function protectedResourceMetadata(origin: string) {
  const e = endpointsFor(origin);
  return {
    resource: e.resource,
    authorization_servers: [e.issuer],
    scopes_supported: [...RESOURCE_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "VPPS One",
  };
}

/**
 * RFC 8414 authorization-server metadata. Public clients only (`none`), code
 * flow with S256 PKCE only, refresh rotation, RFC 9207 `iss` on every
 * authorization response. No Client ID Metadata Document support is
 * advertised, so Claude and ChatGPT use dynamic registration.
 */
export function authorizationServerMetadata(origin: string) {
  const e = endpointsFor(origin);
  return {
    issuer: e.issuer,
    authorization_endpoint: e.authorization,
    token_endpoint: e.token,
    registration_endpoint: e.registration,
    revocation_endpoint: e.revocation,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...AUTHORIZATION_SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}

/**
 * Does a `resource` a client sent name this MCP server? RFC 8707 and the MCP
 * spec: the canonical form is lowercase scheme and host without a trailing
 * slash, and an uppercase scheme or host should still be accepted. No query,
 * no fragment.
 */
export function isOurResource(value: unknown, canonical: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.search || url.hash || url.username || url.password) return false;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}` === canonical;
}
