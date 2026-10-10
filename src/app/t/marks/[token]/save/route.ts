import { NextResponse } from "next/server";

import { clientIp, limitByIp, limitByToken, limitUnknownToken } from "@/modules/collection/data/rate-limit";
import { paperById } from "@/vx/screens/exams/data";
import { resolveMarksLink } from "@/vx/screens/exams/link-data";
import { commitMarks, refusal, withdrawMarks } from "@/vx/screens/exams/marks-save";
import type { SaveOutcome, SavePayload } from "@/vx/screens/exams/save-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Saves from a no-login marks link.
 *
 * **There is no session here**, so the token is resolved again on every
 * request and is the only authority: it names one teacher and one exam. The
 * paper must belong to that exam; `save_marks` then checks that the teacher
 * teaches this subject to this class, that the exam is open, that the class
 * is not locked and that nothing moved since the page was drawn — the same
 * checks a signed-in save gets. The rate limiter is charged first.
 */
export async function POST(request: Request, ctx: RouteContext<"/t/marks/[token]/save">) {
  const { token } = await ctx.params;
  const ip = await clientIp();
  const refuse = (reason: string, status = 403) =>
    NextResponse.json({ ok: false, reason, message: refusal(reason) } satisfies SaveOutcome, { status });

  if (!(await limitByIp(ip)).allowed || !(await limitByToken(token)).allowed) return refuse("failed", 429);

  const link = await resolveMarksLink(token);
  if (!link) {
    await limitUnknownToken(ip);
    return refuse("not_permitted", 404);
  }

  let body: { action?: string; payload?: SavePayload; paperId?: string; revision?: number };
  try {
    body = await request.json();
  } catch {
    return refuse("bad_request", 400);
  }

  const paperId = body.action === "withdraw" ? body.paperId : body.payload?.paperId;
  if (typeof paperId !== "string" || !/^[0-9a-f-]{36}$/i.test(paperId)) return refuse("bad_request", 400);
  const paper = await paperById(paperId);
  if (!paper || paper.assessment_id !== link.assessmentId) return refuse("not_permitted");

  if (body.action === "withdraw") {
    const result = await withdrawMarks(link.staffId, paperId, Number(body.revision));
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (body.action !== "save" || !body.payload) return refuse("bad_request", 400);
  // A link enters and sends marks; handing a paper back is the exam office's.
  if (body.payload.kind === "reopen") return refuse("not_permitted");

  const result = await commitMarks(link.staffId, body.payload);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
