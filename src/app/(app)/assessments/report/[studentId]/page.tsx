import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel } from "@/platform/dates";
import { getSchoolName } from "@/platform/env";
import { countOf, flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listAssessments } from "@/modules/assessments/data/assessments-repo";
import {
  issuedReportCard,
  previewReportCard,
} from "@/modules/assessments/data/reports-repo";
import { orderTerms } from "@/modules/assessments/domain/assessments";
import { readiness } from "@/modules/assessments/domain/report-card";
import { IssueReportForm } from "@/modules/assessments/ui/assessment-forms";
import { PrintButton } from "@/modules/attendance/ui/print-button";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";
import Link from "next/link";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.reportTitle) };
}

/**
 * One child's report card.
 *
 * Two of them, really. The **preview** is built from today's marks and moves as
 * they arrive; the **issued** card is what the school handed the family, frozen
 * the moment somebody pressed the button. The screen says which it is showing,
 * because on a document a family is holding the difference is the whole point:
 * a mark corrected next week must not silently rewrite last week's card.
 *
 * It prints rather than rendering a PDF server-side, for the same reasons as
 * the monthly attendance register (D-55): the browser already owns the paper
 * size, the margins and the Devanagari fonts.
 */
export default async function ReportCardPage(
  props: PageProps<"/assessments/report/[studentId]">,
) {
  const staff = await requirePermission(
    "reports:view",
    "/assessments",
  );
  const language = staff.language;
  const { studentId } = await props.params;
  const params = await props.searchParams;

  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={m.reportTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const assessments = await listAssessments(sessionLabel);
  const terms = orderTerms(assessments.map((entry) => entry.term));

  const requested = typeof params.term === "string" ? params.term : null;
  const term = requested && terms.includes(requested) ? requested : terms[0];

  if (!term) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={m.reportTitle} language={language} back={BACK} />
        <EmptyState title={m.assessmentsNone} language={language} />
      </>
    );
  }

  const [preview, issued] = await Promise.all([
    previewReportCard({ studentId, sessionLabel, term }),
    issuedReportCard({ studentId, sessionLabel, term }),
  ]);

  if (!preview) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={m.reportTitle} language={language} back={BACK} />
        <EmptyState title={m.notFound} language={language} />
      </>
    );
  }

  // The issued card wins when there is one: it is what the family is holding,
  // and showing today's numbers under the same heading would be a quiet lie.
  const card = issued?.card ?? preview;
  const ready = readiness(preview);

  return (
    <>
      <div className="print:hidden">
        <PageHeader eyebrow={m.eyebrowExams}
          title={t(card.studentName, card.studentName)}
          description={t(
            `${m.reportTitle.hi} · ${term}`,
            `${m.reportTitle.en} · ${term}`,
          )}
          language={language}
          back={BACK}
          action={<PrintButton />}
        />

        {terms.length > 1 ? (
          <div className="mb-5 flex flex-wrap gap-2">
            {terms.map((entry) => (
              <Link
                key={entry}
                href={`/assessments/report/${studentId}?term=${encodeURIComponent(entry)}`}
                className={buttonClasses({
                  variant: entry === term ? "primary" : "outline",
                  size: "sm",
                })}
              >
                {entry}
              </Link>
            ))}
          </div>
        ) : null}

        {issued ? (
          <Notice
            className="mb-4"
            tone="success"
            text={m.reportFrozenHint}
            language={language}
          >
            <span className="text-[13px]">
              {primary(m.reportIssuedOn, language)}{" "}
              {primary(dayLabel(issued.generatedAt.slice(0, 10)), language)}
              {issued.generatedByName ? ` · ${issued.generatedByName}` : ""}
            </span>
          </Notice>
        ) : (
          <Notice
            className="mb-4"
            tone="neutral"
            text={m.reportPreviewHint}
            language={language}
          />
        )}

        {!ready.ready ? (
          <Notice
            className="mb-4"
            tone="warning"
            text={ready.note}
            language={language}
          >
            {ready.subjects.length > 0 ? (
              <span className="text-[13px]">{ready.subjects.join(" · ")}</span>
            ) : null}
          </Notice>
        ) : null}
      </div>

      {/* ------------------------------------------------- the card */}

      <article className="rounded-2xl border border-border bg-surface p-5 print:rounded-none print:border-0 print:p-0">
        <header className="mb-4 text-center">
          <h1 className="text-[18px] font-bold text-foreground">
            {getSchoolName()}
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {flat(m.reportTitle, language)} · {term} · {card.sessionLabel}
          </p>
        </header>

        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">
              {primary(m.name, language)}
            </dt>
            <dd className="font-medium text-foreground">{card.studentName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">
              {primary(m.teachClassTitle, language)}
            </dt>
            <dd className="font-medium text-foreground">{card.classLabel || "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">
              {primary(m.studentRollNo, language)}
            </dt>
            <dd className="font-medium text-foreground">{card.rollNo ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">
              {primary(m.studentFather, language)}
            </dt>
            <dd className="font-medium text-foreground">{card.fatherName ?? "—"}</dd>
          </div>
        </dl>

        {card.rows.length === 0 ? (
          <EmptyState title={m.progressNoMarks} language={language} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border border-border bg-surface-2 px-2 py-1.5 text-left font-semibold"
                >
                  {primary(m.reportSubject, language)}
                </th>
                {card.rows[0].marks.map((mark) => (
                  <th
                    key={mark.assessmentCode}
                    scope="col"
                    className="border border-border bg-surface-2 px-2 py-1.5 text-center font-semibold"
                  >
                    {mark.assessmentCode}
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {primary(m.reportOutOf, language)} {mark.maxMarks}
                    </span>
                  </th>
                ))}
                <th
                  scope="col"
                  className="border border-border bg-surface-2 px-2 py-1.5 text-center font-semibold"
                >
                  {primary(m.progressTotal, language)}
                </th>
                <th
                  scope="col"
                  className="border border-border bg-surface-2 px-2 py-1.5 text-center font-semibold"
                >
                  %
                </th>
                <th
                  scope="col"
                  className="border border-border bg-surface-2 px-2 py-1.5 text-center font-semibold"
                >
                  {primary(m.progressGrade, language)}
                </th>
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row) => (
                <tr key={row.subjectCode}>
                  <th
                    scope="row"
                    className="border border-border px-2 py-1 text-left font-medium"
                  >
                    {row.subjectCode}
                  </th>
                  {row.marks.map((mark) => (
                    <td
                      key={`${row.subjectCode}-${mark.assessmentCode}`}
                      className="border border-border px-2 py-1 text-center tabular-nums"
                    >
                      {/* Three states, kept apart on the page a family reads:
                          a mark, an absence, and a paper nobody has marked. */}
                      {mark.absent
                        ? primary(m.marksAbsent, language)
                        : mark.value === null
                          ? "—"
                          : mark.value}
                    </td>
                  ))}
                  <td className="border border-border px-2 py-1 text-center tabular-nums">
                    {row.scored} / {row.outOf}
                  </td>
                  <td className="border border-border px-2 py-1 text-center tabular-nums">
                    {row.percent === null ? "—" : row.percent}
                  </td>
                  <td className="border border-border px-2 py-1 text-center font-semibold">
                    {row.grade ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone="neutral">
            {primary(m.progressTotal, language)} {card.totals.scored} /{" "}
            {card.totals.outOf}
          </Badge>
          <Badge tone={(card.totals.percent ?? 0) >= 33 ? "success" : "warning"}>
            {card.totals.percent === null ? "—" : `${card.totals.percent}%`}
          </Badge>
          {card.grade ? (
            <Badge tone="accent">
              {primary(m.progressGrade, language)} {card.grade}
            </Badge>
          ) : null}
          {card.totals.missing > 0 ? (
            <Badge tone="warning">
              {card.totals.missing} {primary(m.progressMissing, language)}
            </Badge>
          ) : null}
          {card.attendance ? (
            <Badge tone="neutral">
              {primary(m.reportAttendance, language)}{" "}
              {countOf(card.attendance.present, card.attendance.counted, language)}
            </Badge>
          ) : null}
        </div>

        {card.totals.weighted ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {primary(m.reportWeighted, language)}
          </p>
        ) : null}

        {card.gradeDescription ? (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {primary(card.gradeDescription, language)}
          </p>
        ) : null}
      </article>

      <div className="print:hidden">
        <Notice
          className="mt-4"
          tone="neutral"
          text={m.reportGradeDefault}
          language={language}
        />

        <Section className="mt-6" title={m.reportIssue} language={language}>
          <Card className="p-4">
            <IssueReportForm
              studentId={studentId}
              term={term}
              alreadyIssued={Boolean(issued)}
            />
          </Card>
        </Section>
      </div>
    </>
  );
}

const BACK = { href: "/assessments", label: m.assessmentsTitle };
