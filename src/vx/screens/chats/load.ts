import "server-only";

import { chatAccess, type ChatViewer } from "@/modules/chats/domain/access";
import { badgeCount, matchesQuery, matchesShow, matchesView, countViews, sortChats, teacherGroups, type ChatFilter } from "@/modules/chats/domain/filters";
import type { ChatRow } from "@/modules/chats/domain/types";
import { readVisibleChats } from "@/modules/chats/data/list";
import { passTargetKey, passTargets, type PassTarget } from "@/modules/chats/data/manage";
import { readStaffNames } from "@/modules/chats/data/people";
import {
  markRead,
  readChatById,
  readChatClassTeachers,
  readChatSettings,
  readChildBriefs,
  readMessages,
  readMessagesSince,
  readUnread,
  type ChatClassTeacher,
} from "@/modules/chats/data/store";
import { loadDuesBoard } from "@/modules/defaulters/vx/data";
import { loadDuesFromFees } from "@/modules/defaulters/vx/fees-data";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { readChat as readHelperChat } from "@/modules/whatsapp/data/helper-store";
import { OPEN_WINDOW_HOURS } from "@/modules/whatsapp/domain/helper-handoff";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { logWarn } from "@/platform/observability/log";
import { duesReadsFees } from "@/vx/screens/dues/load";

import {
  chatHeadView,
  chatListItem,
  messageView,
  namesWanted,
  type ChatChildView,
  type ChatHeadView,
  type ChatListData,
  type ChatMessageView,
  type ChatThreadData,
  type PassTargetView,
} from "./view";
import { T } from "./words";

/*
 * What the Chats screens draw (D-616), read on the server for the signed-in
 * person: their list, filtered as the address says, and one chat with its
 * heading and its latest lines. Everything is narrowed by the desk rules
 * (`modules/chats/domain/access.ts`) before it leaves here; a chat this person
 * may not see is the same as no chat.
 */

/** The longest list drawn at once: the rest is one search away. */
const LIST_SHOWN = 150;
/** Lines of a chat drawn at first, and per "Show earlier messages". */
export const THREAD_PAGE = 40;

export type { ChatListData, ChatThreadData };


/** Children with fees overdue today (fees only, never the late fee), each with the amount. Null when they could not be read. */
async function overdueByStudent(staff: CurrentStaff): Promise<Map<string, number> | null> {
  try {
    const session = await resolveViewSession({ searchParamSession: null, cookieSession: await getViewSessionCookie() });
    const label = session.sessionLabel;
    const board = duesReadsFees(staff, label) ? (await loadDuesFromFees(label)).board : await loadDuesBoard(label);
    const owed = new Map<string, number>();
    for (const student of board.students) if (student.overdueAmount > 0) owed.set(student.studentId, student.overdueAmount);
    return owed;
  } catch (caught) {
    logWarn("chats.dues_unread", { error: caught instanceof Error ? caught.message : "unknown" });
    return null;
  }
}

