import Link from "next/link";
import {
  BookOpenCheck,
  CalendarDays,
  CalendarOff,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Repeat2,
  Users,
} from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { flat, primary, t } from "@/platform/i18n/language";
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
  lessonsToday,
  nextAction,
  outstanding,
  quietReason,
  registersDue,
  type PeriodSlot,
} from "@/modules/attendance/domain/today";
import { classRoll } from "@/modules/attendance/data/attendance-repo";
import { myDutiesOn } from "@/modules/substitutions/data/duty-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { getPublishedVersion } from "@/modules/timetable/data/timetable-repo";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { Panel, PanelRow } from "@/ui/panel";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";
import { HomeColumns, MetricCard, MetricGrid, TaskHero } from "@/ui/task-hero";

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
        ? countPendingCorrections(sessionLabel)
        : Promise.resolve(0),
      // Her live cover duties. Every one is committed and published by the
      // cover command (P3); there is no draft a teacher could be sent to.
      myDutiesOn(staff.id, sessionLabel, today),
    ]);

  const schoolOpen = isSchoolOpen(today, calendar);

  const heldClasses = held.map((classId) => ({
    classId,
    classLabel: labels.get(classId) ?? "—",
  }));

  const tasks = registersDue({ heldClasses, registers, schoolOpen });
  const todo = outstanding(tasks);
  const quiet = quietReason({ schoolOpen, heldClasses, tasks });
  const next = nextAction({ schoolOpen, heldClasses, tasks });

  /**
   * How many children are on the roll of the class this screen is about.
   *
   * **One read, for one class.** It is read whenever the teacher holds exactly
   * one class — not only when a register is due — because it is also what the
   * "My class" card counts, and a teacher who has already taken her register
   * should still see the size of the class she is looking at. A teacher who
   * holds several gets the count of classes instead: five roll queries to
   * render one card is the kind of thing R7.1 comes back to delete.
   */
  const soleClass = heldClasses.length === 1 ? heldClasses[0] : null;
  const rollClassId = soleClass?.classId ?? (next.kind === "register" ? next.task.classId : null);

  /*
   * The three reads left depend on what came back above and not on each
   * other, so they go together rather than one round trip after another.
   */
  const [staffNames, slots, waiting] = await Promise.all([
    // Who she is standing in for, by name — never why they are away.
    covers.length > 0
      ? listStaff().then((people) => new Map(people.map((person) => [person.id, person.displayName])))
      : new Map<string, string>(),
    // The published timetable writes its own day headers, so today's block is
    // matched rather than assumed — see `matchDayHeader()`.
    published && schoolOpen && timetableRuns(today, calendar)
      ? dayHeaders(published.id).then((headers): Promise<PeriodSlot[]> | PeriodSlot[] => {
          const header = matchDayHeader(headers, today);
          return header ? periodsOn(staff.id, published.id, header) : [];
        })
      : ([] as PeriodSlot[]),
    rollClassId
      ? classRoll({ classId: rollClassId, sessionLabel }).then((roll) => roll.length)
      : null,
  ]);

  const classes = classesToday({ heldClasses, slots });

  // **One lesson per period, not one per class.** A subject taught to five
  // classes at once is five rows in `timetable_slots`, and rendering them as
  // five rows gave a teacher twenty entries for an eight-period day (B-20).
  const lessons = lessonsToday(slots);

  const dayText = t(
    `${weekdayLabel(today).hi}, ${dayLabel(today).hi}`,
    `${weekdayLabel(today).en}, ${dayLabel(today).en}`,
  );

  /**
   * Whose day this is, in one line under the title.
   *
   * The design package asks a teacher's home to open with her own class and
   * day rather than with the app's name — "Your class VI A". Three shapes,
   * because the three are genuinely different and a card that counts rows
   * renders them all the same: one class, several, and none at all. The last
   * one says so rather than leaving the line blank, which would read as a
   * screen that had not finished loading.
   */
  const classContext =
    heldClasses.length === 0
      ? m.teachNoClassOfYourOwn
      : heldClasses.length === 1
        ? // A middle dot rather than a space: the class labels on this school's
          // data are themselves "Class 1", so "Your class Class 1" is what a
          // plain join produces. The separator makes it a label and a value.
          t(
            `${m.teachYourClass.hi} · ${heldClasses[0].classLabel}`,
            `${m.teachYourClass.en} · ${heldClasses[0].classLabel}`,
          )
        : t(
            `${m.teachYourClasses.hi} · ${heldClasses.map((c) => c.classLabel).join(", ")}`,
            `${m.teachYourClasses.en} · ${heldClasses.map((c) => c.classLabel).join(", ")}`,
          );

  /**
   * The day's first lesson, for the card that counts them.
   *
   * "First", not "next": `timetable_slots` carries a period **index** and no
   * clock time, so nothing in this database knows what time it is in the
   * school day. Calling it "next" would be inventing a fact the schema does
   * not hold — the design's "Next: English · 09:10" is a design example, and
   * this is the true version of it. Recorded as a deviation in the evidence.
   */
  const firstLesson = lessons[0] ?? null;

  return (
    <>
      <PageHeader
        eyebrow={dayText}
        title={m.teachTitle}
        description={classContext}
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

      {/* On a desk the day's timetable sits beside the work rather than under
          four sections of it; on a phone it follows them, which is the order a
          teacher reads in a corridor. Same content either way. */}
      <HomeColumns
        main={
          <>
      {/* ------------------------------------------------- today in numbers */}

      <MetricGrid>
        <MetricCard
          // One class: the number that matters is how many children are in it.
          // Several: how many classes. None: a dash and why — because "0
          // classes" and "the class list could not be read" look the same.
          label={soleClass ? m.teachYourClass : m.teachMyClasses}
          value={
            heldClasses.length === 0
              ? "—"
              : soleClass && waiting !== null
                ? String(waiting)
                : String(heldClasses.length)
          }
          detail={
            heldClasses.length === 0
              ? m.teachNoClassHeld
              : soleClass
                ? t(soleClass.classLabel, soleClass.classLabel)
                : t(
                    heldClasses.map((c) => c.classLabel).join(", "),
                    heldClasses.map((c) => c.classLabel).join(", "),
                  )
          }
          href={soleClass ? `/teach/class/${soleClass.classId}` : undefined}
          icon={Users}
          language={language}
        />
        <MetricCard
          label={m.teachPeriodsToday}
          // A dash, not a nought: "the timetable is not published" and "you
          // have a free day" are different news, and a 0 tells the wrong one.
          value={!published ? "—" : String(lessons.length)}
          detail={
            !published
              ? m.teachNoTimetable
              : firstLesson
                ? t(
                    `${m.teachFirstLesson.hi}: ${firstLesson.subjectCode} · ${m.teachPeriod.hi} ${periodNumber(firstLesson.period)}`,
                    `${m.teachFirstLesson.en}: ${firstLesson.subjectCode} · ${m.teachPeriod.en} ${periodNumber(firstLesson.period)}`,
                  )
                : null
          }
          icon={CalendarDays}
          language={language}
        />
        {covers.length > 0 ? (
          <MetricCard
            label={m.teachCoverDuty}
            value={String(covers.length)}
            icon={Repeat2}
            language={language}
            tone="warning"
          />
        ) : null}
        {can(staff, "attendance:correct") ? (
          <MetricCard
            label={m.correctionsQueue}
            value={String(pendingCorrections)}
            href="/teach/corrections"
            icon={BookOpenCheck}
            language={language}
            tone={pendingCorrections > 0 ? "warning" : "neutral"}
          />
        ) : null}
      </MetricGrid>

      {/* ------------------------------------------- one thing to do next */}

      {next.kind === "register" ? (
        <TaskHero
          eyebrow={m.teachFirstThingsFirst}
          title={m.teachTakeRegisterNow}
          detail={
            waiting === null
              ? null
              : t(
                  `${next.task.classLabel} में ${waiting} बच्चे — हाज़िरी बाकी है।`,
                  `${waiting} children in ${next.task.classLabel} are waiting to be marked.`,
                )
          }
          href={`/teach/attendance?class=${next.task.classId}&day=${today}`}
          action={m.teachTakeRegister}
          icon={ClipboardCheck}
          language={language}
        />
      ) : null}

      {/* ------------------------------------------------ needs doing */}

      {quiet === "closed" ? (
        <Section className="mt-7" title={m.teachNeedsDoing} language={language}>
          <Notice tone="info" text={m.teachSchoolClosed} language={language}>
            <span className="inline-flex items-center gap-2 text-[13px]">
              <CalendarOff aria-hidden className="size-4" />
              {flat(dayText, language)}
            </span>
          </Notice>
        </Section>
      ) : quiet === "none-held" ? (
        <Section className="mt-7" title={m.teachNeedsDoing} language={language}>
          <EmptyState title={m.teachNoClassHeld} language={language} />
        </Section>
      ) : quiet === "all-done" ? (
        <Section className="mt-7" title={m.teachNeedsDoing} language={language}>
          <Notice tone="success" text={m.teachAllDone} language={language} />
        </Section>
      ) : (
        <Panel className="mt-7" title={m.teachNeedsDoing} language={language}>
          {todo.map((task) => (
            <PanelRow
              key={task.classId}
              href={`/teach/attendance?class=${task.classId}&day=${today}`}
              icon={ClipboardList}
              tone="warning"
              title={task.classLabel}
              detail={primary(m.teachTakeRegister, language)}
            />
          ))}

          {/* Held classes whose register is already in: kept in the same list
              rather than hidden, so a teacher can check her own work — and
              below the outstanding ones, because those are what she came for. */}
          {tasks
            .filter((task) => task.done)
            .map((task) => (
              <PanelRow
                key={task.classId}
                title={
                  <span className="text-muted-foreground">{task.classLabel}</span>
                }
                trailing={
                  <Badge tone="success">
                    {primary(m.teachRegisterTaken, language)}
                  </Badge>
                }
              />
            ))}
        </Panel>
      )}

      {/* ------------------------------------------------ cover duty */}

      {covers.length > 0 ? (
        <Panel className="mt-7" title={m.teachCoverDuty} language={language}>
          {covers.map((cover) => (
            <PanelRow
              key={cover.id}
              // The same page the WhatsApp link opens (P5), so Today works when
              // the message never arrives.
              href={`/duty/${cover.id}`}
              tone="accent"
              lead={periodNumber(cover.period)}
              title={
                <>
                  {cover.classLabels.join(", ")}
                  <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                    {cover.subjectCode}
                  </span>
                </>
              }
              detail={`${primary(m.subsCoverFor, language)} ${cover.absentStaffIds
                .map((id) => staffNames.get(id) ?? "—")
                .join(", ")} · ${primary(cover.acknowledgedAt ? m.coverAcknowledged : m.teachCoverOpen, language)}`}
            />
          ))}
        </Panel>
      ) : null}

      {/* ----------------------------------------------- your classes */}

      {classes.length > 0 ? (
        <Panel className="mt-7" title={m.teachMyClasses} language={language}>
          {classes.map((entry) => (
            <PanelRow
              key={entry.classId}
              href={`/teach/class/${entry.classId}`}
              icon={Users}
              tone="accent"
              title={entry.classLabel}
              detail={primary(m.teachOpenClass, language)}
            />
          ))}
        </Panel>
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
        }
        aside={
          /* -------------------------------------------- today's periods */
          <Section
            title={m.teachTodaysTimetable}
            language={language}
            action={
              <Link
                href="/timetable"
                className="focus-ring inline-flex min-h-11 items-center rounded-lg px-1 text-[13px] font-semibold text-accent-soft-foreground hover:underline"
              >
                {primary(m.teachFullWeek, language)}
              </Link>
            }
          >
            {!published ? (
              <Notice tone="neutral" text={m.teachNoTimetable} language={language} />
            ) : slots.length === 0 ? (
              <EmptyState title={m.teachNoPeriods} language={language} />
            ) : (
              <ol className="space-y-1.5">
                {lessons.map((lesson) => {
                  const rooms = lesson.classes
                    .map((entry) => entry.classLabel)
                    .join(" · ");

                  return (
                    <li
                      key={`${lesson.period}-${lesson.subjectCode}`}
                      className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2"
                    >
                      <span
                        aria-hidden
                        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[14px] font-bold tabular-nums text-muted-foreground"
                      >
                        {periodNumber(lesson.period)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-foreground">
                          {rooms}
                        </span>
                        <span className="block truncate text-[12px] text-subtle-foreground">
                          {lesson.subjectCode}
                          {lesson.classes.length > 1 ? (
                            <span className="ml-1.5">
                              · {primary(m.teachCombinedLesson, language)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {/* A combined lesson has no single class to open, and
                          offering one of the five would be picking a room at
                          random. */}
                      {lesson.classId ? (
                        <Link
                          href={`/teach/class/${lesson.classId}`}
                          aria-label={`${flat(m.teachOpenClass, language)} — ${rooms}`}
                          className={buttonClasses({ variant: "ghost", size: "icon" })}
                        >
                          <ChevronRight aria-hidden />
                        </Link>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        }
      />
    </>
  );
}
