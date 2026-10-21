import { schoolNow } from "@/platform/auth/qa-clock";
import { byClassLabel } from "@/modules/academics/domain/class-order";
import { requirePermission } from "@/platform/auth/current-staff";
import { daysBetween, shortDay } from "@/vx/format";
import { lead, p } from "@/vx/text";
import { EmptyState } from "@/vx/ui/primitives";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { getViewer } from "@/vx/view-as";
import { currentExam, graceFor, issuedStudents, locksFor, marksOf, moderationFor, papersOf, previousExam, rechecksFor, studentsByIds } from "@/vx/screens/exams/data";
import { cardState, graceByStudent } from "@/vx/screens/exams/cards-data";
import { histogram } from "@/vx/screens/exams/domain/analysis";
import { canFinaliseMarks, canReopenMarks } from "@/vx/screens/exams/domain/finalise";
import { averagePct, graceVerdict, pipelineStates, sameNameHints, unusualAverages, type PaperAverage } from "@/vx/screens/exams/domain/results";
import { classReadiness } from "@/vx/screens/exams/domain/progress";
import { isLate } from "@/vx/screens/exams/domain/tracker";
import { examProgress, officeContext } from "@/vx/screens/exams/office-data";
import { ResultsBoard, type ResultsView, type ResultsProps } from "@/vx/screens/exams/results-board";

import {
  addRecheckAction,
  giveGraceAction,
  issueClassCardsAction,
  lockClassesAction,
  moderateAction,
  publishResultsAction,
  recheckWithTeacherAction,
  removeGraceAction,
  resolveRecheckAction,
  saveGraceRuleAction,
  unlockClassAction,
} from "./actions";
import { remindTeachersAction } from "../actions";

export const runtime = "nodejs";

const VIEWS = ["pipeline", "moderation", "grace", "lock", "cards", "publish", "recheck"] as const;

