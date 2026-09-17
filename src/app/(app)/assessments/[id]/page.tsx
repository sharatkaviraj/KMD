import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { countOf, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { classRoll } from "@/modules/attendance/data/attendance-repo";
import {
  getAssessment,
  marksForPapers,
  papersFor,
} from "@/modules/assessments/data/assessments-repo";
import {
  assessmentStatusLabels,
  isEntered,
} from "@/modules/assessments/domain/assessments";
import { marksCsv } from "@/modules/assessments/domain/report-card";
import {
  AssessmentForm,
  ExportButton,
  PaperForm,
} from "@/modules/assessments/ui/assessment-forms";
import {
  deleteAssessmentAction,
  deletePaperAction,
  setAssessmentStatusAction,
} from "@/app/(app)/assessments/actions";
import { schoolToday } from "@/platform/dates";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.assessmentsTitle) };
}

/**
 * One exam: its papers, and how far each has got.
 *
 * **Finished papers stay on the list.** That is the difference between a board
 * and a reminder queue: one that dropped them would show a teacher who has
 * entered everything as absent, which reads identically to a teacher nobody
 * asked. Ported in spirit from `sampark/src/lib/progress.ts`, which makes the
 * same point about its own boards.
 */
export default async function AssessmentPage(props: PageProps<"/assessments/[id]">) {
  const staff = await requirePermission("assessments:view", "/assessments");
  const language = staff.language;
  const mayManage = can(staff, "assessments:manage");
  const { id } = await props.params;

  const sessionLabel = await resolveSessionLabel();
  const assessment = await getAssessment(id);

  if (!sessionLabel || !assessment) {
    return (
      <>
        <PageHeader title={m.assessmentsTitle} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  const [papers, labels, subjects] = await Promise.all([
    papersFor(assessment.id),
    classLabelMap(sessionLabel),
    listSubjects(),
  ]);

  const marks = await marksForPapers(papers.map((paper) => paper.id));

  // One roll read per class, not per paper: a class sitting six papers is one
  // register, and six identical reads of it would be five wasted.
  const classIds = [...new Set(papers.map((paper) => paper.classId))];
  const rolls = new Map(
    await Promise.all(
      classIds.map(
        async (classId) =>
          [classId, await classRoll(classId, sessionLabel)] as const,
      ),
    ),
  );

  const progress = papers.map((paper) => {
    const roll = rolls.get(paper.classId) ?? [];
    const entered = roll.filter((student) =>
      isEntered(marks.get(`${paper.id}|${student.studentId}`)),
    ).length;

    return {
      paper,
      expected: roll.length,
      entered,
      done: roll.length > 0 && entered === roll.length,
    };
  });

  const outstanding = progress.filter((entry) => !entry.done);

  const exportRows = papers.flatMap((paper) =>
    (rolls.get(paper.classId) ?? []).map((student) => {
      const mark = marks.get(`${paper.id}|${student.studentId}`);
      return {
        rollNo: student.rollNo,
        studentName: student.fullName,
        classLabel: paper.classLabel,
        subjectCode: paper.subjectCode,
        assessmentCode: assessment.code,
        value: mark?.value ?? null,
        absent: mark?.absent ?? false,
        maxMarks: paper.maxMarks,
      };
    }),
  );

  const classes = [...labels.entries()]
    .map(([classId, label]) => ({ id: classId, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "en"));

  return (
    <>
      <PageHeader
        title={t(
          language === "en" ? assessment.labelEn : assessment.labelHi,
          assessment.labelEn,
        )}
        description={t(
          `${assessment.term} · ${assessment.code}`,
          `${assessment.term} · ${assessment.code}`,
        )}
        language={language}
        back={BACK}
        action={
          <Badge
            tone={
              assessment.status === "open"
                ? "success"
                : assessment.status === "locked"
                  ? "warning"
                  : "neutral"
            }
          >
            {primary(assessmentStatusLabels[assessment.status], language)}
          </Badge>
        }
      />

      {assessment.status === "locked" ? (
        <Notice
          className="mb-4"
          tone="warning"
          text={m.marksLocked}
          language={language}
        />
      ) : null}

      {/* ------------------------------------------------- the papers */}

      <Section title={m.papersTitle} language={language}>
        {papers.length === 0 ? (
          <EmptyState title={m.papersNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {progress.map((entry) => (
              <li key={entry.paper.id}>
                <div className="flex items-stretch gap-2">
                  <Link
                    href={`/assessments/marks/${entry.paper.id}`}
                    className="focus-ring flex min-h-16 flex-1 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-foreground">
                        {entry.paper.classLabel} · {entry.paper.subjectCode}
                      </span>
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {primary(m.paperMax, language)} {entry.paper.maxMarks}
                        {entry.paper.passMarks !== null
                          ? ` · ${primary(m.paperPass, language)} ${entry.paper.passMarks}`
                          : ""}
                      </span>
                    </span>
                    <Badge tone={entry.done ? "success" : "warning"}>
                      {countOf(entry.entered, entry.expected, language)}
                    </Badge>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-subtle-foreground"
                    />
                  </Link>

                  {mayManage ? (
                    <form action={deletePaperAction} className="flex">
                      <input type="hidden" name="id" value={entry.paper.id} />
                      <input
                        type="hidden"
                        name="assessmentId"
                        value={assessment.id}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        {primary(m.remove, language)}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* --------------------------------------------- who is still owed */}

      {papers.length > 0 ? (
        <Section className="mt-7" title={m.marksWhoIsLeft} language={language}>
          {outstanding.length === 0 ? (
            <Notice tone="success" text={m.marksAllIn} language={language} />
          ) : (
            <ul className="space-y-1.5">
              {outstanding.map((entry) => (
                <li
                  key={entry.paper.id}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] text-foreground">
                    {entry.paper.classLabel} · {entry.paper.subjectCode}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                    {entry.expected - entry.entered}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {can(staff, "reports:view") && exportRows.length > 0 ? (
            <div className="mt-3">
              <ExportButton
                csv={marksCsv(exportRows)}
                kind="marks"
                scope={`${assessment.term} ${assessment.code}`}
                rowCount={exportRows.length}
                day={schoolToday()}
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* ------------------------------------------------- managing it */}

      {mayManage ? (
        <>
          <Section className="mt-8" title={m.paperAdd} language={language}>
            <Card className="p-4">
              <PaperForm
                assessmentId={assessment.id}
                classes={classes}
                subjects={subjects.map((subject) => ({
                  id: subject.id,
                  code: subject.code,
                  nameEn: subject.nameEn,
                }))}
              />
            </Card>
          </Section>

          <Section className="mt-8" title={m.edit} language={language}>
            <Card className="p-4">
              <AssessmentForm assessment={assessment} />
            </Card>
          </Section>

          <Card className="mt-6 space-y-2 p-4">
            <form action={setAssessmentStatusAction}>
              <input type="hidden" name="id" value={assessment.id} />
              <input
                type="hidden"
                name="status"
                value={assessment.status === "open" ? "locked" : "open"}
              />
              <Button
                type="submit"
                fullWidth
                size="lg"
                variant={assessment.status === "open" ? "outline" : "primary"}
                disabled={papers.length === 0}
              >
                {primary(
                  assessment.status === "open"
                    ? m.assessmentLock
                    : assessment.status === "locked"
                      ? m.assessmentUnlock
                      : m.assessmentOpen,
                  language,
                )}
              </Button>
            </form>

            <p className="text-center text-[12px] text-subtle-foreground">
              {primary(m.assessmentLockHint, language)}
            </p>

            {assessment.status === "draft" ? (
              <form action={deleteAssessmentAction}>
                <input type="hidden" name="id" value={assessment.id} />
                <Button type="submit" variant="ghost" size="sm" fullWidth>
                  {primary(m.assessmentDelete, language)}
                </Button>
              </form>
            ) : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

const BACK = { href: "/assessments", label: m.assessmentsTitle };
