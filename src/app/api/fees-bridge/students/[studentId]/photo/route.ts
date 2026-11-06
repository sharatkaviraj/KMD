import { z } from "zod";
import { getBridgeStudentPhoto } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };

/*
 * A photo that arrived is kept by THIS browser for ten minutes (`private`: never
 * a CDN or shared cache; Janmejay approved, 6 Nov 2026). It was `no-store`, so
 * every Students list re-fetched every thumbnail through a function and the
 * bridge on each visit, the late "largest paint" real phones logged at
 * 2.0 to 2.8 s. Ten minutes is short on purpose: office PCs are shared, and a
 * replaced photo shows within that window. Failures stay `no-store`.
 */
const photoHeaders = { ...headers, "Cache-Control": "private, max-age=600" };

/** No optimizer/CDN cache, storage paths, arbitrary upstream URLs or image redirects. */
export async function GET(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const {studentId} = await context.params;
    const params = new URL(request.url).searchParams;
    const photo = await getBridgeStudentPhoto(z.uuid().parse(studentId), z.string().regex(/^\d{4}-\d{2}$/).parse(params.get("session")), z.enum(["thumb", "full"]).parse(params.get("variant") ?? "thumb"));
    return new Response(photo.bytes, { headers: {...photoHeaders, "Content-Type": photo.contentType, "Content-Length": String(photo.bytes.byteLength)} });
  } catch (error) {
    const status = error instanceof z.ZodError ? 404 : error instanceof FeesBridgeError
      ? error.code === "unauthorized" ? 401 : error.code === "forbidden" ? 403 : ["not_found", "not_available"].includes(error.code) ? 404 : 503
      : error instanceof Error && error.message === "Not signed in." ? 401 : 403;
    return new Response(null, {status, headers});
  }
}
