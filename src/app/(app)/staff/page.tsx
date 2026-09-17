import Link from "next/link";
import { BookOpen, ClipboardCheck, Clock, Plus, Users } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { can } from "@/platform/auth/permissions";
import { flat, primary } from "@/platform/i18n/language";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listClassTeachers } from "@/modules/academics/data/class-teachers-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { StaffList } from "@/modules/staff/ui/staff-list";
import { FootNote } from "@/ui/panel";
import { buttonClasses } from "@/ui/primitives/button";
import { PageHeader } from "@/ui/shell/app-shell";
import { MetricCard, MetricGrid } from "@/ui/task-hero";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.staffTitle) };
}

export default async function StaffPage() {
  const staff = await requirePermission("staff:view", "/staff");
  const language = staff.language;

  const sessionLabel = await resolveSessionLabel();

  const [people, labels, assignments] = await Promise.all([
    listStaff(),
    sessionLabel ? classLabelMap(sessionLabel) : Promise.resolve(null),
    sessionLabel ? listClassTeachers(sessionLabel) : Promise.resolve(null),
  ]);

  /**
   * The four figures the atlas puts above the list.
   *
   * All four are counted from rows already on this page or from one extra
   * read, and every one of them is a fact this screen can act on: how many
   * accounts there are, whether every class has a teacher, who coordinates,
   * and who is waiting to be given a class.
   *
   * `classesAssigned` is null when there is no session to count against, and
   * renders as a dash — "no session" and "no class has a teacher" are very
   * different mornings (D-93).
   */
  const active = people.filter((person) => person.isActive);

  const current = (assignments ?? []).filter(
    (row) => row.effectiveTo === null && row.role === "class_teacher",
  );

  const classesWithTeacher = new Set(current.map((row) => row.classId)).size;
  const classesTotal = labels?.size ?? null;

  const coordinators = active.filter(
    (person) =>
      person.role === "academic_coordinator" || person.role === "exam_coordinator",
  ).length;

  const assignedStaff = new Set(current.map((row) => row.staffProfileId));
  const awaitingClass =
    assignments === null
      ? null
      : active.filter((person) => person.isTeaching && !assignedStaff.has(person.id))
          .length;

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowAdministration}
        title={m.staffTitle}
        description={m.staffIntro}
        language={language}
        action={
          can(staff, "staff:manage") ? (
            <Link
              href="/staff/new"
              className={buttonClasses({ size: "sm" })}
              aria-label={flat(m.staffNew, language)}
            >
              <Plus aria-hidden />
              {primary(m.add, language)}
            </Link>
          ) : null
        }
      />

      <MetricGrid>
        <MetricCard
          label={m.staffActiveCount}
          value={String(active.length)}
          detail={m.staffActiveHint}
          icon={Users}
          language={language}
        />
        <MetricCard
          label={m.staffClassesAssigned}
          value={classesTotal === null ? "—" : `${classesWithTeacher} / ${classesTotal}`}
          detail={
            classesTotal === null
              ? m.noSessionFound
              : classesWithTeacher < classesTotal
                ? m.staffClassesMissing
                : m.staffClassesAllHave
          }
          href="/academics/class-teachers"
          icon={ClipboardCheck}
          language={language}
          tone={
            classesTotal !== null && classesWithTeacher < classesTotal
              ? "warning"
              : "neutral"
          }
        />
        <MetricCard
          label={m.staffCoordinators}
          value={String(coordinators)}
          detail={m.staffCoordinatorsHint}
          icon={BookOpen}
          language={language}
        />
        <MetricCard
          label={m.staffAwaitingClass}
          value={awaitingClass === null ? "—" : String(awaitingClass)}
          detail={awaitingClass === null ? m.homeUnavailable : m.staffAwaitingClassHint}
          icon={Clock}
          language={language}
          tone={awaitingClass ? "warning" : "neutral"}
        />
      </MetricGrid>

      <StaffList className="mt-6" staff={people} />

      {/* The rule this screen exists to keep visible, and the one the design
          package asks twice to be stated: an office role is not an accountant
          (D-168). */}
      <FootNote
        className="mt-5"
        title={m.panelStaffNote}
        text={m.panelStaffNoteText}
        language={language}
      />
    </>
  );
}
