import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Grid3x3,
  MessageSquare,
  UserCheck,
} from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
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
import { FootNote, Panel, PanelRow } from "@/ui/panel";
import { attendanceRules } from "@/modules/attendance/data/attendance-repo";
import { AttendanceRulesForm } from "@/modules/attendance/ui/attendance-rules-form";
import { Badge, Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";
import { HomeColumns } from "@/ui/task-hero";

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
  const [subjects, classes, aliases, teachers, calendar, enrolments, rules] =
    await Promise.all([
      listSubjects(),
      sessionLabel ? listFeeClasses(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listClassAliases(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listClassTeachers(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listCalendarDays(sessionLabel) : Promise.resolve([]),
      sessionLabel ? listEnrolments(sessionLabel) : Promise.resolve([]),
      sessionLabel ? attendanceRules(sessionLabel) : Promise.resolve(null),
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

  /**
   * What an administrator watches rather than edits.
   *
   * Filtered by permission, not by role name: the same two rows are on the
   * Setup group of the sidebar, and a coordinator who cannot open the job
   * console must not be offered it here either.
   */
  const operational = [
    can(staff, "jobs:view")
      ? {
          href: "/jobs",
          icon: Clock,
          label: m.jobsTitle,
          detail: m.jobsIntro,
        }
      : null,
    can(staff, "collection:view")
      ? {
          href: "/collection/messages",
          icon: MessageSquare,
          label: m.messagesTitle,
          detail: m.messagesIntro,
        }
      : null,
  ].filter((row) => row !== null);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
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

      <HomeColumns
        main={
          <>
            <Panel
              title={m.panelAcademicSetup}
              description={
                sessionLabel
                  ? t(`अभी का सत्र · ${sessionLabel}`, `Current session · ${sessionLabel}`)
                  : m.noSession
              }
              language={language}
            >
              {cards.map((card) => (
                <PanelRow
                  key={card.href}
                  href={card.href}
                  icon={card.icon}
                  tone="accent"
                  title={
                    <>
                      {primary(card.label, language)}
                      {secondary(card.label, language) ? (
                        <span className="ml-2 text-[12px] font-normal text-subtle-foreground">
                          {secondary(card.label, language)}
                        </span>
                      ) : null}
                    </>
                  }
                  detail={primary(card.detail, language)}
                  trailing={
                    <Badge tone={card.done ? "success" : "warning"}>
                      {primary(card.done ? m.done : m.pending, language)}
                    </Badge>
                  }
                />
              ))}
            </Panel>

            <Notice
              className="mt-6"
              tone="info"
              text={m.academicsNotice}
              language={language}
            />

            {/* How a half day counts (P6): one rule every percentage reads. */}
            {rules ? (
              <section className="mt-6" aria-labelledby="attendance-rules">
                <h2 id="attendance-rules" className="mb-3 text-[15px] font-semibold text-foreground">
                  {primary(m.attendanceRulesTitle, language)}
                </h2>
                {can(staff, "academics:manage") ? (
                  <AttendanceRulesForm halfDayCredit={rules.halfDayCredit} />
                ) : (
                  <p className="text-[14px] text-muted-foreground">
                    {primary(m.attendanceRulesHalfDay, language)}: <b>{rules.halfDayCredit}</b>
                  </p>
                )}
              </section>
            ) : null}
          </>
        }
        aside={
          // The atlas puts the things an administrator looks at rather than
          // edits in a column beside the setup itself. Only the rows this
          // account may actually open: `jobs:view` is admin-only, and offering
          // a door that answers /access-denied is worse than not offering it.
          operational.length > 0 ? (
            <>
              <Panel
                title={m.panelOperational}
                description={m.panelOperationalHint}
                language={language}
              >
                {operational.map((row) => (
                  <PanelRow
                    key={row.href}
                    href={row.href}
                    icon={row.icon}
                    title={primary(row.label, language)}
                    detail={primary(row.detail, language)}
                  />
                ))}
              </Panel>

              <FootNote
                title={m.panelPreviewEffect}
                text={m.panelPreviewEffectText}
                language={language}
              />
            </>
          ) : undefined
        }
      />
    </>
  );
}
