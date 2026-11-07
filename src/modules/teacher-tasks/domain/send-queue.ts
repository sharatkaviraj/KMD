import type { TaskKind } from "./tasks";
import { teacherMessage, whatsappLink, type MessageLanguage } from "./collect";

/** The first message carrying a teacher's link, or the nudge after it. */
export type SendKind = "initial" | "reminder";

/** One teacher in the send list (D-521): who, what, and the link that opens their list. */
export type SendEntry = {
  taskId: string;
  teacherName: string;
  /** Ten digits, or null when the staff record has no usable mobile. */
  mobile: string | null;
  language: MessageLanguage;
  work: TaskKind;
  title: string;
  group: string | null;
  due: string | null;
  students: number;
  fields: { en: string; hi: string }[];
  answered: number;
  expected: number;
  url: string | null;
  /**
   * Why this teacher cannot be sent to from the list: an earlier send nobody
   * has checked ("check", handled on the task's own sheet), no working link
   * (the work moved or was taken back), or nothing left to do.
   */
  blocked: null | "check" | "no-link" | "finished";
  /** Already told in this round (sent once, or reminded today). */
  done: boolean;
  opened: boolean;
};

/** The message for this teacher, and the click-to-chat link carrying it. */
export function entryMessage(e: SendEntry, kind: SendKind, today: string): { text: string; href: string | null } {
  const text = teacherMessage({
    kind,
    language: e.language,
    teacherName: e.teacherName,
    work: e.work,
    title: e.title,
    students: e.students,
    fields: e.fields,
    answered: e.answered,
    expected: e.expected,
    due: e.due,
    url: e.url ?? "",
    today,
  });
  return { text, href: e.mobile && e.url && !e.blocked ? whatsappLink(e.mobile, text) : null };
}

/** The first teacher still to do, so the list can say "Next" beside them. */
export function nextEntry(entries: readonly SendEntry[], sent: ReadonlySet<string>): string | null {
  return entries.find((e) => !e.blocked && !e.done && !sent.has(e.taskId) && e.mobile && e.url)?.taskId ?? null;
}
