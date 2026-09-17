import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classRoll } from "@/modules/attendance/data/attendance-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import {
  changeLogFor,
  getAssessment,
  getPaper,
  marksForPaper,
} from "@/modules/assessments/data/assessments-repo";
import { canEnterMarks } from "@/modules/assessments/domain/assessments";
import { MarksGrid } from "@/modules/assessments/ui/marks-grid";
import { Card, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.marksGrid) };
}

/**
 * One column of the grid, and everything that happened to it.
 *
 * The change log sits under the grid rather than behind a tab, because the
 * moment somebody wants it is the moment they are looking at a mark that
 * surprised them.
 */
export default async function MarksPage(
  props: PageProps<"/assessments/marks/[paperId]">,
) {
  const staff = await requirePermission("marks:view", "/assessments");
  const language = staff.language;
  const { paperId } = await props.params;

  const sessionLabel = await resolveSessionLabel();
  const paper = await getPaper(paperId);

  if (!sessionLabel || !paper) {
    return (
      <>
        <PageHeader title={m.marksGrid} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  const assessment = await getAssessment(paper.assessmentId);

  if (!assessment) {
    return (
      <>
        <PageHeader title={m.marksGrid} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  const [roll, marks, changes, own] = await Promise.all([
    classRoll(paper.classId, sessionLabel),
    marksForPaper(paper.id),
    changeLogFor(paper.id),
    ownClassIds(staff.id, sessionLabel),
  ]);

  const openness = canEnterMarks(assessment);

  // `marks:write` says this person may enter marks; it does not say whose.
  // The same row-level half as attendance, and the same shape.
  const mine =
    can(staff, "assessments:manage") || own.includes(paper.classId);

  const locked = !openness.allowed || !can(staff, "marks:write") || !mine;

  return (
    <>
      <PageHeader
        title={t(
          `${paper.classLabel} · ${paper.subjectCode}`,
          `${paper.classLabel} · ${paper.subjectCode}`,
        )}
        description={t(
          `${language === "en" ? assessment.labelEn : assessment.labelHi} · ${assessment.term}`,
          `${assessment.labelEn} · ${assessment.term}`,
        )}
        language={language}
        back={{ href: `/assessments/${assessment.id}`, label: m.papersTitle }}
      />

      <MarksGrid
        paper={paper}
        roll={roll}
        marks={Object.fromEntries(
          [...marks.entries()].map(([studentId, mark]) => [
            studentId,
            { value: mark.value, absent: mark.absent },
          ]),
        )}
        locked={locked}
        lockedReason={
          !openness.allowed
            ? m.marksLocked
            : !mine
              ? m.attendanceNotYours
              : null
        }
      />

      {/* --------------------------------------------- the change log */}

      <Section className="mt-8" title={m.marksChangeLog} language={language}>
        {changes.length === 0 ? (
          <EmptyState title={m.marksChangeNone} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {changes.map((change) => {
              const student = roll.find(
                (entry) => entry.studentId === change.studentId,
              );

              const before = change.fromAbsent
                ? primary(m.marksAbsent, language)
                : change.fromValue === null
                  ? primary(m.marksNotEntered, language)
                  : String(change.fromValue);

              const after = change.toAbsent
                ? primary(m.marksAbsent, language)
                : change.toValue === null
                  ? primary(m.marksNotEntered, language)
                  : String(change.toValue);

              return (
                <li key={change.id}>
                  <Card className="p-3">
                    <p className="truncate text-[14px] font-medium text-foreground">
                      {student?.fullName ?? "—"}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px]">
                      <span className="text-muted-foreground line-through">
                        {before}
                      </span>
                      <span aria-hidden className="text-subtle-foreground">
                        →
                      </span>
                      <span className="font-semibold text-foreground">{after}</span>
                    </p>
                    <p className="mt-1 text-[12px] text-subtle-foreground">
                      {change.changedByName ?? "—"} ·{" "}
                      {primary(dayLabel(change.changedAt.slice(0, 10)), language)}
                    </p>
                    {change.reason ? (
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {change.reason}
                      </p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

const BACK = { href: "/assessments", label: m.assessmentsTitle };

