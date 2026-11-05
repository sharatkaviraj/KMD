/**
 * Collect's step machine (plan §3.2, D2). One card per decision, in a fixed
 * order, the same on a phone and a desktop:
 *
 *   who → dues → amount → pay → (check) → sealed
 *
 * The check card is shown only when the payment is unusual; a plain payment
 * is saved with a 0.6 s hold on the payment card. The sealed card is reached
 * only from a ledger confirmation — never by `next()`.
 *
 * Pure: the screen keeps the state; this decides what comes next and why.
 */

import type { CollectMode } from "./cash";

export const CARDS = ["who", "dues", "amount", "pay", "check", "sealed"] as const;
export type Card = (typeof CARDS)[number];

/** More than this needs a second look (plan §3.2). */
export const CHECK_OVER = 15_000;

export type CheckReason = "family" | "split" | "cheque" | "bank" | "backdated" | "paid_today" | "over_limit" | "waiver_reason";

export type CheckInput = {
  children: number;
  mode: CollectMode;
  paymentDate: string;
  today: string;
  /** Any child being paid for already has a receipt today. */
  paidToday: boolean;
  total: number;
  /** Late fee pending across the children being paid for. */
  lateFee: number;
  waiving: boolean;
  /** The waiver reason is the desk's default. */
  defaultReason: boolean;
};

/** Why the check card is needed, in the order it says so. Empty: save from the payment card. */
export function checkReasons(input: CheckInput): CheckReason[] {
  const out: CheckReason[] = [];
  if (input.children > 1) out.push("family");
  if (input.mode === "split") out.push("split");
  if (input.mode === "cheque") out.push("cheque");
  if (input.mode === "bank_transfer") out.push("bank");
  if (input.paymentDate < input.today) out.push("backdated");
  if (input.paidToday) out.push("paid_today");
  if (input.total > CHECK_OVER) out.push("over_limit");
  if (input.lateFee > 0 && input.waiving && !input.defaultReason) out.push("waiver_reason");
  return out;
}

/** The cards shown right now: the check card only when needed (or a desk wants it always), or while on it. */
export function visibleCards(needsCheck: boolean, current: Card): Card[] {
  return CARDS.filter((card) => card !== "check" || needsCheck || current === "check");
}

export type FlowState = {
  current: Card;
  /** Cards answered at least once. */
  done: ReadonlySet<Card>;
  /** The cashier jumped back from the ticket: return to where they were going once the earlier card is answered again. */
  jumping: boolean;
  needsCheck: boolean;
};

/**
 * The card after `from`. After a jump back (tapping a ticket chip) the
 * cashier goes straight to the saving card — check when needed, else pay —
 * once every card between is still answered.
 */
export function nextCard(state: FlowState): Card {
  const visible: Card[] = visibleCards(state.needsCheck, state.current).filter((c) => c !== "sealed");
  const at = visible.indexOf(state.current);
  const plain = visible[Math.min(at + 1, visible.length - 1)];
  if (!state.jumping) return plain;
  const stop: Card = state.needsCheck ? "check" : "pay";
  const between = visible.slice(at + 1, visible.indexOf(stop));
  return between.every((card) => state.done.has(card)) ? stop : plain;
}

/** The card before, or null on the first card and after the seal. */
export function previousCard(state: Pick<FlowState, "current" | "needsCheck">): Card | null {
  if (state.current === "who" || state.current === "sealed") return null;
  const visible = visibleCards(state.needsCheck, state.current);
  const at = visible.indexOf(state.current);
  return at > 0 ? visible[at - 1] : null;
}

/** A ticket chip may be tapped when its card was answered, nothing is saved yet, and it is not the card on screen. */
export function canJumpTo(card: Card, state: Pick<FlowState, "current" | "done">, saved: boolean): boolean {
  return !saved && card !== "sealed" && card !== state.current && (state.done.has(card) || card === "who");
}

/** -1 back, 1 forward: which way the cards slide. */
export function direction(from: Card, to: Card): 1 | -1 {
  return CARDS.indexOf(to) >= CARDS.indexOf(from) ? 1 : -1;
}

/** The hold-to-save length (D2). */
export const HOLD_MS = 600;
