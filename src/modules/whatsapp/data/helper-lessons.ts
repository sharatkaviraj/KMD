import "server-only";

import {
  cleanAnswer,
  cleanTaughtQuestion,
  isLessonStatus,
  questionFingerprint,
  schoolKnowledge,
  type Lesson,
  type LessonNote,
  type SchoolKnowledge,
} from "@/modules/whatsapp/domain/helper-lessons";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { whatsappDb } from "@/platform/whatsapp/store";

/**
 * Teach it once (D-589), in One's database: `vppsone.parent_helper_lessons`
 * through the service role. The helper reads only what an admin has seen (the
 * school's answers and the questions it leaves to people) and writes one note
 * per answer through `parent_helper_note_lesson`. The admin page reads the
 * whole list of its own kind (practice or real) and changes one row at a time.
 */

type Db = ReturnType<typeof whatsappDb>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, practice, question, answer, status, topic, asked_count, first_asked_at, last_asked_at, used_count, last_used_at, answered_by, answered_at, closed_at";
/** More than an admin will ever have on the list at once; the page shows the most asked first. */
const LIST_LIMIT = 300;

type LessonRow = {
  id: string;
  practice: boolean;
  question: string;
  answer: string | null;
  status: string;
  topic: string | null;
  asked_count: number | null;
  first_asked_at: string;
  last_asked_at: string;
  used_count: number | null;
  last_used_at: string | null;
  answered_by: string | null;
  answered_at: string | null;
  closed_at: string | null;
};

function lessonFromRow(row: LessonRow): Lesson | null {
  if (!isLessonStatus(row.status)) return null;
  return {
    id: row.id,
    practice: row.practice === true,
    question: row.question,
    answer: row.answer,
    status: row.status,
    topic: row.topic,
    askedCount: Number(row.asked_count ?? 0),
    firstAskedAt: row.first_asked_at,
    lastAskedAt: row.last_asked_at,
    usedCount: Number(row.used_count ?? 0),
    lastUsedAt: row.last_used_at,
    answeredBy: row.answered_by,
    answeredAt: row.answered_at,
    closedAt: row.closed_at,
  };
}

/**
 * What one answer may use, read for every message Claude answers: the
 * school's answers and the questions it leaves to people, for this kind of
 * chat. Null when it could not be read: then the helper answers without them
 * and keeps nothing for the list this time.
 */
export async function readSchoolKnowledge(practice: boolean, db: Db = whatsappDb()): Promise<SchoolKnowledge | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_lessons")
      .select(COLUMNS)
      .eq("practice", practice)
      .in("status", ["answered", "by_people"])
      .order("last_asked_at", { ascending: false })
      .limit(LIST_LIMIT)
      .returns<LessonRow[]>();
    if (error || !data) return null;
    return schoolKnowledge(data.map(lessonFromRow).filter((lesson): lesson is Lesson => lesson !== null));
  } catch {
    return null;
  }
}

/** One answer's note on the list; the lesson it landed on, or null when nothing matched or it failed. */
export async function noteLesson(note: LessonNote, practice: boolean, topic: string | null, db: Db = whatsappDb()): Promise<string | null> {
  try {
    const { data, error } = await db.rpc("parent_helper_note_lesson", {
      p_practice: practice,
      p_role: note.role,
      p_lesson_id: note.lessonId,
      p_question: note.role === "asked" ? note.question : null,
      p_fingerprint: note.role === "asked" ? note.fingerprint : null,
      p_topic: topic,
    });
    if (error) return null;
    return typeof data === "string" && UUID.test(data) ? data : null;
  } catch {
    return null;
  }
}

type StaffNameRow = { id: string; display_name: string | null; short_name: string | null; is_test_account: boolean | null };

export type LessonBook = {
  lessons: Lesson[];
  /** Who taught each answer, by staff id: only staff of the list's own kind are named. */
  names: Record<string, string>;
};

/**
 * The whole list of one kind, for the admin page. A member of staff of the
 * other kind (a real admin who taught a practice answer, say) is not named:
 * practice accounts appear only in the practice view and real staff only in
 * the real one (the owner's rule, 8 Nov 2026).
 */
