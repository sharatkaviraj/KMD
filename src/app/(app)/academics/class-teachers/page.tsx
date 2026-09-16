import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { t } from "@/platform/i18n/language";
import {
  listFeeClasses,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { listClassTeachers } from "@/modules/academics/data/class-teachers-repo";
import {
  assignmentProgress,
  joinClassesToTeachers,
} from "@/modules/academics/domain/class-teachers";
import { ClassTeacherEditor } from "@/modules/academics/ui/class-teacher-editor";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { Notice } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.classTeachers) };
}

export default async function ClassTeachersPage() {
  const staff = await requirePermission("academics:view", "/academics/class-teachers");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader
          title={m.classTeachers}
          language={language}
          back={{ href: "/academics", label: m.academicsTitle }}
        />
        <EmptyState title={m.classLabelsNothing} language={language} />
      </>
    );
  }

  const [classes, assignments, allStaff] = await Promise.all([
    listFeeClasses(sessionLabel),
    listClassTeachers(sessionLabel),
    listStaff(),
  ]);

  const rows = joinClassesToTeachers(classes, assignments);
  const progress = assignmentProgress(rows);
  // Only active teaching staff can hold a class — the same rule the action
  // enforces, applied here so the wrong name is never in the list.
  const teachers = allStaff
    .filter((person) => person.isActive && person.isTeaching)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={m.classTeachers}
        description={t(
          `${m.session.hi} ${sessionLabel} — ${progress.assigned} / ${progress.total} ${m.classTeachersAssigned.hi}`,
          `${m.session.en} ${sessionLabel} — ${progress.assigned} / ${progress.total} ${m.classTeachersAssigned.en}`,
        )}
        language={language}
        back={{ href: "/academics", label: m.academicsTitle }}
      />

      <Notice
        className="mb-4"
        tone={progress.complete ? "success" : "info"}
        text={progress.complete ? m.classTeachersDone : m.classTeachersTodo}
        language={language}
      />

      <Notice
        className="mb-4"
        tone="neutral"
        text={m.classTeachersIntro}
        language={language}
      />

      <ClassTeacherEditor
        rows={rows}
        teachers={teachers}
        sessionLabel={sessionLabel}
        today={today}
        editable={can(staff, "academics:manage")}
      />
    </>
  );
}
