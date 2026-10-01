import { getCurrentStaff } from "@/platform/auth/current-staff";
import { parsePerformanceEvents } from "@/platform/performance/policy";

export const runtime = "nodejs";
const buckets = new Map<string, { since: number; requests: number }>();

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const staff = await getCurrentStaff();
  if (!staff) return new Response(null, { status: 401 });
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now - bucket.since > 60000) buckets.delete(key);
  const bucket = buckets.get(staff.id) ?? { since: now, requests: 0 };
  if (bucket.requests >= 5 || buckets.size > 1000) return new Response(null, { status: 429 });
  bucket.requests++; buckets.set(staff.id, bucket);
  // Enforce actual bytes as well as Content-Length, without logging the body.
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    length += next.value.byteLength;
    if (length > 16384) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(next.value);
  }
  let events;
  try { events = parsePerformanceEvents(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { return new Response(null, { status: 400 }); }
  if (!events) return new Response(null, { status: 400 });
  console.info(JSON.stringify({ kind: "vppsone.performance", role: staff.role, events }));
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
