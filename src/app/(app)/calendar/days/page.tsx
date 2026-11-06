import { schoolToday } from "@/platform/dates";
import * as m from "@/messages/pairs";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { t } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listCalendarDays } from "@/modules/academics/data/class-teachers-repo";
import { CalendarEditor } from "@/modules/academics/ui/calendar-editor";
import { EmptyState } from "@/ui/states";
import { Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.calendarTitle) };
}

export default async function CalendarPage() {
  const staff = await requirePermission("academics:view", "/calendar/days");
  const language = staff.language;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowAcademics} title={m.calendarTitle} language={language} />
        <EmptyState title={m.classLabelsNothing} language={language} />
      </>
    );
  }

  const days = await listCalendarDays(sessionLabel);
  const today = schoolToday();

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAcademics}
        title={m.calendarTitle}
        description={t(
          `${m.session.hi} ${sessionLabel} — ${days.length} ${m.calendarDaysEntered.hi}`,
          `${m.session.en} ${sessionLabel} — ${days.length} ${m.calendarDaysEntered.en}`,
        )}
        language={language}
      />

      <Notice className="mb-4" tone="info" text={m.calendarIntro} language={language} />

      <CalendarEditor
        days={days}
        sessionLabel={sessionLabel}
        today={today}
        editable={can(staff, "academics:manage")}
      />
    </>
  );
}
