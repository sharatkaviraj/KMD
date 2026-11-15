import { ownsDesk, type ChatViewer } from "./access";
import type { ChatDesk, ChatRow } from "./types";

/**
 * The chat list, sorted and filtered (D-616). Pure.
 *
 * The owner asked for an admin view that is calm, not a flood (15 Nov 2026):
 * filtered teacher-wise, accounts-wise, by dues and by ID, with the chats
 * where a parent wants the admin shown on their own. So an admin's list opens
 * on "For you" (the office desk, parents who asked for the principal, chats
 * nobody answered in a day, and the ones they took over), with tabs for the
 * class teachers (and a chip per teacher), the accounts office and
 * everything. Everyone else sees only their own desk's chats.
 *
 * Waiting chats come first, the longest wait at the top; then the rest by
 * their last message.
 */

export const CHAT_VIEWS = ["you", "class", "accounts", "all"] as const;
export type ChatView = (typeof CHAT_VIEWS)[number];

export const CHAT_SHOWS = ["active", "waiting", "done"] as const;
/** `active`: waiting and open. */
export type ChatShow = (typeof CHAT_SHOWS)[number];

export type ChatFilter = {
  view: ChatView;
  show: ChatShow;
  /** A class teacher's chats only (the admin's teacher chips). */
  teacherId: string | null;
  /** Only families with fees overdue today (fees only; never for a teacher). */
  dues: boolean;
  query: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The filter from the page's address, narrowed to what this person may ask for. */
export function parseChatFilter(params: Record<string, string | string[] | undefined>, viewer: Pick<ChatViewer, "seesAll" | "feesDesk">): ChatFilter {
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const view = (CHAT_VIEWS as readonly string[]).includes(one("view")) ? (one("view") as ChatView) : "you";
  const show = (CHAT_SHOWS as readonly string[]).includes(one("show")) ? (one("show") as ChatShow) : "active";
  const teacher = one("teacher");
  return {
    view: viewer.seesAll ? view : "you",
    show,
    teacherId: viewer.seesAll && UUID.test(teacher) ? teacher : null,
    dues: (viewer.seesAll || viewer.feesDesk) && one("dues") === "1",
    query: one("q").trim().slice(0, 60),
  };
}

/** "For you": what is an admin's own to answer, or anyone's own desk. */
export function isForYou(viewer: ChatViewer, chat: ChatRow): boolean {
  if (chat.takenBy === viewer.staffId) return true;
  if (!viewer.seesAll) return ownsDesk(viewer, chat) && (!chat.takenBy || chat.takenBy === viewer.staffId);
  if (chat.takenBy) return false;
  return chat.desk === "admin" || chat.wantsAdmin || (chat.passedUpAt !== null && chat.status === "waiting");
}

/**
 * Whether a chat this person may see belongs in a tab. Someone who is not an
 * admin has one list, their desk's, including a chat an admin took over (they
 * read it until it comes back).
 */
export function matchesView(viewer: ChatViewer, chat: ChatRow, view: ChatView): boolean {
  if (!viewer.seesAll) return true;
  switch (view) {
    case "you":
      return isForYou(viewer, chat);
    case "class":
      return chat.desk === "class";
    case "accounts":
      return chat.desk === "accounts";
    case "all":
      return true;
  }
}

export function matchesShow(chat: Pick<ChatRow, "status">, show: ChatShow): boolean {
  if (show === "waiting") return chat.status === "waiting";
  if (show === "done") return chat.status === "done";
  return chat.status !== "done";
}

/** What a search can match on a chat, beyond its own row: the children's names and admission numbers. */
export type ChatSearchExtra = { names: readonly string[]; admissionNos: readonly string[] };

const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * A search: digits match the parent's number (any four or more in a row) or
 * an admission number; words match the parent's name, the children's names
 * and the admission numbers.
 */
export function matchesQuery(chat: Pick<ChatRow, "parentE164" | "fromName" | "studentLabel">, query: string, extra: ChatSearchExtra): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const digits = digitsOf(text);
  if (digits.length >= 4 && digits.length === text.replace(/[\s+-]/g, "").length) {
    if (digitsOf(chat.parentE164).includes(digits)) return true;
    return extra.admissionNos.some((no) => digitsOf(no) === digits || no.toLowerCase() === text);
  }
  const haystack = [chat.fromName, chat.studentLabel ?? "", ...extra.names, ...extra.admissionNos].join(" \u0000 ").toLowerCase();
  return text.split(/\s+/).every((word) => haystack.includes(word));
}

const time = (value: string | null): number => {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : 0;
};

/** Waiting first, the longest wait on top; then the rest, newest first. */
export function sortChats<T extends Pick<ChatRow, "status" | "waitingSince" | "lastMessageAt">>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => {
    const aw = a.status === "waiting" ? 0 : 1;
    const bw = b.status === "waiting" ? 0 : 1;
    if (aw !== bw) return aw - bw;
    if (aw === 0) return time(a.waitingSince) - time(b.waitingSince);
    return time(b.lastMessageAt) - time(a.lastMessageAt);
  });
}

export type ViewCounts = Record<ChatView, { waiting: number; total: number }>;

/** How many chats (and how many waiting) each tab holds, for the tabs' little numbers. */
export function countViews(viewer: ChatViewer, chats: readonly ChatRow[]): ViewCounts {
  const counts = Object.fromEntries(CHAT_VIEWS.map((view) => [view, { waiting: 0, total: 0 }])) as ViewCounts;
  for (const chat of chats) {
    if (chat.status === "done") continue;
    for (const view of CHAT_VIEWS) {
      if (!matchesView(viewer, chat, view)) continue;
      counts[view].total += 1;
      if (chat.status === "waiting") counts[view].waiting += 1;
    }
  }
  return counts;
}

export type TeacherGroup = { staffId: string; name: string; waiting: number; total: number };

/** The class teachers with chats, for the admin's teacher chips: most waiting first. */
export function teacherGroups(chats: readonly ChatRow[], names: ReadonlyMap<string, string>): TeacherGroup[] {
  const groups = new Map<string, TeacherGroup>();
  for (const chat of chats) {
    if (chat.desk !== "class" || !chat.classTeacherId || chat.status === "done") continue;
    const group = groups.get(chat.classTeacherId) ?? {
      staffId: chat.classTeacherId,
      name: names.get(chat.classTeacherId) ?? "—",
      waiting: 0,
      total: 0,
    };
    group.total += 1;
    if (chat.status === "waiting") group.waiting += 1;
    groups.set(chat.classTeacherId, group);
  }
  return [...groups.values()].sort((a, b) => b.waiting - a.waiting || b.total - a.total || a.name.localeCompare(b.name));
}

/** The number on the menu's Chats item: parents waiting on this person's own desks (an admin's "For you"). */
export function badgeCount(viewer: ChatViewer, chats: readonly ChatRow[]): number {
  return chats.filter((chat) => chat.status === "waiting" && isForYou(viewer, chat)).length;
}

/** Which desk a pass goes to, from the words on the button. */
export const PASS_TARGETS: readonly ChatDesk[] = ["class", "accounts", "admin"];
