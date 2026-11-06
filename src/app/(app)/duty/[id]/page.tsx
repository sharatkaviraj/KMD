import Link from "@/ui/link";
import { Lock } from "lucide-react";

import * as m from "@/messages/pairs";
import { requireStaff } from "@/platform/auth/current-staff";
import { assertSessionVisible, notFoundUnlessVisible } from "@/platform/auth/test-session-access";
import { dayLabel, weekdayLabel } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { viewDuty } from "@/modules/substitutions/data/duty-repo";
import type { CoverDuty } from "@/modules/substitutions/data/cover-repo";
import { DutyAnswer } from "@/modules/substitutions/ui/duty-answer";
import { periodTiming } from "@/modules/timetable/domain/bells";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { Badge, Card, DetailList, Notice } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { StateCard } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.dutyTitle) };
}

/**
 * One cover duty, the place both Today and the WhatsApp link open (P5).
 *
 * Signed in first: the proxy sends a signed-out visitor to the login page and
 * back here afterwards, and nothing about the duty is rendered before that.
 * Then the row decides — the link is a pointer, never a permission: its
 * current holder sees it and may answer; whoever held an older revision sees
 * that it changed or was cancelled; anybody else, including someone a link
 * was forwarded to, sees that it is not for them and nothing more.
 *
 * Opening the page changes nothing. Acknowledging is a button.
 */
export default async function DutyPage(props: PageProps<"/duty/[id]">) {
  const staff = await requireStaff();
  const language = staff.language;
  const { id } = await props.params;

  const view = /^[0-9a-f-]{36}$/i.test(id) ? await viewDuty(id, staff) : ({ kind: "none" } as const);

  if (view.kind === "none") {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowCover} title={m.dutyTitle} language={language} />
        <StateCard
          icon={Lock}
          title={m.dutyNotForYou}
          detail={m.dutyNotForYouDetail}
          language={language}
          action={
            <Link href="/teach" className={buttonClasses({ variant: "outline" })}>
              {primary(m.teachTitle, language)}
            </Link>
          }
        />
      </>
    );
  }

  const shown: CoverDuty = view.kind === "former_holder" ? view.linked : (view.current ?? view.linked);
  // Phase 3 fence: a duty in a session this viewer cannot open is "not found".
  await notFoundUnlessVisible(() => assertSessionVisible(staff, shown.sessionLabel));
  const [bells, people] = await Promise.all([currentBells(shown.sessionLabel), listStaff()]);
  const nameOf = new Map(people.map((person) => [person.id, person.displayName]));
  const window = bells.periods.find((period) => period.index === shown.period);
  const timing = periodTiming(bells, shown.day, shown.period, new Date());
  const over = timing === "over";

  const when = t(
    `${weekdayLabel(shown.day).hi}, ${dayLabel(shown.day).hi} · पीरियड ${periodNumber(shown.period)}${window ? ` (${window.starts}–${window.ends})` : ""}`,
    `${weekdayLabel(shown.day).en}, ${dayLabel(shown.day).en} · Period ${periodNumber(shown.period)}${window ? ` (${window.starts}–${window.ends})` : ""}`,
  );

  const facts = (
    <Card className="p-4">
      <DetailList
        language={language}
        items={[
          { label: m.dutyWhen, value: primary(when, language) },
          { label: m.dutyClasses, value: shown.classLabels.join(", ") },
          { label: m.dutySubject, value: shown.subjectCode },
          {
            label: m.dutyCoveringFor,
            value: shown.absentStaffIds.map((staffId) => nameOf.get(staffId) ?? "—").join(", "),
          },
        ]}
      />
    </Card>
  );

  /* --------------------------------- it moved on, and this person was on it */

  if (view.kind === "former_holder") {
    const stillMine = view.current?.status === "assigned" && view.current.coveringStaffId === staff.id;
    const cancelled = !view.current;
    return (
      <>
        <PageHeader eyebrow={m.eyebrowCover} title={m.dutyTitle} language={language} />
        <Notice
          className="mb-4"
          tone="warning"
          text={cancelled ? m.dutyCancelledTitle : m.dutyChangedTitle}
          language={language}
        >
          <p className="text-[14px]">
            {primary(cancelled ? m.dutyCancelledDetail : m.dutyChangedDetail, language)}
          </p>
        </Notice>
        {facts}
        {stillMine && view.current ? (
          <Link
            href={`/duty/${view.current.id}`}
            className={buttonClasses({ size: "lg", fullWidth: true, className: "mt-4" })}
          >
            {primary(m.teachCoverOpen, language)}
          </Link>
        ) : null}
      </>
    );
  }

  /* --------------------------------------------- the holder, or the office */

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowCover}
        title={view.kind === "holder" ? m.dutyYours : m.dutyTitle}
        language={language}
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {shown.status === "assigned" ? (
          <Badge tone="success">{nameOf.get(shown.coveringStaffId ?? "") ?? "—"}</Badge>
        ) : (
          <Badge tone="warning">{primary(m.coverNeedsHelp, language)}</Badge>
        )}
        {over ? <Badge tone="neutral">{primary(m.dutyPeriodOver, language)}</Badge> : null}
        {shown.cannotCoverAt ? <Badge tone="danger">{primary(m.coverCannotCover, language)}</Badge> : null}
      </div>
      {facts}
      {view.kind === "holder" && !over ? (
        <div className="mt-5">
          <DutyAnswer
            dutyId={shown.id}
            acknowledged={Boolean(shown.acknowledgedAt)}
            cannotCover={Boolean(shown.cannotCoverAt)}
          />
        </div>
      ) : null}
      {view.kind === "manager" ? (
        <Link
          href={`/substitutions?day=${shown.day}`}
          className={buttonClasses({ variant: "outline", fullWidth: true, className: "mt-4" })}
        >
          {primary(m.subsTitle, language)}
        </Link>
      ) : null}
    </>
  );
}
