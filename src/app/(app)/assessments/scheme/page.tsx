import Link from "next/link";

import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listAssessments } from "@/modules/assessments/data/assessments-repo";
import { approvedScheme, schemesFor } from "@/modules/assessments/data/reports-repo";
import { currentTerm, termsByDate } from "@/modules/assessments/domain/assessments";
import { schoolToday } from "@/platform/dates";
import { plannedExams } from "@/vx/screens/exams/domain/current";
import {
  bandsToText,
  DEFAULT_GRADE_BANDS,
  signatoriesToText,
  type ReportScheme,
} from "@/modules/assessments/domain/report-scheme";
import { ApproveSchemeForm, ReportSchemeForm } from "@/modules/assessments/ui/report-scheme-forms";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(ms.schemeTitle) };
}

/**
 * A term's report scheme (P8): the grade bands, the rounding, the attendance
 * period, the header and the signature lines a card is worked out by.
 *
 * Read by anybody who reads reports; written by the exam office. One revision
 * may be a draft; an approved revision never changes, and a change after
 * approval is the next revision — so a card issued last month still says
 * exactly what it said.
 */
export default async function ReportSchemePage(props: PageProps<"/assessments/scheme">) {
  const staff = await requirePermission("reports:view", "/assessments");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={ms.schemeTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const params = await props.searchParams;
  const assessments = await listAssessments(sessionLabel);
  // Terms in the order they are sat, never by label (rule 3a), and only planned (dated) ones:
  // "phoneops-…" sorted above "Term 1" and the page opened on it (smoke 20 Oct).
  const planned = plannedExams(assessments);
  const terms = termsByDate(planned);
  const requested = typeof params.term === "string" ? params.term : null;
  const allTerms = new Set(assessments.map((entry) => entry.term));
  const term = requested && allTerms.has(requested) ? requested : (currentTerm(planned, schoolToday()) ?? terms[0]);
  // How much each exam of the term counts towards the card's percentage (`assessments.weight`).
  const examsOfTerm = assessments.filter((entry) => entry.term === term && entry.status !== "draft");

  if (!term) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={ms.schemeTitle} language={language} back={BACK} />
        <EmptyState title={m.assessmentsNone} language={language} />
      </>
    );
  }

  const schemes = await schemesFor(sessionLabel, term);
  const approved = approvedScheme(schemes);
  const draft = schemes.find((scheme) => scheme.status === "draft") ?? null;
  const base: ReportScheme | null = draft ?? approved;
  const manages = can(staff, "assessments:manage");

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowExams}
        title={ms.schemeTitle}
        description={{ hi: `${term} · ${sessionLabel}`, en: `${term} · ${sessionLabel}` }}
        language={language}
        back={BACK}
      />

      {terms.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          {terms.map((entry) => (
            <Link
              key={entry}
              href={`/assessments/scheme?term=${encodeURIComponent(entry)}`}
              className={buttonClasses({ variant: entry === term ? "primary" : "outline", size: "sm" })}
            >
              {entry}
            </Link>
          ))}
        </div>
      ) : null}

      <Notice className="mb-5" tone="info" text={ms.schemeIntro} language={language} />

      {approved ? (
        <Section title={ms.schemeApprovedBy} language={language}>
          <Card className="p-4" data-scheme-approved={approved.revision}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">
                {primary(ms.reportRevision, language)} {approved.revision}
              </Badge>
              <span className="text-[13px] text-muted-foreground">
                {approved.approvedAt ? primary(dayLabel(approved.approvedAt.slice(0, 10)), language) : ""}
                {approved.approvedByName ? ` · ${approved.approvedByName}` : ""}
              </span>
            </div>
            <table className="mt-3 w-full text-[13px]">
              <tbody>
                {approved.gradeBands.map((band) => (
                  <tr key={band.label} className="border-t border-border">
                    <td className="py-1 pr-3 tabular-nums">{band.from}%+</td>
                    <td className="py-1 pr-3 font-semibold">{band.label}</td>
                    <td className="py-1 text-muted-foreground">{language === "hi" ? band.hi : band.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {primary(ms.schemeDecimals, language)}: {approved.percentDecimals}
              {approved.passPercent !== null ? ` · ${primary(ms.schemePass, language)}: ${approved.passPercent}%` : ""}
              {approved.attendanceFrom || approved.attendanceTo
                ? ` · ${approved.attendanceFrom ?? "…"} → ${approved.attendanceTo ?? "…"}`
                : ""}
            </p>
            {examsOfTerm.length ? (
              <p className="mt-1 text-[12px] text-muted-foreground" data-scheme-weights>
                {primary(ms.schemeExamWeights, language)}:{" "}
                {examsOfTerm.map((entry) => `${language === "hi" ? entry.labelHi : entry.labelEn} ×${entry.weight}`).join(", ")}
              </p>
            ) : null}
            <p className="mt-1 text-[12px] text-muted-foreground">{primary(ms.schemePassRule, language)}</p>
          </Card>
        </Section>
      ) : (
        <EmptyState title={ms.schemeNone} language={language} />
      )}

      {manages ? (
        <Section className="mt-6" title={ms.schemeDraftStatus} language={language}>
          <Card className="space-y-6 p-4">
            <ReportSchemeForm
              key={`${term}/${draft?.id ?? "new"}`}
              term={term}
              initial={{
                bandsText: bandsToText(base?.gradeBands ?? DEFAULT_GRADE_BANDS),
                percentDecimals: base?.percentDecimals ?? 1,
                passPercent: base?.passPercent ?? null,
                attendanceFrom: base?.attendanceFrom ?? null,
                attendanceTo: base?.attendanceTo ?? null,
                headerEn: base?.headerEn ?? "",
                headerHi: base?.headerHi ?? "",
                signatoriesText: signatoriesToText(base?.signatories ?? []),
              }}
            />
            {draft ? <ApproveSchemeForm term={term} /> : null}
          </Card>
        </Section>
      ) : null}
    </>
  );
}

const BACK = { href: "/assessments", label: m.assessmentsTitle };
