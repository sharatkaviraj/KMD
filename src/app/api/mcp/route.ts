import { handleMcp } from "@/modules/mcp/domain/mcp";
import { mcpDeps } from "@/modules/mcp/data/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The AI connection's MCP endpoint (Streamable HTTP, stateless, JSON). Every
 * request carries a One-issued bearer token, checked by `handleMcp` — which
 * answers its own 401 with a `WWW-Authenticate` challenge — and every tool
 * call runs the full per-call pipeline there (plan §5.3). This file is only
 * the adapter from Next.js to the portable core.
 */
export function POST(request: Request) {
  return handleMcp(request, mcpDeps());
}

/** No server-initiated stream: 405 with `Allow: POST`. */
export function GET(request: Request) {
  return handleMcp(request, mcpDeps());
}

/** No sessions to end: 405. */
export function DELETE(request: Request) {
  return handleMcp(request, mcpDeps());
}
