import { p, type Pair } from "@/vx/text";

/**
 * A Fees receipt read inside One (reviews F01–F03). Pure: no database, no
 * request, so the receipt page, the day book and the payment desk build the
 * same address and make the same choice.
 */

/** The in-One address of a Fees receipt: the number for people, the id and session for the read. */
export function sourceReceiptHref(receiptNumber: string, receiptId: string, sessionLabel: string): string {
  return `/receipts/${encodeURIComponent(receiptNumber)}?${new URLSearchParams({ receiptId, session: sessionLabel })}`;
}

const REAL_SESSION = /^\d{4}-\d{2}$/;

/** At most this many school years are asked about one receipt link. */
export const MOST_SESSIONS = 4;

/**
 * The school years to ask about one receipt link, in order (F02): what the
 * link or the person's chosen year names first, then the active year, then
 * every other real year this person may open, as Fees' session list gives
 * them. Never a TEST year (that is the local ledger's), never one the person
 * may not open, never the same year twice, and never more than
 * `MOST_SESSIONS` — each one is a round trip to Fees.
 *
 * The labels are not sorted: which year is current is `active`'s to say
 * (CLAUDE.md 3a), and the rest are only a fallback.
 */
export function receiptSessionOrder(input: {
  first: readonly (string | null | undefined)[];
  active: string | null | undefined;
  available: readonly string[];
  may: (sessionLabel: string) => boolean;
}): string[] {
  const out: string[] = [];
  const add = (label: string | null | undefined) => {
    if (label && REAL_SESSION.test(label) && !out.includes(label) && input.may(label)) out.push(label);
  };
  for (const label of input.first) add(label);
  add(input.active);
  for (const label of input.available) add(label);
  return out.slice(0, MOST_SESSIONS);
}

/**
 * Ask each school year in turn until one answers. `attempt` returns null when
 * that year refused or does not have the receipt (the same thing to the
 * reader, so a refusal never confirms a receipt exists) and throws to stop
 * asking: a failure the next year would only repeat.
 */
export async function firstAnswering<T>(
  sessions: readonly string[],
  attempt: (sessionLabel: string) => Promise<T | null>,
): Promise<{ sessionLabel: string; value: T } | null> {
  for (const sessionLabel of sessions) {
    const value = await attempt(sessionLabel);
    if (value !== null) return { sessionLabel, value };
  }
  return null;
}

/**
 * The year a link names, alone, first; only when it does not answer, the
 * other years (`others` is called then and only then — naming them costs a
 * read of its own), skipping the one already asked.
 */
export async function askYears<T>(
  named: string | null,
  others: () => Promise<readonly string[]>,
  attempt: (sessionLabel: string) => Promise<T | null>,
): Promise<{ sessionLabel: string; value: T } | null> {
  if (named) {
    const value = await attempt(named);
    if (value !== null) return { sessionLabel: named, value };
  }
  return firstAnswering((await others()).filter((label) => label !== named), attempt);
}

/**
 * What a Fees receipt read here still sends the reader to Fees for, worded
 * for this person (F01). Only what Fees' own receipt page would offer them:
 * sending needs `receipts:print`; reversing needs `payments:reverse_any` and
 * goes to Fees only while One cannot do it here; telling a family about a
 * reversal is Fees' "Tell the family it was reversed", for the same
 * permission. Null when Fees would offer this person nothing more.
 */
export function feesReceiptExit(input: { canPrint: boolean; canReverseHere: boolean; mayReverse: boolean; isVoided: boolean }): Pair | null {
  if (input.isVoided) {
    if (input.mayReverse) return p("Tell the family in Fees", "Fees से परिवार को बताएँ");
    return input.canPrint ? p("Send in Fees", "Fees में भेजें") : null;
  }
  const send = input.canPrint;
  const reverse = input.mayReverse && !input.canReverseHere;
  if (send && reverse) return p("Reverse or send in Fees", "Fees में रद्द करें या भेजें");
  if (reverse) return p("Reverse in Fees", "Fees में रद्द करें");
  if (send) return p("Send in Fees", "Fees में भेजें");
  return null;
}
