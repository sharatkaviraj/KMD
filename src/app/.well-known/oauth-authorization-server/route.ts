import { handleAuthorizationServerMetadata } from "@/modules/mcp/domain/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RFC 8414 metadata for One's own authorization server (plan §5.2 option B). Public by design. */
export function GET(request: Request) {
  return handleAuthorizationServerMetadata(request, { env: process.env });
}
