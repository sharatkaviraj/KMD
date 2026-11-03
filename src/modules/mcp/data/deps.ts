import "server-only";

import type { McpDeps } from "@/modules/mcp/domain/mcp";
import type { OAuthDeps } from "@/modules/mcp/domain/oauth";
import { toolRuntime, sessionForActor } from "@/modules/mcp/data/runtime";
import { resolveStaffForUser } from "@/modules/mcp/data/staff";
import { createSupabaseMcpStore } from "@/modules/mcp/data/store";

/**
 * Everything the portable core needs, built for this request: One's Postgres
 * store, the staff resolver, the session rule and the screens' readers. The
 * route files under `src/app/` pass a request and this to a core handler and
 * do nothing else.
 */
export function oauthDeps(): OAuthDeps {
  return { store: createSupabaseMcpStore(), env: process.env };
}

export function mcpDeps(): McpDeps {
  return {
    store: createSupabaseMcpStore(),
    env: process.env,
    resolveStaff: resolveStaffForUser,
    sessionFor: sessionForActor,
    runtime: toolRuntime,
  };
}
