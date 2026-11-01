import { z } from "zod";
import { feesBridgeOrigin } from "./policy";

export class FeesBridgeError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) {
    super(message);
    this.name = "FeesBridgeError";
  }
}

/** Small explicit HTTP contract. Never expose a SQL, RPC name or remote URL parameter. */
export async function bridgeRequest<T>(options: {
  path: string; token: string; key: string; schema: z.ZodType<T>; body?: unknown;
  origin?: string; fetcher?: typeof fetch;
}): Promise<T> {
  const {path,token,key,schema,body} = options;
  if (!/^\/(?:students(?:\/[0-9a-f-]+)?|sessions|classes|quote|payments|commands\/[0-9a-f-]+|receipts\/[0-9a-f-]+)(?:\?[^#]*)?$/i.test(path)) {
    throw new FeesBridgeError("invalid_route", "The Fees connection route is not permitted.");
  }
  const origin = feesBridgeOrigin({FEES_BRIDGE_ORIGIN:options.origin});
  if (!token || !key) throw new FeesBridgeError("not_configured", "The live Fees connection is not configured.");
  let response: Response;
  try {
    response = await (options.fetcher ?? globalThis.fetch)(`${origin}/api/one/v1${path}`, {
      method:body === undefined ? "GET" : "POST",
      headers:{Authorization:`Bearer ${token}`,"X-One-Bridge-Key":key,"Content-Type":"application/json"},
      body:body === undefined ? undefined : JSON.stringify(body),
      cache:"no-store",redirect:"error",signal:AbortSignal.timeout(body === undefined ? 15_000 : 45_000),
    });
  } catch {
    throw new FeesBridgeError("unavailable", "The Fees connection could not confirm the result.", path === "/payments");
  }
  let envelope: unknown;
  try { envelope = await response.json(); } catch {
    throw new FeesBridgeError("invalid_response", "The Fees connection returned an unreadable result.", path === "/payments");
  }
  const parsed = z.object({version:z.literal(1),data:z.unknown().optional(),error:z.object({code:z.string(),message:z.string()}).optional()}).safeParse(envelope);
  if (!parsed.success) throw new FeesBridgeError("invalid_response", "The Fees connection returned an unexpected result.", path === "/payments");
  if (!response.ok || parsed.data.error) {
    throw new FeesBridgeError(parsed.data.error?.code ?? "unavailable", parsed.data.error?.message ?? "The Fees connection is unavailable.", path === "/payments" && (response.status >= 500 || parsed.data.error?.code === "idempotency_conflict"));
  }
  const data = schema.safeParse(parsed.data.data);
  if (!data.success) throw new FeesBridgeError("invalid_response", "The Fees connection returned incomplete information.", path === "/payments");
  return data.data;
}