export async function loadChatList(staff: CurrentStaff, viewer: ChatViewer, filter: ChatFilter): Promise<ChatListData> {
  const settings = await readChatSettings().catch(() => null);
  const base: ChatListData = {
    enabled: settings?.enabled === true,
    finishesItself: settings?.finishByItself === true,
    quietHours: settings?.quietHours ?? 12,
    items: [],
    hidden: 0,
    counts: null,
    teachers: [],
    dues: {},
    duesFailed: false,
    seesAll: viewer.seesAll,
    feesDesk: viewer.feesDesk,
    viewingTest: viewer.viewingTest,
    total: 0,
    waitingForYou: 0,
  };

  const rows = await readVisibleChats(viewer, filter.show === "done");
  const open = rows.filter((chat) => chat.status !== "done");
  let shown = rows.filter(
    (chat) => matchesView(viewer, chat, filter.view) && (!filter.teacherId || chat.classTeacherId === filter.teacherId) && matchesShow(chat, filter.show),
  );

  if (filter.query) {
    const briefs = await readChildBriefs(shown.flatMap((chat) => chat.studentIds)).catch(() => new Map());
    shown = shown.filter((chat) => {
      const children = chat.studentIds.map((id) => briefs.get(id)).filter((brief): brief is NonNullable<typeof brief> => Boolean(brief));
      return matchesQuery(chat, filter.query, { names: children.map((child) => child.fullName), admissionNos: children.flatMap((child) => (child.admissionNo ? [child.admissionNo] : [])) });
    });
  }

  let dues: Map<string, number> | null = null;
  let duesFailed = false;
  if (filter.dues && can(staff, "fees:view")) {
    dues = await overdueByStudent(staff);
    if (!dues) duesFailed = true;
  }
  const owedBy = (chat: ChatRow) => (dues ? chat.studentIds.reduce((sum, id) => sum + (dues?.get(id) ?? 0), 0) : 0);

  let sorted: ChatRow[];
  if (filter.dues) {
    // Biggest dues first; a chat about a child with nothing overdue is not in this list.
    sorted = duesFailed ? [] : shown.filter((chat) => owedBy(chat) > 0).sort((a, b) => owedBy(b) - owedBy(a));
  } else {
    sorted = sortChats(shown);
  }
  const drawn = sorted.slice(0, LIST_SHOWN);

  const nameIds = new Set<string>();
  for (const chat of rows) {
    if (chat.classTeacherId) nameIds.add(chat.classTeacherId);
    if (chat.takenBy) nameIds.add(chat.takenBy);
  }
  const [names, unread] = await Promise.all([
    readStaffNames([...nameIds]).catch(() => new Map<string, string>()),
    readUnread(viewer.staffId, drawn.map((chat) => chat.id)).catch(() => new Map<string, number>()),
  ]);

  return {
    ...base,
    items: drawn.map((chat) => chatListItem(chat, viewer, { names, unread: unread.get(chat.id) ?? 0 })),
    hidden: Math.max(0, sorted.length - drawn.length),
    counts: viewer.seesAll && filter.show !== "done" ? countViews(viewer, open) : null,
    teachers: viewer.seesAll ? teacherGroups(open, names) : [],
    dues: dues ? Object.fromEntries(drawn.map((chat) => [chat.id, owedBy(chat)])) : {},
    duesFailed,
    total: filter.show === "done" ? rows.length : open.length,
    waitingForYou: badgeCount(viewer, open),
  };
}

/* ------------------------------------------------------------- a chat */

export type ThreadRead = { kind: "chat"; data: ChatThreadData } | { kind: "moved"; to: string } | { kind: "none" };

/** What the heading depends on, as one string (the polling rebuilds the heading only when it changes). */
export function headStamp(chat: ChatRow): string {
  return [
    chat.status,
    chat.desk,
    chat.classTeacherId ?? "",
    chat.wantsAdmin ? 1 : 0,
    chat.takenBy ?? "",
    chat.doneBy ?? "",
    chat.mergedInto ?? "",
    chat.lastParentAt ?? "",
    chat.complaint ? 1 : 0,
    chat.topic ?? "",
    chat.studentIds.join(","),
  ].join("|");
}

/** A poll starts a few seconds back: a row stamped just before the last poll's own clock is read again, never missed. */
const CURSOR_OVERLAP_MS = 5000;

function cursorFrom(now: Date): string {
  return new Date(now.getTime() - CURSOR_OVERLAP_MS).toISOString();
}

