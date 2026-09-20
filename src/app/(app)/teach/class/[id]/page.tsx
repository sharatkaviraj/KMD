import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { primary, t } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import {
  classLabelMap,
  resolveSessionLabel,
} from "@/modules/academics/data/academics-repo";
import { classRoll } from "@/modules/attendance/data/attendance-repo";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { compareRoll } from "@/modules/attendance/domain/attendance";
import { listNoteKinds, notesForClass } from "@/modules/notes/data/notes-repo";
import { canReadNote } from "@/modules/notes/domain/notes";
import { NoteComposer } from "@/modules/notes/ui/note-composer";
import { NoteList } from "@/modules/notes/ui/note-list";
import { Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.teachClassTitle) };
}

/**
 * One class: who is in it, what has been written about it, and the two ways in
 * — today's register and the month's.
 *
 * The roll is the useful part. Every name is a link to that child's card,
 * because the question a teacher arrives with is nearly always about one
 * child, and making them go back to a search to find somebody they are
 * looking straight at is the sort of thing that gets an app left unopened.
 */
export default async function ClassPage(props: PageProps<"/teach/class/[id]">) {
  const staff = await requirePermission("attendance:view", "/teach");
  const language = staff.language;
  const { id: classId } = await props.params;
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <>
        <PageHeader eyebrow={m.eyebrowMyClass} title={m.teachClassTitle} language={language} back={BACK} />
        <EmptyState title={m.noSessionFound} language={language} />
      </>
    );
  }

  const [labels, roll, own, kinds] = await Promise.all([
    classLabelMap(sessionLabel),
    classRoll({ classId, sessionLabel }),
    ownClassIds(staff.id, sessionLabel),
    listNoteKinds(),
  ]);

  const classLabel = labels.get(classId) ?? "—";
  const today = schoolToday();

  const allNotes = can(staff, "notes:view")
    ? await notesForClass(classId, sessionLabel)
    : [];

  const notes = allNotes.filter((note) =>
    canReadNote({
      hasNotesView: can(staff, "notes:view"),
      // Office and admin follow up on concerns; that is the job, so they see
      // every note rather than only the ones about classes they hold.
      seesEverything: can(staff, "attendance:correct"),
      ownClassIds: own,
      note,
      staffId: staff.id,
    }),
  );

  return (
    <>
      <PageHeader eyebrow={m.eyebrowMyClass}
        title={t(classLabel, classLabel)}
        description={t(
          `${roll.length} ${m.teachStudents.hi}`,
          `${roll.length} ${m.teachStudents.en}`,
        )}
        language={language}
        back={BACK}
        action={
          <Link
            href={`/teach/attendance?class=${classId}&day=${today}`}
            className={buttonClasses({ size: "sm" })}
          >
            {primary(m.teachTakeRegister, language)}
          </Link>
        }
      />

      <div className="mb-6">
        <Link
          href={`/teach/register?class=${classId}&month=${today.slice(0, 7)}`}
          className={buttonClasses({ variant: "outline", fullWidth: true })}
        >
          {primary(m.teachViewRegister, language)}
        </Link>
      </div>

      <Section title={m.teachRoll} language={language}>
        {roll.length === 0 ? (
          <EmptyState title={m.attendanceEmptyRoll} language={language} />
        ) : (
          <ul className="space-y-1.5">
            {[...roll].sort(compareRoll).map((student) => (
              <li key={student.studentId}>
                <Link
                  href={`/teach/student/${student.studentId}`}
                  className="focus-ring flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 transition-colors hover:bg-surface-2"
                >
                  <span className="w-8 shrink-0 text-[13px] font-semibold tabular-nums text-subtle-foreground">
                    {student.rollNo ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-foreground">
                    {student.fullName}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-subtle-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {can(staff, "notes:view") ? (
        <Section className="mt-8" title={m.notesTitle} language={language}>
          <NoteList
            notes={notes}
            language={language}
            staffId={staff.id}
            classId={classId}
          />
        </Section>
      ) : null}

      {can(staff, "notes:write") ? (
        <Section
          className="mt-6"
          title={m.notesAboutClass}
          language={language}
        >
          <NoteComposer kinds={kinds} classId={classId} />
        </Section>
      ) : null}
    </>
  );
}

const BACK = { href: "/teach", label: m.teachTitle };
