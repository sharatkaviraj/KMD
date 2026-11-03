import { can, readsEveryClass } from "@/platform/auth/permissions";
import { canAccessSession, isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import {
  DEFAULT_PROTOCOL_VERSION,
  LIMITS,
  MAX_BATCH,
  MAX_RESULT_CHARS,
  RATE_LIMITS,
  RESOURCE_SCOPES,
  SERVER_INFO,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@/modules/mcp/domain/constants";
import { sha256Hex } from "@/modules/mcp/domain/crypto";
import { aiConnectionEligibility } from "@/modules/mcp/domain/eligibility";
import { json, mediaType, methodNotAllowed, NO_STORE, readBody } from "@/modules/mcp/domain/http";
import { canonicalOrigin, endpointsFor, type DeploymentEnv, type Endpoints } from "@/modules/mcp/domain/origin";
import { project } from "@/modules/mcp/domain/projection";
import type { AccessRow, ConnectionRow, McpStore, RevokeReason } from "@/modules/mcp/domain/store";
import {
  findTool,
  ToolArgumentError,
  toolDescriptor,
  TOOLS,
  type McpActor,
  type ToolDefinition,
  type ToolRuntime,
} from "@/modules/mcp/domain/tools";

/**
 * The MCP endpoint: Streamable HTTP, stateless (no `Mcp-Session-Id`), JSON
 * responses only (no SSE), the `initialize`-era protocol versions
 * 2025-03-26, 2025-06-18 and 2025-11-25. One function takes the Web
 * `Request` and returns the Web `Response`; storage, staff resolution, the
 * session and the data readers are injected.
 */

export type McpDeps = {
  store: McpStore;
  env: DeploymentEnv;
  /** Step 4: the staff profile and its permissions for a verified auth user, read now. */
  resolveStaff(authUserId: string): Promise<McpActor | null>;
  /** Step 6: the academic session for this actor, by `pickSessionLabel()` — never from arguments. */
  sessionFor(actor: McpActor): Promise<string | null>;
  runtime: ToolRuntime;
  now?: () => number;
};

/** Provider web origins a browser-borne request may carry. Anything else is refused (DNS rebinding, spec "Security Warning"). */
export const ALLOWED_REQUEST_ORIGINS = ["https://claude.ai", "https://claude.com", "https://chatgpt.com"] as const;

export function allowedRequestOrigin(value: string, ownOrigin: string, env: DeploymentEnv): boolean {
  if (value === ownOrigin || (ALLOWED_REQUEST_ORIGINS as readonly string[]).includes(value)) return true;
  return isConfinedDeployment(env) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(value);
}

type RpcId = string | number;

type RpcMessage = { jsonrpc: "2.0"; id?: RpcId; method?: string; params?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(id: RpcId | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

/* --------------------------------------------------------------- auth */

/** `WWW-Authenticate` for a 401 (RFC 6750 §3, RFC 9728 §5.1). */
export function bearerChallenge(endpoints: Endpoints, error?: { code: string; description: string }): string {
  const parts = [];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/["\\]/g, "")}"`);
  parts.push(`resource_metadata="${endpoints.protectedResourceMetadata}"`, `scope="${RESOURCE_SCOPES.join(" ")}"`);
  return `Bearer ${parts.join(", ")}`;
}

function unauthorized(endpoints: Endpoints, tokenPresented: boolean, description = "The access token is missing, expired or revoked."): Response {
  return new Response(
    JSON.stringify({ error: tokenPresented ? "invalid_token" : "unauthorized", error_description: description }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        ...NO_STORE,
        "WWW-Authenticate": bearerChallenge(endpoints, tokenPresented ? { code: "invalid_token", description } : undefined),
      },
    },
  );
}

/** The bearer token from the header (RFC 6750 §2.1 only: never a query or body parameter). */
export function bearerToken(request: Request): string | null | "malformed" {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header.trim());
  if (!match || match[1].length > LIMITS.token) return "malformed";
  return match[1];
}

/**
 * Steps 1–2: the token by its hash — an access token, unrevoked, unexpired,
 * issued for exactly this MCP URL and scope — and its connection, unrevoked
 * and inside its 90 days. Read from the store on every call.
 */
export function liveAccess(row: AccessRow | null, endpoints: Endpoints, now: number): row is AccessRow {
  if (!row || row.kind !== "access" || row.revokedAt) return false;
  if (!(Date.parse(row.expiresAt) > now)) return false;
  if (row.resource !== endpoints.resource) return false;
  if (!row.scopes.includes("one.read")) return false;
  const connection = row.connection;
  return !connection.revokedAt && Date.parse(connection.expiresAt) > now;
}

/* ------------------------------------------------------------- handler */

/**
 * Fail closed: if the store or a reader throws (the database is down, the
 * permission matrix cannot be read), the answer is 503 — never a guess, and
 * never a cached yes.
 */
export async function handleMcp(request: Request, deps: McpDeps): Promise<Response> {
  try {
    return await handleMcpUnguarded(request, deps);
  } catch {
    return json(rpcError(null, -32603, "VPPS One is unavailable just now. Try again in a minute."), 503, { "Retry-After": "60" });
  }
}

async function handleMcpUnguarded(request: Request, deps: McpDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const origin = canonicalOrigin(request.url, deps.env);
  if (!origin) return json({ error: "invalid_request", error_description: "This host does not serve the AI connection." }, 404);
  const endpoints = endpointsFor(origin);

  const requestOrigin = request.headers.get("origin");
  if (requestOrigin !== null && !allowedRequestOrigin(requestOrigin, origin, deps.env)) {
    return json(rpcError(null, -32600, "Origin not allowed"), 403);
  }

  const now = deps.now?.() ?? Date.now();
  const token = bearerToken(request);
  if (token === null) return unauthorized(endpoints, false, "Sign in to VPPS One to use this connection.");
  if (token === "malformed") return unauthorized(endpoints, true, "Malformed bearer token.");
  const tokenHash = await sha256Hex(token);
  if (!liveAccess(await deps.store.resolveToken(tokenHash), endpoints, now)) return unauthorized(endpoints, true);

  if (mediaType(request) !== "application/json") return json(rpcError(null, -32600, "Content-Type must be application/json"), 415);
  const accept = request.headers.get("accept");
  if (accept !== null && !/application\/json|\*\/\*|application\/\*/i.test(accept)) {
    return json(rpcError(null, -32600, "Accept must include application/json"), 406);
  }

  const text = await readBody(request);
  if (text === null) return json(rpcError(null, -32600, "Request too large"), 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const batch = Array.isArray(body);
  const messages: unknown[] = batch ? (body as unknown[]) : [body];
  if (batch && (messages.length === 0 || messages.length > MAX_BATCH)) {
    return json(rpcError(null, -32600, `A batch holds 1 to ${MAX_BATCH} messages`), 400);
  }

  const initializing = messages.some((message) => isRecord(message) && message.method === "initialize");
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !initializing && !(SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}`), 400);
  }

  const replies: unknown[] = [];
  for (const message of messages) {
    const reply = await handleMessage(message, { deps, endpoints, tokenHash });
    if (reply instanceof Response) return reply;
    if (reply !== null) replies.push(reply);
  }

  if (replies.length === 0) return new Response(null, { status: 202, headers: NO_STORE });
  return json(batch ? replies : replies[0]);
}

type MessageContext = { deps: McpDeps; endpoints: Endpoints; tokenHash: string };

async function handleMessage(message: unknown, context: MessageContext): Promise<unknown | Response | null> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request");
  const rpc = message as RpcMessage;

  if (typeof rpc.method !== "string") {
    // A response to a server request. This server sends none, so it is ignored.
    if ("result" in message || "error" in message) return null;
    return rpcError(null, -32600, "Invalid Request");
  }
  if (!("id" in message)) return null; // a notification: notifications/initialized and the rest are accepted (202)
  const id = rpc.id;
  if (!(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))) return rpcError(null, -32600, "Invalid Request id");

  switch (rpc.method) {
    case "initialize": {
      const params = isRecord(rpc.params) ? rpc.params : {};
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION;
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "VPPS One, Shri Veer Patta Senior Secondary School's own school app. Read-only tools for the signed-in member of staff. Start with get_context. Counts and staff names only; no pupil, fee or contact data.",
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS.map(toolDescriptor) });
    case "tools/call": {
      const params = isRecord(rpc.params) ? rpc.params : {};
      const outcome = await callTool(params.name, params.arguments, context);
      if (outcome.kind === "unauthorized") return unauthorized(context.endpoints, true, outcome.description);
      if (outcome.kind === "rpc_error") return rpcError(id, outcome.code, outcome.message);
      return rpcResult(id, outcome.result);
    }
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

/* ------------------------------------------------------- the pipeline */

type CallOutcome =
  | { kind: "result"; result: { content: { type: "text"; text: string }[]; structuredContent?: unknown; isError: boolean } }
  | { kind: "rpc_error"; code: number; message: string }
  | { kind: "unauthorized"; description: string };

function toolError(message: string): CallOutcome {
  return { kind: "result", result: { content: [{ type: "text", text: message }], isError: true } };
}

/** May this actor call this tool now: its permission (from the matrix, read this call) and its scope rule. */
export function toolAllowed(tool: ToolDefinition, actor: McpActor): "ok" | "permission" | "scope" {
  if (tool.permission !== "active_staff" && !can(actor, tool.permission)) return "permission";
  if (tool.scope === "every_class" && !readsEveryClass(actor)) return "scope";
  return "ok";
}

const REFUSAL_TEXT: Record<string, string> = {
  switched_off: "The school has switched the AI connection off. An admin can turn it on in VPPS One → Settings.",
  no_session: "VPPS One has no academic session open, so there is nothing to read.",
  session_fence: "This account may not read that academic session.",
  test_not_admin: "Only admin accounts may use the TEST session through the AI connection.",
  permission: "Your role in VPPS One does not include this. Ask an admin if you think it should.",
  scope: "This tool reads every class, which your role in VPPS One does not.",
  rate_limited: `You have reached the AI connection's limit (${RATE_LIMITS.perHour} calls an hour, ${RATE_LIMITS.perDay} a day). Try again later.`,
};

/**
 * One tool call, plan §5.3, in order and with nothing carried over from an
 * earlier call: 1 token → 2 connection → 3 kill switch → 4 staff → 5
 * eligibility → 6 TEST rule and session → 7 permission, scope, arguments →
 * 8 rate limit → 9 run and project → 10 one metadata-only log row.
 */
async function callTool(name: unknown, rawArgs: unknown, { deps, endpoints, tokenHash }: MessageContext): Promise<CallOutcome> {
  const started = deps.now?.() ?? Date.now();

  // 1–2. Read again for this call, even inside a batch.
  const row = await deps.store.resolveToken(tokenHash);
  if (!liveAccess(row, endpoints, deps.now?.() ?? Date.now())) return { kind: "unauthorized", description: "The access token is missing, expired or revoked." };
  const connection: ConnectionRow = row.connection;

  const tool = findTool(name);
  const log = async (outcome: string, rows: number | null = null) => {
    try {
      await deps.store.logToolCall({
        staffProfileId: connection.staffProfileId,
        connectionId: connection.id,
        provider: connection.provider,
        tool: tool?.name ?? "unknown",
        outcome,
        rowCount: rows,
        durationMs: Math.max(0, Math.round((deps.now?.() ?? Date.now()) - started)),
      });
    } catch {
      // The log is evidence, not a gate; a failed insert never fails the call.
    }
  };
  const revokeAnd = async (reason: RevokeReason, description: string): Promise<CallOutcome> => {
    await deps.store.revokeConnection(connection.id, reason, null);
    await log(`refused:${reason}`);
    return { kind: "unauthorized", description };
  };
  const refuse = async (reason: string): Promise<CallOutcome> => {
    await log(`refused:${reason}`);
    return toolError(REFUSAL_TEXT[reason] ?? "Refused.");
  };

  if (!tool) {
    await log("refused:unknown_tool");
    return { kind: "rpc_error", code: -32602, message: "Unknown tool" };
  }

  // 3. The kill switch: absent or unreadable is off.
  if (!(await deps.store.killSwitchOn())) return refuse("switched_off");

  // 4. The staff member, read now by the connection's auth user.
  const actor = await deps.resolveStaff(connection.authUserId);
  if (!actor || !actor.isActive) return revokeAnd("inactive", "This VPPS One account is not active. The connection has been ended.");
  if (actor.id !== connection.staffProfileId) return revokeAnd("staff_mismatch", "This connection no longer matches its staff profile. Connect again from VPPS One.");

  // 5–6. Eligibility (admins first, D7) and the TEST rule (D11), one function.
  const eligibility = aiConnectionEligibility(actor);
  if (!eligibility.ok) {
    return revokeAnd(eligibility.reason, "This VPPS One account may not use the AI connection. The connection has been ended.");
  }

  // 6. The session, from the server's own rules. Never from arguments.
  const sessionLabel = await deps.sessionFor(actor);
  if (!sessionLabel) return refuse("no_session");
  if (!canAccessSession(actor, sessionLabel)) return refuse("session_fence");
  if (isTestSessionLabel(sessionLabel) && actor.role !== "admin") return refuse("test_not_admin");

  // 7. The tool's permission and scope rule, then its arguments.
  const allowed = toolAllowed(tool, actor);
  if (allowed !== "ok") return refuse(allowed);
  const parsed = tool.input.safeParse(rawArgs === undefined ? {} : rawArgs);
  if (!parsed.success) {
    await log("refused:invalid_arguments");
    // Field paths only: the values a client sent are never echoed or logged.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "(arguments)"))].slice(0, 5);
    const takes = Object.keys((toolDescriptor(tool).inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
    return toolError(`Invalid arguments (${fields.join(", ")}). This tool takes: ${takes.join(", ") || "no arguments"}.`);
  }

  // 8. Per-staff limits, counted from the log.
  const counts = await deps.store.callCounts(actor.id);
  if (counts.hour >= RATE_LIMITS.perHour || counts.day >= RATE_LIMITS.perDay) return refuse("rate_limited");

  // 9. Run the screen's reader, then keep only the projection.
  const permitted = TOOLS.filter((candidate) => toolAllowed(candidate, actor) === "ok").map((candidate) => candidate.name);
  let output: unknown;
  let rows: number;
  try {
    ({ output, rows } = await tool.run({ actor, sessionLabel, runtime: deps.runtime, permitted }, parsed.data));
  } catch (error) {
    if (error instanceof ToolArgumentError) {
      await log("refused:invalid_arguments");
      return toolError(`Invalid arguments: ${error.message}.`);
    }
    await log("error:read_failed");
    return toolError("VPPS One could not read this just now. Try again in a minute.");
  }
  const projected = project(output, tool.output);
  const text = JSON.stringify(projected);
  if (text.length > MAX_RESULT_CHARS) {
    await log("error:too_large", rows);
    return toolError("The answer is too large to send. Ask for a narrower question.");
  }

  // 10. One row, metadata only.
  await log("ok", rows);
  return { kind: "result", result: { content: [{ type: "text", text }], structuredContent: projected, isError: false } };
}
