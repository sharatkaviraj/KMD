import Link from "next/link";
import { Users } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { dayLabel, isIsoDay, schoolToday, weekdayLabel } from "@/platform/dates";
import { flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  attendanceCalendar,
  classRoll,
  findRegister,
  listMarks,
} from "@/modules/attendance/data/attendance-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import {
  canMarkClass,
  isEditable,
  type AttendanceStatus,
} from "@/modules/attendance/domain/attendance";
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
 * The register.
 *
 * Reached with `?class=…&day=…`, and with neither it offers a class to pick
 * rather than guessing — a register filed against the wrong class is worse
 * than one not taken, because it looks done.
 *
 * The screen's own job is small: work out whether this person may mark this
 * class, load the roll and whatever is already recorded, and hand it to the
 * form. The rules live in `canMarkClass()`, the offline behaviour in the form,
 * and the idempotency in the upsert. Nothing here is clever, which is the
 * point.
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
  const requestedPeriod = typeof params.period === "string" ? params.period : null;

  // A day from the URL is a day somebody typed. An unparseable one falls back
  // to today rather than throwing — the register still opens, on the right
  // date.
  const day = requestedDay && isIsoDay(requestedDay) ? requestedDay : schoolToday();
  const period =
    requestedPeriod && /^\d{1,2}$/.test(requestedPeriod)
      ? Number(requestedPeriod)
      : null;

  const [labels, own] = await Promise.all([
    classLabelMap(sessionLabel),
    ownClassIds(staff.id, sessionLabel),
  ]);

  const dayText = t(
    `${weekdayLabel(day).hi}, ${dayLabel(day).hi}`,
    `${weekdayLabel(day).en}, ${dayLabel(day).en}`,
  );

  /* ------------------------------------------------- nothing chosen */

  if (!requestedClass) {
    // Everything this person may mark: their own classes, or every class when
    // they mark on the school's behalf.
    const choices = can(staff, "attendance:mark_on_behalf")
      ? [...labels.entries()].map(([classId, classLabel]) => ({
          classId,
          classLabel,
        }))
      : own.map((classId) => ({
          classId,
          classLabel: labels.get(classId) ?? "—",
        }));

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

  const verdict = canMarkClass({
    hasMarkPermission: can(staff, "attendance:mark"),
    hasMarkOnBehalfPermission: can(staff, "attendance:mark_on_behalf"),
    ownClassIds: own,
    classId: requestedClass,
  });

  const classLabel = labels.get(requestedClass) ?? "—";

  const [roll, register, calendar] = await Promise.all([
    classRoll({ classId: requestedClass, sessionLabel }),
    findRegister(requestedClass, sessionLabel, day, period),
    attendanceCalendar(sessionLabel),
  ]);

  const marks = register ? await listMarks(register.id) : new Map();
  const existing: Record<string, AttendanceStatus> = Object.fromEntries(
    [...marks.entries()].map(([studentId, mark]) => [studentId, mark.status]),
  );

  // Submitted is locked; so is a day the school was shut, because a register
  // for a holiday is almost always the wrong date rather than a real one.
  const closed = !isSchoolOpen(day, calendar);
  const locked = !isEditable(register) || !verdict.allowed || closed;

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowMyClass}
        title={t(`${classLabel}`, `${classLabel}`)}
        // The day and how many children are on the roll — which is what makes
        // "32 marked" mean something when you are halfway down the list.
        description={t(
          `${dayText.hi} · ${roll.length} बच्चे`,
          `${dayText.en} · ${roll.length} children`,
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
        <Notice
          className="mb-4"
          tone="warning"
          text={m.teachSchoolClosed}
          language={language}
        />
      ) : null}

      {!verdict.allowed && verdict.reason ? (
        <Notice
          className="mb-4"
          tone="danger"
          text={verdict.reason}
          language={language}
        />
      ) : null}

      <HomeColumns
        main={
          <>
            <RegisterForm
              key={`${staff.id}/${sessionLabel}/${requestedClass}/${day}/${period}`}
              ownerId={staff.id}
              sessionLabel={sessionLabel}
              roll={roll}
              classId={requestedClass}
              classLabel={classLabel}
              day={day}
              period={period}
              existing={existing}
              locked={locked}
              onBehalf={verdict.allowed && verdict.onBehalf}
            />

            {/* A submitted register is a record. Changing it goes through
                somebody else, which is what this form is. */}
            {register && register.status === "submitted" && roll.length > 0 ? (
              <section className="mt-8">
                <h2 className="mb-3 text-[15px] font-semibold text-foreground">
                  {flat(m.correctionRequest, language)}
                </h2>
                <CorrectionRequestForm
                  registerId={register.id}
                  roll={roll}
                  existing={existing}
                />
              </section>
            ) : null}
          </>
        }
        aside={
          // How to take a register quickly, beside the register on a desk and
          // under it on a phone.
          //
          // **The live counts stay in the form**, which is where the state is.
          // The atlas draws them in this column; lifting them out would mean
          // threading the offline queue's state through the page, and the
          // queue is the part of this screen least worth destabilising for a
          // layout. Recorded as a deviation.
          locked ? undefined : (
            <FootNote
              title={m.panelExceptionsFirst}
              text={m.panelExceptionsFirstText}
              language={language}
            />
          )
        }
      />
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
