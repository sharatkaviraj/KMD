import type { NextRequest } from "next/server";

/**
 * The pass from `Authorization: Bearer …`, and only from there: the API takes
 * no pass in the URL, where it would land in request logs and history. Only
 * the browser doors (`/lab/enter`, `/lab/clock`) need one in the URL.
 */
export function passFrom(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? null;
}
