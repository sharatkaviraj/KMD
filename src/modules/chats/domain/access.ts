import type { ChatDesk, ChatRow } from "./types";

/**
 * Who sees a parent chat and who may write in it (D-616). Pure.
 *
 *  - A chat belongs to one desk. The class desk is the child's own class
 *    teacher's; the accounts desk is everyone who takes fees at the counter
 *    (`fees:collect`); the office desk is the school office's and the
 *    admins'. A chat where the parent asked for the principal is the admins'
 *    alone.
 *  - An admin (`chats:all`) sees every chat. On the office desk they write;
 *    on a teacher's or the accounts desk they first take the chat over, and
 *    then the desk reads it ("the principal's office is answering") until it
 *    is handed back. Two people never answer one parent at once.
 *  - Practice chats (the owner's number standing for test children) show
 *    only to someone looking at the test session, and real chats only in the
 *    real year: the owner's rule for test accounts, whoever is looking.
 */

/** The hand-off targets Veer Patta AI uses (`helper-replies.ts`), named here so the domain does not reach into WhatsApp's. */
export type HandoffTargetName = "class_teacher" | "accounts" | "office" | "principal";

/** The desk a hand-off lands on. A class teacher's message with no class teacher on file goes to the office. */
export function deskForHandoff(
  target: HandoffTargetName,
  classTeacherId: string | null,
): { desk: ChatDesk; wantsAdmin: boolean; classTeacherId: string | null } {
  if (target === "class_teacher" && classTeacherId) return { desk: "class", wantsAdmin: false, classTeacherId };
  if (target === "accounts") return { desk: "accounts", wantsAdmin: false, classTeacherId: null };
  return { desk: "admin", wantsAdmin: target === "principal", classTeacherId: null };
}

export type ChatViewer = {
  staffId: string;
  role: string;
  /** `chats:reply`: may open Chats and answer on their own desk. */
  replies: boolean;
  /** `chats:all`: sees every chat and may take one over. */
  seesAll: boolean;
  /** `fees:collect`: the accounts desk is theirs. */
  feesDesk: boolean;
  /** Looking at the test session: practice chats only, and no real ones. */
  viewingTest: boolean;
};

type AccessChat = Pick<ChatRow, "desk" | "classTeacherId" | "practice" | "takenBy" | "wantsAdmin">;

/** The desk is this person's own, whoever has taken the chat. */
export function ownsDesk(viewer: ChatViewer, chat: AccessChat): boolean {
  if (chat.desk === "class") return chat.classTeacherId !== null && chat.classTeacherId === viewer.staffId;
  // The fee desk's people. An admin can take fees too, but takes an accounts
  // chat over before writing, so the accountant knows to stop (as the
  // WhatsApp nudges, which never count an admin on this desk).
  if (chat.desk === "accounts") return viewer.feesDesk && !viewer.seesAll;
  // The office desk: the office and the admins. A chat that asks for the principal is the admins' alone.
  if (viewer.seesAll) return true;
  return viewer.role === "office" && !chat.wantsAdmin;
}

export function chatVisible(viewer: ChatViewer, chat: AccessChat): boolean {
  if (!viewer.replies && !viewer.seesAll) return false;
  if (chat.practice !== viewer.viewingTest) return false;
  return viewer.seesAll || ownsDesk(viewer, chat) || chat.takenBy === viewer.staffId;
}

/**
 * What this person may do in the chat:
 *  - `reply`: write to the parent.
 *  - `take_over`: an admin looking at a desk that is not theirs; one tap and they write.
 *  - `watch`: somebody else took it over; they read until it is handed back.
 *  - `none`: not theirs to see.
 */
export type ChatAccess = "reply" | "take_over" | "watch" | "none";

export function chatAccess(viewer: ChatViewer, chat: AccessChat): ChatAccess {
  if (!chatVisible(viewer, chat)) return "none";
  if (chat.takenBy) return chat.takenBy === viewer.staffId ? "reply" : "watch";
  if (!viewer.replies && !viewer.seesAll) return "watch";
  if (ownsDesk(viewer, chat)) return "reply";
  return viewer.seesAll ? "take_over" : "watch";
}

/** Whether this person may pass a chat to another desk: anyone who may write in it. */
export function mayPass(viewer: ChatViewer, chat: AccessChat): boolean {
  return chatAccess(viewer, chat) === "reply";
}

/** Whether this person may hand a taken chat back to its desk: the one who took it, or any admin. */
export function mayHandBack(viewer: ChatViewer, chat: AccessChat): boolean {
  if (!chat.takenBy || !chatVisible(viewer, chat)) return false;
  return chat.takenBy === viewer.staffId || viewer.seesAll;
}

/** The desks a person answers on, for the list's tabs and the badge. */
export function desksOf(viewer: ChatViewer): ChatDesk[] {
  const desks: ChatDesk[] = [];
  if (viewer.replies || viewer.seesAll) desks.push("class");
  if (viewer.feesDesk || viewer.seesAll) desks.push("accounts");
  if (viewer.seesAll || viewer.role === "office") desks.push("admin");
  return desks;
}
