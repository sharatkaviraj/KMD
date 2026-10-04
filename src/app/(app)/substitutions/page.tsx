import Link from "next/link";
import { Pin, PinOff, X } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { addDays, dayLabel, isIsoDay, schoolToday, weekdayLabel } from "@/platform/dates";
import { flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { buildPlanningContext } from "@/modules/substitutions/data/planning-context";
import { getPlan, planAssignments } from "@/modules/substitutions/data/plans-repo";
import {
  planIsStale,
  rankCandidates,
  type Candidate,
} from "@/modules/substitutions/domain/engine";
import {
  blockLabels,
  tierLabels,
  warningLabels,
} from "@/modules/substitutions/domain/labels";
import {
  describePeriods,
  hostsInPeriod,
  planCounts,
} from "@/modules/substitutions/domain/plan";
import { AbsenceForm } from "@/modules/substitutions/ui/absence-form";
import {
  CoverChoice,
  GeneratePlanButton,
  type CoverOption,
} from "@/modules/substitutions/ui/plan-controls";
import {
  clearAbsenceAction,
  publishPlanAction,
  removeCoverAction,
  togglePinAction,
  unpublishPlanAction,
} from "@/app/(app)/substitutions/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subsTitle) };
}

/**
 * The cover planner.
 *
 * One day at a time, in the order a coordinator actually works: who is away,
 * then what that leaves uncovered, then the allocation, then publish. The
 * engine's answer is a proposal on every row — the name it would choose is
 * selected, the names it refused are still in the list with the reason on
 * them, and nothing reaches a teacher until somebody presses publish.
 *
 * Hiding the refused names would make the staff room look smaller than it is,
 * which is the moment a coordinator stops trusting the screen and goes back to
 * the paper chart.
 */
