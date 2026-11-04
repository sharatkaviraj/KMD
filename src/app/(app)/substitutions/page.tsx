import Link from "next/link";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { coverPhotoEnabled, recentCoverPhoto } from "@/lib/ai/cover-photo-service";
import { CoverPhotoPanel } from "@/lib/ai/ui/cover-photo-panel";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { addDays, dayLabel, isIsoDay, schoolToday, weekdayLabel } from "@/platform/dates";
import { flat, primary, t, type Language, type Localized } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { periodNumber } from "@/modules/timetable/domain/periods";
import {
  candidatesFor,
  profilesFor,
  readCoverDay,
} from "@/modules/substitutions/data/arrange-day";
import { noticesOn, type CoverDuty, type DutyNotice } from "@/modules/substitutions/data/cover-repo";
import { needsHelpReasons } from "@/modules/substitutions/domain/cover-state";
import { coverEligibleIds, distinctNames, missedPeriods } from "@/modules/substitutions/domain/cover-view";
import type { Candidate } from "@/modules/substitutions/domain/engine";
import { blockLabels, tierLabels, warningLabels } from "@/modules/substitutions/domain/labels";
import { describePeriods } from "@/modules/substitutions/domain/plan";
import { CoverResultBanner, CoverResultProvider } from "@/modules/substitutions/ui/cover-command";
import {
  AbsenceCommandForm,
  AssignCommandForm,
  BackAtSchoolForm,
  RearrangeForm,
  ReleaseCommandForm,
  type CoverChoice,
} from "@/modules/substitutions/ui/cover-forms";
import { reconcileNoticeAction, sendNoticesNowAction } from "@/app/(app)/substitutions/actions";
import { staffTransportName } from "@/modules/staff-notices/data/dispatcher";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";
import { G } from "@/vx/screens/timetable/guided-text";
import type { Pair } from "@/vx/text";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subsTitle) };
}

/**
 * Cover for one day (P3).
 *
 * There is no draft and no publish button any more. Saving an absence is one
 * command that records it, works out every lesson it leaves without a teacher,
 * assigns the ones the app can assign safely, marks the rest as needing help,
 * publishes all of it and queues the notices — or changes nothing. What the
 * coordinator sees is what the teachers see.
 *
 * Every duty says one of three things plainly: who has it, why nobody does
 * yet, or that its period has begun and it is history. Assigned, needs help
 * and "was anybody told" are separate facts and shown separately (§5).
 */
