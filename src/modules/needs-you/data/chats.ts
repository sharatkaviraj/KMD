import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { p } from "@/vx/text";

import { clockP } from "../domain/format";
import type { NeedItem } from "../domain/types";

/**
 * Parents' chats waiting on this person, as one job on Needs you (D-634).
 *
 * The Chats screen arrives in its own change. Until it does, `CHATS_ROUTE` is
 * null and there is no chat job; that change sets the route and points
 * `waitingChatsForNeeds` at its own count, so the swap is these few lines.
 * The rule it will count by: chats in `waiting`, not merged, practice ones
 * only in the test year, the parent chat switch on, and for each person the
 * chats taken by them or untaken on their desk (their class, the accounts
 * desk for fee collectors, the admin desk for an admin).
 */
export const CHATS_ROUTE: string | null = null;

export type WaitingChats = { count: number; oldestWaitingSince: string | null };

/** The chats waiting on this person, or null when there is no Chats screen yet or the count could not be read. */
export async function waitingChatsForNeeds(staff: CurrentStaff, viewingTest: boolean): Promise<WaitingChats | null> {
  void staff;
  void viewingTest;
  if (!CHATS_ROUTE) return null;
  return null;
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