export default async function SubstitutionsPage(
  props: PageProps<"/substitutions">,
) {
  const staff = await requirePermission("substitutions:view", "/substitutions");
  const language = staff.language;
  const mayManage = can(staff, "substitutions:manage");
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowCover} title={m.subsTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const params = await props.searchParams;
  const requestedDay = typeof params.day === "string" ? params.day : null;
  const day = requestedDay && isIsoDay(requestedDay) ? requestedDay : schoolToday();

  const context = await buildPlanningContext(sessionLabel, day);

  const dayText = t(
    `${weekdayLabel(day).hi}, ${dayLabel(day).hi}`,
    `${weekdayLabel(day).en}, ${dayLabel(day).en}`,
  );

  const header = (
    <PageHeader eyebrow={m.eyebrowCover}
      title={m.subsTitle}
      description={dayText}
      language={language}
      action={
        mayManage ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/substitutions/rules"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.subsRulesTitle, language)}
            </Link>
            <Link
              href="/substitutions/policies"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.subsPoliciesTitle, language)}
            </Link>
          </div>
        ) : null
      }
    />
  );

  const dayNav = (
    <div className="mb-5 flex items-center gap-2">
      <Link
        href={`/substitutions?day=${addDays(day, -1)}`}
        className={buttonClasses({ variant: "outline", size: "sm" })}
      >
        ← {primary(dayLabel(addDays(day, -1)), language)}
      </Link>
      <Link
        href={`/substitutions?day=${addDays(day, 1)}`}
        className={buttonClasses({ variant: "outline", size: "sm" })}
      >
        {primary(dayLabel(addDays(day, 1)), language)} →
      </Link>
    </div>
  );

  if (!context) {
    return (
      <>
        {header}
        {dayNav}
        <Notice tone="warning" text={m.subsNoTimetable} language={language} />
      </>
    );
  }

  const plan = await getPlan(sessionLabel, day);
  const rows = plan ? await planAssignments(plan.id) : [];
  const counts = planCounts(rows, context.vacancies.length);
  const stale = planIsStale(plan, context.versionId);

  /*
   * The options on every row, ranked by the same engine that made the
   * proposal. Computed here rather than in the client so the reasons — "away
   * this period", "already covering another class" — arrive with the names
   * rather than after a round trip.
   */
  const covered = new Map(
    rows
      .filter((row) => row.coveringStaffId)
      .map((row) => [`${row.classId}|${row.period}`, row.coveringStaffId!]),
  );

  const nameById = new Map(context.staff.map((person) => [person.id, person.displayName]));

  const optionsFor = (row: (typeof rows)[number]): CoverOption[] => {
    if (!context.header) return [];

    const ranked = rankCandidates({
      day: context.header,
      teacherProfiles: context.teacherProfiles,
      absenceIndex: context.absenceIndex,
      coverHistory: context.coverHistory,
      assignments: rows
        .filter((other) => other.coveringStaffId && other.id !== row.id)
        .map((other) => ({
          slotId: `${other.classId}|${other.period}`,
          teacher: other.coveringStaffId!,
          periodIndex: other.period,
        })),
      vacancy: {
        slotId: `${row.classId}|${row.period}`,
        periodIndex: row.period,
        className: row.classLabel,
        subject: row.subjectCode ?? "",
      },
    });

    const describe = (candidate: Candidate) => {
      if (candidate.blocked.length > 0) {
        return primary(
          blockLabels[candidate.blocked[0]] ?? { hi: "", en: candidate.blocked[0] },
          language,
        );
      }
      const tier = primary(tierLabels[candidate.matchTier], language);
      const warning = candidate.warnings[0]
        ? primary(
            warningLabels[candidate.warnings[0]] ?? {
              hi: "",
              en: candidate.warnings[0],
            },
            language,
          )
        : "";
      return warning ? `${tier} · ${warning}` : tier;
    };

    const teachers: CoverOption[] = ranked.map((candidate) => ({
      kind: "teacher" as const,
      id: candidate.teacher,
      label: nameById.get(candidate.teacher) ?? candidate.teacher,
      detail: describe(candidate),
    }));

    const hosts = hostsInPeriod(
      context.slots,
      context.header,
      row.period,
      context.absenceIndex,
      covered,
    )
      .filter((host) => host.classId !== row.classId && host.teacher)
      .map((host) => ({
        kind: "merge" as const,
        id: host.classId,
        label: host.className,
        detail: "",
      }));

    return [...teachers, ...hosts];
  };

  const currentChoice = (row: (typeof rows)[number]) =>
    row.kind === "cover" && row.coveringStaffId
      ? row.coveringStaffId
      : row.kind === "merged" && row.mergeHostClassId
        ? `merge:${row.mergeHostClassId}:${row.mergeHostClassLabel ?? ""}`
        : "self_study";

  const byPeriod = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = byPeriod.get(row.period) ?? [];
    list.push(row);
    byPeriod.set(row.period, list);
  }

  return (
    <>
      {header}
      {dayNav}

      {stale ? (
        <Notice className="mb-4" tone="warning" text={m.subsStale} language={language} />
      ) : null}

      {/* ------------------------------------------------- who is away */}

      <Section title={m.subsAbsentToday} language={language}>
        {context.absences.length === 0 ? (
          <EmptyState title={m.subsNobodyAway} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {context.absences.map((absence) => (
              <li
                key={absence.id}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">
                    {absence.staffName}
                  </span>
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {describePeriods(absence.periods)}
                    {absence.reason ? ` · ${absence.reason}` : ""}
                  </span>
                </span>
                {mayManage ? (
                  <form action={clearAbsenceAction}>
                    <input type="hidden" name="id" value={absence.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      aria-label={flat(m.subsRemoveAbsence, language)}
                    >
                      <X aria-hidden />
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {mayManage ? (
        <Card className="mt-4 p-4">
          <AbsenceForm day={day} staff={context.staff} />
        </Card>
      ) : null}

      {/* ---------------------------------------------------- the plan */}

      <Section className="mt-8" title={m.subsPlanSummary} language={language}>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">
            {counts.vacancies} {primary(m.teachPeriodsToday, language)}
          </Badge>
          {counts.covered > 0 ? (
            <Badge tone="success">
              {primary(m.subsCovered, language)} {counts.covered}
            </Badge>
          ) : null}
          {counts.needsReview > 0 ? (
            <Badge tone="warning">
              {primary(m.subsNeedsReview, language)} {counts.needsReview}
            </Badge>
          ) : null}
          {counts.merged > 0 ? (
            <Badge tone="accent">
              {primary(m.subsMerged, language)} {counts.merged}
            </Badge>
          ) : null}
          {counts.selfStudy > 0 ? (
            <Badge tone="danger">
              {primary(m.subsSelfStudy, language)} {counts.selfStudy}
            </Badge>
          ) : null}
          <Badge tone={plan?.status === "published" ? "success" : "neutral"}>
            {primary(
              plan?.status === "published" ? m.subsPublished : m.subsDraft,
              language,
            )}
          </Badge>
        </div>

        {mayManage ? (
          <div className="mt-4">
            <GeneratePlanButton day={day} again={rows.length > 0} />
          </div>
        ) : null}
      </Section>

      {context.vacancies.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={m.subsNoVacancies}
          language={language}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-6"
          title={m.subsGenerate}
          detail={m.subsPinKeeps}
          language={language}
        />
      ) : (
        <div className="mt-6 space-y-6">
          {[...byPeriod.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([period, list]) => (
              <section key={period}>
                <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground">
                  {primary(m.teachPeriod, language)} {periodNumber(period)}
                </h3>
                <ul className="space-y-2">
                  {list.map((row) => (
                    <li key={row.id}>
                      <Card className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-semibold text-foreground">
                              {row.classLabel}
                              {row.subjectCode ? (
                                <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                                  {row.subjectCode}
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-[12px] text-subtle-foreground">
                              {primary(m.subsOriginal, language)}:{" "}
                              {row.originalStaffName ?? "—"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {row.pinned ? (
                              <Badge tone="accent">
                                <Pin aria-hidden className="size-3" />
                                {primary(m.subsPinned, language)}
                              </Badge>
                            ) : null}
                            {row.source === "suggestion" ? (
                              <Badge tone="warning">
                                {primary(m.subsNeedsReview, language)}
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        <p className="mt-2 text-[15px]">
                          {row.kind === "cover" ? (
                            <span className="font-semibold text-foreground">
                              {row.coveringStaffName ?? "—"}
                            </span>
                          ) : row.kind === "merged" ? (
                            <span className="font-medium text-accent-soft-foreground">
                              {primary(m.subsMerged, language)} ·{" "}
                              {row.mergeHostClassLabel ?? "—"}
                            </span>
                          ) : (
                            <span className="font-medium text-destructive-soft-foreground">
                              {primary(m.subsSelfStudy, language)}
                            </span>
                          )}
                        </p>

                        {row.matchTier ? (
                          <p className="mt-1 text-[12px] text-subtle-foreground">
                            {primary(tierLabels[row.matchTier], language)}
                            {row.warnings.length > 0
                              ? ` · ${row.warnings
                                  .map((warning) =>
                                    primary(
                                      warningLabels[warning] ?? {
                                        hi: "",
                                        en: warning,
                                      },
                                      language,
                                    ),
                                  )
                                  .join(" · ")}`
                              : ""}
                          </p>
                        ) : null}

                        {mayManage ? (
                          <>
                            <CoverChoice
                              day={day}
                              period={row.period}
                              classId={row.classId}
                              classLabel={row.classLabel}
                              subjectCode={row.subjectCode}
                              originalStaffId={row.originalStaffId}
                              current={currentChoice(row)}
                              options={optionsFor(row)}
                            />

                            <div className="mt-2 flex gap-2">
                              <form action={togglePinAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <input
                                  type="hidden"
                                  name="pinned"
                                  value={row.pinned ? "false" : "true"}
                                />
                                <Button type="submit" variant="ghost" size="sm">
                                  {row.pinned ? (
                                    <PinOff aria-hidden />
                                  ) : (
                                    <Pin aria-hidden />
                                  )}
                                  {primary(
                                    row.pinned ? m.subsUnpin : m.subsPin,
                                    language,
                                  )}
                                </Button>
                              </form>
                              <form action={removeCoverAction}>
                                <input type="hidden" name="id" value={row.id} />
                                <Button type="submit" variant="ghost" size="sm">
                                  {primary(m.remove, language)}
                                </Button>
                              </form>
                            </div>
                          </>
                        ) : null}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      {/* ------------------------------------------------- publishing */}

      {mayManage && plan && rows.length > 0 ? (
        <Card className="mt-8 p-4">
          {plan.status === "published" ? (
            <>
              <p className="mb-3 text-[13px] text-muted-foreground">
                {primary(m.subsPublished, language)}
                {plan.publishedByName ? ` · ${plan.publishedByName}` : ""}
              </p>
              <form action={unpublishPlanAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <Button type="submit" variant="outline" fullWidth>
                  {primary(m.subsUnpublish, language)}
                </Button>
              </form>
            </>
          ) : (
            <>
              <Notice
                className="mb-3"
                tone="neutral"
                text={m.subsNotPublished}
                language={language}
              />
              <form action={publishPlanAction}>
                <input type="hidden" name="planId" value={plan.id} />
                <Button type="submit" fullWidth size="lg">
                  {primary(m.subsPublish, language)}
                </Button>
              </form>
            </>
          )}
        </Card>
      ) : null}
    </>
  );
}
