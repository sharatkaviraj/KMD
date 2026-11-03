import { type NextRequest, NextResponse } from "next/server";

import { resolvePass, touchPass } from "@/modules/smoke/data/smoke-repo";
import { AGENT_RULES, FINDING_KINDS, ROLE_FOCUS, SCHOOL_DAY, SEVERITIES } from "@/modules/smoke/domain/smoke";
import { passFrom } from "@/modules/smoke/data/pass-header";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/lab/brief` — everything an agent needs to start: who it is, the
 * run, the rules, its part of the school day, and how to sign in, move the
 * clock and file findings. Read-only.
 */
export async function GET(request: NextRequest) {
  if (!smokeLabEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const resolved = await resolvePass(passFrom(request));
  if (!resolved.ok) return NextResponse.json({ error: resolved.reason }, { status: 401 });
  const { pass } = resolved;
  await touchPass(pass.passId).catch(() => undefined);
  const origin = request.nextUrl.origin;
  const mine = pass.run.scenario === "school_day" ? SCHOOL_DAY.filter((s) => s.role === pass.role || s.role === "all") : [];
  return NextResponse.json({
    account: { label: pass.label, role: pass.role, persona: pass.persona, email: pass.email },
    run: { id: pass.runId, title: pass.run.title, scenario: pass.run.scenario, schoolDay: pass.run.schoolDay, clockStart: pass.run.clockStart, expiresAt: pass.run.expiresAt },
    rules: AGENT_RULES,
    focus: ROLE_FOCUS[pass.role],
    yourSteps: mine,
    wholeDay: pass.run.scenario === "school_day" ? SCHOOL_DAY : [],
    how: {
      signIn: `${origin}/lab/enter?pass=<your pass>  (optionally &next=/some/path)`,
      moveClock: `${origin}/lab/clock?pass=<your pass>&at=HH:MM&next=/teach`,
      fileFinding: `POST ${origin}/api/lab/findings with Authorization: Bearer <your pass> and JSON { kind, severity, title, screen, steps, expected, actual, evidence, reporter }`,
      listFindings: `GET ${origin}/api/lab/findings with the same header, to avoid filing what another agent already filed`,
    },
    findingFields: { kind: FINDING_KINDS, severity: SEVERITIES, severityGuide: { P1: "blocks a task or loses/corrupts data or money", P2: "a task works but is wrong, confusing or very slow", P3: "polish, wording, layout" } },
  });
}
