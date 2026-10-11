import { NextResponse, type NextRequest } from "next/server";

import { remindTeachersVx } from "@/app/(app)/attendance/actions";
import { assignCoverVx, decideCorrectionVx, decideSubmissionsVx } from "@/app/(app)/inbox/actions";
import { assertPermission } from "@/platform/auth/current-staff";

export const runtime = "nodejs";

/**
 * Needs you holds a decision on the device for a few seconds so Undo can take
 * it back, and sends whatever is still held when the page goes away. A server
 * action fired from `pagehide` is cancelled with the page, so a decision made
 * just before a reload or a closed tab was silently lost. The page sends it
 * here instead with `fetch(…, { keepalive: true })`, which outlives the page.
 *
 * Each branch is the same action the page would have called, with its own
 * permission check; this only changes how the request travels.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { kind: "correction"; correctionId: string; approve: boolean }
    | { kind: "submissions"; submissionIds: string[]; accept: boolean }
    | { kind: "remind"; classIds: string[] }
    | { kind: "cover"; commandId: string; needKey: string; coveringStaffId: string; day: string; dayRevision: number }
    | null;
  if (!body) return NextResponse.json({ ok: false }, { status: 400 });

  const permission = body.kind === "correction" ? "attendance:correct"
    : body.kind === "submissions" ? "collection:manage"
      : body.kind === "remind" ? "attendance:mark_on_behalf"
        : body.kind === "cover" ? "substitutions:manage" : null;
  if (!permission) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await assertPermission(permission);
  } catch {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const result =
    body.kind === "correction"
      ? await decideCorrectionVx(String(body.correctionId), body.approve === true)
      : body.kind === "submissions"
        ? await decideSubmissionsVx(Array.isArray(body.submissionIds) ? body.submissionIds.map(String) : [], body.accept === true)
        : body.kind === "remind"
          ? await remindTeachersVx(Array.isArray(body.classIds) ? body.classIds.map(String) : [])
          : body.kind === "cover"
            ? await assignCoverVx({ commandId: String(body.commandId), needKey: String(body.needKey), coveringStaffId: String(body.coveringStaffId), day: String(body.day), dayRevision: Number(body.dayRevision) })
            : { ok: false };
    return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 422 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 422 });
  }
}
