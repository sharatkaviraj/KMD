import Link from "next/link";
import { Plus } from "lucide-react";

import { setSubjectActiveAction } from "@/app/(app)/academics/actions";
import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { can } from "@/platform/auth/permissions";
import { listSubjects } from "@/modules/academics/data/academics-repo";
import { compareSubjects } from "@/modules/academics/domain/subjects";
import { primary } from "@/platform/i18n/language";
import { Badge } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.subjects) };
}

export default async function SubjectsPage() {
  const staff = await requirePermission("academics:view", "/academics/subjects");
  const language = staff.language;
  const subjects = (await listSubjects()).sort(compareSubjects);
  const mayManage = can(staff, "academics:manage");

  return (
    <>
      <PageHeader
        title={m.subjects}
        description={m.subjectsIntro}
        language={language}
        back={{ href: "/academics", label: m.academicsTitle }}
        action={
          mayManage ? (
            <Link href="/academics/subjects/new" className={buttonClasses({ size: "sm" })}>
              <Plus aria-hidden />
              {primary(m.add, language)}
            </Link>
          ) : null
        }
      />

      {subjects.length === 0 ? (
        <EmptyState
          title={m.subjectsNone}
          language={language}
          action={
            mayManage ? (
              <Link href="/academics/subjects/new" className={buttonClasses()}>
                {primary(m.subjectFirst, language)}
              </Link>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-2">
          {subjects.map((subject) => (
            <li
              key={subject.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <span
                aria-hidden
                className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-2 font-mono text-[13px] font-bold ${
                  subject.isActive
                    ? "bg-accent-soft text-accent-soft-foreground"
                    : "bg-surface-3 text-subtle-foreground"
                }`}
              >
                {subject.code}
              </span>

              {/* A subject's own names are data, not interface: both are shown
                  whatever the reader chose, because the school types them and
                  the timetable sheet may use either. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {language === "en" ? subject.nameEn : subject.nameHi}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {language === "en" ? subject.nameHi : subject.nameEn}
                </span>
              </span>

              {!subject.isActive ? (
                <Badge tone="neutral">{primary(m.inactive, language)}</Badge>
              ) : null}

              {mayManage ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/academics/subjects/${subject.id}`}
                    className={buttonClasses({ variant: "ghost", size: "sm" })}
                  >
                    {primary(m.edit, language)}
                  </Link>
                  <form action={setSubjectActiveAction}>
                    <input type="hidden" name="id" value={subject.id} />
                    <input
                      type="hidden"
                      name="isActive"
                      value={subject.isActive ? "false" : "true"}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {primary(subject.isActive ? m.remove : m.restore, language)}
                    </Button>
                  </form>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
