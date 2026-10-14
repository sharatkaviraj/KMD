import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

import { academicContext, classDetail, classMarks, classPeople, classResults, classTeacherOf, currentExam, examsOf, needsAttention, staffDirectory, studentDetail, type Exam } from "./data";
import { subjectName, type AttentionReason } from "./domain";
import { AcadProgressView, type AcadProgressProps } from "./progress-view";
import { sayer } from "./ui";

/*
 * AcadProgress's server half: it reads the chosen state's records (scoped to
 * the reader's classes) and hands plain props to `AcadProgressView`.
 */

type Props = { staff: CurrentStaff; view?: string; exam?: string; classId?: string; studentId?: string; a?: string; b?: string; reason?: string; grp?: string; hl?: string };

const REASONS: (AttentionReason | "improving")[] = ["attendance", "below_33", "dropped", "notes", "improving"];

function examLabel(e: Exam, language: string): string {
  return language === "hi" && e.labelHi ? e.labelHi : e.label;
}

export async function AcadProgress(props: Props) {
  const { staff } = props;
  const language = staff.language;
  const say = sayer(language);
  const ctx = await academicContext(staff);
  if (!ctx) {
    return (
      <VxPage>
        <TopBar title={say("Student progress", "छात्र प्रगति")} />
        <Section>
          <EmptyState title={say("No session is open", "कोई सत्र खुला नहीं है")} />
        </Section>
      </VxPage>
    );
  }
  const exams = await examsOf(ctx.session);
  const chosen = exams.find((e) => e.code === props.exam) ?? currentExam(exams, ctx.today).current;
  const idx = chosen ? exams.indexOf(chosen) : -1;
  const previous = idx > 0 ? exams[idx - 1] : null;
  const attention = await needsAttention(ctx);
  const view = ["class", "student", "compare", "attention", "plan"].includes(props.view ?? "") ? props.view! : "overview";
  const tab = (e: Exam) => ({ code: e.code, label: examLabel(e, language) });
  const results = chosen && (view === "overview" || view === "compare" || view === "class") ? await classResults(ctx, chosen, previous) : null;
  const common = {
    language,
    today: ctx.today,
    session: ctx.session.replace("-", "–"),
    exams: exams.filter((e) => e.startsOn <= ctx.today).map(tab),
    exam: chosen ? tab(chosen) : null,
    previous: previous ? tab(previous) : null,
    entered: results && results.stats.length ? Math.round((results.stats.filter((s) => s.submitted).length / results.stats.length) * 100) : 0,
    attentionCount: attention.length,
    mayManage: can(staff, "academics:manage"),
    mayFollow: ctx.everyClass,
    notesHref: can(staff, "notes:view") ? "/notes" : null,
  };
  const staffList = async () =>
    [...(await staffDirectory()).values()]
      .filter((s) => s.is_active && s.is_teaching !== false)
      .map((s) => ({ id: s.id, name: s.display_name }))
      .sort((x, y) => x.name.localeCompare(y.name));

  let p: AcadProgressProps;
  if (!chosen) {
    p = { ...common, view: "empty" };
  } else if ((view === "student" || view === "plan") && props.studentId) {
    const child = await studentDetail(ctx, props.studentId);
    if (!child) p = { ...common, view: "missing", what: "student" };
    else if (view === "plan") {
      const suggestions = [
        ...(child.facts?.below33Subjects ?? []).slice(0, 2).map((s) => say(`Saturday remedial class · ${subjectName(s)}`, `शनिवार उपचारात्मक कक्षा · ${subjectName(s)}`)),
        ...(child.facts?.reasons.includes("below_33") || child.facts?.reasons.includes("dropped") ? [say("Extra practice sheets twice a week", "सप्ताह में दो बार अभ्यास पत्रक")] : []),
        ...(child.facts?.reasons.includes("attendance") ? [say("Call parents about attendance", "हाज़िरी के बारे में अभिभावक से बात")] : []),
        say("Parent meeting at the PTM", "PTM पर अभिभावक बैठक"),
        say("Peer buddy for daily homework", "रोज़ गृहकार्य के लिए साथी"),
        say("Check homework diary every day", "रोज़ गृहकार्य डायरी जाँचें"),
      ];
      p = { ...common, view: "plan", child, staff: await staffList(), suggestions, father: child.father, parentPhone: child.phone };
    } else {
      p = { ...common, view: "student", child, classTeacher: await classTeacherOf(ctx, child.classId), hl: props.hl ?? null };
    }
  } else if (view === "attention") {
    const filter = REASONS.find((r) => r === props.reason) ?? null;
    p = { ...common, view: "attention", list: attention, filter, staff: ctx.everyClass ? await staffList() : [] };
  } else if (view === "compare" && results) {
    const a = ctx.classes.find((c) => c.id === props.a) ?? ctx.classes[Math.max(0, ctx.classes.length - 8)];
    const b = ctx.classes.find((c) => c.id === props.b && c.id !== a?.id) ?? ctx.classes[ctx.classes.indexOf(a) + 1] ?? ctx.classes.find((c) => c.id !== a?.id);
    if (!a || !b) p = { ...common, view: "missing", what: "class" };
    else {
      const attentionBy: Record<string, number> = {};
      for (const c of attention) attentionBy[c.classId] = (attentionBy[c.classId] ?? 0) + 1;
      p = { ...common, view: "compare", classes: ctx.classes, a, b, results: results.classes, stats: results.stats.filter((s) => s.classId === a.id || s.classId === b.id).map((s) => ({ classId: s.classId, subject: s.subject, avg: s.avgPct })), attentionBy };
    }
  } else if (view === "class" && props.classId && results) {
    const detail = await classDetail(ctx, props.classId, chosen, previous);
    if (!detail) p = { ...common, view: "missing", what: "class" };
    else {
      const at = ctx.classes.findIndex((c) => c.id === detail.classId);
      const n = ctx.classes.length;
      const [marks, people] = await Promise.all([classMarks(ctx, detail.classId, chosen.id), classPeople(ctx, detail.classId, chosen.id)]);
      p = {
        ...common,
        view: "class",
        detail,
        result: results.classes.find((c) => c.classId === detail.classId) ?? null,
        nav: { prev: ctx.classes[(at - 1 + n) % n], next: ctx.classes[(at + 1) % n], pos: at + 1, total: n },
        marks,
        people: { ...people, bySubject: Object.fromEntries(people.bySubject) },
      };
    }
  } else if (results) {
    const withAvg = results.classes.filter((c) => c.avg !== null);
    const mean = (vals: number[]) => (vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null);
    p = {
      ...common,
      view: "overview",
      classes: results.classes,
      school: {
        avg: mean(withAvg.map((c) => c.avg ?? 0)),
        before: mean(results.classes.filter((c) => c.before !== null).map((c) => c.before ?? 0)),
        pass: results.studentPass,
        lowest: results.lowest ? { label: results.lowest.label, pass: results.lowest.pass } : null,
        att: mean(results.classes.filter((c) => c.attendance !== null).map((c) => c.attendance ?? 0)),
      },
      stats: results.stats.map((s) => ({ classId: s.classId, subject: s.subject, sortOrder: s.sortOrder, avg: s.avgPct, entered: s.entered })),
      group: props.grp === "senior" ? "senior" : "junior",
      attention,
    };
  } else {
    p = { ...common, view: "empty" };
  }
  return <AcadProgressView {...p} />;
}