/** From marks to parents (ExamResults): check, grace, lock, cards, publish, re-checks. */
export default async function ExamResultsPage(props: PageProps<"/exam-office/results">) {
  await requirePermission("assessments:manage");
  const { staff } = await getViewer();
  const sp = await props.searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const view: ResultsView = (VIEWS as readonly string[]).includes(one("view") ?? "") ? (one("view") as ResultsView) : "pipeline";

  const now = await schoolNow(staff);
  const ctx = await officeContext(now);
  const exam = ctx ? currentExam(ctx.exams, ctx.today, one("exam")) : null;
  if (!ctx || !exam) {
    return (
      <VxPage>
        <TopBar title={lead(p("Results pipeline", "परिणाम"), staff.language)} />
        <main>
          <Section>
            <EmptyState icon="award" title={lead(p("No exam has marks yet", "अभी किसी परीक्षा के अंक नहीं"), staff.language)} />
          </Section>
        </main>
      </VxPage>
    );
  }
  const { today, sessionLabel } = ctx;
  const progress = await examProgress(ctx, exam);
  const paperIds = progress.rows.map((r) => r.id);
  const prev = previousExam(ctx.exams, exam);
  const [locks, moderation, grace, rechecks, issued, prevPapers] = await Promise.all([
    locksFor(exam.id),
    moderationFor(paperIds),
    graceFor(paperIds),
    rechecksFor(paperIds),
    issuedStudents(sessionLabel, exam.term, exam.startsOn),
    prev ? papersOf([prev.id]) : Promise.resolve([]),
  ]);
  const prevMarks = await marksOf(prevPapers.map((x) => x.id));

  /* children on roll and their names */
  const rollIds = [...progress.roll.values()].flat().map((e) => e.studentId);
  const names = await studentsByIds([...rollIds, ...rechecks.map((r) => r.student_id)]);
  const nameOf = (id: string) => names.get(id)?.name ?? "—";

  /* averages now and before */
  const marksBy = new Map<string, typeof progress.marks>();
  for (const m of progress.marks) marksBy.set(m.assessment_subject_id, [...(marksBy.get(m.assessment_subject_id) ?? []), m]);
  const prevBy = new Map<string, typeof prevMarks>();
  for (const m of prevMarks) prevBy.set(m.assessment_subject_id, [...(prevBy.get(m.assessment_subject_id) ?? []), m]);
  const norm = (m: (typeof prevMarks)[number]) => ({ value: m.value === null ? null : Number(m.value), absent: m.absent, exempt: m.exempt });
  const factsOf = new Map(progress.papers.map((x) => [x.paperId, x]));
  const averages: PaperAverage[] = progress.rows.map((r) => {
    const before = prevPapers.find((x) => x.class_id === r.class_id && x.subject_code === r.subject_code);
    return {
      paperId: r.id,
      classId: r.class_id,
      classLabel: r.class_label,
      subjectCode: r.subject_code,
      avgPct: averagePct((marksBy.get(r.id) ?? []).map(norm), Number(r.max_marks)),
      prevPct: before ? averagePct((prevBy.get(before.id) ?? []).map(norm), Number(before.max_marks)) : null,
    };
  });
  const unusual = unusualAverages(averages);
  const unusualOpen = unusual.filter((u) => !moderation.has(u.paperId));

  /* grace */
  const rule = { maxPerPaper: exam.plan?.graceMax ?? 3, maxSubjects: exam.plan?.graceSubjects ?? 2 };
  const given = new Map(grace.map((g) => [`${g.paper_id}|${g.student_id}`, Number(g.grace)]));
  const markOf = new Map(progress.marks.map((m) => [`${m.assessment_subject_id}|${m.student_id}`, m]));
  const graceRows: ResultsProps["grace"]["rows"] = [];
  // Two children with one name in one class get their SR no. (or father's name) beside it.
  const hints = sameNameHints(
    [...progress.roll].flatMap(([classId, kids]) =>
      kids.map((k) => ({ id: k.studentId, group: classId, name: nameOf(k.studentId), sr: names.get(k.studentId)?.admissionNo ?? null, father: names.get(k.studentId)?.fatherName ?? null })),
    ),
  );
  for (const [classId, kids] of progress.roll) {
    const papers = progress.rows.filter((r) => r.class_id === classId);
    for (const kid of kids) {
      const verdict = graceVerdict(
        kid.studentId,
        papers.map((x) => {
          const m = markOf.get(`${x.id}|${kid.studentId}`);
          return { paperId: x.id, subjectCode: x.subject_code, value: m?.value === null || m?.value === undefined ? null : Number(m.value), absent: Boolean(m?.absent), exempt: Boolean(m?.exempt), passMarks: x.pass_marks === null ? null : Number(x.pass_marks), maxMarks: Number(x.max_marks) };
        }),
        rule,
      );
      if (!verdict) continue;
      graceRows.push({
        studentId: kid.studentId,
        name: nameOf(kid.studentId),
        hint: hints.get(kid.studentId) ?? null,
        classId,
        classLabel: papers[0]?.class_label ?? "",
        canPass: verdict.canPass,
        total: verdict.total,
        given: verdict.needs.every((n) => given.has(`${n.paperId}|${kid.studentId}`)),
        locked: locks.has(classId),
        needs: verdict.needs.map((n) => ({ paperId: n.paperId, subjectCode: n.subjectCode, value: n.value, passMarks: n.passMarks, grace: n.grace, maxMarks: Number(progress.rows.find((r) => r.id === n.paperId)?.max_marks ?? 0) })),
      });
    }
  }
  graceRows.sort((a, b) => Number(b.canPass) - Number(a.canPass) || a.total - b.total || a.name.localeCompare(b.name));
  const graceOpen = graceRows.filter((g) => g.canPass && !g.given && !g.locked).length;

  /* classes */
  const issuedBy = new Map<string, number>();
  for (const [classId, kids] of progress.roll) issuedBy.set(classId, kids.filter((k) => issued.has(k.studentId)).length);
  const classes: ResultsProps["classes"] = [...new Set(progress.papers.map((x) => x.classId))]
    .map((classId) => {
      const papers = progress.papers.filter((x) => x.classId === classId);
      const total = papers.reduce((a, x) => a + x.total, 0);
      const entered = papers.reduce((a, x) => a + Math.min(x.entered, x.total), 0);
      const info = ctx.classes.find((c) => c.id === classId);
      // Readiness from the persisted marks and their validity (B04): "Ready to
      // lock" needs every paper sent, every child marked and no mark the
      // paper cannot hold — the same check `lockClassesAction` makes.
      const ready = classReadiness(papers);
      return {
        id: classId,
        label: papers[0]?.classLabel ?? "",
        sort: papers[0]?.classSort ?? 999,
        teacher: info?.classTeacherName ?? null,
        children: progress.roll.get(classId)?.length ?? 0,
        percent: total ? Math.round((entered / total) * 100) : 0,
        allSubmitted: papers.every((x) => x.entryStatus === "submitted"),
        readiness: ready.state,
        readyToLock: ready.readyToLock,
        invalid: ready.invalid,
        fix: papers.filter((x) => (x.invalid ?? 0) > 0).map((x) => ({ subjectCode: x.subjectCode, count: x.invalid ?? 0 })),
        // Every late paper, whether or not a teacher is assigned to it: an
        // unassigned paper past its due date is the most late of all (B7).
        late: papers.filter((x) => isLate(x, progress.expected)).length,
        unusual: unusual.filter((u) => u.classId === classId).length,
        unusualOpen: unusualOpen.filter((u) => u.classId === classId).length,
        graceNeeded: graceRows.filter((g) => g.classId === classId && g.canPass && !g.given).length,
        locked: locks.has(classId),
        issued: issuedBy.get(classId) ?? 0,
      };
    })
    .sort((a, b) => a.sort - b.sort || byClassLabel(a.label, b.label));

  /* moderation: complete classes, their papers with a spread */
  const modClassId = one("class") && classes.some((c) => c.id === one("class")) ? one("class")! : (classes.find((c) => c.allSubmitted && c.unusualOpen) ?? classes.find((c) => c.allSubmitted) ?? classes[0])?.id ?? null;
  const modPapers: ResultsProps["moderation"]["papers"] = progress.rows
    .filter((r) => r.class_id === modClassId)
    .map((r) => {
      const values = (marksBy.get(r.id) ?? []).filter((m) => !m.absent && !m.exempt && m.value !== null).map((m) => Number(m.value));
      const avg = averages.find((a) => a.paperId === r.id)!;
      const u = unusual.find((x) => x.paperId === r.id);
      const facts = factsOf.get(r.id);
      return {
        paperId: r.id,
        subjectCode: r.subject_code,
        teacherId: facts?.teacherId ?? null,
        teacherName: facts?.teacherName ?? null,
        teacherPhone: facts?.teacherId ? (ctx.staff.find((s) => s.id === facts.teacherId)?.phone ?? null) : null,
        maxMarks: Number(r.max_marks),
        passMarks: r.pass_marks === null ? null : Number(r.pass_marks),
        avgPct: avg.avgPct,
        prevPct: avg.prevPct,
        baseline: u?.baseline ?? null,
        basis: u?.basis ?? null,
        delta: u?.delta ?? null,
        unusual: Boolean(u),
        invalid: facts?.invalid ?? 0,
        decision: moderation.get(r.id)?.decision ?? null,
        sat: values.length,
        onRoll: facts?.total,
        absent: facts?.absent,
        exempt: facts?.exempt,
        below: r.pass_marks === null ? 0 : values.filter((v) => v < Number(r.pass_marks)).length,
        highest: values.length ? Math.max(...values) : null,
        spread: histogram(values, Number(r.max_marks), 10),
      };
    })
    .sort((a, b) => Number(b.unusual) - Number(a.unusual) || a.subjectCode.localeCompare(b.subjectCode));

  /* cards: a sample */
  const termExams = ctx.exams.filter((e) => e.term === exam.term && e.status !== "draft");
  const sampleClass = classes.find((c) => c.locked) ?? classes.find((c) => c.allSubmitted) ?? null;
  let sample: ResultsProps["cards"]["sample"] = null;
  const sampleKid = sampleClass ? progress.roll.get(sampleClass.id)?.[0] : undefined;
  // Only the Cards and Publish steps show the sample; building a full card (marks, grace,
  // attendance) for every other step is what made Grace take 9.4 s (smoke 20 Oct).
  if (sampleKid && (view === "cards" || view === "publish")) {
    const graceMap = await graceByStudent(termExams, sampleClass!.id);
    const state = await cardState({ studentId: sampleKid.studentId, sessionLabel, term: exam.term, grace: graceMap.get(sampleKid.studentId) ?? {} }).catch(() => null);
    if (state) {
      sample = {
        studentId: sampleKid.studentId,
        name: state.card.studentName,
        classId: sampleClass!.id,
        classLabel: state.card.classLabel,
        issued: state.issued,
        rows: state.card.rows.map((r) => ({ subject: r.subjectCode, scored: r.scored, outOf: r.outOf, grade: r.grade, grace: state.grace[r.subjectCode] ?? 0 })),
        total: state.card.totals.scored,
        outOf: state.card.totals.outOf,
        percent: state.card.totals.percent,
        grade: state.card.grade,
        passed: state.card.passed,
        shortIn: [...new Set([...(state.card.shortIn ?? []), ...(state.card.absentIn ?? [])])],
      };
    }
  }

  /* re-checks */
  const recheckRows: ResultsProps["rechecks"] = rechecks.map((r) => {
    const paper = progress.rows.find((x) => x.id === r.paper_id);
    const facts = factsOf.get(r.paper_id);
    const m = markOf.get(`${r.paper_id}|${r.student_id}`);
    return {
      id: r.id,
      studentId: r.student_id,
      name: nameOf(r.student_id),
      paperId: r.paper_id,
      classLabel: paper?.class_label ?? "",
      subjectCode: paper?.subject_code ?? "",
      maxMarks: Number(paper?.max_marks ?? 0),
      mark: m?.value === null || m?.value === undefined ? null : Number(m.value),
      askedBy: r.asked_by,
      note: r.note,
      status: r.status,
      oldValue: r.old_value === null ? null : Number(r.old_value),
      newValue: r.new_value === null ? null : Number(r.new_value),
      createdAt: r.created_at,
      teacherName: facts?.teacherName ?? null,
      teacherPhone: facts?.teacherId ? (ctx.staff.find((s) => s.id === facts.teacherId)?.phone ?? null) : null,
      locked: paper ? locks.has(paper.class_id) : false,
    };
  });

  const childrenTotal = rollIds.length;
  const states = pipelineStates({
    enteredPct: progress.overall.percent,
    unusualOpen: unusualOpen.length,
    invalid: classes.reduce((a, c) => a + (c.invalid ?? 0), 0),
    graceOpen,
    lockedClasses: classes.filter((c) => c.locked).length,
    totalClasses: classes.length,
    cardsIssued: [...issuedBy.values()].reduce((a, b) => a + b, 0),
    cardsDue: childrenTotal,
    published: Boolean(exam.plan?.resultsPublishedAt),
  });
  const plan = exam.plan;

  const data: ResultsProps = {
    view,
    isAdmin: staff.role === "admin",
    canFinalise: canFinaliseMarks(staff),
    canReopen: canReopenMarks(staff),
    fromName: staff.displayName,
    exam: {
      id: exam.id,
      term: exam.term,
      name: { en: exam.labelEn, hi: exam.labelHi },
      dates: exam.startsOn ? `${shortDay(exam.startsOn)}${exam.endsOn ? ` – ${shortDay(exam.endsOn)}` : ""}` : "",
      sessionLabel,
      prevName: prev ? { en: prev.labelEn, hi: prev.labelHi } : null,
      marksDue: plan?.marksDueOn ? shortDay(plan.marksDueOn) : null,
      daysToDue: plan?.marksDueOn ? daysBetween(today, plan.marksDueOn) : null,
      resultsOn: plan?.resultsOn ?? null,
      resultsLabel: plan?.resultsOn ? shortDay(plan.resultsOn) : null,
      daysToResults: plan?.resultsOn ? daysBetween(today, plan.resultsOn) : null,
      ptmAt: plan?.ptmAt ?? null,
      publishAt: plan?.resultsPublishAt ?? null,
      publishedAt: plan?.resultsPublishedAt ?? null,
      ptm: plan?.channels.ptm ?? true,
    },
    overall: progress.overall,
    teachers: progress.teachers,
    states,
    classes,
    childrenTotal,
    unusualCount: unusual.length,
    unusualOpen: unusualOpen.length,
    moderation: {
      classId: modClassId,
      completeClasses: classes.filter((c) => c.allSubmitted).map((c) => ({ id: c.id, label: c.label, unusual: c.unusualOpen })),
      still: classes.filter((c) => !c.allSubmitted).length,
      flagged: unusualOpen.slice(0, 4).map((u) => ({ paperId: u.paperId, classId: u.classId, classLabel: u.classLabel, subjectCode: u.subjectCode, avgPct: u.avgPct, baseline: u.baseline, delta: u.delta, basis: u.basis, teacherName: factsOf.get(u.paperId)?.teacherName ?? null })),
      papers: modPapers,
    },
    grace: { max: rule.maxPerPaper, subjects: rule.maxSubjects, rows: graceRows.slice(0, 200), open: graceOpen },
    cards: { sample, issuedTotal: [...issuedBy.values()].reduce((a, b) => a + b, 0) },
    rechecks: recheckRows,
    paperChoices: progress.rows.map((r) => ({ id: r.id, classId: r.class_id, label: `${r.class_label} · ${r.subject_code}` })),
    rollChoices: Object.fromEntries([...progress.roll].map(([classId, kids]) => [classId, kids.map((k) => ({ id: k.studentId, name: nameOf(k.studentId), roll: k.roll ?? null }))])),
    actions: {
      moderate: moderateAction,
      saveGraceRule: saveGraceRuleAction,
      giveGrace: giveGraceAction,
      removeGrace: removeGraceAction,
      lock: lockClassesAction,
      unlock: unlockClassAction,
      issueClass: issueClassCardsAction,
      publish: publishResultsAction,
      addRecheck: addRecheckAction,
      recheckWithTeacher: recheckWithTeacherAction,
      resolveRecheck: resolveRecheckAction,
      remind: remindTeachersAction,
    },
    recheckId: one("recheck") ?? null,
  };
  return <ResultsBoard {...data} />;
}
