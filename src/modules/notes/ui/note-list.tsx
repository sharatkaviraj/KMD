import { m } from "@/messages";
import { deleteNoteAction } from "@/app/(app)/teach/actions";
import { byNewest, type Note, type NoteTone } from "@/modules/notes/domain/notes";
import { dayLabel } from "@/platform/dates";
import { primary, type Language } from "@/platform/i18n/language";
import { Badge } from "@/ui/primitives";
import { EmptyState } from "@/ui/states";

const TONE: Record<NoteTone, "neutral" | "success" | "warning"> = {
  neutral: "neutral",
  good: "success",
  concern: "warning",
};

/**
 * Notes, newest first.
 *
 * A Server Component: there is nothing interactive here except removing your
 * own note, and that is a form posting to an action — which works without
 * JavaScript and needs no hydration for a list that can run to a hundred rows.
 *
 * Remove is offered only on your own notes, and the action enforces it in the
 * query as well. Somebody else's note about a child is their record of a
 * conversation, not yours to delete.
 */
export function NoteList({
  notes,
  language,
  staffId,
  studentId = "",
  classId = "",
}: {
  notes: Note[];
  language: Language;
  staffId: string;
  studentId?: string;
  classId?: string;
}) {
  if (notes.length === 0) {
    return <EmptyState title={m.notesNone} language={language} />;
  }

  return (
    <ul className="space-y-2">
      {[...notes].sort(byNewest).map((note) => (
        <li
          key={note.id}
          className="rounded-2xl border border-border bg-surface p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <Badge tone={TONE[note.tone]}>
              {language === "en" ? note.kindLabelEn : note.kindLabelHi}
            </Badge>
            <span className="shrink-0 text-[12px] text-subtle-foreground">
              {primary(dayLabel(note.createdAt.slice(0, 10)), language)}
            </span>
          </div>

          <p className="mt-2 whitespace-pre-line text-[15px] leading-6 text-foreground">
            {note.body}
          </p>

          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[12px] text-subtle-foreground">
              {note.writtenByName}
            </span>
            {note.writtenById === staffId ? (
              <form action={deleteNoteAction}>
                <input type="hidden" name="noteId" value={note.id} />
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="classId" value={classId} />
                <button
                  type="submit"
                  className="focus-ring rounded-lg px-2 py-1 text-[13px] font-medium text-destructive-soft-foreground hover:bg-destructive-soft"
                >
                  {primary(m.notesDelete, language)}
                </button>
              </form>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
