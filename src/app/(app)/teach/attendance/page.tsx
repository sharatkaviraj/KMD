import Link from "next/link";
import { Users } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel, isIsoDay, schoolToday, weekdayLabel } from "@/platform/dates";
import { counted, flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  attendanceCalendar,
  findRegister,
  latestReceipt,
  listMarks,
  registerRevisions,
  rosterOn,
} from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { NotYourClass } from "@/modules/attendance/ui/not-your-class";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import {
  attendanceLabels,
  registerAuthority,
  type AttendanceStatus,
} from "@/modules/attendance/domain/attendance";
import { revisionLine, schoolClockTime } from "@/modules/attendance/domain/attendance-receipt";
import { CorrectionRequestForm } from "@/modules/attendance/ui/correction-request-form";
import { RegisterForm } from "@/modules/attendance/ui/register-form";
import { FootNote, Panel, PanelRow } from "@/ui/panel";
import { Notice } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";
import { HomeColumns } from "@/ui/task-hero";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.attendanceTitle) };
}

/**
 * One class's daily register (P6).
 *
 * Reached with `?class=…&day=…`, and with neither it offers a class to pick
 * rather than guessing — a register filed against the wrong class is worse
 * than one not taken, because it looks done.
 *
 * The roll is the roll **on that date**, from the enrolment record, so a past
 * day shows who was in the class then. Opening the page records nothing. Who
 * may save or correct is `registerAuthority()`: the class teacher or assistant
 * as of today, or the office; a subject teacher reads her classes and may ask
 * for a correction. The database decides all of it again when a save arrives.
 */