function latest(a: string | null | undefined, b: string | null | undefined): string | null {
  const at = (value: string | null | undefined) => {
    const ms = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  const x = at(a);
  const y = at(b);
  if (x === null) return y === null ? null : new Date(y).toISOString();
  if (y === null) return new Date(x).toISOString();
  return new Date(Math.max(x, y)).toISOString();
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function targetView(target: PassTarget): PassTargetView {
  const key = passTargetKey(target);
  if (target.desk === "class") {
    return { key, desk: "class", teacherId: target.teacherId, principal: false, label: T.classTeacherOf(target.name, target.children.join(", ") || "—") };
  }
  if (target.desk === "accounts") return { key, desk: "accounts", teacherId: null, principal: false, label: T.accountsDesk };
  return { key, desk: "admin", teacherId: null, principal: target.principal, label: target.principal ? T.principalDesk : T.officeDesk };
}

/** The heading of one chat, with everything it needs read. */
async function buildHead(chat: ChatRow, viewer: ChatViewer, extraNames: readonly string[]): Promise<{ head: ChatHeadView; names: Map<string, string> }> {
  const [briefs, helper, teachers] = await Promise.all([
    readChildBriefs(chat.studentIds).catch(() => new Map()),
    readHelperChat(chat.parentE164).catch(() => null),
    readChatClassTeachers(chat.id).catch((): ChatClassTeacher[] => []),
  ]);
  const ids = [chat.classTeacherId, chat.takenBy, chat.doneBy, ...teachers.map((teacher) => teacher.staffId), ...extraNames].filter((id): id is string => Boolean(id));
  const names = await readStaffNames([...new Set(ids)]).catch(() => new Map<string, string>());
  const children: ChatChildView[] = chat.studentIds.flatMap((id) => {
    const brief = briefs.get(id);
    return brief ? [{ id, name: brief.fullName, admissionNo: brief.admissionNo }] : [];
  });
  const firstNames = new Map(children.map((child) => [child.id, firstNameOf(child.name)]));
  const lastWrote = latest(chat.lastParentAt, helper?.lastTurnAt ?? null);
  const windowUntil = lastWrote ? new Date(Date.parse(lastWrote) + OPEN_WINDOW_HOURS * 3_600_000).toISOString() : null;
  const head = chatHeadView(chat, viewer, {
    names,
    children,
    windowUntil,
    passTargets: passTargets(chat, teachers, firstNames).map(targetView),
  });
  return { head, names };
}

/** One chat for this person, with its latest lines; marks it read for them when they are looking at it. */
export async function loadChatThread(viewer: ChatViewer, chatId: string, options: { markRead: boolean }): Promise<ThreadRead> {
  const chat = await readChatById(chatId).catch(() => null);
  if (!chat) return { kind: "none" };
  if (chat.mergedInto) return { kind: "moved", to: chat.mergedInto };
  if (chatAccess(viewer, chat) === "none") return { kind: "none" };

  const now = new Date();
  const page = await readMessages(chat.id, { limit: THREAD_PAGE });
  const { head, names } = await buildHead(chat, viewer, namesWanted(page.messages));
  if (options.markRead) await markRead(chat.id, viewer.staffId, now).catch(() => undefined);
  return {
    kind: "chat",
    data: {
      head,
      messages: page.messages.map((message) => messageView(message, names)),
      more: page.more,
      stamp: headStamp(chat),
      cursor: cursorFrom(now),
    },
  };
}

export type ThreadUpdate =
  | { kind: "update"; messages: ChatMessageView[]; head: ChatHeadView | null; stamp: string; cursor: string }
  | { kind: "moved"; to: string }
  | { kind: "none" };

/** What changed in a chat since the screen last asked: new lines, lines whose ticks moved, and the heading when it changed. */
export async function loadThreadUpdate(viewer: ChatViewer, chatId: string, since: string, stamp: string, options: { markRead: boolean }): Promise<ThreadUpdate> {
  const chat = await readChatById(chatId).catch(() => null);
  if (!chat) return { kind: "none" };
  if (chat.mergedInto) return { kind: "moved", to: chat.mergedInto };
  if (chatAccess(viewer, chat) === "none") return { kind: "none" };

  const now = new Date();
  const changed = await readMessagesSince(chat.id, since);
  const nextStamp = headStamp(chat);
  let head: ChatHeadView | null = null;
  let names: Map<string, string>;
  if (nextStamp !== stamp) {
    const built = await buildHead(chat, viewer, namesWanted(changed));
    head = built.head;
    names = built.names;
  } else {
    const wanted = namesWanted(changed);
    names = wanted.length > 0 ? await readStaffNames(wanted).catch(() => new Map<string, string>()) : new Map<string, string>();
  }
  if (options.markRead && changed.some((message) => message.direction === "in")) await markRead(chat.id, viewer.staffId, now).catch(() => undefined);
  return { kind: "update", messages: changed.map((message) => messageView(message, names)), head, stamp: nextStamp, cursor: cursorFrom(now) };
}

/** A page of earlier lines, before the oldest one the screen has. */
export async function loadEarlier(viewer: ChatViewer, chatId: string, before: string): Promise<{ messages: ChatMessageView[]; more: boolean } | null> {
  const chat = await readChatById(chatId).catch(() => null);
  if (!chat || chatAccess(viewer, chat) === "none") return null;
  const page = await readMessages(chat.id, { limit: THREAD_PAGE, before });
  const wanted = namesWanted(page.messages);
  const names = wanted.length > 0 ? await readStaffNames(wanted).catch(() => new Map<string, string>()) : new Map<string, string>();
  return { messages: page.messages.map((message) => messageView(message, names)), more: page.more };
}
