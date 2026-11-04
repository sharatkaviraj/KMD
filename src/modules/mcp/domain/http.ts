import { MAX_BODY_BYTES } from "@/modules/mcp/domain/constants";

/** Small Web-standard helpers shared by the OAuth and MCP handlers. */

export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...headers },
  });
}

/** RFC 6749 §5.2 error body, always `no-store`. */
export function oauthError(error: string, description: string, status = 400, headers: Record<string, string> = {}): Response {
  return json({ error, error_description: description }, status, headers);
}

/** An OAuth endpoint whose store failed answers 503, never a partial success. */
export async function failClosed(run: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await run();
  } catch {
    return oauthError("temporarily_unavailable", "VPPS One is unavailable just now. Try again in a minute.", 503, { "Retry-After": "60" });
  }
}

export function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { Allow: allow, ...NO_STORE } });
}

/** The body as text, refused past `MAX_BODY_BYTES` (header or actual size). */
export async function readBody(request: Request, limit = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > limit ? null : text;
}

export function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * Form parameters, each at most once (RFC 6749 §3.1: "parameters MUST NOT be
 * included more than once"). Null when the body is too large, not a form, or
 * repeats a parameter.
 */
export async function readForm(request: Request): Promise<Map<string, string> | null> {
  if (mediaType(request) !== "application/x-www-form-urlencoded") return null;
  const text = await readBody(request);
  if (text === null) return null;
  return singleParams(new URLSearchParams(text));
}

export function singleParams(params: URLSearchParams): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const [key, value] of params) {
    if (out.has(key)) return null;
    out.set(key, value);
  }
  return out;
}
