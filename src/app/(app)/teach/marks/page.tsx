import { notFound } from "next/navigation";

import { byClassLabel } from "@/modules/academics/domain/class-order";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolToday } from "@/platform/dates";
import { shortDay } from "@/vx/format";
import { lead, p } from "@/vx/text";
import { EmptyState } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import {
  assignmentsFor,
  attendanceFor,
  classesFor,
  currentExam,
  enrolmentsFor,
  listExams,
  marksOf,
  openExamsForMarks,
  paperById,
  papersOf,
  remarksFor,
  staffList,
  studentsByIds,
  termStanding,
  trackerFor,
} from "@/vx/screens/exams/data";
import { onRoll, paperStatus } from "@/vx/screens/exams/domain/tracker";
import { suggestRemarks } from "@/vx/screens/exams/domain/messages";
import { subjectPair } from "@/vx/screens/exams/domain/groups";
import { classTeacherOf, isManager, mayEnterPaper } from "@/vx/screens/exams/guards";
import { MarksSheet, type SheetPhase } from "@/vx/screens/exams/marks-sheet";
import { daysLeft, loadSheet } from "@/vx/screens/exams/sheet-data";
import { TeacherPick, TeacherRemarks, type PickCard, type RemarkChild, type RemarksCard } from "@/vx/screens/exams/teacher-marks";

import { orderPapersToFill, tellApart } from "@/vx/screens/teach/domain/teach";
import { LangSeg } from "@/vx/screens/teach/ui/shared";

import { saveRemarkAction, saveTeacherMarksAction, withdrawTeacherMarksAction } from "./actions";

export const runtime = "nodejs";

const VIEWS = ["pick", "entry", "keypad", "check", "submitted", "remarks"] as const;
type View = (typeof VIEWS)[number];

/**
 * A teacher's marks (TchMarks): pick a class-subject, type marks in a list or
 * on a number pad, check, send, undo for ten minutes — and, for a class
 * teacher, the remarks on her class's report cards. Only her own papers and
 * her own class ever reach this page.
 */
