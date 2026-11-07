import { NextResponse } from "next/server";
import { z } from "zod";

import { copyFeesPhotos } from "@/modules/collection/data/fees-photo-copy";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { readFeesBridgeHealth } from "@/platform/fees-bridge/state";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { assertNotPreviewing } from "@/vx/view-as";

export const runtime = "nodejs";
export const maxDuration = 120;

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const input = z.object({ after: z.uuid().nullable().optional() });

/**
 * One batch of "copy the Fees photos into One for teachers" (owner, 7 Nov
 * 2026, D-511), asked for by an admin's "Refresh roster now" until `next` is
 * null. The same guards as the roster refresh: same origin, a real admin, not
 * previewing another account. A batch starts no new Fees page after 30
 * seconds, so one page (40 photos) always fits well inside the time allowed.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return json({ ok: false, code: "forbidden" }, 403);
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin" || staff.isTestAccount === true || !usesCanonicalFees(staff)) return json({ ok: false, code: "forbidden" }, 403);
  try { await assertNotPreviewing(); } catch { return json({ ok: false, code: "previewing" }, 403); }
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ ok: false, code: "bad_request" }, 400);

  const { state } = await readFeesBridgeHealth();
  const session = state?.active_session_label ?? null;
  if (!session || isTestSessionLabel(session)) return json({ ok: true, total: 0, pending: 0, copied: 0, failed: 0, next: null });
  try {
    const result = await copyFeesPhotos(staff, session, { after: parsed.data.after ?? null, budgetMs: 30_000 });
    return json({ ok: true, ...result });
  } catch (failure) {
    const code = failure instanceof FeesBridgeError ? `bridge_${failure.code}` : failure instanceof Error && /^photo_[a-z_]+$/.test(failure.message) ? failure.message : "photo_copy_failed";
    return json({ ok: false, code }, 503);
  }
}
