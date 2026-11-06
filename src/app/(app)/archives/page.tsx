import * as m from "@/messages/pairs";
import { ms } from "@/messages/setup";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel, toSchoolDay } from "@/platform/dates";
import { primary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listArchives } from "@/modules/archives/data/archive-repo";
import { ArchiveActions, BuildArchiveForm } from "@/modules/archives/ui/archive-forms";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";
// Building copies every table and every document and photograph; give it time.
export const maxDuration = 300;

export async function generateMetadata() {
  return { title: await pageTitle(ms.archiveTitle) };
}

const megabytes = (bytes: number | null) => (bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Archives (P11, D-238): copies of every VPPS One table and every document
 * and photograph, each with a manifest of counts and checksums, and the
 * restore drills that prove they come back. An administrator's screen.
 */
export default async function ArchivesPage() {
  const staff = await requirePermission("jobs:run", "/archives");
  const language = staff.language;
  const archives = await listArchives();

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAdministration} title={ms.archiveTitle} language={language} back={{ href: "/jobs", label: m.jobsTitle }} />
      <Notice className="mb-5" tone="info" text={ms.archiveIntro} language={language} />

      <Card className="mb-6 p-4">
        <BuildArchiveForm />
      </Card>

      <Section title={ms.archiveList} language={language}>
        {archives.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{primary(ms.archiveNone, language)}</p>
        ) : (
          <ul className="space-y-3" data-archives>
            {archives.map((archive) => (
              <li key={archive.id}>
                <Card className="space-y-2 p-4 text-[13px]" data-archive={archive.id} data-status={archive.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[15px] font-semibold text-foreground">{archive.label}</p>
                    <div className="flex gap-1.5">
                      <Badge tone={archive.status === "ready" ? "success" : archive.status === "failed" ? "danger" : "neutral"}>
                        {primary(archive.status === "ready" ? ms.archiveReady : archive.status === "failed" ? ms.archiveFailedShort : ms.archiveBuilding, language)}
                      </Badge>
                      {archive.lastDrill ? (
                        <Badge tone={archive.lastDrill.ok ? "success" : "danger"} data-drill={archive.lastDrill.ok ? "passed" : "failed"}>
                          {primary(archive.lastDrill.ok ? ms.drillPassedShort : ms.drillFailedShort, language)}
                        </Badge>
                      ) : (
                        <Badge tone="warning">{primary(ms.drillNever, language)}</Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-muted-foreground">
                    {archive.sessionLabel} · {primary(dayLabel(toSchoolDay(new Date(archive.createdAt))), language)} · {archive.createdByName ?? "—"}
                  </p>
                  {archive.status === "ready" ? (
                    <p data-archive-totals>
                      {archive.tableCount} {primary(ms.archiveTables, language)} · {archive.rowCount} {primary(ms.archiveRows, language)} ·{" "}
                      {archive.objectCount} {primary(ms.archiveObjects, language)} · {megabytes(archive.totalBytes)}
                      {archive.schemaVersion ? ` · schema ${archive.schemaVersion}` : ""}
                      {archive.appCommit ? ` · ${archive.appCommit.slice(0, 7)}` : ""}
                    </p>
                  ) : null}
                  {archive.error ? <p className="text-destructive-soft-foreground">{archive.error}</p> : null}
                  {archive.lastDrill && !archive.lastDrill.ok ? (
                    <p className="text-destructive-soft-foreground">
                      {[
                        ...archive.lastDrill.report.tables.failed.map((entry) => `${entry.name}: ${entry.why}`),
                        ...archive.lastDrill.report.objects.failed.map((entry) => `${entry.path}: ${entry.why}`),
                        archive.lastDrill.report.manifestMatches ? null : "manifest",
                        archive.lastDrill.report.roundTrip === "failed" ? "round trip" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {archive.status === "ready" ? <ArchiveActions archiveId={archive.id} /> : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
