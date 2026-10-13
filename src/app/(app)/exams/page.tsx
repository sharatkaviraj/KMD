import { notFound, redirect } from "next/navigation";

import { byClassLabel } from "@/modules/academics/domain/class-order";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { can } from "@/platform/auth/permissions";
import { lead, p } from "@/vx/text";
import { EmptyState } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import {
  activityFor,
  assignmentsFor,
  currentExam,
  graceFor,
  issuedStudents,
  locksFor,
  paperById,
  previousExam,
  studentsByIds,
  type Exam,
} from "@/vx/screens/exams/data";
import { cardState, graceByStudent } from "@/vx/screens/exams/cards-data";
import { childPercent, classAnalysis, type ChildMarks } from "@/vx/screens/exams/domain/analysis";
import { canFinaliseMarks } from "@/vx/screens/exams/domain/finalise";
import { cellCounts, cellState, neighbours } from "@/vx/screens/exams/domain/board";
import { GROUP_KEYS, GROUP_LABELS, groupOf, subjectPair } from "@/vx/screens/exams/domain/groups";
import { splitByStream } from "@/vx/screens/exams/domain/streams";
import { isLate, subjectColumns } from "@/vx/screens/exams/domain/tracker";
import { ExamsBoard, type ExamsProps, type ExamsView } from "@/vx/screens/exams/exams-board";
import { classTeacherOf, isManager } from "@/vx/screens/exams/guards";
import { MarksSheet } from "@/vx/screens/exams/marks-sheet";
import { examProgress, officeContext } from "@/vx/screens/exams/office-data";
import { loadSheet } from "@/vx/screens/exams/sheet-data";
import { dateSpan, dueDay } from "@/vx/screens/exams/when";

import { issueClassCardsAction, lockClassesAction } from "../exam-office/results/actions";
import { marksLinkAction, remindTeachersAction } from "../exam-office/actions";
import { saveTeacherMarksAction, withdrawTeacherMarksAction } from "../teach/marks/actions";
import { createExamAction } from "./actions";

export const runtime = "nodejs";

const VIEWS = ["list", "grid", "cell", "sampark", "entry", "reportcards", "preview", "analysis", "create", "remind"] as const;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Exams & marks (Exams): the session's exams, the class × subject marks
 * tracker, one paper's detail, the per-teacher marks links, entering marks,
 * report cards and their preview, result analysis, a new exam and the
 * reminder to late teachers.
 *
 * Who sees what: the exam office sees and does everything; the office and
 * the academic coordinator read the school's tracker, cards and analysis; a
 * teacher sees only her own papers and her own class, and enters marks on
 * /teach/marks.
 */
