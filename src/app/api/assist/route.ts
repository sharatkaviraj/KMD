import { NextResponse, type NextRequest } from "next/server";

import { recordDecision } from "@/modules/assist/data/log";
import { runAssistTask } from "@/modules/assist/data/run";
import { isAssistDecision } from "@/modules/assist/domain/features";
import { isAssistTaskId } from "@/modules/assist/domain/tasks";
import { assertStaff } from "@/platform/auth/current-staff";

export const runtime = "nodejs";
// A photograph or a dozen remarks on Sonnet can take half a minute; the client gives up at 60 s.
export const maxDuration = 90;

/**
 * The one door the AI helper uses (D-324). POST runs a task for the signed-in
 * person; PATCH records what they did with the draft. Every check that
 * matters — permission, the admin's switch, the budget, the daily cap, the
 * input's shape — happens in `runAssistTask`, so no screen can skip one.
 *
 * Nothing here writes school data. A draft is returned to the screen, which
 * puts it in a field the person still edits and saves through that screen's
 * own action, with that action's own checks.
 */
export async function POST(request: NextRequest) {
  let staff;
  try {
    staff = await assertStaff();
  } catch {
    return NextResponse.json({ ok: false, problem: "denied" }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const task = (body as { task?: unknown } | null)?.task;
  if (!isAssistTaskId(task)) return NextResponse.json({ ok: false, problem: "invalid" }, { status: 400 });
  const result = await runAssistTask(staff, task, (body as { input?: unknown }).input);
  return NextResponse.json(result, { status: 200 });
}

export async function PATCH(request: NextRequest) {
  let staff;
  try {
    staff = await assertStaff();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { logId?: unknown; decision?: unknown } | null;
  const logId = typeof body?.logId === "string" && /^[0-9a-f-]{36}$/i.test(body.logId) ? body.logId : null;
  if (!logId || !isAssistDecision(body?.decision)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await recordDecision(logId, staff.id, body.decision);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