export async function readLessonBook(practice: boolean, db: Db = whatsappDb()): Promise<LessonBook | null> {
  try {
    const { data, error } = await db
      .from("parent_helper_lessons")
      .select(COLUMNS)
      .eq("practice", practice)
      .order("last_asked_at", { ascending: false })
      .limit(LIST_LIMIT)
      .returns<LessonRow[]>();
    if (error || !data) return null;
    const lessons = data.map(lessonFromRow).filter((lesson): lesson is Lesson => lesson !== null);
    const ids = [...new Set(lessons.map((lesson) => lesson.answeredBy).filter((id): id is string => Boolean(id)))];
    const names: Record<string, string> = {};
    if (ids.length > 0) {
      const staff = await fetchInChunks<StaffNameRow>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
        db.from("staff_profiles").select("id, display_name, short_name, is_test_account").in("id", chunk),
      );
      // Names are a courtesy: the list stands without them.
      for (const row of staff.error ? [] : staff.data) {
        if ((row.is_test_account === true) !== practice) continue;
        const name = (row.display_name ?? row.short_name ?? "").trim();
        if (name) names[row.id] = name.slice(0, 60);
      }
    }
    return { lessons, names };
  } catch {
    return null;
  }
}

export type LessonChange = "saved" | "invalid_question" | "invalid_answer" | "gone" | "same_open" | "failed";

/**
 * The school's answer to one question, written by an admin: a question
 * waiting on the list, one a person used to answer, or an answer being
 * changed. The admin may reword the question as they teach it. From the next
 * message on, the helper answers it itself.
 */
export async function teachLesson(
  input: { id: string; practice: boolean; question: string; answer: string; actorId: string },
  db: Db = whatsappDb(),
): Promise<LessonChange> {
  if (!UUID.test(input.id)) return "gone";
  const question = cleanTaughtQuestion(input.question);
  if (!question) return "invalid_question";
  const answer = cleanAnswer(input.answer);
  if (!answer) return "invalid_answer";
  const now = new Date().toISOString();
  try {
    const { data, error } = await db
      .from("parent_helper_lessons")
      .update({
        question,
        fingerprint: questionFingerprint(question),
        answer,
        status: "answered",
        answered_by: input.actorId,
        answered_at: now,
        closed_by: null,
        closed_at: null,
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("practice", input.practice)
      .select("id");
    if (error) return "failed";
    return data && data.length > 0 ? "saved" : "gone";
  } catch {
    return "failed";
  }
}

/**
 * A person always answers this one: the helper hands it off as before, counts
 * it when it comes again, and never lists it again. Its answer, if it had
 * one, is no longer used. Refused when the same question already waits on the
 * list in other words (one open row per question).
 */
export async function leaveLessonToPeople(input: { id: string; practice: boolean; actorId: string }, db: Db = whatsappDb()): Promise<LessonChange> {
  if (!UUID.test(input.id)) return "gone";
  const now = new Date().toISOString();
  try {
    const { data, error } = await db
      .from("parent_helper_lessons")
      .update({ status: "by_people", answer: null, closed_by: input.actorId, closed_at: now, updated_at: now })
      .eq("id", input.id)
      .eq("practice", input.practice)
      .select("id");
    if (error) return error.code === "23505" ? "same_open" : "failed";
    return data && data.length > 0 ? "saved" : "gone";
  } catch {
    return "failed";
  }
}

/** A waiting question that is not one for the list. Asked again, it comes back. */
export async function removeLesson(input: { id: string; practice: boolean }, db: Db = whatsappDb()): Promise<LessonChange> {
  if (!UUID.test(input.id)) return "gone";
  try {
    const { data, error } = await db
      .from("parent_helper_lessons")
      .delete()
      .eq("id", input.id)
      .eq("practice", input.practice)
      .eq("status", "waiting")
      .select("id");
    if (error) return "failed";
    return data && data.length > 0 ? "saved" : "gone";
  } catch {
    return "failed";
  }
}
