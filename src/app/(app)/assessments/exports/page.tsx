import Link from "@/ui/link";

import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listAssessments } from "@/modules/assessments/data/assessments-repo";
import { recentExports } from "@/modules/assessments/data/reports-repo";
import { exportKindLabels } from "@/modules/assessments/domain/exports";
import { Card, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.exportsTitle) };
}

/**
 * What has left the building.
 *
 * An export is a copy of the school's records going somewhere this app cannot
 * see. PLAN 6.5 says "logged" and this is the log: who took what, and when.
 * The buttons that produce a file live beside the data they export — an exam's
 * own screen — and this screen points at each of them, so somebody who came
 * here to take marks out is one tap from the button (coordinators B12).
 */
export default async function ExportsPage() {
  const staff = await requirePermission("reports:view", "/assessments/exports");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowExams} title={m.exportsTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [entries, assessments] = await Promise.all([recentExports(sessionLabel), listAssessments(sessionLabel)]);
  // Exams in the order they are sat, undated ones last — never by label (rule 3a).
  const exams = assessments
    .filter((exam) => exam.status !== "draft")
    .sort((a, b) => (a.startsOn ?? "9999-12-31").localeCompare(b.startsOn ?? "9999-12-31"));

  return (
    <>
      <PageHeader eyebrow={m.eyebrowExams}
        title={m.exportsTitle}
        description={m.exportsIntro}
        language={language}
        back={BACK}
      />

      <Section title={ms.exportsTakeTitle} description={ms.exportsTakeIntro} language={language}>
        {exams.length === 0 ? (
          <EmptyState title={ms.exportsNoExams} language={language} />
        ) : (
          <ul className="space-y-2">
            {exams.map((exam) => (
              <li key={exam.id}>
                <Card className="flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">
                    {primary(t(exam.labelHi || exam.labelEn, exam.labelEn), language)} · {exam.term}
                  </span>
                  <Link
                    prefetch={false}
                    href={`/assessments/${exam.id}#marks-export`}
                    className={buttonClasses({ variant: "outline", size: "sm" })}
                  >
                    {primary(ms.exportsDownloadMarks, language)}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section className="mt-7" title={ms.exportsLogTitle} language={language}>
        {entries.length === 0 ? (
          <EmptyState title={m.exportNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="p-3">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {primary(exportKindLabels[entry.kind], language)}
                    {/* A round's scope is its id; an id means nothing to a reader. */}
                    {UUID.test(entry.scope) ? "" : ` · ${entry.scope}`}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-subtle-foreground">
                    {entry.rowCount} {primary(entry.rowCount === 1 ? ms.exportRow : m.exportRows, language)} ·{" "}
                    {primary(m.exportTakenBy, language)}{" "}
                    {entry.exportedByName ?? "—"} ·{" "}
                    {primary(dayLabel(entry.exportedAt.slice(0, 10)), language)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

const BACK = { href: "/assessments", label: m.assessmentsTitle };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
