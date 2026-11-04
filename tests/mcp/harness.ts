import { approveRequest } from "@/modules/mcp/domain/consent";
import { randomToken, s256 } from "@/modules/mcp/domain/crypto";
import type { McpDeps } from "@/modules/mcp/domain/mcp";
import { handleRegister, handleToken, validateAuthorizeRequest, type OAuthDeps } from "@/modules/mcp/domain/oauth";
import { canonicalOrigin, endpointsFor, type DeploymentEnv } from "@/modules/mcp/domain/origin";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import type { McpActor, ToolRuntime } from "@/modules/mcp/domain/tools";

import { createFakeStore, type FakeStore } from "./fake-store";

/** Production: issuer and resource are the verified school origin, loopback refused. */
export const PROD_ENV: DeploymentEnv = { VERCEL_ENV: "production" };
/** A local `next dev` / Preview: confined — every account a test account, loopback accepted. */
export const CONFINED_ENV: DeploymentEnv = { VERCEL_ENV: "preview", VERCEL_URL: "vppsone-git-x.vercel.app" };

export const ORIGIN = "https://one.vpps.co.in";
export const MCP_URL = `${ORIGIN}/api/mcp`;
export const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";

export const ADMIN: McpActor = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  displayName: "Test Admin",
  shortName: "TA",
  role: "admin",
  isActive: true,
  isTestAccount: false,
  confined: false,
  permissions: null,
};

export const TEACHER: McpActor = {
  ...ADMIN,
  id: "22222222-2222-4222-8222-222222222222",
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  displayName: "Test Teacher",
  role: "teacher",
};

/**
 * The screens' readers, faked — and handed fields no tool may pass on: a
 * reason, a note, phone numbers, a fee figure, a pupil's name. The projection
 * tests prove none of them leaves.
 */
export function fakeRuntime(calls: string[] = []): ToolRuntime {
  const leak = { reason: "Hospital visit", note: "Private note", phone: "9999999999", whatsappPhone: "9999999998", feeDue: 12500, studentName: "Pupil Name", email: "x@y.z" };
  return {
    today: () => "2026-11-03",
    async schoolDay(actor, sessionLabel, day) {
      calls.push(`schoolDay:${actor.id}:${sessionLabel}:${day}`);
      return {
        schoolOpen: true,
        timetableRuns: true,
        rows: [
          { label: "Class 6 A", recorded: true, roll: 30, present: 27, absent: 2, halfDay: 1, ...leak, teacherName: "A Teacher" },
          { label: "Class 7 B", recorded: false, roll: 28, present: 0, absent: 0, halfDay: 0, ...leak },
        ],
        staffAway: 2,
        uncovered: [{ period: 2, classLabels: ["Class 7 B"], ...leak }],
        unavailable: [],
        ...leak,
      } as never;
    },
    async absences(actor, sessionLabel, day) {
      calls.push(`absences:${actor.id}:${sessionLabel}:${day}`);
      return {
        periodCount: 8,
        absences: [
          { staffName: "Away Whole", periods: [], ...leak },
          { staffName: "Away Part", periods: [0, 1, 2], ...leak },
          { staffName: "Away All", periods: [0, 1, 2, 3, 4, 5, 6, 7], ...leak },
        ],
      } as never;
    },
    async cover(actor, sessionLabel, day) {
      calls.push(`cover:${actor.id}:${sessionLabel}:${day}`);
      return {
        duties: [
          { period: 0, classLabels: ["Class 6 A"], absentNames: ["Away Whole"], substituteName: "Sub One", status: "assigned", ...leak },
          { period: 3, classLabels: ["Class 7 B", "Class 7 C"], absentNames: ["Away Part"], substituteName: null, status: "needs_help", ...leak },
        ],
      } as never;
    },
    async pendingLeave(actor, sessionLabel) {
      calls.push(`leave:${actor.id}:${sessionLabel}`);
      return [{ staffName: "Asks Leave", fromDay: "2026-11-05", toDay: "2026-11-06", span: "full", ...leak }] as never;
    },
  };
}

export type Harness = {
  store: FakeStore;
  env: DeploymentEnv;
  staff: Map<string, McpActor>;
  runtimeCalls: string[];
  mcp: McpDeps;
  oauth: OAuthDeps;
};

