import Link from "next/link";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import {
  daysInMonth,
  dayOfMonth,
  monthBounds,
  monthLabel,
  schoolToday,
  shiftMonth,
} from "@/platform/dates";
import { flat, primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import {
  attendanceCalendar,
  classAttendanceRange,
  classRoll,
} from "@/modules/attendance/data/attendance-repo";
import {
  attendanceInitials,
  attendanceLabels,
  attendanceStatuses,
} from "@/modules/attendance/domain/attendance";
import {
  belowThreshold,
  buildMonthlySheet,
  sheetTotals,
} from "@/modules/attendance/domain/register-sheet";
import { PrintButton } from "@/modules/attendance/ui/print-button";
import { Badge, Card } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.registerMonthly) };
}

/**
 * The monthly register, as the school keeps it on paper.
 *
 * Printed rather than exported to a PDF file: the browser's own print dialogue
 * produces a PDF on every device the school uses, honours the paper size the
 * office actually has, and costs no dependency, no server-side renderer and no
 * second set of fonts that would have to be shipped for Devanagari. `@media
 * print` in `globals.css` drops the chrome; what is left is the sheet.
 *
 * Landscape is asked for in the stylesheet because a month of columns does not
 * fit across A4 portrait, and a register that silently loses its last week is
 * worse than one that needs a setting changed.
 */
export default async function RegisterPage(props: PageProps<"/teach/register">) {
  const staff = await requirePermission("attendance:view", "/teach/register");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader title={m.registerMonthly} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const params = await props.searchParams;
  const requestedClass = typeof params.class === "string" ? params.class : null;
  const requestedMonth = typeof params.month === "string" ? params.month : null;

  const month =
    requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
      ? requestedMonth
      : schoolToday().slice(0, 7);

  const labels = await classLabelMap(sessionLabel);

  /* ------------------------------------------------- nothing chosen */

  if (!requestedClass) {
    // No sort: the map arrives in school order (B-06).
    const choices = [...labels.entries()];

    return (
      <>
        <PageHeader
          title={m.registerMonthly}
          description={monthLabel(month)}
          language={language}
          back={BACK}
        />
        <ul className="grid gap-2 sm:grid-cols-2">
          {choices.map(([classId, classLabel]) => (
            <li key={classId}>
              <Link
                href={`/teach/register?class=${classId}&month=${month}`}
                className="focus-ring flex min-h-14 items-center rounded-xl border border-border bg-surface px-4 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-surface-2"
              >
                {classLabel}
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  /* ------------------------------------------------------ the sheet */

  const { from, to } = monthBounds(month);
  const classLabel = labels.get(requestedClass) ?? "—";

  const [roll, marks, calendar] = await Promise.all([
    classRoll({ classId: requestedClass, sessionLabel }),
    classAttendanceRange(requestedClass, sessionLabel, from, to),
    attendanceCalendar(sessionLabel),
  ]);

  const openDays = daysInMonth(month).filter((day) => isSchoolOpen(day, calendar));
  const sheet = buildMonthlySheet({ month, roll, openDays, marks });
  const totals = sheetTotals(sheet);
  const struggling = belowThreshold(sheet, 75);

  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={m.registerMonthly}
          description={t(
            `${classLabel} · ${monthLabel(month).hi}`,
            `${classLabel} · ${monthLabel(month).en}`,
          )}
          language={language}
          back={BACK}
          action={<PrintButton />}
        />

        <div className="mb-5 flex items-center gap-2">
          <Link
            href={`/teach/register?class=${requestedClass}&month=${previous}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            ← {primary(monthLabel(previous), language)}
          </Link>
          <Link
            href={`/teach/register?class=${requestedClass}&month=${next}`}
            className={buttonClasses({ variant: "outline", size: "sm" })}
          >
            {primary(monthLabel(next), language)} →
          </Link>
        </div>
      </div>

      {/* The printed heading. On screen it is redundant with the page header,
          which is why that one is `print:hidden` and this one is not. */}
      <div className="mb-3 hidden print:block">
        <h1 className="text-[16px] font-bold">
          {classLabel} — {flat(monthLabel(month), language)}
        </h1>
        <p className="text-[11px]">
          {flat(m.session, language)} {sessionLabel}
        </p>
      </div>

      {sheet.rows.length === 0 ? (
        <EmptyState title={m.attendanceEmptyRoll} language={language} />
      ) : sheet.days.length === 0 ? (
        <EmptyState title={m.registerNoData} language={language} />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 print:mx-0 print:overflow-visible print:px-0">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 border border-border bg-surface-2 px-2 py-1.5 text-left font-semibold"
                  >
                    {primary(m.teachRoll, language)}
                  </th>
                  {sheet.days.map((day) => (
                    <th
                      key={day}
                      scope="col"
                      className="border border-border bg-surface-2 px-1 py-1.5 text-center font-semibold tabular-nums"
                    >
                      {dayOfMonth(day)}
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="border border-border bg-surface-2 px-2 py-1.5 text-center font-semibold"
                  >
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row) => (
                  <tr key={row.student.studentId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-44 truncate border border-border bg-surface px-2 py-1 text-left font-medium"
                    >
                      <span className="mr-1.5 tabular-nums text-subtle-foreground">
                        {row.student.rollNo ?? "—"}
                      </span>
                      {row.student.fullName}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td
                        key={sheet.days[index]}
                        className={
                          "border border-border px-1 py-1 text-center font-semibold " +
                          (cell === "absent"
                            ? "bg-destructive-soft text-destructive-soft-foreground"
                            : cell === null
                              ? "text-subtle-foreground"
                              : "text-foreground")
                        }
                      >
                        {cell ? primary(attendanceInitials[cell], language) : ""}
                      </td>
                    ))}
                    <td className="border border-border px-2 py-1 text-center font-semibold tabular-nums">
                      {row.percent === null ? "—" : row.percent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ------------------------------------------------ the key */}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span className="font-semibold">{primary(m.registerKey, language)}:</span>
            {attendanceStatuses.map((status) => (
              <span key={status}>
                <b className="text-foreground">
                  {primary(attendanceInitials[status], language)}
                </b>{" "}
                {primary(attendanceLabels[status], language)}
              </span>
            ))}
            <span>{primary(m.registerBlankDay, language)}</span>
          </div>

          <Card className="mt-5 p-4 print:mt-3 print:border-0 print:p-0 print:shadow-none">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">
                {primary(m.registerDaysRecorded, language)} {sheet.daysRecorded}
              </Badge>
              <Badge tone="neutral">
                {primary(m.registerWorkingDays, language)} {openDays.length}
              </Badge>
              <Badge tone={totals.percent !== null && totals.percent < 75 ? "warning" : "success"}>
                {primary(m.registerClassTotal, language)}{" "}
                {totals.percent === null ? "—" : `${totals.percent}%`}
              </Badge>
              {struggling.length > 0 ? (
                <Badge tone="danger">
                  {primary(m.registerBelow, language)} {struggling.length}
                </Badge>
              ) : null}
            </div>
          </Card>
        </>
      )}
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
