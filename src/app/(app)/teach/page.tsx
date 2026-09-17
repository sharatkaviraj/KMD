import Link from "next/link";
import { CalendarOff, ChevronRight, ClipboardList, Users } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { flat, primary, secondary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { isSchoolOpen, timetableRuns } from "@/modules/academics/domain/calendar";
import { periodNumber } from "@/modules/timetable/domain/periods";
import {
  attendanceCalendar,
  registersForDay,
} from "@/modules/attendance/data/attendance-repo";
import { countPendingCorrections } from "@/modules/attendance/data/corrections-repo";
import {
  dayHeaders,
  heldClassIds,
  periodsOn,
} from "@/modules/attendance/data/teaching-repo";
import {
  classesToday,
  outstanding,
  periodsInOrder,
  quietReason,
  registersDue,
  type PeriodSlot,
} from "@/modules/attendance/domain/today";
import { coversForTeacher } from "@/modules/substitutions/data/plans-repo";
import { getPublishedVersion } from "@/modules/timetable/data/timetable-repo";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.teachTitle) };
}

/**
 * The teacher's day.
 *
 * One question, answered above the fold: **is there anything I have not
 * done?** Everything else on the screen is secondary to that, because this is
 * opened at 7:40 in a corridor with a bell about to go.
 *
 * The three kinds of nothing are kept apart deliberately — school closed, no
 * class of your own, and everything already in. A card that counts rows would
 * render all three as an empty box, and the last one is the only one that
 * means "you are finished".
 */