export default async function ExamsPage(props: PageProps<"/exams">) {
  await requirePermission("assessments:view");
  const { staff } = await getViewer();
  const lang = staff.language;
  const manage = isManager(staff);
  const reports = can(staff, "reports:view");
  const scoped = !manage && !reports;
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const asked = (VIEWS as readonly string[]).includes(one("view") ?? "") ? (one("view") as ExamsView) : null;
  let view: ExamsView = asked ?? (staff.role === "academic_coordinator" ? "analysis" : "list");
  if (!manage && (view === "sampark" || view === "create" || view === "remind")) view = "grid";
  if (!reports && (view === "reportcards" || view === "preview" || view === "analysis")) view = "grid";

  const ctx = await officeContext();
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={lead(p("Exams & marks", "परीक्षा व अंक"), lang)} />
        <main><Section><EmptyState icon="calendar" title={lead(p("No session is set up yet", "अभी कोई सत्र नहीं है"), lang)} /></Section></main>
      </VxPage>
    );
  }
  const { today, sessionLabel, exams } = ctx;
  const exam = currentExam(exams, today, one("exam"));

  /* ------------------------------------------------- entering marks */
  if (view === "entry") {
    const paperId = one("paper");
    if (!paperId || !UUID.test(paperId)) redirect("/exams?view=grid");
    if (!manage) {
      if (can(staff, "marks:write")) redirect(`/teach/marks?paper=${paperId}`);
      redirect(`/exams?view=cell&paper=${paperId}`);
    }
    const paper = await paperById(paperId);
    if (!paper) notFound();
    const sheet = await loadSheet(paper.id, { exams, paper });
    if (!sheet) notFound();
    const owner = exams.find((e) => e.id === paper.assessment_id);
    const assigned = (await assignmentsFor(sessionLabel)).find((a) => a.classId === paper.class_id && a.subjectId === paper.subject_id);
    const forTeacher = assigned ? (ctx.staff.find((s) => s.id === assigned.staffId)?.name ?? null) : null;
    return (
      <MarksSheet
        variant="office"
        forTeacher={forTeacher}
        key={`${staff.id}/${sessionLabel}/${sheet.paper.id}`}
        ownerId={staff.id}
        sessionLabel={sessionLabel}
        paper={sheet.paper}
        students={sheet.students}
        saved={sheet.saved}
        coordinatorName={sheet.coordinatorName}
        onSave={saveTeacherMarksAction}
        onWithdraw={withdrawTeacherMarksAction}
        canCorrect
        canReopen
        crumb={`${lead(p("Exams", "परीक्षा"), lang)} · ${owner ? lead({ en: owner.labelEn, hi: owner.labelHi }, lang) : ""}`}
        backHref={`/exams?view=cell&paper=${paper.id}`}
        doneHref="/exams?view=grid"
        noteHref={can(staff, "notes:write") ? "/teach/notes?student=" : undefined}
      />
    );
  }

  /* ------------------------------------------------- who sees which papers */
  let mine: Set<string> | null = null; // "classId|subjectId" she teaches
  let myClasses: string[] = [];
  if (scoped) {
    const [assigned, ct] = await Promise.all([assignmentsFor(sessionLabel, staff.id), classTeacherOf(staff.id, sessionLabel)]);
    mine = new Set(assigned.map((a) => `${a.classId}|${a.subjectId}`));
    myClasses = ct;
  }
  const visible = mine ? (r: { class_id: string; subject_id: string }) => mine!.has(`${r.class_id}|${r.subject_id}`) || myClasses.includes(r.class_id) : undefined;

  const progress = exam ? await examProgress(ctx, exam, visible) : null;
  const locks = exam ? await locksFor(exam.id) : new Map<string, { lockedAt: string; lockedBy: string }>();
  const lockedSet = new Set(locks.keys());

  /* ------------------------------------------------- the timeline */
  const timeline: ExamsProps["timeline"] = exams
    .filter((e) => !scoped || e.papers > 0)
    .map((e) => {
      const state: ExamsProps["timeline"][number]["state"] =
        e.id === exam?.id ? "now" : e.plan?.resultsPublishedAt || e.status === "locked" ? "done" : (e.startsOn ?? "9999") > today ? "later" : "past";
      return {
        id: e.id,
        name: { en: e.labelEn, hi: e.labelHi },
        dates: span(e),
        state,
        papers: e.papers,
        sub: e.plan?.resultsPublishedAt
          ? p(`results sent ${dateSpan(e.plan.resultsPublishedAt, null)}`, `परिणाम भेजे ${dateSpan(e.plan.resultsPublishedAt, null)}`)
          : e.papers === 0
            ? p("not set up yet", "अभी तैयार नहीं")
            : p(`${e.papers} papers`, `${e.papers} पेपर`),
      };
    });

  /* ------------------------------------------------- the tracker */
  const counts = progress ? cellCounts(progress.papers, lockedSet, progress.expected) : null;
  const editable = new Set(progress?.rows.filter((r) => manage || (mine?.has(`${r.class_id}|${r.subject_id}`) ?? false)).map((r) => r.id) ?? []);
  const bands: ExamsProps["bands"] = [];
  if (progress) {
    const subjectOrder = new Map<string, number>();
    progress.rows.forEach((r) => subjectOrder.set(r.subject_code, Math.min(subjectOrder.get(r.subject_code) ?? 999, r.sort_order)));
    for (const key of GROUP_KEYS) {
      const inBand = progress.papers.filter((x) => groupOf(x.classLabel) === key);
      if (inBand.length === 0) continue;
      // Classes 11–12 are drawn one stream to a band (design: Science, Commerce, Arts).
      for (const part of key === "c11_12" ? splitByStream(inBand) : [{ stream: null, label: null, items: inBand }]) {
      const papers = part.items;
      const subjects = subjectColumns(papers, subjectOrder);
      const classIds = [...new Set(papers.map((x) => x.classId))];
      const rows = classIds
        .map((classId) => {
          const list = papers.filter((x) => x.classId === classId);
          const total = list.reduce((a, x) => a + x.total, 0);
          const entered = list.reduce((a, x) => a + Math.min(x.entered, x.total), 0);
          const info = ctx.classes.find((c) => c.id === classId);
          return {
            classId,
            label: list[0].classLabel,
            sort: list[0].classSort,
            teacher: info?.classTeacherName ?? null,
            children: progress.roll.get(classId)?.length ?? 0,
            percent: total ? Math.round((entered / total) * 100) : 0,
            cells: Object.fromEntries(
              list.map((x) => [
                x.subjectCode,
                { paperId: x.paperId, state: cellState(x, lockedSet.has(classId)), entered: Math.min(x.entered, x.total), total: x.total, late: isLate(x, progress.expected), teacher: x.teacherName },
              ]),
            ),
          };
        })
        .sort((a, b) => a.sort - b.sort || byClassLabel(a.label, b.label));
      bands.push({ key: part.stream ? `${key}-${part.stream}` : key, label: part.label ?? GROUP_LABELS[key], subjects: subjects.map((s) => ({ code: s, name: subjectPair(s) })), rows });
      }
    }
  }

  /* ------------------------------------------------- one cell */
  let cell: ExamsProps["cell"] = null;
  const cellId = one("paper");
  if (view === "cell" && progress && cellId) {
    const facts = progress.papers.find((x) => x.paperId === cellId);
    const row = progress.rows.find((r) => r.id === cellId);
    if (facts && row) {
      const teacher = progress.teachers.find((t) => t.id === facts.teacherId) ?? null;
      const classPapers = progress.papers.filter((x) => x.classId === facts.classId);
      const history: { text: { en: string; hi?: string }; at: string; tone: string }[] = [];
      if (manage && teacher?.link) history.push({ text: p("Marks link made", "अंक लिंक बना"), at: teacher.link.createdAt, tone: "var(--mut)" });
      if (manage && teacher?.link?.openedAt) history.push({ text: p(`Link opened by ${teacher.name}`, `${teacher.name} ने लिंक खोला`), at: teacher.link.openedAt, tone: "var(--info)" });
      if (manage && teacher?.remindedAt) history.push({ text: p("Reminded on WhatsApp", "WhatsApp पर याद दिलाया"), at: teacher.remindedAt, tone: "var(--warn)" });
      if (row.submitted_at) history.push({ text: p("Marks sent", "अंक भेजे"), at: row.submitted_at, tone: "var(--ok)" });
      if (locks.get(facts.classId)) history.push({ text: p("Class locked", "कक्षा बंद"), at: locks.get(facts.classId)!.lockedAt, tone: "var(--pri)" });
      history.sort((a, b) => b.at.localeCompare(a.at));
      cell = {
        paperId: facts.paperId,
        classId: facts.classId,
        classLabel: facts.classLabel,
        subject: subjectPair(facts.subjectCode),
        teacherId: facts.teacherId,
        teacherName: facts.teacherName,
        phoneMasked: manage ? (teacher?.phoneMasked ?? null) : null,
        maxMarks: facts.maxMarks,
        entered: Math.min(facts.entered, facts.total),
        total: facts.total,
        state: cellState(facts, lockedSet.has(facts.classId)),
        late: isLate(facts, progress.expected),
        link: manage ? (teacher?.link ?? null) : null,
        remindedAt: manage ? (teacher?.remindedAt ?? null) : null,
        canEnter: editable.has(facts.paperId),
        classLocked: lockedSet.has(facts.classId),
        classReady: classPapers.every((x) => x.entryStatus === "submitted"),
        history,
      };
    }
  }

  /* ------------------------------------------------- report cards */
  let cards: ExamsProps["cards"] = null;
  let preview: ExamsProps["preview"] = null;
  if (reports && exam && progress && (view === "reportcards" || view === "preview")) {
    const issued = await issuedStudents(sessionLabel, exam.term);
    const classList = [...progress.roll.keys()]
      .map((id) => {
        const info = ctx.classes.find((c) => c.id === id);
        const kids = progress.roll.get(id) ?? [];
        return { id, label: info?.label ?? "", sort: info?.sort ?? 999, children: kids.length, issued: kids.filter((k) => issued.has(k.studentId)).length, locked: lockedSet.has(id) };
      })
      .filter((c) => c.label)
      .sort((a, b) => a.sort - b.sort || byClassLabel(a.label, b.label));
    const studentId = one("student");
    let classId = one("class") && classList.some((c) => c.id === one("class")) ? one("class")! : null;
    if (!classId && studentId) classId = [...progress.roll].find(([, kids]) => kids.some((k) => k.studentId === studentId))?.[0] ?? null;
    classId ??= classList.find((c) => c.locked)?.id ?? classList[0]?.id ?? null;
    const kids = classId ? (progress.roll.get(classId) ?? []) : [];
    const names = await studentsByIds(kids.map((k) => k.studentId));
    // Where each child's marks stand in this exam: what is still missing, and the percentage so far.
    const classPapers = classId ? progress.rows.filter((r) => r.class_id === classId).sort((a, b) => a.sort_order - b.sort_order || a.subject_code.localeCompare(b.subject_code)) : [];
    const markOf = new Map(progress.marks.map((m) => [`${m.assessment_subject_id}|${m.student_id}`, m]));
    const students = kids
      .map((k) => {
        const marks = classPapers.map((x) => {
          const m = markOf.get(`${x.id}|${k.studentId}`);
          return { subjectCode: x.subject_code, value: m?.value === null || m?.value === undefined ? null : Number(m.value), absent: Boolean(m?.absent), exempt: Boolean(m?.exempt), maxMarks: Number(x.max_marks), passMarks: x.pass_marks === null ? null : Number(x.pass_marks) };
        });
        return {
          id: k.studentId,
          name: names.get(k.studentId)?.name ?? "—",
          roll: k.roll ?? null,
          issued: issued.has(k.studentId),
          percent: childPercent(marks),
          missing: marks.filter((m) => m.value === null && !m.absent && !m.exempt).map((m) => m.subjectCode),
          absent: marks.filter((m) => m.absent).length,
        };
      })
      .sort((a, b) => Number(a.roll ?? 9999) - Number(b.roll ?? 9999) || a.name.localeCompare(b.name));
    const classInfo = classId ? ctx.classes.find((c) => c.id === classId) : undefined;
    cards = { term: exam.term, classes: classList, classId, classTeacher: classInfo?.classTeacherName ?? null, subjects: classPapers.length, students };

    if (view === "preview") {
      const id = studentId && students.some((s) => s.id === studentId) ? studentId : students[0]?.id;
      if (id) {
        const termExams = exams.filter((e) => e.term === exam.term && e.status !== "draft");
        const grace = await graceByStudent(termExams, classId ?? undefined);
        const state = await cardState({ studentId: id, sessionLabel, term: exam.term, grace: grace.get(id) ?? {} }).catch(() => null);
        const at = neighbours(students, students.findIndex((s) => s.id === id));
        if (state) {
          const c = state.card;
          preview = {
            school: schoolProfile.name,
            studentId: id,
            name: c.studentName,
            fatherName: c.fatherName,
            classLabel: c.classLabel,
            roll: c.rollNo,
            admissionNo: c.admissionNo,
            issued: state.issued,
            revision: state.revision,
            remark: state.remark,
            title: { en: `${exam.labelEn} · Report card`, hi: `${exam.labelHi} · प्रगति पत्र` },
            rows: c.rows.map((r) => ({
              subject: subjectPair(r.subjectCode),
              outOf: r.outOf,
              scored: r.scored,
              grade: r.grade,
              grace: state.grace[r.subjectCode] ?? 0,
              state: rowState(r.marks),
            })),
            total: c.totals.scored,
            outOf: c.totals.outOf,
            percent: c.totals.percent,
            grade: c.grade,
            passed: c.passed,
            attendance: c.attendance?.percent ?? null,
            present: c.attendance?.present ?? null,
            counted: c.attendance?.counted ?? null,
            classTeacher: classInfo?.classTeacherName ?? null,
            coordinator: ctx.coordinatorName,
            prevId: at.prev?.id ?? null,
            nextId: at.next?.id ?? null,
            position: at.position,
            of: at.of,
          };
        }
      }
    }
  }

  /* ------------------------------------------------- analysis */
  let analysis: ExamsProps["analysis"] = null;
  if (reports && exam && progress && view === "analysis") {
    const classIds = [...new Set(progress.rows.map((r) => r.class_id))];
    const classList = classIds
      .map((id) => ({ id, label: ctx.classes.find((c) => c.id === id)?.label ?? "", sort: ctx.classes.find((c) => c.id === id)?.sort ?? 999 }))
      .filter((c) => c.label)
      .sort((a, b) => a.sort - b.sort || byClassLabel(a.label, b.label));
    const classId = one("class") && classIds.includes(one("class")!) ? one("class")! : (classList.find((c) => progress.papers.filter((x) => x.classId === c.id).every((x) => x.entryStatus === "submitted"))?.id ?? classList[0]?.id ?? null);
    if (classId) {
      const papers = progress.rows.filter((r) => r.class_id === classId).sort((a, b) => a.sort_order - b.sort_order || a.subject_code.localeCompare(b.subject_code));
      const kids = progress.roll.get(classId) ?? [];
      const names = await studentsByIds(kids.map((k) => k.studentId));
      const markOf = new Map(progress.marks.map((m) => [`${m.assessment_subject_id}|${m.student_id}`, m]));
      const children: ChildMarks[] = kids.map((k) => ({
        studentId: k.studentId,
        name: names.get(k.studentId)?.name ?? "—",
        marks: papers.map((x) => {
          const m = markOf.get(`${x.id}|${k.studentId}`);
          return { subjectCode: x.subject_code, value: m?.value === null || m?.value === undefined ? null : Number(m.value), absent: Boolean(m?.absent), exempt: Boolean(m?.exempt), maxMarks: Number(x.max_marks), passMarks: x.pass_marks === null ? null : Number(x.pass_marks) };
        }),
      }));
      const result = classAnalysis(children, papers.map((x) => x.subject_code), 5);
      // One pass line for the chart when every paper of the class shares it; each paper's own line still decides who is below.
      const passShares = [...new Set(papers.map((x) => Math.round(((x.pass_marks === null ? Math.ceil(Number(x.max_marks) * 0.33) : Number(x.pass_marks)) / Math.max(1, Number(x.max_marks))) * 100)))];
      const prev = previousExam(exams, exam);
      analysis = {
        classes: classList.map(({ id, label }) => ({ id, label })),
        classId,
        classLabel: classList.find((c) => c.id === classId)?.label ?? "",
        children: kids.length,
        submitted: progress.papers.filter((x) => x.classId === classId && x.entryStatus === "submitted").length,
        papers: papers.length,
        subjects: result.subjects.map((s) => ({ ...s, name: subjectPair(s.subjectCode) })),
        counted: result.counted,
        passedAll: result.passedAll,
        top: result.top,
        below: result.below.slice(0, 40),
        belowCount: result.below.length,
        prevName: prev ? { en: prev.labelEn, hi: prev.labelHi } : null,
        passPct: passShares.length === 1 ? passShares[0] : undefined,
        locked: lockedSet.has(classId),
      };
    }
  }

  /* ------------------------------------------------- activity */
  const activity = reports && exam
    ? (await activityFor([exam.id], 8)).map((a) => ({ id: a.id, kind: a.kind, text: { en: a.text_en, hi: a.text_hi ?? undefined }, at: a.created_at }))
    : [];

  const graceCount = manage && exam && progress ? (await graceFor(progress.rows.map((r) => r.id))).length : 0;
  const terms = [...new Set(["Term 1", "Term 2", ...exams.map((e) => e.term)])].filter((t) => !/^QA-/.test(t));

  const data: ExamsProps = {
    view,
    manage,
    canFinalise: canFinaliseMarks(staff),
    reports,
    scoped,
    fromName: staff.displayName,
    sessionLabel,
    timeline,
    exam: exam && progress && counts
      ? {
          id: exam.id,
          term: exam.term,
          name: { en: exam.labelEn, hi: exam.labelHi },
          dates: span(exam),
          open: exam.status === "open",
          dueLabel: exam.plan?.marksDueOn ? dueDay(exam.plan.marksDueOn) : null,
          entered: progress.overall.entered,
          total: progress.overall.total,
          percent: progress.overall.percent,
          notStarted: progress.teachers.filter((t) => t.notStarted).length,
          counts,
          graceGiven: graceCount,
        }
      : null,
    activity,
    bands,
    gridClassId: one("class") ?? null,
    teachers: manage && progress ? progress.teachers : [],
    cell,
    cards,
    preview,
    analysis,
    terms,
    actions: {
      remind: remindTeachersAction,
      marksLink: marksLinkAction,
      lock: lockClassesAction,
      issueClass: issueClassCardsAction,
      create: createExamAction,
    },
  };
  return <ExamsBoard {...data} />;
}

function span(e: Exam): string {
  return dateSpan(e.startsOn, e.endsOn);
}

/** A report-card row's state from its marks: all absent, all exempt, a mark still missing, or marked. */
function rowState(marks: { value: number | null; absent: boolean; exempt: boolean }[]): "value" | "absent" | "missing" | "exempt" {
  if (marks.length && marks.every((m) => m.exempt)) return "exempt";
  if (marks.length && marks.every((m) => m.absent || m.exempt)) return "absent";
  if (marks.some((m) => m.value === null && !m.absent && !m.exempt)) return "missing";
  return "value";
}
