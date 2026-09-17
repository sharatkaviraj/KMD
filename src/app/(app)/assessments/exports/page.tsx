import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { recentExports } from "@/modules/assessments/data/reports-repo";
import { exportKindLabels } from "@/modules/assessments/domain/exports";
import { Card, Notice, Section } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

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
 * own screen — because that is where somebody is when they decide they want
 * it; this screen is the record.
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

  const entries = await recentExports(sessionLabel);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowExams}
        title={m.exportsTitle}
        description={m.exportsIntro}
        language={language}
        back={BACK}
      />

      <Notice
        className="mb-5"
        tone="neutral"
        text={m.exportsIntro}
        language={language}
      />

      <Section title={m.exportsTitle} language={language}>
        {entries.length === 0 ? (
          <EmptyState title={m.exportNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li key={entry.id}>
                <Card className="p-3">
                  <p className="truncate text-[15px] font-medium text-foreground">
                    {primary(exportKindLabels[entry.kind], language)} · {entry.scope}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-subtle-foreground">
                    {entry.rowCount} {primary(m.exportRows, language)} ·{" "}
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
