import "server-only";

import { chatVisible, type ChatViewer } from "@/modules/chats/domain/access";
import { whatsappDb } from "@/platform/whatsapp/store";

import { ChatStoreError, isUuid, listChats, readChatSettings, type ChatScope } from "./store";
import type { ChatRow } from "@/modules/chats/domain/types";

/**
 * The chats a person sees (D-616): the rows behind their list, and the small
 * "parents waiting for you" read behind the menu's number and the pop-up.
 * The desk rules (`domain/access.ts`, `domain/filters.ts`) decide; these
 * reads only narrow what the database sends first.
 */

type Db = ReturnType<typeof whatsappDb>;

/** Which rows a person's list starts from: an admin's are all of one kind; anyone else's their desks and what they took over. */
export function scopeFor(viewer: ChatViewer): ChatScope {
  return viewer.seesAll ? { all: true } : { all: false, staffId: viewer.staffId, feesDesk: viewer.feesDesk, office: viewer.role === "office" };
}

/** The chats this person may see, of the kind they are looking at: practice ones in the test year, real ones otherwise. */
export async function readVisibleChats(viewer: ChatViewer, done: boolean, db: Db = whatsappDb()): Promise<ChatRow[]> {
  if (!viewer.replies && !viewer.seesAll) return [];
  const rows = await listChats({ practice: viewer.viewingTest, done, scope: scopeFor(viewer) }, db);
  return rows.filter((chat) => chatVisible(viewer, chat));
}

/**
 * "For you" as the database reads it (`isForYou` in `domain/filters.ts`, which
 * the tests hold the two to): what this person took over, and otherwise what
 * nobody has taken on their own desks; for an admin, the office desk, parents
 * who asked for the principal, and chats nobody answered in a day.
 */
export function forYouFilter(viewer: Pick<ChatViewer, "staffId" | "seesAll" | "feesDesk" | "role">): string | null {
  if (!isUuid(viewer.staffId)) return null;
  const me = viewer.staffId;
  if (viewer.seesAll) {
    return `taken_by.eq.${me},and(taken_by.is.null,or(desk.eq.admin,wants_admin.is.true,passed_up_at.not.is.null))`;
  }
  const desks = [`and(desk.eq.class,class_teacher_id.eq.${me})`];
  if (viewer.feesDesk) desks.push("desk.eq.accounts");
  if (viewer.role === "office") desks.push("and(desk.eq.admin,wants_admin.is.false)");
  return `taken_by.eq.${me},and(taken_by.is.null,or(${desks.join(",")}))`;
}

/** The newest parent waiting for this person, for the pop-up. */
export type PulseChat = { chatId: string; fromName: string; studentLabel: string | null; preview: string | null; at: string };

/**
 * Parents waiting for this person: how many (the menu's number, at most
 * `PULSE_LIMIT`), and the one who wrote last. Zero while chats are off.
 */
export type ChatPulse = { waiting: number; latest: PulseChat | null };

export const PULSE_LIMIT = 99;

type PulseRow = { id: string; from_name: string; student_label: string | null; last_preview: string | null; last_parent_at: string | null; last_message_at: string };

export async function readChatPulse(viewer: ChatViewer, db: Db = whatsappDb()): Promise<ChatPulse> {
  const none: ChatPulse = { waiting: 0, latest: null };
  if (!viewer.replies && !viewer.seesAll) return none;
  const filter = forYouFilter(viewer);
  if (!filter) return none;
  const settings = await readChatSettings(db);
  if (!settings?.enabled) return none;
  const { data, error } = await db
    .from("parent_chats")
    .select("id, from_name, student_label, last_preview, last_parent_at, last_message_at")
    .eq("practice", viewer.viewingTest)
    .eq("status", "waiting")
    .is("merged_into", null)
    .or(filter)
    .order("last_parent_at", { ascending: false, nullsFirst: false })
    .limit(PULSE_LIMIT)
    .returns<PulseRow[]>();
  if (error || !data) throw new ChatStoreError("count the parents waiting");
  const first = data[0];
  return {
    waiting: data.length,
    latest: first
      ? { chatId: first.id, fromName: first.from_name, studentLabel: first.student_label, preview: first.last_preview, at: first.last_parent_at ?? first.last_message_at }
      : null,
  };
}

/**
 * How many parents wait for this person, and since when the longest has: no
 * names and no words, for a card elsewhere in One (Needs you) that opens
 * Chats. The same "for you" rule as the menu's number; zero while chats are off.
 */
export type WaitingChats = { count: number; oldestWaitingSince: string | null };

export async function waitingChatsFor(viewer: ChatViewer, db: Db = whatsappDb()): Promise<WaitingChats> {
  const none: WaitingChats = { count: 0, oldestWaitingSince: null };
  if (!viewer.replies && !viewer.seesAll) return none;
  const filter = forYouFilter(viewer);
  if (!filter) return none;
  const settings = await readChatSettings(db);
  if (!settings?.enabled) return none;
  const { data, error } = await db
    .from("parent_chats")
    .select("waiting_since")
    .eq("practice", viewer.viewingTest)
    .eq("status", "waiting")
    .is("merged_into", null)
    .or(filter)
    .order("waiting_since", { ascending: true, nullsFirst: false })
    .limit(PULSE_LIMIT)
    .returns<Array<{ waiting_since: string | null }>>();
  if (error || !data) throw new ChatStoreError("count the parents waiting");
  return { count: data.length, oldestWaitingSince: data.find((row) => row.waiting_since)?.waiting_since ?? null };
}