export default async function AttendancePage(
  props: PageProps<"/teach/attendance">,
) {
  const staff = await requirePermission("attendance:view", "/teach/attendance");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.attendanceTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const params = await props.searchParams;
  const requestedClass = typeof params.class === "string" ? params.class : null;
  const requestedDay = typeof params.day === "string" ? params.day : null;

  // A day from the URL is a day somebody typed. An unparseable one falls back
  // to today rather than throwing — the register still opens, on the right
  // date.
  const day = requestedDay && isIsoDay(requestedDay) ? requestedDay : schoolToday();

  const [labels, held, scope] = await Promise.all([
    classLabelMap(sessionLabel),
    heldClassIds(staff.id, sessionLabel),
    classScopeFor(staff, sessionLabel),
  ]);

  const dayText = t(
    `${weekdayLabel(day).hi}, ${dayLabel(day).hi}`,
    `${weekdayLabel(day).en}, ${dayLabel(day).en}`,
  );

  /* ------------------------------------------------- nothing chosen */

  if (!requestedClass) {
    // The registers this person takes: the classes they hold today, or every
    // class when they record on the school's behalf.
    const choices = can(staff, "attendance:mark_on_behalf")
      ? [...labels.entries()].map(([classId, classLabel]) => ({ classId, classLabel }))
      : held.map((classId) => ({ classId, classLabel: labels.get(classId) ?? "—" }));

    // A subset of the classes — this teacher's own — so it needs the school's
    // order applied rather than inherited from iterating the map (B-06).
    const rank = rankOf(labels);
    choices.sort(
      (a, b) =>
        (rank.get(a.classId) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.classId) ?? Number.MAX_SAFE_INTEGER),
    );

    return (
      <>
        <PageHeader
          eyebrow={m.eyebrowMyClass}
          title={m.attendanceTitle}
          description={dayText}
          language={language}
          back={BACK}
        />

        {choices.length === 0 ? (
          <EmptyState title={m.attendanceNotYours} language={language} />
        ) : (
          <Panel
            title={m.teachChooseClass}
            description={m.attendanceNoClassChosen}
            language={language}
          >
            {choices.map((choice) => (
              <PanelRow
                key={choice.classId}
                href={`/teach/attendance?class=${choice.classId}&day=${day}`}
                icon={Users}
                title={choice.classLabel}
              />
            ))}
          </Panel>
        )}
      </>
    );
  }

  /* ------------------------------------------------ a class, a day */

  const authority = registerAuthority({
    isOwner: held.includes(requestedClass),
    hasMarkPermission: can(staff, "attendance:mark"),
    hasMarkOnBehalfPermission: can(staff, "attendance:mark_on_behalf"),
    hasCorrectPermission: can(staff, "attendance:correct"),
  });

  // Reading a class is wider than taking its register — a coordinator reads
  // every register and takes none — but it is still bounded. Outside the
  // reader's scope the roll is never read (P1).
  if (!scopeIncludes(scope, requestedClass) && !authority.save && !authority.correct) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.attendanceTitle} language={language} back={BACK} />
        <NotYourClass language={language} />
      </>
    );
  }

  const classLabel = labels.get(requestedClass) ?? "—";

  const [roll, register, calendar] = await Promise.all([
    rosterOn({ classId: requestedClass, sessionLabel, day }),
    findRegister(requestedClass, sessionLabel, day, null),
    attendanceCalendar(sessionLabel),
  ]);

  const recorded = register !== null && register.revision >= 1;
  const [marks, receipt, history] = recorded
    ? await Promise.all([listMarks(register.id), latestReceipt(register.id), registerRevisions(register.id)])
    : [new Map<string, { status: AttendanceStatus; note: string | null }>(), null, []];

  const saved: Record<string, AttendanceStatus> = Object.fromEntries(
    [...marks.entries()].map(([studentId, mark]) => [studentId, mark.status]),
  );

  // A day the school was shut, or one that has not happened, takes no
  // register: almost always the wrong date rather than a real one.
  const closed = !isSchoolOpen(day, calendar) || day > schoolToday();
  const nameOf = new Map(roll.map((student) => [student.studentId, student.fullName]));

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowMyClass}
        title={t(`${classLabel}`, `${classLabel}`)}
        // The day and how many children were on the roll that day — which is
        // what makes the counts mean something halfway down the list.
        description={t(
          `${dayText.hi} · ${counted(roll.length, m.childOne, m.childMany).hi}`,
          `${dayText.en} · ${counted(roll.length, m.childOne, m.childMany).en}`,
        )}
        language={language}
        back={BACK}
        action={
          <Link
            href={`/teach/register?class=${requestedClass}&month=${day.slice(0, 7)}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            {primary(m.registerMonthly, language)}
          </Link>
        }
      />

      {closed ? (
        <Notice className="mb-4" tone="warning" text={m.teachSchoolClosed} language={language} />
      ) : null}

      {!authority.save && !authority.correct && authority.reason ? (
        <Notice className="mb-4" tone="info" text={authority.reason} language={language} />
      ) : null}

      <HomeColumns
        main={
          <>
            <RegisterForm
              // A new revision or a changed roll is a different register to
              // draw: the form starts again from what the server now says.
              key={`${staff.id}/${sessionLabel}/${requestedClass}/${day}/${register?.revision ?? 0}/${roll.length}`}
              ownerId={staff.id}
              sessionLabel={sessionLabel}
              roll={roll}
              classId={requestedClass}
              classLabel={classLabel}
              day={day}
              dayText={dayText}
              revision={register?.revision ?? 0}
              saved={saved}
              receipt={receipt}
              canSave={authority.save}
              canCorrect={authority.correct}
              onBehalf={authority.onBehalf}
              closed={closed}
            />

            {/* Somebody who reads this class but may not change it asks the
                people who can. */}
            {recorded && !authority.correct && roll.length > 0 ? (
              <section className="mt-8">
                <h2 className="mb-1 text-[15px] font-semibold text-foreground">
                  {flat(m.correctionRequest, language)}
                </h2>
                <p className="mb-3 text-[13px] text-muted-foreground">{primary(m.attendanceAskInstead, language)}</p>
                <CorrectionRequestForm registerId={register.id} roll={roll} existing={saved} />
              </section>
            ) : null}

            {history.length > 0 ? (
              <section className="mt-8" aria-labelledby="register-history">
                <h2 id="register-history" className="mb-2 text-[15px] font-semibold text-foreground">
                  {primary(m.attendanceHistory, language)}
                </h2>
                <ol className="space-y-2 text-[13px]">
                  {history.map((entry) => (
                    <li key={entry.revision} className="rounded-xl border border-border bg-surface px-3 py-2">
                      <p className="font-medium text-foreground">
                        {entry.kind === "imported"
                          ? `${entry.revision} · ${primary(m.attendanceHistoryImported, language)}`
                          : primary(revisionLine(entry), language)}
                      </p>
                      {entry.reason ? <p className="mt-0.5 text-muted-foreground">“{entry.reason}”</p> : null}
                      {entry.kind === "correction" && entry.changes.length > 0 ? (
                        <ul className="mt-1 text-muted-foreground">
                          {entry.changes.map((change) => (
                            <li key={change.studentId}>
                              {nameOf.get(change.studentId) ?? "—"}:{" "}
                              {change.from ? primary(attendanceLabels[change.from], language) : "—"} →{" "}
                              {primary(attendanceLabels[change.to], language)}
                            </li>
                          ))}
                        </ul>
                      ) : entry.kind === "imported" ? (
                        <p className="mt-0.5 text-subtle-foreground">{schoolClockTime(entry.savedAt)}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        }
        aside={
          // How to take a register quickly, beside the register on a desk and
          // under it on a phone.
          authority.save && !recorded && !closed ? (
            <FootNote title={m.panelExceptionsFirst} text={m.panelExceptionsFirstText} language={language} />
          ) : undefined
        }
      />
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
