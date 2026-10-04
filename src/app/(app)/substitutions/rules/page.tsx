import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { currentBells, teamRules } from "@/modules/substitutions/data/school-rules-repo";
import {
  eventCounts,
  teachingEventsFor,
  teamBlockSummary,
  type TeachingEvent,
  type TimetableClash,
} from "@/modules/substitutions/domain/events";
import type { PlanSlot } from "@/modules/substitutions/domain/plan";
import { BellsForm, TeamRuleForm } from "@/modules/substitutions/ui/rules-forms";
import { clearTeamRuleAction } from "@/app/(app)/substitutions/rules/actions";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subsRulesTitle) };
}

/**
 * The school rules cover depends on, and the timetable as cover sees it (P2).
 *
 * Bells, so a period that has begun is never arranged; team rules, so a team
 * block is only absorbed when the school has said how many it needs; and the
 * week's lessons rebuilt as physical events — the dry run the plan asks for
 * before any duty depends on them — with any clash the rows imply.
 */
export default async function CoverRulesPage() {
  const staff = await requirePermission("substitutions:manage", "/substitutions/rules");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowCover} title={m.subsRulesTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [bells, rules, published, people] = await Promise.all([
    currentBells(sessionLabel),
    teamRules(sessionLabel),
    getPublishedVersion(sessionLabel),
    listStaff(),
  ]);

  const slots = published ? ((await listSlots(published.id)) as PlanSlot[]) : [];
  const days = [...new Set(slots.map((slot) => slot.day))];
  const events: TeachingEvent[] = [];
  const clashes: TimetableClash[] = [];
  for (const day of days) {
    const result = teachingEventsFor(slots, day);
    events.push(...result.events);
    clashes.push(...result.clashes);
  }

  const counts = eventCounts(events);
  const teams = teamBlockSummary(events);
  const ruleFor = new Map(rules.map((rule) => [rule.subjectCode, rule.minimumPresent]));
  const nameOf = new Map(people.map((person) => [person.id, person.displayName]));

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowCover}
        title={m.subsRulesTitle}
        description={m.subsRulesIntro}
        language={language}
        back={BACK}
      />

      <Section title={m.bellsTitle} language={language}>
        <Notice className="mb-3" tone="neutral" text={m.bellsHint} language={language} />
        <Card className="p-4">
          <BellsForm periods={bells.periods} />
          <p className="mt-3 text-[12px] text-subtle-foreground">
            {primary(m.bellsRevision, language)} {bells.revision} · {bells.label}
          </p>
        </Card>
      </Section>

      <Section className="mt-8" title={m.lessonsTitle} language={language}>
        {!published ? (
          <Notice tone="warning" text={m.subsNoTimetable} language={language} />
        ) : (
          <>
            <Notice className="mb-3" tone="neutral" text={m.lessonsHint} language={language} />
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">
                {primary(m.lessonOrdinary, language)} {counts.ordinary}
              </Badge>
              <Badge tone="accent">
                {primary(m.lessonJoint, language)} {counts.joint}
              </Badge>
              <Badge tone="accent">
                {primary(m.lessonParallel, language)} {counts.parallel_cohort}
              </Badge>
              <Badge tone="warning">
                {primary(m.lessonTeam, language)} {counts.team_block}
              </Badge>
            </div>
          </>
        )}
      </Section>

      <Section className="mt-8" title={m.teamRulesTitle} language={language}>
        <Notice className="mb-3" tone="neutral" text={m.teamRulesHint} language={language} />
        {teams.length === 0 ? (
          <EmptyState title={m.teamNone} language={language} />
        ) : (
          <ul className="space-y-2">
            {teams.map((team) => {
              const current = ruleFor.get(team.subjectCode) ?? null;
              return (
                <li key={team.subjectCode}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold text-foreground">{team.subjectCode}</p>
                        <p className="text-[12px] text-subtle-foreground">
                          {team.classLabels.join(", ")}
                        </p>
                        <p className="text-[12px] text-subtle-foreground">
                          {primary(m.teamSize, language)}{" "}
                          {team.smallestTeam === team.largestTeam
                            ? team.largestTeam
                            : `${team.smallestTeam}–${team.largestTeam}`}{" "}
                          · {primary(m.teamBlocksPerWeek, language)} {team.blocks}
                        </p>
                      </div>
                      <Badge tone={current ? "success" : "warning"}>
                        {current
                          ? `${primary(m.teamMinimum, language)} ${current}`
                          : primary(m.teamNoRule, language)}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <TeamRuleForm
                        subjectCode={team.subjectCode}
                        largestTeam={team.largestTeam}
                        current={current}
                      />
                    </div>
                    {current ? (
                      <form action={clearTeamRuleAction} className="mt-2">
                        <input type="hidden" name="subjectCode" value={team.subjectCode} />
                        <Button type="submit" variant="ghost" size="sm">
                          {primary(m.remove, language)}
                        </Button>
                      </form>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section className="mt-8" title={m.clashesTitle} language={language}>
        {clashes.length === 0 ? (
          <EmptyState title={m.clashesNone} language={language} />
        ) : (
          <>
            <Notice className="mb-3" tone="warning" text={m.clashesHint} language={language} />
            <ul className="space-y-1.5">
              {clashes.map((clash) => (
                <li
                  key={`${clash.day}|${clash.period}|${clash.staffId}`}
                  className="rounded-xl border border-border bg-surface px-3 py-2 text-[14px]"
                >
                  <span className="font-semibold text-foreground">
                    {nameOf.get(clash.staffId) ?? "—"}
                  </span>{" "}
                  · {clash.day} · {primary(m.teachPeriod, language)} {periodNumber(clash.period)} ·{" "}
                  {primary(
                    t(`${clash.eventKeys.length} पाठ`, `${clash.eventKeys.length} lessons`),
                    language,
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </>
  );
}

const BACK = { href: "/substitutions", label: m.subsTitle };
