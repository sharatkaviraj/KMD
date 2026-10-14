import { notFound } from "next/navigation";

import { clientIp, limitByIp, limitByToken, limitUnknownToken } from "@/modules/collection/data/rate-limit";
import { getSchoolName } from "@/platform/env";
import { schoolToday } from "@/platform/dates";
import { LanguageProvider } from "@/platform/i18n/use-language";
import { lead } from "@/vx/text";
import { ToastProvider } from "@/vx/ui/overlays";
import { assignmentsFor, classesFor, listExams, staffList, trackerFor } from "@/vx/screens/exams/data";
import { paperStatus } from "@/vx/screens/exams/domain/tracker";
import { resolveMarksLink, touchMarksLink } from "@/vx/screens/exams/link-data";
import { PublicMarksSheet, PublicPaperList } from "@/vx/screens/exams/public-sheet";
import { loadSheet } from "@/vx/screens/exams/sheet-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Marks · VPPS One",
  robots: { index: false, follow: false },
};

/**
 * A teacher's marks link: her papers in one exam, and the same marks sheet
 * she would see signed in. No account, no navigation past her own papers.
 * The scope comes from the token's teacher and exam — never from the URL's
 * other parts — and `?paper=` is honoured only for a paper in that scope.
 */
export default async function MarksLinkPage(props: PageProps<"/t/marks/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const ip = await clientIp();
  if (!(await limitByIp(ip)).allowed || !(await limitByToken(token)).allowed) notFound();

  const link = await resolveMarksLink(token);
  if (!link) {
    await limitUnknownToken(ip);
    notFound();
  }
  await touchMarksLink(link.id).catch(() => undefined);
  const lang = link.language;
  const today = schoolToday();

  const [exams, classes, staff, mine] = await Promise.all([
    listExams(link.sessionLabel),
    classesFor(link.sessionLabel),
    staffList(),
    assignmentsFor(link.sessionLabel, link.staffId),
  ]);
  const exam = exams.find((e) => e.id === link.assessmentId);
  if (!exam) notFound();
  const keys = new Set(mine.map((a) => `${a.classId}|${a.subjectId}`));
  const { papers, rows } = await trackerFor({ exam, classes, staff, today, onlyPapers: (r) => keys.has(`${r.class_id}|${r.subject_id}`) });

  const wrap = (children: React.ReactNode) => (
    <LanguageProvider language={lang}>
      <ToastProvider>
        <div className="vxt" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
          {children}
        </div>
        <div id="vx-layer" className="vxt vx-layer" />
      </ToastProvider>
    </LanguageProvider>
  );

  const paperId = typeof sp.paper === "string" ? sp.paper : null;
  const row = paperId ? rows.find((r) => r.id === paperId) : null;
  if (row) {
    const sheet = await loadSheet(row.id, { exams, paper: row });
    if (!sheet) notFound();
    const v = typeof sp.view === "string" ? sp.view : "entry";
    const view = v === "keypad" || v === "check" || v === "submitted" ? v : "entry";
    return wrap(
      <PublicMarksSheet
        ownerId={`marks-link/${link.id}/${link.staffId}`}
        sessionLabel={link.sessionLabel}
        token={token}
        paper={sheet.paper}
        students={sheet.students}
        saved={sheet.saved}
        coordinatorName={sheet.coordinatorName}
        crumb={`${link.staffName} · ${lead(link.examLabel, lang)}`}
        view={sheet.paper.entryStatus === "submitted" && view === "entry" ? "submitted" : view}
      />,
    );
  }

  return wrap(
    <PublicPaperList
      token={token}
      school={getSchoolName()}
      staffName={link.staffName}
      examLabel={link.examLabel}
      papers={papers
        .sort((a, b) => a.classSort - b.classSort || a.subjectCode.localeCompare(b.subjectCode))
        .map((paper) => ({ paperId: paper.paperId, classLabel: paper.classLabel, subjectCode: paper.subjectCode, maxMarks: paper.maxMarks, entered: paper.entered, total: paper.total, status: paperStatus(paper) }))}
    />,
  );
}
