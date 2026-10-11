import { NextResponse, type NextRequest } from "next/server";
import { remindTeachersVx } from "@/app/(app)/attendance/actions";
import { assignCoverVx, decideSubmissionsVx } from "@/app/(app)/inbox/actions";
import { assertPermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { isInboxBeacon, type InboxScope } from "@/vx/screens/admin/inbox-outbox";
import { schoolToday } from "@/vx/format";
export const runtime = "nodejs";

/** Normal sends and departure/reload replay use the same scoped command. */
export async function POST(request: NextRequest) {
  const raw: unknown = await request.json().catch(() => null);
  if (!isInboxBeacon(raw)) return NextResponse.json({ ok: false }, { status: 400 });
  const scope = (raw as { scope?: InboxScope }).scope;
  if (!scope || typeof scope.accountId !== "string" || typeof scope.sessionLabel !== "string" || typeof scope.day !== "string") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const permission = raw.kind === "submissions" ? "collection:manage"
      : raw.kind === "remind" ? "attendance:mark_on_behalf" : "substitutions:manage";
  let actor;
  try { actor = await assertPermission(permission); }
  catch { return NextResponse.json({ ok: false }, { status: 403 }); }
  // Cookies can change while an old tab is held. Never apply that account's
  // saved intent under newly signed-in staff or a different session.
  if (actor.userId !== scope.accountId) return NextResponse.json({ ok: false }, { status: 403 });
  try {
    const sessionLabel = await resolveSessionLabel();
    if (scope.sessionLabel !== sessionLabel || scope.day !== schoolToday()) return NextResponse.json({ ok: false }, { status: 409 });
    const result = raw.kind === "submissions"
        ? await decideSubmissionsVx(raw.submissionIds, raw.accept, raw.commandId)
        : raw.kind === "remind"
          ? await remindTeachersVx(raw.classIds, { day: scope.day, sessionLabel: scope.sessionLabel, commandId: raw.commandId })
          : await assignCoverVx(raw);
    return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 422 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