export default async function TeachMarksPage(props: PageProps<"/teach/marks">) {
  await requirePermission("marks:write");
  const { staff } = await getViewer();
  const lang = staff.language;
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view: View = (VIEWS as readonly string[]).includes(one("view") ?? "") ? (one("view") as View) : one("paper") ? "entry" : "pick";

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(p("Marks", "अंक"), lang)} />
        <main><Section><EmptyState icon="calendar" title={lead(p("No session is set up yet", "अभी कोई सत्र नहीं है"), lang)} /></Section></main>
      </VxPage>
    );
  }
  const today = schoolToday();
  const exams = await listExams(sessionLabel);
  const exam = currentExam(exams, today, one("exam"));
  const crumb = `${lead(p("Marks", "अंक"), lang)} · ${exam ? lead({ en: exam.labelEn, hi: exam.labelHi }, lang) : ""} ${sessionLabel}`;

  /* ---------------------------------------------------------- a sheet */
  const paperId = one("paper");
  if (paperId && view !== "remarks") {
    if (!/^[0-9a-f-]{36}$/i.test(paperId)) notFound();
    const paper = await paperById(paperId);
    if (!paper || !(await mayEnterPaper(staff, paper, sessionLabel))) notFound();
    // The sheet, her papers and the exam's papers are read side by side, not
    // one after another: the sent view took 7.7 s to open (smoke 20 Oct).
    const [sheet, mine, examPapers] = await Promise.all([
      loadSheet(paper.id, { exams, paper }),
      myPaperIds(staff.id, sessionLabel, paper.assessment_id, isManager(staff)),
      papersOf([paper.assessment_id]),
    ]);
    if (!sheet) notFound();
    // The heading names the paper's own exam, not whichever exam is current (B05).
    const own = exams.find((e) => e.id === paper.assessment_id) ?? null;
    const sheetCrumb = `${lead(p("Marks", "अंक"), lang)} · ${own ? lead({ en: own.labelEn, hi: own.labelHi }, lang) : ""} ${sessionLabel}`;

    // The next paper of hers in the same exam that is not yet sent.
    const rows = examPapers.filter((r) => mine.has(`${r.class_id}|${r.subject_id}`) && r.id !== paper.id && r.entry_status === "open");
    const next = rows.sort((a, b) => byClassLabel(a.class_label, b.class_label))[0] ?? null;

    const phase: SheetPhase = view === "check" ? "check" : view === "submitted" ? "sent" : "entry";
    return (
      <MarksSheet
        key={`${staff.id}/${sessionLabel}/${sheet.paper.id}`}
        ownerId={staff.id}
        sessionLabel={sessionLabel}
        paper={sheet.paper}
        students={sheet.students}
        saved={sheet.saved}
        coordinatorName={sheet.coordinatorName}
        onSave={saveTeacherMarksAction}
        onWithdraw={withdrawTeacherMarksAction}
        canCorrect={isManager(staff)}
        canReopen={isManager(staff)}
        viewerStaffId={staff.id}
        initialPhase={phase}
        initialMode={view === "keypad" ? "pad" : "list"}
        crumb={sheetCrumb}
        backHref="/teach/marks"
        nextHref={next ? `/teach/marks?paper=${next.id}` : null}
        nextLabel={next ? `${next.class_label} ${next.subject_code}` : null}
        doneHref="/teach/marks"
        noteHref="/teach/notes?student="
        langSwitch={<LangSeg pill />}
      />
    );
  }

  /* ---------------------------------------------------------- remarks */
  const myClasses = await classTeacherOf(staff.id, sessionLabel);
  const classes = await classesFor(sessionLabel);
  if (view === "remarks") {
    const classId = one("class") && myClasses.includes(one("class")!) ? one("class")! : myClasses[0];
    const klass = classes.find((c) => c.id === classId);
    if (!klass || !exam) {
      return (
        <VxPage>
          <TopBar crumb={crumb} title={lead(p("Report card remarks", "प्रगति पत्र टिप्पणी"), lang)} mBack="/teach/marks" />
          <main><Section><EmptyState icon="users" title={lead(p("You are not a class teacher this session", "आप इस सत्र किसी कक्षा के कक्षा अध्यापक नहीं हैं"), lang)} /></Section></main>
        </VxPage>
      );
    }
    const term = exam.term;
    const termExams = exams.filter((e) => e.term === term && e.status !== "draft");
    const [roll, termPapers, attendance] = await Promise.all([
      enrolmentsFor(sessionLabel, [klass.id]),
      papersOf(termExams.map((e) => e.id)),
      attendanceFor(klass.id, sessionLabel).catch(() => new Map<string, number>()),
    ]);
    const kids = roll.filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
    const classPapers = termPapers.filter((r) => r.class_id === klass.id);
    const [marks, names, remarks] = await Promise.all([
      marksOf(classPapers.map((r) => r.id)),
      studentsByIds(kids.map((k) => k.studentId)),
      remarksFor(sessionLabel, term, kids.map((k) => k.studentId)),
    ]);
    // Same-named children are told apart by SR number and father, on the chips too.
    const apart = tellApart(kids.map((k) => ({ id: k.studentId, name: names.get(k.studentId)?.name ?? "—", admissionNo: names.get(k.studentId)?.admissionNo ?? null, fatherName: names.get(k.studentId)?.fatherName ?? null })));
    const children: RemarkChild[] = kids
      .map((k) => {
        const standing = termStanding(classPapers, marks, k.studentId);
        const att = attendance.get(k.studentId) ?? null;
        const sr = names.get(k.studentId)?.admissionNo ?? null;
        return {
          id: k.studentId,
          name: names.get(k.studentId)?.name ?? "—",
          roll: k.roll ?? null,
          hint: apart.get(k.studentId) ?? null,
          tag: apart.has(k.studentId) && sr ? `SR ${sr}` : null,
          remark: remarks.get(k.studentId) ?? null,
          percent: standing.percent,
          attendance: att,
          suggestions: suggestRemarks({ percent: standing.percent, attendancePct: att, strongest: standing.strongest, weakest: standing.weakest }),
          // For the AI remark (D-324): the subject as a parent reads it, never a name.
          strongest: standing.strongest ? subjectPair(standing.strongest).en : null,
          weakest: standing.weakest && standing.weakest !== standing.strongest ? subjectPair(standing.weakest).en : null,
        };
      })
      .sort((a, b) => Number(a.roll ?? 999) - Number(b.roll ?? 999) || a.name.localeCompare(b.name));
    return (
      <TeacherRemarks
        classLabel={klass.label}
        term={term}
        examLabel={{ en: exam.labelEn, hi: exam.labelHi }}
        kids={children}
        save={saveRemarkAction}
        crumb={`${klass.label} · ${lead(p("report cards", "प्रगति पत्र"), lang)} · ${lead({ en: exam.labelEn, hi: exam.labelHi }, lang)}`}
      />
    );
  }

  /* ------------------------------------------------------------- pick */
  // Every open exam with papers, not the last one or two by date: an undated
  // leftover exam sorts last and hid the Half-yearly papers from every
  // teacher (BUG-02, ST-01). Her papers from all of them, overdue first —
  // the exams by the shared rule in exams/domain/current.ts.
  const openExams = openExamsForMarks(exams, today);
  const [staffAll, mine] = await Promise.all([staffList(), myPaperIds(staff.id, sessionLabel, "", false)]);
  const coordinator = staffAll.find((s) => s.role === "exam_coordinator")?.name ?? null;
  const perExam = mine.size
    ? await Promise.all(openExams.map(async (e) => ({ e, papers: (await trackerFor({ exam: e, classes, staff: staffAll, today, onlyPapers: (r) => mine.has(`${r.class_id}|${r.subject_id}`) })).papers })))
    : [];
  const cards: PickCard[] = orderPapersToFill(
    perExam.flatMap(({ e, papers }) =>
      papers.map((paper) => ({
        paperId: paper.paperId,
        examLabel: { en: e.labelEn, hi: e.labelHi },
        classLabel: paper.classLabel,
        subjectCode: paper.subjectCode,
        maxMarks: paper.maxMarks,
        entered: paper.entered,
        total: paper.total,
        invalid: paper.invalid ?? 0,
        status: paperStatus(paper),
        submittedToName: coordinator,
        dueOn: e.plan?.marksDueOn ?? null,
        late: Boolean(e.plan?.marksDueOn && e.plan.marksDueOn < today && paperStatus(paper) !== "done"),
        dueLabel: e.plan?.marksDueOn ? shortDay(e.plan.marksDueOn) : null,
        classSort: paper.classSort,
        examId: e.id,
      })),
    ),
    today,
  );

  const remarksCards: RemarksCard[] = [];
  if (exam && myClasses.length) {
    for (const classId of myClasses) {
      const klass = classes.find((c) => c.id === classId);
      if (!klass) continue;
      const roll = (await enrolmentsFor(sessionLabel, [classId])).filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
      const remarks = await remarksFor(sessionLabel, exam.term, roll.map((r) => r.studentId));
      remarksCards.push({ classId, classLabel: klass.label, done: remarks.size, total: roll.length, examLabel: { en: exam.labelEn, hi: exam.labelHi } });
    }
  }

  // The date that matters is the one on the first paper she still has to fill.
  const firstOpen = cards.find((c) => c.status !== "done") ?? null;
  const dueExam = firstOpen ? (openExams.find((e) => e.id === firstOpen.examId) ?? null) : null;
  const due = dueExam?.plan?.marksDueOn
    ? {
        label: shortDay(dueExam.plan.marksDueOn),
        daysLeft: daysLeft(dueExam.plan.marksDueOn, today),
        results: dueExam.plan.resultsOn ? `${shortDay(dueExam.plan.resultsOn)}${dueExam.plan.ptmAt ? " (PTM)" : ""}` : null,
        // A results day already gone is said in the past (smoke 20 Oct).
        resultsPast: Boolean(dueExam.plan.resultsOn && dueExam.plan.resultsOn < today),
      }
    : null;
  const pickCrumb = `${lead(p("Marks", "अंक"), lang)} · ${dueExam ? `${lead({ en: dueExam.labelEn, hi: dueExam.labelHi }, lang)} ` : ""}${sessionLabel}`;

  // Her no-login links live on More · Marks links, where she can open, share or make them.
  return <TeacherPick cards={cards} remarks={remarksCards} due={due} crumb={pickCrumb} />;
}

/** "classId|subjectId" for each paper the timetable gives this person in an exam's session. */
async function myPaperIds(staffId: string, sessionLabel: string, _examId: string, everything: boolean): Promise<Set<string>> {
  if (everything) {
    const all = await assignmentsFor(sessionLabel);
    return new Set(all.map((a) => `${a.classId}|${a.subjectId}`));
  }
  const mine = await assignmentsFor(sessionLabel, staffId);
  return new Set(mine.map((a) => `${a.classId}|${a.subjectId}`));
}
