import { NextResponse, type NextRequest } from "next/server";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { decideDraft, readyDraftsFor } from "@/modules/assist/data/drafts";
import { assistFeaturesFor } from "@/modules/assist/data/settings";
import type { ReadyDraftView } from "@/modules/assist/domain/drafts";
import { isAssistDecision } from "@/modules/assist/domain/features";
import { assertStaff } from "@/platform/auth/current-staff";
import { childBasics } from "@/vx/screens/teach/students";

export const runtime = "nodejs";

/**
 * What the app has prepared for the signed-in person (D-418): GET lists what
 * is waiting in the session they work in, PATCH records what they did with
 * one. Only kinds whose feature this person is offered come back, so a
 * switched-off feature hides its prepared drafts too.
 */
export async function GET() {
  let staff;
  try {
    staff = await assertStaff();
  } catch {
    return NextResponse.json({ drafts: [] }, { status: 401 });
  }
  try {
    const [features, sessionLabel] = await Promise.all([assistFeaturesFor(staff), resolveSessionLabel()]);
    if (!sessionLabel || !features.length) return NextResponse.json({ drafts: [] });
    const offered = new Set(features);
    const drafts = (await readyDraftsFor(staff.id, sessionLabel)).filter((d) =>
      d.kind === "cover_plan" ? offered.has("cover") : offered.has("summary"),
    );
    const ids = drafts.flatMap((d) => (d.kind === "class_digest" ? [...d.payload.attention, ...d.payload.praise].map((r) => r.studentId).filter((id): id is string => Boolean(id)) : []));
    const children = ids.length ? await childBasics(ids).catch(() => new Map()) : new Map();
    const view: ReadyDraftView[] = drafts.map((d) =>
      d.kind === "class_digest"
        ? { ...d, names: Object.fromEntries([...d.payload.attention, ...d.payload.praise].flatMap((r) => (r.studentId && children.get(r.studentId) ? [[r.ref, String(children.get(r.studentId)?.fullName ?? r.ref)]] : []))) }
        : d,
    );
    return NextResponse.json({ drafts: view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ drafts: [] });
  }
}

export async function PATCH(request: NextRequest) {
  let staff;
  try {
    staff = await assertStaff();
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { id?: unknown; decision?: unknown } | null;
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
  if (!id || !isAssistDecision(body?.decision)) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    return NextResponse.json({ ok: await decideDraft(id, staff.id, body.decision) });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
