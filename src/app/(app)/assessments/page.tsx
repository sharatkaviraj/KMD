import Link from "@/ui/link";

import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listAssessments } from "@/modules/assessments/data/assessments-repo";
import {
  assessmentKindLabels,
  assessmentStatusLabels,
  orderTerms,
} from "@/modules/assessments/domain/assessments";
import { AssessmentForm } from "@/modules/assessments/ui/assessment-forms";
import { Panel, PanelRow } from "@/ui/panel";
import { Badge, Card, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.assessmentsTitle) };
}

const STATUS_TONE = {
  draft: "neutral",
  open: "success",
  locked: "warning",
} as const;

/**
 * Every exam this session, grouped by term.
 *
 * The exam is the thing marks hang off, and its three states are the whole of
 * the workflow: a draft nobody can enter against, an open exam being marked,
 * and a locked one whose report cards have gone out.
 */
export default async function AssessmentsPage() {
  const staff = await requirePermission("assessments:view", "/assessments");
  const language = staff.language;
  const mayManage = can(staff, "assessments:manage");
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={m.assessmentsTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const assessments = await listAssessments(sessionLabel);
  const terms = orderTerms(assessments.map((entry) => entry.term));

  return (
    <>
      <PageHeader eyebrow={m.eyebrowExams}
        title={m.assessmentsTitle}
        description={m.assessmentsIntro}
        language={language}
        action={
          can(staff, "reports:view") ? (
            <Link
              href="/assessments/exports"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.exportsTitle, language)}
            </Link>
          ) : null
        }
      />

      {assessments.length === 0 ? (
        <EmptyState title={m.assessmentsNone} language={language} />
      ) : (
        <div className="space-y-5">
          {terms.map((term) => (
            <Panel key={term} title={{ hi: term, en: term }} language={language}>
              {assessments
                .filter((entry) => entry.term === term)
                .map((assessment) => (
                  <PanelRow
                    key={assessment.id}
                    href={`/assessments/${assessment.id}`}
                    title={
                      <>
                        {language === "en" ? assessment.labelEn : assessment.labelHi}
                        <span className="ml-2 font-mono text-[12px] font-normal text-subtle-foreground">
                          {assessment.code}
                        </span>
                      </>
                    }
                    detail={[
                      primary(assessmentKindLabels[assessment.kind], language),
                      assessment.startsOn
                        ? primary(dayLabel(assessment.startsOn), language)
                        : null,
                      `${primary(m.assessmentWeight, language)} ${assessment.weight}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    trailing={
                      <Badge tone={STATUS_TONE[assessment.status]}>
                        {primary(assessmentStatusLabels[assessment.status], language)}
                      </Badge>
                    }
                  />
                ))}
            </Panel>
          ))}
        </div>
      )}

      {mayManage ? (
        <Section className="mt-8" title={m.assessmentNew} language={language}>
          <Card className="p-4">
            <AssessmentForm />
          </Card>
        </Section>
      ) : null}
    </>
  );
}
