import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { issuedCards, issueReportCardCommand, previewReportCard } from "@/modules/assessments/data/reports-repo";
import { isEmptyCard, type ReportCard } from "@/modules/assessments/domain/report-card";
import { reportRefusals } from "@/modules/assessments/domain/report-refusals";
import type { Pair } from "@/vx/text";

import { graceFor, papersOf, remarksFor, type Exam } from "./data";
import type { CardForPdf } from "./report-card-pdf";

/*
 * One child's report card for a term, as it stands: the issued revision when
 * there is one (frozen, the card the family holds), else today's preview,
 * with the grace beside it and the class teacher's remark. Issuing goes
 * through `issue_report_card` exactly as the assessments screen does.
 */

export type CardState = {
  card: ReportCard;
  issued: boolean;
  revision: number;
  /** The preview is newer than the issued card: marks or grace moved since. */
  schemeReady: boolean;
  grace: Record<string, number>;
  remark: string | null;
};

/** Grace by student, then by subject, for every paper of a term's exams. */
export async function graceByStudent(termExams: Exam[], classId?: string): Promise<Map<string, Record<string, number>>> {
  let papers = await papersOf(termExams.map((e) => e.id));
  if (classId) papers = papers.filter((p) => p.class_id === classId);
  const subjectOf = new Map(papers.map((p) => [p.id, p.subject_code]));
  const rows = await graceFor(papers.map((p) => p.id));
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const code = subjectOf.get(r.paper_id);
    if (!code) continue;
    const mine = out.get(r.student_id) ?? {};
    mine[code] = (mine[code] ?? 0) + Number(r.grace);
    out.set(r.student_id, mine);
  }
  return out;
}

export async function cardState(input: { studentId: string; sessionLabel: string; term: string; grace?: Record<string, number>; remark?: string | null }): Promise<CardState | null> {
  const [revisions, preview] = await Promise.all([issuedCards(input), previewReportCard(input)]);
  const current = revisions.find((r) => r.status === "issued") ?? null;
  const card = current?.card ?? preview?.card;
  if (!card) return null;
  let remark = input.remark;
  if (remark === undefined) remark = (await remarksFor(input.sessionLabel, input.term, [input.studentId])).get(input.studentId) ?? null;
  return {
    card,
    issued: Boolean(current),
    revision: current?.revision ?? 0,
    schemeReady: Boolean(preview?.scheme),
    grace: input.grace ?? {},
    remark,
  };
}

export function toPdf(state: CardState): CardForPdf {
  return { card: state.card, grace: state.grace, remark: state.remark, issued: state.issued };
}

export type IssueResult = { ok: true; kind: "issue" | "reissue" } | { ok: false; reason: string; message: Pair };

/** Issue (or reissue) one child's card from the marks as they stand now. */
export async function issueOne(input: { actorStaffId: string; studentId: string; sessionLabel: string; term: string; reason?: string | null }): Promise<IssueResult> {
  const [preview, revisions] = await Promise.all([previewReportCard(input), issuedCards(input)]);
  if (!preview) return { ok: false, reason: "not_found", message: { en: "No card for this child.", hi: "इस बच्चे का कार्ड नहीं।" } };
  if (!preview.scheme) {
    const m = reportRefusals.no_approved_scheme;
    return { ok: false, reason: "no_approved_scheme", message: { en: m.en, hi: m.hi } };
  }
  if (isEmptyCard(preview.card)) {
    const m = reportRefusals.no_marks;
    return { ok: false, reason: "no_marks", message: { en: m.en, hi: m.hi } };
  }
  const expectedRevision = revisions.find((r) => r.status === "issued")?.revision ?? 0;
  const reason = expectedRevision > 0 ? (input.reason ?? "Reissued after results were finalised") : null;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ studentId: input.studentId, term: input.term, expectedRevision, reason, scheme: preview.scheme.id }))
    .digest("hex");
  try {
    const outcome = await issueReportCardCommand({
      commandId: randomUUID(),
      actorStaffId: input.actorStaffId,
      sessionLabel: input.sessionLabel,
      term: input.term,
      studentId: input.studentId,
      schemeId: preview.scheme.id,
      expectedRevision,
      reason,
      card: preview.card,
      sources: preview.sources,
      payloadHash,
    });
    if (outcome.outcome === "issued") return { ok: true, kind: outcome.kind };
    const m = reportRefusals[outcome.reason] ?? reportRefusals.failed;
    const papers = outcome.papers.length ? ` (${outcome.papers.join(", ")})` : "";
    return { ok: false, reason: outcome.reason, message: { en: `${m.en}${papers}`, hi: `${m.hi}${papers}` } };
  } catch {
    const m = reportRefusals.failed;
    return { ok: false, reason: "failed", message: { en: m.en, hi: m.hi } };
  }
}
