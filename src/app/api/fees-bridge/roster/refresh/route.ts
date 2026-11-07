import { NextResponse } from "next/server";

import { runFeesBridgeSync } from "@/modules/coexistence/data/sync";
import { refreshRouteCopy } from "@/modules/transport/data/routes";
import { getCurrentStaff } from "@/platform/auth/current-staff";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { rosterRefreshWait } from "@/platform/fees-bridge/roster-refresh";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

export const runtime = "nodejs";
export const maxDuration = 120;

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * An admin's "Refresh roster now": the same copy the nightly job runs, once,
 * on request. Not forced: it fetches the roster only when Fees has changes
 * since the last copy. At most once in ten minutes, from any admin. The
 * transport route names are fetched again with it.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return json({ ok: false, code: "forbidden" }, 403);
  const staff = await getCurrentStaff();
  if (!staff || staff.role !== "admin" || staff.isTestAccount === true || !usesCanonicalFees(staff)) return json({ ok: false, code: "forbidden" }, 403);
  try { await assertNotPreviewing(); } catch { return json({ ok: false, code: "previewing" }, 403); }

  const { data, error } = await createAdminClient().from("fees_bridge_state").select("last_checked_at,last_attempt_at").eq("id", true)
    .maybeSingle<{ last_checked_at: string | null; last_attempt_at: string | null }>();
  if (error) return json({ ok: false, code: "bridge_target_status_failed" }, 503);
  const wait = rosterRefreshWait([data?.last_checked_at, data?.last_attempt_at]);
  if (wait > 0) return json({ ok: false, code: "cooldown", waitMinutes: Math.ceil(wait / 60_000) }, 429);
  try {
    const result = await runFeesBridgeSync();
    // Transport's route names come along (D-550). Best effort: the roster answer stands either way.
    await refreshRouteCopy({ force: true }).catch(() => null);
    return json({ ok: true, changed: !("unchanged" in result) && !("busy" in result), busy: "busy" in result });
  } catch (failure) {
    const code = failure instanceof Error && /^bridge_[a-z0-9_]+$/.test(failure.message) ? failure.message : "bridge_sync_failed";
    return json({ ok: false, code }, 503);
  }
}
