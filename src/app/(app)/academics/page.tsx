import Link from "next/link";
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Grid3x3,
  UserCheck,
} from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  listClassAliases,
  listFeeClasses,
  listSubjects,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import {
  joinClassesToAliases,
  mappingProgress,
} from "@/modules/academics/domain/subjects";
import {
  listCalendarDays,
  listClassTeachers,
} from "@/modules/academics/data/class-teachers-repo";
import { listEnrolments } from "@/modules/enrolments/data/enrolments-repo";
import {
  assignmentProgress,
  joinClassesToTeachers,
} from "@/modules/academics/domain/class-teachers";
import { primary, secondary, t } from "@/platform/i18n/language";
import { Badge, Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.academicsTitle) };
}

/**
 * The academics hub.
 *
 * Its job is to say what is still missing, because that is what blocks the
 * Phase 2 timetable import: an unmapped class or a subject the sheet names and
 * this app does not.
 */
export default async function AcademicsPage() {
  const staff = await requirePermission("academics:view", "/academics");
  const language = staff.language;

  const sessionLabel = await resolveSessionLabel();
  const [subjects, classes, aliases, teachers, calendar, enrolments] =
    await Promise.all([
      listSubjects(),
      sessionLabel ? listFeeClasses(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listClassAliases(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listClassTeachers(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listCalendarDays(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listEnrolments(sessionLabel) : Promise.resolve([]),
    ]);

  const progress = mappingProgress(joinClassesToAliases(classes, aliases));
  const teacherProgress = assignmentProgress(
    joinClassesToTeachers(classes, teachers),
  );
  const activeSubjects = subjects.filter((subject) => subject.isActive).length;

  const cards = [
    {
      href: "/academics/subjects",
      icon: BookOpen,
      label: m.subjects,
      detail: t(
        `${activeSubjects} ${m.active.hi}`,
        `${activeSubjects} ${m.active.en}`,
      ),
      done: activeSubjects > 0,
    },
    {
      href: "/academics/classes",
      icon: Grid3x3,
      label: m.classLabels,
      detail: t(
        `${progress.mapped} / ${progress.total} ${m.classLabelsMapped.hi}`,
        `${progress.mapped} / ${progress.total} ${m.classLabelsMapped.en}`,
      ),
      done: progress.complete,
    },
    {
      href: "/academics/class-teachers",
      icon: UserCheck,
      label: m.classTeachers,
      detail: t(
        `${teacherProgress.assigned} / ${teacherProgress.total} ${m.classTeachersAssigned.hi}`,
        `${teacherProgress.assigned} / ${teacherProgress.total} ${m.classTeachersAssigned.en}`,
      ),
      done: teacherProgress.complete,
    },
    // Not tabs: the bar holds five, and these two are visited occasionally
    // rather than daily. They are listed in NON_NAV_SCREENS, and the
    // navigation test requires every screen to be one or the other.
    {
      href: "/calendar",
      icon: CalendarDays,
      label: m.calendarTitle,
      detail: t(
        `${calendar.length} ${m.calendarDaysEntered.hi}`,
        `${calendar.length} ${m.calendarDaysEntered.en}`,
      ),
      done: calendar.length > 0,
    },
    {
      href: "/enrolments",
      icon: ClipboardCheck,
      label: m.enrolmentsTitle,
      detail: t(
        `${enrolments.length} ${m.enrolmentsStudents.hi}`,
        `${enrolments.length} ${m.enrolmentsStudents.en}`,
      ),
      done: enrolments.length > 0,
    },
  ];

  return (
    <>
      <PageHeader
        title={m.academicsTitle}
        description={
          sessionLabel
            ? t(
                `${m.session.hi} ${sessionLabel}`,
                `${m.session.en} ${sessionLabel}`,
              )
            : m.noSession
        }
        language={language}
      />

      {!sessionLabel ? (
        <Notice tone="warning" text={m.noFeeClasses} language={language} />
      ) : null}

      <ul className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => {
          const under = secondary(card.label, language);
          return (
            <li key={card.href}>
              <Link
                href={card.href}
                className="focus-ring flex min-h-20 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground [&_svg]:size-5"
                >
                  <card.icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-foreground">
                    {primary(card.label, language)}
                    {under ? (
                      <span className="ml-2 text-[12px] font-normal text-subtle-foreground">
                        {under}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[13px] text-muted-foreground">
                    {primary(card.detail, language)}
                  </span>
                </span>
                <Badge tone={card.done ? "success" : "warning"}>
                  {primary(card.done ? m.done : m.pending, language)}
                </Badge>
              </Link>
            </li>
          );
        })}
      </ul>

      <Notice
        className="mt-6"
        tone="info"
        text={m.academicsNotice}
        language={language}
      />
    </>
  );
}
