import { type NextRequest, NextResponse } from "next/server";

import { fileFinding, listFindings, resolvePass, touchPass } from "@/modules/smoke/data/smoke-repo";
import { findingInput } from "@/modules/smoke/domain/smoke";
import { passFrom } from "@/modules/smoke/data/pass-header";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/lab/findings` — an agent files a bug or an improvement, with its
 * pass as `Authorization: Bearer …`. A repeat of the same problem (same role,
 * screen and title) in the same run raises its count instead of a new row.
 * `GET` lists what this run already holds, so agents can avoid duplicates.
 */
export async function POST(request: NextRequest) {
  if (!smokeLabEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const resolved = await resolvePass(passFrom(request));
  if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = findingInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad_request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  try {
    const filed = await fileFinding(resolved.pass, parsed.data);
    await touchPass(resolved.pass.passId).catch(() => undefined);
    return NextResponse.json(filed, { status: filed.repeat ? 200 : 201 });
  } catch {
    return NextResponse.json({ error: "not_saved" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!smokeLabEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const resolved = await resolvePass(passFrom(request));
  if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 401 });
  const rows = await listFindings(resolved.pass.runId);
  return NextResponse.json({ findings: rows.map((r) => ({ id: r.id, severity: r.severity, kind: r.kind, status: r.status, title: r.title, role: r.role, screen: r.screen, repeats: r.repeats })) });
}
