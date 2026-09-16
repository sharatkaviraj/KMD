import Link from "next/link";
import { Plus } from "lucide-react";

import { setSubjectActiveAction } from "@/app/(app)/academics/actions";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { listSubjects } from "@/modules/academics/data/academics-repo";
import { compareSubjects } from "@/modules/academics/domain/subjects";
import { Badge } from "@/ui/primitives";
import { Button, buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "विषय · VPPS One" };

export default async function SubjectsPage() {
  const staff = await requirePermission("academics:view", "/academics/subjects");
  const subjects = (await listSubjects()).sort(compareSubjects);
  const mayManage = can(staff, "academics:manage");

  return (
    <>
      <PageHeader
        title="विषय"
        titleEn="Subjects"
        back={{ href: "/academics", label: "शैक्षणिक" }}
        description="कोड वही रखें जो समय-सारिणी की शीट में है। · Use the code exactly as the timetable sheet writes it."
        action={
          mayManage ? (
            <Link href="/academics/subjects/new" className={buttonClasses({ size: "sm" })}>
              <Plus aria-hidden />
              जोड़ें
            </Link>
          ) : null
        }
      />

      {subjects.length === 0 ? (
        <EmptyState
          hi="अभी कोई विषय नहीं है।"
          en="Add every subject the timetable names. Phase 2 resolves each cell against this list."
          action={
            mayManage ? (
              <Link href="/academics/subjects/new" className={buttonClasses()}>
                पहला विषय जोड़ें
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

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {subject.nameHi}
                </span>
                <span className="block truncate text-[13px] text-muted-foreground">
                  {subject.nameEn}
                </span>
              </span>

              {!subject.isActive ? <Badge tone="neutral">निष्क्रिय</Badge> : null}

              {mayManage ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/academics/subjects/${subject.id}`}
                    className={buttonClasses({ variant: "ghost", size: "sm" })}
                  >
                    बदलें
                  </Link>
                  <form action={setSubjectActiveAction}>
                    <input type="hidden" name="id" value={subject.id} />
                    <input
                      type="hidden"
                      name="isActive"
                      value={subject.isActive ? "false" : "true"}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {subject.isActive ? "हटाएँ" : "वापस"}
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
