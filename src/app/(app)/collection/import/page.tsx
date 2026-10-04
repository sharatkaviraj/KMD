import Link from "next/link";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel, toSchoolDay } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { importBatch, recentBatches } from "@/modules/collection/data/sampark-import-repo";
import { ambiguityLabels, matchedOnLabels } from "@/modules/collection/domain/sampark-import";
import { SamparkApplyForm, SamparkResolveForm, SamparkUploadForm } from "@/modules/collection/ui/sampark-import-forms";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(ms.importTitle) };
}

type Props = { searchParams: Promise<{ batch?: string }> };

/**
 * Bringing SamPark's records in (P10b, D-235).
 *
 * Upload the workbook SamPark exports; each row is matched to a child by ids
 * alone and staged. Applying the matched rows offers their values to the one
 * writer as an import, where anything a person recorded is kept. The rows no
 * id could settle are the queue, and stay there until somebody decides.
 */
export default async function SamparkImportPage({ searchParams }: Props) {
  const staff = await requirePermission("collection:manage", "/collection/import");
  const language = staff.language;
  const { batch: batchId } = await searchParams;

  const [batch, recent] = await Promise.all([
    batchId && /^[0-9a-f-]{36}$/i.test(batchId) ? importBatch(batchId) : Promise.resolve(null),
    recentBatches(),
  ]);

  const toApply = batch?.rows.filter((row) => (row.resolution === "matched" || row.resolution === "resolved") && !row.appliedAt) ?? [];
  const queue = batch?.rows.filter((row) => row.resolution === "ambiguous" || row.resolution === "unmatched") ?? [];
  const applied = batch?.rows.filter((row) => row.appliedAt) ?? [];
  const dismissed = batch?.rows.filter((row) => row.resolution === "dismissed") ?? [];
  const problems = batch?.rows.filter((row) => row.problems.length > 0) ?? [];

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowSampark}
        title={ms.importTitle}
        language={language}
        back={{ href: "/collection", label: m.eyebrowSampark }}
      />

      <Notice className="mb-5" tone="info" text={ms.importIntro} language={language} />

      <Card className="mb-6 p-4">
        <SamparkUploadForm />
      </Card>

      {batch ? (
        <div data-sampark-batch={batch.id}>
          <Section title={{ hi: batch.fileName, en: batch.fileName }} language={language}>
            <Card className="space-y-3 p-4 text-[13px]">
              <div className="flex flex-wrap gap-2" data-sampark-counts>
                <Badge tone="success">
                  {primary(ms.importMatched, language)} {toApply.length + applied.length}
                </Badge>
                <Badge tone={queue.length > 0 ? "warning" : "neutral"}>
                  {primary(ms.importQueue, language)} {queue.length}
                </Badge>
                <Badge tone="neutral">
                  {primary(ms.importApplied, language)} {applied.length}
                </Badge>
                {dismissed.length > 0 ? (
                  <Badge tone="neutral">
                    {primary(ms.importDismissedTitle, language)} {dismissed.length}
                  </Badge>
                ) : null}
              </div>
              <p>
                <span className="font-semibold">{primary(ms.importColumnsRead, language)}:</span>{" "}
                {batch.mappedFields.length > 0 ? batch.mappedFields.join(", ") : "—"}
              </p>
              <p className="text-muted-foreground">
                <span className="font-semibold">{primary(ms.importColumnsIgnored, language)}:</span>{" "}
                {batch.ignoredHeaders.length > 0 ? batch.ignoredHeaders.join(", ") : "—"}
              </p>
              {toApply.length > 0 ? (
                <SamparkApplyForm batchId={batch.id} count={toApply.length} />
              ) : (
                <p className="text-muted-foreground">{primary(ms.importNothingToApply, language)}</p>
              )}
            </Card>
          </Section>

          {queue.length > 0 ? (
            <Section className="mt-6" title={ms.importQueue} description={ms.importQueueHint} language={language}>
              <ul className="space-y-3" data-sampark-queue>
                {queue.map((row) => (
                  <li key={row.rowNo}>
                    <Card className="space-y-2 p-4 text-[13px]" data-row={row.rowNo}>
                      <p className="font-semibold text-foreground">
                        {primary(ms.importRowLabel, language)} {row.rowNo} · {row.presented.name ?? "—"}
                      </p>
                      <p className="text-muted-foreground">
                        SamPark {row.externalId ?? "—"} · SR {row.presented.sr ?? "—"} · {row.presented.class ?? "—"}
                      </p>
                      {row.why && row.why in ambiguityLabels ? (
                        <Badge tone="warning">{primary(ambiguityLabels[row.why as keyof typeof ambiguityLabels], language)}</Badge>
                      ) : null}
                      <SamparkResolveForm batchId={batch.id} rowNo={row.rowNo} candidates={row.candidates} />
                    </Card>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {problems.length > 0 ? (
            <Section className="mt-6" title={ms.importProblems} language={language}>
              <ul className="space-y-1 text-[13px]" data-sampark-problems>
                {problems.map((row) => (
                  <li key={row.rowNo}>
                    {primary(ms.importRowLabel, language)} {row.rowNo}:{" "}
                    {row.problems.map((problem) => `${problem.field} “${problem.value}”`).join(", ")}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {applied.length > 0 ? (
            <Section className="mt-6" title={ms.importApplied} language={language}>
              <details>
                <summary className="cursor-pointer text-[13px] font-semibold">
                  {primary(ms.importApplied, language)} ({applied.length})
                </summary>
                <ul className="mt-2 space-y-1 text-[13px]" data-sampark-applied>
                  {applied.map((row) => (
                    <li key={row.rowNo}>
                      {primary(ms.importRowLabel, language)} {row.rowNo} · {row.presented.name ?? "—"} ·{" "}
                      {row.matchedOn ? primary(matchedOnLabels[row.matchedOn], language) : "—"}
                      {row.outcome ? ` · +${row.outcome.written} / =${row.outcome.unchanged} / ⨯${row.outcome.kept_person + row.outcome.kept_other_import}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            </Section>
          ) : null}
        </div>
      ) : null}

      <Section className="mt-8" title={ms.importRecent} language={language}>
        {recent.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{primary(ms.importNoneYet, language)}</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Link className="underline" href={`/collection/import?batch=${entry.id}`}>
                  {entry.fileName}
                </Link>{" "}
                · {entry.rowCount} · {primary(dayLabel(toSchoolDay(new Date(entry.uploadedAt))), language)}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