export default async function SubstitutionsPage(props: PageProps<"/substitutions">) {
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

  const coverDay = await readCoverDay(sessionLabel, day);
  const photoEnabled = Boolean(coverDay.versionId && coverDay.header && coverDay.slots.length &&
    coverPhotoEnabled(staff, sessionLabel) && !(await getViewer()).previewing);
  const [notices, profiles, photoResult] = await Promise.all([
    noticesOn(sessionLabel, day),
    mayManage ? profilesFor(coverDay) : Promise.resolve(null),
    photoEnabled ? recentCoverPhoto(staff, day) : Promise.resolve(null),
  ]);

  // Two profiles with one name are told apart; office logins are never offered as cover (D-213).
  const nameOf = distinctNames(coverDay.staff);
  for (const absence of coverDay.absences) if (!nameOf.has(absence.staffProfileId)) nameOf.set(absence.staffProfileId, absence.staffName);
  const eligible = coverEligibleIds(coverDay.staff, coverDay.slots);
  const isToday = day === schoolToday();
  const missed = missedPeriods(coverDay.needs, coverDay.live, coverDay.openPeriods);
  const contactOf = new Map(coverDay.staff.map((person) => [person.id, person]));

  const dayText = t(
    `${weekdayLabel(day).hi}, ${dayLabel(day).hi}`,
    `${weekdayLabel(day).en}, ${dayLabel(day).en}`,
  );

  const live = coverDay.live;
  const assigned = live.filter((duty) => duty.status === "assigned").length;
  const needsHelp = live.filter((duty) => duty.status === "needs_help").length;
  const history = coverDay.duties.length - live.length;
  const noticeOf = latestNoticeByDuty(notices);
  const canCommand = mayManage && Boolean(coverDay.versionId && coverDay.header);
  const waiting = notices.filter((notice) => notice.status === "pending" || notice.status === "failed").length;
  const transport = staffTransportName();

  const byPeriod = new Map<number, CoverDuty[]>();
  for (const duty of live) byPeriod.set(duty.period, [...(byPeriod.get(duty.period) ?? []), duty]);

  const awayIds = new Set(coverDay.absences.map((absence) => absence.staffProfileId));
  const clashTouchesAbsence = coverDay.clashes.some((clash) => awayIds.has(clash.staffId));

  const choicesFor = (duty: CoverDuty): CoverChoice[] =>
    profiles
      ? candidatesFor(coverDay, profiles.everyone, profiles.history, duty)
          .filter((candidate) => eligible.has(candidate.teacher))
          .map((candidate) => ({
          id: candidate.teacher,
          label: nameOf.get(candidate.teacher) ?? candidate.teacher,
          detail: describeCandidate(candidate, language),
          blocked: candidate.blocked.length > 0,
        }))
      : [];

  return (
    <CoverResultProvider>
      <PageHeader
        eyebrow={m.eyebrowCover}
        title={m.subsTitle}
        description={dayText}
        language={language}
        action={
          mayManage ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/substitutions/arrange?day=${day}`} className={buttonClasses({ size: "sm" })}>
                {primary(localized(G.title), language)}
              </Link>
              <Link href="/substitutions/rules" className={buttonClasses({ variant: "outline", size: "sm" })}>
                {primary(m.subsRulesTitle, language)}
              </Link>
              <Link href="/substitutions/policies" className={buttonClasses({ variant: "outline", size: "sm" })}>
                {primary(m.subsPoliciesTitle, language)}
              </Link>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex items-center gap-2">
        <Link href={`/substitutions?day=${addDays(day, -1)}`} className={buttonClasses({ variant: "outline", size: "sm" })}>
          ← {primary(dayLabel(addDays(day, -1)), language)}
        </Link>
        <Link href={`/substitutions?day=${addDays(day, 1)}`} className={buttonClasses({ variant: "outline", size: "sm" })}>
          {primary(dayLabel(addDays(day, 1)), language)} →
        </Link>
      </div>

      {mayManage ? (
        // Which cover page is for what (C01): one line, the same words as the Cover tab.
        <p className="mb-4 text-[13px] text-subtle-foreground">{primary(localized(G.whichPage), language)}</p>
      ) : null}

      <CoverResultBanner />

      {photoEnabled && <div className="mb-4"><CoverPhotoPanel key={day} day={day} initial={photoResult} /></div>}

      {!coverDay.versionId ? (
        <Notice className="mb-4" tone="warning" text={m.subsNoTimetable} language={language} />
      ) : !coverDay.header ? (
        <Notice className="mb-4" tone="neutral" text={m.subsNoVacancies} language={language} />
      ) : null}

      {clashTouchesAbsence ? (
        <Notice className="mb-4" tone="warning" text={m.coverClash} language={language}>
          <Link href="/substitutions/rules" className={buttonClasses({ variant: "outline", size: "sm" })}>
            {primary(m.subsRulesTitle, language)}
          </Link>
        </Notice>
      ) : null}

      {/* ------------------------------------------------------ who is away */}

      <Section title={isToday ? m.subsAbsentToday : ms.subsAbsentOnDay} language={language}>
        {coverDay.absences.length === 0 ? (
          <EmptyState title={isToday ? m.subsNobodyAway : ms.subsNobodyAwayOnDay} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {coverDay.absences.map((absence) => (
              <li
                key={absence.id}
                className="flex min-h-14 flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">{nameOf.get(absence.staffProfileId) ?? absence.staffName}</span>
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {describePeriods(absence.periods)}
                  </span>
                </span>
                {canCommand ? (
                  <BackAtSchoolForm
                    day={day}
                    dayRevision={coverDay.dayRevision}
                    staffProfileId={absence.staffProfileId}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canCommand ? (
        <Card className="mt-4 p-4">
          <AbsenceCommandForm
            day={day}
            dayRevision={coverDay.dayRevision}
            staff={coverDay.staff
              .filter(({ id }) => eligible.has(id))
              .map(({ id, displayName, shortName }) => ({ id, displayName: nameOf.get(id) ?? displayName, shortName }))}
            away={coverDay.absences.map(({ staffProfileId, periods }) => ({ staffProfileId, periods }))}
          />
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- duties */}

      <Section className="mt-8" title={isToday ? m.coverDutiesTitle : ms.coverDutiesOnDay} language={language}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="success">
            {primary(m.coverAssigned, language)} {assigned}
          </Badge>
          <Badge tone={needsHelp > 0 ? "warning" : "neutral"}>
            {primary(m.coverNeedsHelp, language)} {needsHelp}
          </Badge>
          {canCommand && live.length > 0 ? (
            <span className="ml-auto">
              <RearrangeForm day={day} dayRevision={coverDay.dayRevision} />
            </span>
          ) : null}
        </div>
        {mayManage && waiting > 0 ? (
          <form action={sendNoticesNowAction} className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone="info">
              {primary(m.coverNoticeQueued, language)} {waiting}
            </Badge>
            <Button type="submit" variant="outline" size="sm">
              {primary(m.coverSendNow, language)}
            </Button>
            <span className="text-[12px] text-subtle-foreground">
              {primary(m.coverTransport, language)}: {transport}
            </span>
          </form>
        ) : null}
      </Section>

      {missed.length > 0 ? (
        <Notice className="mt-4" tone="warning" text={ms.coverMissedTitle} language={language}>
          <p className="text-[13px]">{primary(ms.coverMissedHint, language)}</p>
          <ul className="mt-2 space-y-1 text-[14px]">
            {missed.map((entry) => (
              <li key={entry.key}>
                {primary(m.teachPeriod, language)} {periodNumber(entry.period)} · {entry.classLabels.join(", ")} · {entry.subjectCode} ·{" "}
                {entry.absentStaffIds.map((id) => nameOf.get(id) ?? "—").join(", ")}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {live.length === 0 ? (
        <EmptyState className="mt-4" title={missed.length > 0 ? ms.coverMissedNothingLeft : m.coverNothingNeeded} language={language} />
      ) : (
        <div className="mt-4 space-y-6">
          {[...byPeriod.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([period, duties]) => {
              const open = coverDay.openPeriods.has(period);
              const window = coverDay.bells.periods.find((entry) => entry.index === period);
              return (
                <section key={period} aria-labelledby={`period-${period}`}>
                  <h3
                    id={`period-${period}`}
                    className="mb-2 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-subtle-foreground"
                  >
                    {primary(m.teachPeriod, language)} {periodNumber(period)}
                    {window ? (
                      <span className="font-normal normal-case">
                        {window.starts}–{window.ends}
                      </span>
                    ) : null}
                    {!open ? <Badge tone="neutral">{primary(m.coverStarted, language)}</Badge> : null}
                  </h3>
                  <ul className="space-y-2">
                    {duties.map((duty) => (
                      <li key={duty.id} data-duty={duty.id} data-need-key={duty.needKey}>
                        <DutyCard
                          duty={duty}
                          language={language}
                          nameOf={nameOf}
                          notice={noticeOf.get(duty.id) ?? null}
                          contact={duty.coveringStaffId ? (contactOf.get(duty.coveringStaffId) ?? null) : null}
                          manage={
                            canCommand && open
                              ? { day, dayRevision: coverDay.dayRevision, choices: choicesFor(duty) }
                              : null
                          }
                          canReconcile={mayManage}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
        </div>
      )}

      {history > 0 ? (
        <p className="mt-6 text-[12px] text-subtle-foreground">
          {primary(m.coverHistory, language)}: {history}
        </p>
      ) : null}
    </CoverResultProvider>
  );
}

const KIND_LABEL: Record<CoverDuty["eventKind"], Localized | null> = {
  ordinary: null,
  joint: m.lessonJoint,
  parallel_cohort: m.lessonParallel,
  team_block: m.lessonTeam,
};

function DutyCard({
  duty,
  language,
  nameOf,
  notice,
  contact,
  manage,
  canReconcile,
}: {
  duty: CoverDuty;
  language: Language;
  nameOf: Map<string, string>;
  notice: DutyNotice | null;
  contact: { hasPhone: boolean; hasLogin: boolean } | null;
  manage: { day: string; dayRevision: number; choices: CoverChoice[] } | null;
  canReconcile: boolean;
}) {
  const kind = KIND_LABEL[duty.eventKind];
  const away = duty.absentStaffIds.map((id) => nameOf.get(id) ?? "—").join(", ");

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">
            {duty.classLabels.join(", ")}
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">{duty.subjectCode}</span>
          </p>
          <p className="text-[12px] text-subtle-foreground">
            {primary(m.coverFor, language)}: {away}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {kind ? <Badge tone="accent">{primary(kind, language)}</Badge> : null}
          <Badge tone={duty.status === "assigned" ? "success" : "warning"}>
            {primary(duty.status === "assigned" ? m.coverAssigned : m.coverNeedsHelp, language)}
          </Badge>
        </div>
      </div>

      {duty.status === "assigned" ? (
        <div className="mt-2 space-y-1">
          <p className="text-[15px] font-semibold text-foreground">
            {nameOf.get(duty.coveringStaffId ?? "") ?? "—"}
            {duty.source === "manual" ? (
              <span className="ml-2 text-[12px] font-normal text-subtle-foreground">
                {primary(m.coverManual, language)}
              </span>
            ) : null}
          </p>
          {duty.matchTier ? (
            <p className="text-[12px] text-subtle-foreground">
              {primary(labelOf(tierLabels as Record<string, Localized>, duty.matchTier), language)}
              {duty.warnings.length > 0
                ? ` · ${duty.warnings.map((warning) => primary(labelOf(warningLabels, warning), language)).join(" · ")}`
                : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <NoticeBadge notice={notice} contact={contact} language={language} />
            {duty.cannotCoverAt ? (
              <Badge tone="danger">{primary(m.coverCannotCover, language)}</Badge>
            ) : duty.acknowledgedAt ? (
              <Badge tone="success">{primary(m.coverAcknowledged, language)}</Badge>
            ) : (
              <Badge tone="neutral">{primary(m.coverNotAcknowledged, language)}</Badge>
            )}
            {contact && !contact.hasLogin ? (
              <Badge tone="warning">{primary(m.coverNoLogin, language)}</Badge>
            ) : null}
          </div>
          {canReconcile && notice && (notice.status === "unknown" || notice.status === "failed") ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <form action={reconcileNoticeAction}>
                <input type="hidden" name="noticeId" value={notice.id} />
                <input type="hidden" name="resolution" value="confirmed_received" />
                <Button type="submit" variant="outline" size="sm">
                  {primary(m.coverConfirmedReceived, language)}
                </Button>
              </form>
              <form action={reconcileNoticeAction}>
                <input type="hidden" name="noticeId" value={notice.id} />
                <input type="hidden" name="resolution" value="resend" />
                <Button type="submit" variant="ghost" size="sm">
                  {primary(notice.status === "unknown" ? m.coverResendMaybeTwice : m.coverResend, language)}
                </Button>
              </form>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-[14px] font-medium text-warning-soft-foreground">
            {primary(needsHelpReasons[duty.reason ?? "no_candidate"] ?? needsHelpReasons.no_candidate, language)}
          </p>
          {duty.suggestedStaffId ? (
            <p className="text-[12px] text-subtle-foreground">
              {primary(m.coverSuggested, language)}: {nameOf.get(duty.suggestedStaffId) ?? "—"}
            </p>
          ) : null}
        </div>
      )}

      {manage ? (
        <>
          <AssignCommandForm
            day={manage.day}
            dayRevision={manage.dayRevision}
            needKey={duty.needKey}
            choices={manage.choices}
            current={duty.status === "assigned" ? duty.coveringStaffId : duty.suggestedStaffId}
          />
          {duty.status === "assigned" ? (
            <ReleaseCommandForm day={manage.day} dayRevision={manage.dayRevision} needKey={duty.needKey} />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function NoticeBadge({
  notice,
  contact,
  language,
}: {
  notice: DutyNotice | null;
  contact: { hasPhone: boolean } | null;
  language: Language;
}) {
  if (contact && !contact.hasPhone) {
    return <Badge tone="warning">{primary(m.coverNoticeBlocked, language)}</Badge>;
  }
  if (!notice) return <Badge tone="neutral">{primary(m.coverNoticeNone, language)}</Badge>;
  switch (notice.status) {
    case "pending":
    case "dispatching":
      return <Badge tone="info">{primary(m.coverNoticeQueued, language)}</Badge>;
    case "accepted":
    case "delivered":
    case "read":
      return <Badge tone="success">{primary(m.coverNoticeSent, language)}</Badge>;
    case "unknown":
      return <Badge tone="warning">{primary(m.coverNoticeUnknown, language)}</Badge>;
    case "failed":
      return <Badge tone="danger">{primary(m.coverNoticeFailed, language)}</Badge>;
    case "suppressed":
      return notice.statusReason === "no_phone" ? (
        <Badge tone="warning">{primary(m.coverNoticeBlocked, language)}</Badge>
      ) : (
        <Badge tone="neutral">{primary(m.coverNoticeNone, language)}</Badge>
      );
    default:
      return <Badge tone="neutral">{primary(m.coverNoticeNone, language)}</Badge>;
  }
}

/** A vx pair (English first) as this page's Hindi/English pair. */
function localized(pair: Pair): Localized {
  return t(pair.hi ?? pair.en, pair.en);
}

function labelOf(labels: Record<string, Localized>, key: string): Localized {
  return labels[key] ?? t(key, key);
}

/** The notice that speaks for a duty now: the newest telling its holder about it. */
function latestNoticeByDuty(notices: readonly DutyNotice[]): Map<string, DutyNotice> {
  const latest = new Map<string, DutyNotice>();
  for (const notice of notices) {
    if (notice.kind !== "cover_assigned" && notice.kind !== "cover_changed") continue;
    const seen = latest.get(notice.dutyId);
    if (!seen || seen.createdAt <= notice.createdAt) latest.set(notice.dutyId, notice);
  }
  return latest;
}

function describeCandidate(candidate: Candidate, language: Language): string {
  if (candidate.blocked.length > 0) {
    return flat(labelOf(blockLabels, candidate.blocked[0]), language);
  }
  const tier = primary(tierLabels[candidate.matchTier], language);
  const warning = candidate.warnings[0] ? warningLabels[candidate.warnings[0]] : null;
  return warning ? `${tier} · ${primary(warning, language)}` : tier;
}
