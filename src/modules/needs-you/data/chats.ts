import "server-only";

import { waitingChatsFor } from "@/modules/chats/data/list";
import { viewerFor } from "@/modules/chats/data/people";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { p } from "@/vx/text";

import { clockP } from "../domain/format";
import type { NeedItem } from "../domain/types";

/**
 * Parents' chats waiting on this person, as one job on Needs you (D-634).
 *
 * The count is Chats' own (D-616..D-618): the same one its badge, strip and
 * pop-up show, so the three never disagree. Chats in `waiting`, not merged,
 * practice ones only in the test year, the chat switch on, and for each person
 * the chats taken by them or untaken on their desk (their class, the accounts
 * desk for the fee desk, the office's desk for an admin or the office).
 */
export const CHATS_ROUTE: string | null = "/chats";

export type WaitingChats = { count: number; oldestWaitingSince: string | null };

/** The chats waiting on this person; throws when the count could not be read, so the list knows it is incomplete. */
export async function waitingChatsForNeeds(staff: CurrentStaff, viewingTest: boolean): Promise<WaitingChats | null> {
  if (!CHATS_ROUTE) return null;
  return waitingChatsFor(viewerFor(staff, viewingTest));
}

/** "3 parents are waiting for a reply", as a Do now job. */
export function chatNeed(chats: WaitingChats | null): NeedItem | null {
  if (!CHATS_ROUTE || !chats || chats.count <= 0) return null;
  const since = chats.oldestWaitingSince && !Number.isNaN(Date.parse(chats.oldestWaitingSince)) ? chats.oldestWaitingSince : null;
  const at = since ? clockP(since) : null;
  const n = chats.count;
  return {
    key: "chat",
    kind: "chat",
    title: p(n === 1 ? "1 parent is waiting for a reply" : `${n} parents are waiting for a reply`, `${n} अभिभावक जवाब का इंतज़ार कर रहे हैं`),
    why: at ? p(`The first has waited since ${at.en}`, `पहला ${at.hi} से इंतज़ार में`) : null,
    lane: "now",
    dueAt: since,
    lateMinutes: 0,
    startsInMinutes: null,
    peopleWaiting: n,
    count: n,
    effort: "quick",
    href: CHATS_ROUTE,
    act: p("Open chats", "चैट खोलें"),
    canSnooze: true,
  };
}