export function setup(options: { env?: DeploymentEnv; actors?: McpActor[]; session?: (actor: McpActor) => string | null } = {}): Harness {
  const env = options.env ?? PROD_ENV;
  const store = createFakeStore();
  const staff = new Map<string, McpActor>();
  const confined = isConfinedDeployment(env);
  for (const actor of options.actors ?? [ADMIN, TEACHER]) {
    // As `testAccountFlags`: a confined deployment makes every account a test account.
    const seen = { ...actor, isTestAccount: actor.isTestAccount === true || confined, confined };
    staff.set(actor.userId, seen);
    store.staffUsers.set(actor.id, { authUserId: actor.userId, isActive: actor.isActive });
  }
  const runtimeCalls: string[] = [];
  const session = options.session ?? ((actor: McpActor) => (actor.isTestAccount ? "TEST-2026-27" : "2026-27"));
  return {
    store,
    env,
    staff,
    runtimeCalls,
    oauth: { store, env, now: () => store.now, resolveStaff: async (userId) => staff.get(userId) ?? null },
    mcp: {
      store,
      env,
      now: () => store.now,
      resolveStaff: async (userId) => staff.get(userId) ?? null,
      sessionFor: async (actor) => session(actor),
      runtime: fakeRuntime(runtimeCalls),
    },
  };
}

export function originFor(env: DeploymentEnv): string {
  return env === PROD_ENV ? ORIGIN : `https://${env.VERCEL_URL}`;
}

let source = 0;

/** A registration request from `ip` (Vercel's `x-real-ip`); a fresh documentation-range address unless pinned. */
export function registerRequest(h: Harness, redirectUris: string[] = [CLAUDE_REDIRECT], ip: string | null = `198.51.100.${(source = (source % 250) + 1)}`): Request {
  return new Request(`${originFor(h.env)}/api/mcp/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ip ? { "x-real-ip": ip } : {}) },
    body: JSON.stringify({ client_name: "Claude", redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }),
  });
}

export async function register(h: Harness, redirectUris: string[] = [CLAUDE_REDIRECT], ip?: string | null): Promise<string> {
  const response = await handleRegister(ip === undefined ? registerRequest(h, redirectUris) : registerRequest(h, redirectUris, ip), h.oauth);
  if (response.status !== 201) throw new Error(`registration failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

export function authorizeQuery(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams({ response_type: "code", code_challenge_method: "S256", ...params });
}

/** The consent page and Approve, without the page: validate, then `approveRequest`. */
export async function consent(
  h: Harness,
  actor: McpActor,
  clientId: string,
  options: { redirectUri?: string; state?: string; verifier?: string } = {},
): Promise<{ code: string; verifier: string; redirect: URL }> {
  const origin = canonicalOrigin(`${originFor(h.env)}/mcp/authorize`, h.env)!;
  const endpoints = endpointsFor(origin);
  const verifier = options.verifier ?? randomToken(48);
  const query = authorizeQuery({
    client_id: clientId,
    redirect_uri: options.redirectUri ?? CLAUDE_REDIRECT,
    code_challenge: await s256(verifier),
    state: options.state ?? "state-xyz",
    resource: endpoints.resource,
    scope: "one.read offline_access",
  });
  const decision = validateAuthorizeRequest(query, await h.store.getClient(clientId), { resource: endpoints.resource, allowLoopback: isConfinedDeployment(h.env) });
  if (decision.kind !== "ok") throw new Error(`authorize refused: ${JSON.stringify(decision)}`);
  const url = await approveRequest(h.store, { staffProfileId: actor.id, authUserId: actor.userId }, decision.request, endpoints.issuer);
  if (!url) throw new Error("grant refused");
  const redirect = new URL(url);
  return { code: redirect.searchParams.get("code")!, verifier, redirect };
}

export function tokenRequest(h: Harness, params: Record<string, string>): Request {
  return new Request(`${originFor(h.env)}/api/mcp/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

export async function exchange(h: Harness, input: { code: string; verifier: string; clientId: string; redirectUri?: string }): Promise<Response> {
  return handleToken(
    tokenRequest(h, {
      grant_type: "authorization_code",
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      redirect_uri: input.redirectUri ?? CLAUDE_REDIRECT,
      resource: `${originFor(h.env)}/api/mcp`,
    }),
    h.oauth,
  );
}

export type Tokens = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };

/** Register, consent and exchange: a live connection for `actor`. */
export async function connect(h: Harness, actor: McpActor = ADMIN): Promise<Tokens & { clientId: string }> {
  const clientId = await register(h);
  const { code, verifier } = await consent(h, actor, clientId);
  const response = await exchange(h, { code, verifier, clientId });
  if (response.status !== 200) throw new Error(`exchange failed: ${response.status} ${await response.text()}`);
  return { ...((await response.json()) as Tokens), clientId };
}

export function mcpRequest(h: Harness, token: string | null, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${originFor(h.env)}/api/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function toolCall(name: string, args?: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: args === undefined ? { name } : { name, arguments: args } };
}
