import { handleProtectedResourceMetadata } from "@/modules/mcp/domain/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same document at its RFC 9728 §3.1 path for the resource `/api/mcp` —
 * the one the 401's `resource_metadata` points at.
 */
export function GET(request: Request) {
  return handleProtectedResourceMetadata(request, { env: process.env });
}