export default async function TeachPage() {
  const staff = await requirePermission("attendance:view", "/teach");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.teachTitle} language={language} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const today = schoolToday();

  const [calendar, labels, held, published, registers, pendingCorrections, covers] =
    await Promise.all([
      attendanceCalendar(sessionLabel),
      classLabelMap(sessionLabel),
      heldClassIds(staff.id, sessionLabel),
      getPublishedVersion(sessionLabel),
      registersForDay(sessionLabel, today),
      can(staff, "attendance:correct")
        ? countPendingCorrections()
        : Promise.resolve(0),
      // Published plans only: a draft is somebody's work in progress, and a
      // teacher who turned up to a class the coordinator had not finished
      // deciding about would be the reason nobody trusted the card again.
      coversForTeacher(staff.id, sessionLabel, today),
    ]);

  const schoolOpen = isSchoolOpen(today, calendar);

  // The published timetable writes its own day headers, so today's block is
  // matched rather than assumed — see `matchDayHeader()`.
  let slots: PeriodSlot[] = [];
  if (published && schoolOpen && timetableRuns(today, calendar)) {
    const header = matchDayHeader(await dayHeaders(published.id), today);
    if (header) {
      slots = await periodsOn(staff.id, published.id, header);
    }
  }

  const heldClasses = held.map((classId) => ({
    classId,
    classLabel: labels.get(classId) ?? "—",
  }));

  const tasks = registersDue({ heldClasses, registers, schoolOpen });
  const todo = outstanding(tasks);
  const quiet = quietReason({ schoolOpen, heldClasses, tasks });
  const classes = classesToday({ heldClasses, slots });

  const dayText = t(
    `${weekdayLabel(today).hi}, ${dayLabel(today).hi}`,
    `${weekdayLabel(today).en}, ${dayLabel(today).en}`,
  );

  return (
    <>
      <PageHeader
        title={m.teachTitle}
        description={dayText}
        language={language}
        action={
          can(staff, "attendance:correct") ? (
            <Link
              href="/teach/corrections"
              className={buttonClasses({ variant: "outline", size: "sm" })}
            >
              {primary(m.correctionsQueue, language)}
              {pendingCorrections > 0 ? (
                <Badge tone="warning">{pendingCorrections}</Badge>
              ) : null}
            </Link>
          ) : null
        }
      />

      {/* ------------------------------------------------ needs doing */}

      <Section title={m.teachNeedsDoing} language={language}>
        {quiet === "closed" ? (
          <Notice tone="info" text={m.teachSchoolClosed} language={language}>
            <span className="inline-flex items-center gap-2 text-[13px]">
              <CalendarOff aria-hidden className="size-4" />
              {flat(dayText, language)}
            </span>
          </Notice>
        ) : quiet === "none-held" ? (
          <EmptyState title={m.teachNoClassHeld} language={language} />
        ) : quiet === "all-done" ? (
          <Notice tone="success" text={m.teachAllDone} language={language} />
        ) : (
          <ul className="space-y-2">
            {todo.map((task) => (
              <li key={task.classId}>
                <Link
                  href={`/teach/attendance?class=${task.classId}&day=${today}`}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 transition-colors hover:brightness-[0.98]"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-warning-soft-foreground"
                  >
                    <ClipboardList className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-warning-soft-foreground">
                      {task.classLabel}
                    </span>
                    <span className="block truncate text-[13px] text-warning-soft-foreground/85">
                      {primary(m.teachTakeRegister, language)}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-warning-soft-foreground/70"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Held classes whose register is already in: shown under the list
            rather than hidden, so a teacher can check their own work. */}
        {tasks.length > todo.length ? (
          <ul className="space-y-1.5">
            {tasks
              .filter((task) => task.done)
              .map((task) => (
                <li
                  key={task.classId}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">
                    {task.classLabel}
                  </span>
                  <Badge tone="success">
                    {primary(m.teachRegisterTaken, language)}
                  </Badge>
                </li>
              ))}
          </ul>
        ) : null}
      </Section>

      {/* ------------------------------------------------ cover duty */}

      {covers.length > 0 ? (
        <Section className="mt-7" title={m.teachCoverDuty} language={language}>
          <ul className="space-y-2">
            {covers.map((cover) => (
              <li key={cover.id}>
                <Link
                  href={`/teach/class/${cover.classId}`}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 transition-colors hover:brightness-[0.98]"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-[14px] font-bold tabular-nums text-accent-soft-foreground"
                  >
                    {periodNumber(cover.period)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-accent-soft-foreground">
                      {cover.classLabel}
                      {cover.subjectCode ? (
                        <span className="ml-2 text-[13px] font-normal">
                          {cover.subjectCode}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-accent-soft-foreground/85">
                      {primary(m.subsCoverFor, language)}{" "}
                      {cover.originalStaffName ?? "—"}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-accent-soft-foreground/70"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* -------------------------------------------- today's periods */}

      <Section className="mt-7" title={m.teachPeriodsToday} language={language}>
        {!published ? (
          <Notice tone="neutral" text={m.teachNoTimetable} language={language} />
        ) : slots.length === 0 ? (
          <EmptyState title={m.teachNoPeriods} language={language} />
        ) : (
          <ol className="space-y-1.5">
            {periodsInOrder(slots).map((slot) => (
              <li
                key={`${slot.period}-${slot.classId}`}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[14px] font-bold tabular-nums text-muted-foreground"
                >
                  {periodNumber(slot.period)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-foreground">
                    {slot.classLabel}
                  </span>
                  <span className="block truncate text-[12px] text-subtle-foreground">
                    {slot.subjectCode}
                  </span>
                </span>
                <Link
                  href={`/teach/class/${slot.classId}`}
                  aria-label={`${flat(m.teachOpenClass, language)} — ${slot.classLabel}`}
                  className={buttonClasses({ variant: "ghost", size: "icon" })}
                >
                  <ChevronRight aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ----------------------------------------------- your classes */}

      {classes.length > 0 ? (
        <Section className="mt-7" title={m.teachMyClasses} language={language}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {classes.map((entry) => {
              const under = secondary(m.teachOpenClass, language);
              return (
                <li key={entry.classId}>
                  <Link
                    href={`/teach/class/${entry.classId}`}
                    className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground"
                    >
                      <Users className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-foreground">
                        {entry.classLabel}
                      </span>
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {primary(m.teachOpenClass, language)}
                        {under ? <span className="ml-1.5">{under}</span> : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {/* A standing note that the register survives a dropped connection —
          not a claim that the connection *is* down. This card used to render
          `attendanceOffline`, which is present-tense and told everybody on a
          working connection that they had none. */}
      <Card className="mt-7 p-4">
        <p className="text-[13px] leading-5 text-muted-foreground">
          {primary(m.attendanceWorksOffline, language)}
        </p>
      </Card>
    </>
  );
}
