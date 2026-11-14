import "server-only";

import type { ReportCard } from "@/modules/assessments/domain/report-card";
import { cardExamCodes, cardReleased } from "@/modules/whatsapp/domain/helper-facts";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { logWarn } from "@/platform/observability/log";
import { whatsappDb } from "@/platform/whatsapp/store";

import { parentFacingFilename, storeNoticeDocument } from "./document-store";

/**
 * A child's report card a parent asked Veer Patta AI for, as a PDF in the
 * chat (D-613).
 *
 * The PDF is the school's own printed card (`renderReportCardsPdf`, the one
 * Exams → Report cards prints, with the letterhead, photo, effort panel,
 * remark and signatures), made from the card the school ISSUED and nothing
 * else: never a preview, never marks still being entered. It goes on the same
 * private shelf as a receipt, signed for an hour: Meta fetches it once, at
 * send time, and keeps it in the chat.
 *
 * Three checks stand between a request and a file, each made here again from
 * the database rather than taken from the plan:
 *
 *  - the issued card is the revision the plan read (a card reissued since is
 *    not sent under the old one's line);
 *  - every exam on it is among those released for the class when the plan
 *    read them (a Term 1 card reissued after a later exam whose results are
 *    not out would show those marks early);
 *  - the child is a TEST child and the number is the owner's, practising.
 *    A real family's card waits until real families are switched on.
 *
 * Every read is One's own schema; none goes to the Fees roster. Never throws:
 * null is "could not be made", and the parent is told so.
 */

export type ReportCardRequest = {
  studentId: string;
  sessionLabel: string;
  term: string;
  /** The issued revision the plan read. */
  revision: number;
  /** The exams released for the child's class when the plan read them. */
  releasedCodes: readonly string[];
  /** The exam the card is printed under. */
  title: { en: string; hi: string };
  /** The class teacher's name, from the same read, for the signature line. */
  classTeacher: string | null;
  /** The owner's test number standing in for a family (always, while the helper practises). */
  practice: boolean;
};

export type ReportCardDocument = { link: string; filename: string };

type Issued = { revision: number; card: ReportCard };

export type ReportCardDeps = {
  /** The card the school issued for this child and term, the current revision only. */
  readIssued: (input: { studentId: string; sessionLabel: string; term: string }) => Promise<Issued | null>;
  /** The printed card as a PDF, or null. */
  render: (input: { issued: Issued; request: ReportCardRequest }) => Promise<Uint8Array | null>;
  /** On the shelf, signed for an hour, or null. */
  store: (input: { sessionLabel: string; id: string; pdf: Uint8Array }) => Promise<{ signedUrl: string } | null>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readIssued(input: { studentId: string; sessionLabel: string; term: string }): Promise<Issued | null> {
  const { data, error } = await whatsappDb()
    .from("report_card_issues")
    .select("revision, card")
    .eq("session_label", input.sessionLabel)
    .eq("student_id", input.studentId)
    .eq("term", input.term)
    .eq("status", "issued")
    .order("revision", { ascending: false })
    .limit(1)
    .returns<{ revision: number; card: ReportCard }[]>();
  if (error || !data || data.length !== 1) return null;
  const row = data[0];
  // The card must be this child's, of this term and year.
  if (row.card?.studentId?.toLowerCase() !== input.studentId.toLowerCase() || row.card.term !== input.term || row.card.sessionLabel !== input.sessionLabel) return null;
  return { revision: Number(row.revision), card: row.card };
}

/** The exam in-charge who signs the card: a test account in a test year, real staff in the real year. */
async function examCoordinator(sessionLabel: string): Promise<string | null> {
  const { data, error } = await whatsappDb()
    .from("staff_profiles")
    .select("display_name")
    .eq("role", "exam_coordinator")
    .eq("is_active", true)
    .eq("is_test_account", isTestSessionLabel(sessionLabel))
    .order("display_name")
    .limit(1)
    .returns<{ display_name: string }[]>();
  return error ? null : (data?.[0]?.display_name ?? null);
}

/**
 * The card as Exams → Report cards prints it (`exams/report-card/route.ts`):
 * the grace beside the marks, the class teacher's remark, the photo, mother
 * and birth date, and the letterhead. None of the page around the marks may
 * stop a card printing. Imported when a card is asked for, so a parent's
 * other questions never load the PDF renderer.
 */
async function renderCard({ issued, request }: { issued: Issued; request: ReportCardRequest }): Promise<Uint8Array | null> {
  const [{ listExams, remarksFor }, { graceByStudent }, { cardExtras }, { documentLetterhead }] = await Promise.all([
    import("@/vx/screens/exams/data"),
    import("@/vx/screens/exams/cards-data"),
    import("@/vx/screens/exams/card-extras"),
    import("@/modules/certificates/data/issue"),
  ]);
  const { studentId, sessionLabel, term } = request;
  const termExams = (await listExams(sessionLabel)).filter((exam) => exam.term === term && exam.status !== "draft");
  const [grace, remarks, extras, school, coordinator] = await Promise.all([
    graceByStudent(termExams).catch(() => new Map<string, Record<string, number>>()),
    remarksFor(sessionLabel, term, [studentId]).catch(() => new Map<string, string>()),
    cardExtras([studentId]).catch(() => new Map()),
    documentLetterhead().catch(() => null),
    examCoordinator(sessionLabel).catch(() => null),
  ]);
  const { renderReportCardsPdf } = await import("@/vx/screens/exams/report-card-pdf");
  const buffer = await renderReportCardsPdf({
    cards: [
      {
        card: issued.card,
        grace: grace.get(studentId) ?? {},
        remark: remarks.get(studentId) ?? null,
        issued: true,
        ...(extras.get(studentId) ?? {}),
        classTeacher: request.classTeacher,
      },
    ],
    title: request.title,
    school,
    coordinator,
  });
  return new Uint8Array(buffer);
}

/** The real database, renderer and shelf. */
export function liveReportCardDeps(): ReportCardDeps {
  return {
    readIssued,
    render: renderCard,
    store: ({ sessionLabel, id, pdf }) => storeNoticeDocument({ sessionLabel, kind: "report_card", id, pdf }),
  };
}

export async function prepareHelperReportCard(request: ReportCardRequest, deps: ReportCardDeps = liveReportCardDeps()): Promise<ReportCardDocument | null> {
  if (!request.practice || !isTestSessionLabel(request.sessionLabel)) return null;
  if (!UUID.test(request.studentId) || !request.term.trim() || request.term.length > 40) return null;
  try {
    const issued = await deps.readIssued({ studentId: request.studentId, sessionLabel: request.sessionLabel, term: request.term });
    if (!issued || issued.revision !== request.revision) return null;
    if (!cardReleased(cardExamCodes(issued.card), request.releasedCodes)) return null;
    const pdf = await deps.render({ issued, request });
    if (!pdf || pdf.byteLength === 0) return null;
    const stored = await deps.store({ sessionLabel: request.sessionLabel, id: `${request.studentId}-${request.term}`, pdf });
    if (!stored) return null;
    return {
      link: stored.signedUrl,
      filename: parentFacingFilename({ kind: "report_card", studentName: issued.card.studentName ?? "", label: request.title.en }),
    };
  } catch (caught) {
    logWarn("whatsapp.helper.report_card_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}
