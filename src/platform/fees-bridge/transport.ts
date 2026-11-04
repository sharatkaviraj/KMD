import { z } from "zod";
import { feesBridgeOrigin } from "./policy";

export class FeesBridgeError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) {
    super(message);
    this.name = "FeesBridgeError";
  }
}

const PHOTO_LIMIT = 512 * 1024;
/** Existing correspondence only; no PDF generation or message side effect. */
export async function bridgeDocumentRequest(options:{studentId:string;sendId:string;sessionLabel:string;token:string;key:string;origin?:string;fetcher?:typeof fetch}):Promise<ArrayBuffer> {
  const id=z.uuid().parse(options.studentId),sendId=z.uuid().parse(options.sendId),session=z.string().regex(/^\d{4}-\d{2}$/).parse(options.sessionLabel);
  const origin=feesBridgeOrigin({FEES_BRIDGE_ORIGIN:options.origin});
  if(!options.token||!options.key)throw new FeesBridgeError("not_configured","The live Fees connection is not configured.");
  let response:Response;
  try {response=await (options.fetcher??globalThis.fetch)(`${origin}/api/one/v1/students/${id}/documents/${sendId}?${new URLSearchParams({session})}`,{
    method:"GET",headers:{Authorization:`Bearer ${options.token}`,"X-One-Bridge-Key":options.key,Accept:"application/pdf"},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15_000),
  });}catch{throw new FeesBridgeError("unavailable","The stored document could not be read.");}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new FeesBridgeError(response.status===404?"not_found":response.status===403?"forbidden":response.status===401?"unauthorized":"unavailable","The stored document could not be read.");}
  const limit=2*1024*1024;
  if(response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/pdf"||Number(response.headers.get("content-length")??0)>limit){await response.body?.cancel().catch(()=>{});throw new FeesBridgeError("invalid_response","The stored document is not supported.");}
  const reader=response.body?.getReader();if(!reader)throw new FeesBridgeError("invalid_response","The stored document is empty.");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new FeesBridgeError("invalid_response","The stored document is too large.");chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(String.fromCharCode(...bytes.slice(0,5))!=="%PDF-")throw new FeesBridgeError("invalid_response","The stored document is not a PDF.");
  return bytes.buffer;
}
/** Authenticated image bytes only. The source path and storage credentials never reach One's browser. */
export async function bridgePhotoRequest(options: {
  studentId: string; sessionLabel: string; variant: "thumb" | "full";
  token: string; key: string; origin?: string; fetcher?: typeof fetch;
}): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const studentId = z.uuid().parse(options.studentId);
  const session = z.string().regex(/^\d{4}-\d{2}$/).parse(options.sessionLabel);
  const variant = z.enum(["thumb", "full"]).parse(options.variant);
  const origin = feesBridgeOrigin({ FEES_BRIDGE_ORIGIN: options.origin });
  if (!options.token || !options.key) throw new FeesBridgeError("not_configured", "The live Fees connection is not configured.");
  let response: Response;
  try {
    response = await (options.fetcher ?? globalThis.fetch)(`${origin}/api/one/v1/students/${studentId}/photo?${new URLSearchParams({session, variant})}`, {
      method: "GET", headers: { Authorization: `Bearer ${options.token}`, "X-One-Bridge-Key": options.key, Accept: "image/jpeg,image/png,image/webp" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new FeesBridgeError("unavailable", "The student photograph could not be read."); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new FeesBridgeError(response.status === 404 ? "not_found" : response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : "unavailable", "The student photograph could not be read.");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType) || Number(response.headers.get("content-length") ?? 0) > PHOTO_LIMIT) {
    await response.body?.cancel().catch(() => {});
    throw new FeesBridgeError("invalid_response", "The photograph response is not supported.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FeesBridgeError("invalid_response", "The photograph response is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > PHOTO_LIMIT) throw new FeesBridgeError("invalid_response", "The photograph response is too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const valid = contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : contentType === "image/png" ? [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
    : String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
  if (!valid) throw new FeesBridgeError("invalid_response", "The photograph response is not an image.");
  return {bytes: bytes.buffer, contentType};
}

/** Small explicit HTTP contract. Never expose a SQL, RPC name or remote URL parameter. */
export async function bridgeRequest<T>(options: {
  path: string; token: string; key: string; schema: z.ZodType<T>; body?: unknown;
  origin?: string; fetcher?: typeof fetch;
}): Promise<T> {
  const {path,token,key,schema,body} = options;
  // Every route One may call, and nothing else. Office reads (Fees 20261103170000) and
  // office commands (Fees 20261103190000) were missing here, so they failed before leaving One.
  if (!/^\/(?:students(?:\/[0-9a-f-]+(?:\/workspace)?)?|directory(?:\/lookup)?|sessions|classes|quote|payments|commands\/[0-9a-f-]+|receipts\/[0-9a-f-]+(?:\/detail)?|summary\/today|requests\/pending|receipts\/lookup|receipts|reversals|refunds\/[0-9a-f-]+\/(?:decision|process))(?:\?[^#]*)?$/i.test(path)) {
    throw new FeesBridgeError("invalid_route", "The Fees connection route is not permitted.");
  }
  // A command that moves money or decides a request: a lost or unreadable answer may have committed.
  const command = body !== undefined && /^\/(?:payments|reversals|refunds\/[0-9a-f-]+\/(?:decision|process))$/i.test(path);
  const origin = feesBridgeOrigin({FEES_BRIDGE_ORIGIN:options.origin});
  if (!token || !key) throw new FeesBridgeError("not_configured", "The live Fees connection is not configured.");
  const started = Date.now();
  let status = 0;
  try {
    return await exchange();
  } finally {
    logBridgeTiming(body === undefined ? "GET" : "POST", path, status, Date.now() - started);
  }

  async function exchange(): Promise<T> {
    let response: Response;
    try {
      response = await (options.fetcher ?? globalThis.fetch)(`${origin}/api/one/v1${path}`, {
        method:body === undefined ? "GET" : "POST",
        headers:{Authorization:`Bearer ${token}`,"X-One-Bridge-Key":key,"Content-Type":"application/json"},
        body:body === undefined ? undefined : JSON.stringify(body),
        cache:"no-store",redirect:"error",signal:AbortSignal.timeout(body === undefined ? 15_000 : 45_000),
      });
    } catch {
      throw new FeesBridgeError("unavailable", "The Fees connection could not confirm the result.", command);
    }
    status = response.status;
    let envelope: unknown;
    try { envelope = await response.json(); } catch {
      throw new FeesBridgeError("invalid_response", "The Fees connection returned an unreadable result.", command);
    }
    const parsed = z.object({version:z.literal(1),data:z.unknown().optional(),error:z.object({code:z.string(),message:z.string()}).optional()}).safeParse(envelope);
    if (!parsed.success) throw new FeesBridgeError("invalid_response", "The Fees connection returned an unexpected result.", command);
    if (!response.ok || parsed.data.error) {
      throw new FeesBridgeError(parsed.data.error?.code ?? "unavailable", parsed.data.error?.message ?? "The Fees connection is unavailable.", command && (response.status >= 500 || parsed.data.error?.code === "idempotency_conflict"));
    }
    const data = schema.safeParse(parsed.data.data);
    if (!data.success) throw new FeesBridgeError("invalid_response", "The Fees connection returned incomplete information.", command);
    return data.data;
  }
}

/**
 * One line per Fees call, to find which read a slow screen waits on (S01/S02,
 * P02). The route's shape only: ids become `:id` and the query string — search
 * words, dates — is dropped, so no child's name or number reaches the logs.
 */
export function bridgeTimingLine(method: string, path: string, status: number, ms: number): string {
  const shape = path.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
  return `[fees-bridge] ${method} ${shape} ${status || "no-answer"} ${ms}ms`;
}
function logBridgeTiming(method: string, path: string, status: number, ms: number) {
  if (process.env.NODE_ENV === "test") return;
  console.info(bridgeTimingLine(method, path, status, ms));
}
