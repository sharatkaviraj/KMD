import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type {
  Note,
  NoteKind,
  NoteTone,
  WriteNoteInput,
} from "@/modules/notes/domain/notes";

type KindRow = {
  id: string;
  code: string;
  label_hi: string;
  label_en: string;
  tone: NoteTone;
  is_active: boolean;
  sort_order: number;
};

export async function listNoteKinds(): Promise<NoteKind[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("note_kinds")
    .select("id, code, label_hi, label_en, tone, is_active, sort_order")
    .order("sort_order")
    .returns<KindRow[]>();

  if (error) throw new Error(`Could not read the note kinds: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    code: row.code,
    labelHi: row.label_hi,
    labelEn: row.label_en,
    tone: row.tone,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }));
}

type NoteRow = {
  id: string;
  session_label: string;
  student_id: string | null;
  class_id: string | null;
  kind_id: string;
  body: string;
  written_by: string;
  created_at: string;
  note_kinds: {
    code: string;
    label_hi: string;
    label_en: string;
    tone: NoteTone;
  } | null;
  staff_profiles: { display_name: string } | null;
};

const NOTE_COLUMNS =
  "id, session_label, student_id, class_id, kind_id, body, written_by, created_at, " +
  "note_kinds!inner(code, label_hi, label_en, tone), " +
  "staff_profiles!notes_written_by_fkey!inner(display_name)";

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    sessionLabel: row.session_label,
    studentId: row.student_id,
    classId: row.class_id,
    kindId: row.kind_id,
    kindCode: row.note_kinds?.code ?? "other",
    kindLabelHi: row.note_kinds?.label_hi ?? "—",
    kindLabelEn: row.note_kinds?.label_en ?? "—",
    tone: row.note_kinds?.tone ?? "neutral",
    body: row.body,
    writtenById: row.written_by,
    writtenByName: row.staff_profiles?.display_name ?? "—",
    createdAt: row.created_at,
  };
}

export async function notesForStudent(
  studentId: string,
  sessionLabel: string,
): Promise<Note[]> {
  await assertPermission("notes:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("student_id", studentId)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<NoteRow[]>();

  if (error) throw new Error(`Could not read the notes: ${error.message}`);
  return data.map(toNote);
}

export async function notesForClass(
  classId: string,
  sessionLabel: string,
): Promise<Note[]> {
  await assertPermission("notes:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("class_id", classId)
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<NoteRow[]>();

  if (error) throw new Error(`Could not read the notes: ${error.message}`);
  return data.map(toNote);
}

export async function writeNote(
  input: WriteNoteInput,
  sessionLabel: string,
  writtenByStaffId: string,
): Promise<void> {
  const { error } = await createAdminClient().from("notes").insert({
    session_label: sessionLabel,
    student_id: input.studentId,
    class_id: input.classId,
    kind_id: input.kindId,
    body: input.body,
    written_by: writtenByStaffId,
  });

  if (error) throw error;
}

/**
 * Remove a note.
 *
 * Only the person who wrote it, and only their own — enforced in the query
 * rather than checked beforehand, so a tampered id cannot delete somebody
 * else's note even if the guard above it were wrong.
 */
/** A note's own session, for the test-session fence. Null when there is no such note. */
export async function noteSessionLabel(noteId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) return null;
  const { data, error } = await createAdminClient()
    .from("notes")
    .select("session_label")
    .eq("id", noteId)
    .maybeSingle<{ session_label: string | null }>();
  if (error) throw error;
  return data?.session_label ?? null;
}

export async function deleteOwnNote(
  noteId: string,
  writtenByStaffId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("notes")
    .delete()
    .eq("id", noteId)
    .eq("written_by", writtenByStaffId);

  if (error) throw error;
}
