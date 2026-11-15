import "server-only";

import { assistFeaturesFor } from "@/modules/assist/data/settings";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { schoolToday } from "@/platform/dates";
import { logWarn } from "@/platform/observability/log";
import { getViewer } from "@/vx/view-as";

import { mergeDone, planFits, withReminders } from "../domain/lanes";
import type { DoneItem, NeedItem, NeedPlan, NeedReminder, NeedsRole } from "../domain/types";
import { chatNeed, waitingChatsForNeeds } from "./chats";
import type { NeedsSource } from "./sources";
import { mayAskAgain, openReminders, planState, syncSeen } from "./store";

/**
 * One person's Needs you, ready to draw (D-630..D-634): their jobs with their
 * own to-dos and put-off jobs folded in, the AI's order when one still fits,
 * and what they finished today. The screen arranges the lanes itself
 * (`arrange`, pure), so a tick or a reminder moves a job without a reload.
 *
 * Nothing is written while an administrator previews a role or sees One as
 * somebody else: they only look.
 */
export type NeedsView = {
  role: NeedsRole;
  day: string;
  nowIso: string;
  items: NeedItem[];
  /** The AI's order for this list, when it still names every job in Do now and Today. */
  plan: NeedPlan | null;
  done: DoneItem[];
  /** The AI may be asked for an order now (switched on, not asked too lately, two jobs or more). */
  mayAsk: boolean;
  readOnly: boolean;
};

/** Whether this person's AI helper may arrange their list: the switch for it is on and they may use it. */
async function arrangeOn(staff: CurrentStaff): Promise<boolean> {
  return assistFeaturesFor(staff)
    .then((features) => features.includes("needs"))
    .catch(() => false);
}

/**
 * `source` may still be loading: the person's own reads start beside it, so a
 * page that loads its jobs anyway (the admin's queue) waits for them once.
 */
export async function needsView(staff: CurrentStaff, input: { role: NeedsRole; source: NeedsSource | Promise<NeedsSource>; sessionLabel: string; now: Date }): Promise<NeedsView> {
  const { role, sessionLabel, now } = input;
  const viewer = await getViewer();
  const readOnly = viewer.previewing !== null || Boolean(staff.viewedBy);
  const day = schoolToday(now);
  let complete = true;

  const [source, reminders, chats, state, aiOn] = await Promise.all([
    input.source,
    openReminders(staff.id, sessionLabel, now).catch((caught: unknown) => {
      complete = false;
      logWarn("needs_you.reminders_unreadable", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
      return [] as NeedReminder[];
    }),
    waitingChatsForNeeds(staff, isTestSessionLabel(sessionLabel)).catch(() => {
      complete = false;
      return null;
    }),
    planState(staff.id, sessionLabel, day).catch(() => null),
    readOnly ? Promise.resolve(false) : arrangeOn(staff),
  ]);
  if (!source.complete) complete = false;

  const chat = chatNeed(chats);
  const items = withReminders(chat ? [chat, ...source.items] : source.items, reminders, now);
  const plan = state?.ai && planFits(state.ai, items) ? { order: state.ai.order, reasons: state.ai.reasons, source: "ai" as const } : null;
  const left = items.filter((i) => i.lane === "now" || i.lane === "today").length;
  // Asked by the real clock, as the asks are recorded, whatever time a QA seat is set to.
  const mayAsk = aiOn && !plan && left >= 2 && state !== null && mayAskAgain(state, new Date());

  let done: DoneItem[] = mergeDone(source.done);
  if (!readOnly) {
    const seen = await syncSeen(staff.id, sessionLabel, day, items, complete).catch((caught: unknown) => {
      logWarn("needs_you.sync_failed", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
      return [] as DoneItem[];
    });
    done = mergeDone(source.done, seen);
  }
  return { role, day, nowIso: now.toISOString(), items, plan, done, mayAsk, readOnly };
}
