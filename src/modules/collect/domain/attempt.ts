/**
 * One save, possibly for several children (plan §3.7). Each child is its own
 * ledger payment with its own command id, posted in order. The whole list is
 * written to the browser before the first post goes, and each child is marked
 * as its answer comes back, so:
 *
 *  - a reload after a lost answer checks the same ids instead of making new ones;
 *  - after a partial failure the screen says which children saved, and a retry
 *    sends only the rest — with the same ids and the same bodies;
 *  - nothing is ever resubmitted without the cashier asking.
 *
 * Pure: parsing and transitions. The screen owns sessionStorage.
 */

import { z } from "zod";

import type { CollectPost, SavedReceipt } from "./types";

export type PostState = "pending" | "saved" | "uncertain" | "refused";

export type AttemptPost = { post: CollectPost; state: PostState; receipt: SavedReceipt | null; message: string | null };

export type CollectAttempt = {
  version: 1;
  adapter: "bridge" | "local";
  sessionLabel: string;
  createdAt: string;
  posts: AttemptPost[];
  /** What the screen needs to redraw the sealed card after a reload. */
  summary: {
    total: number;
    paymentDate: string;
    /** "Cash ₹4,000 + UPI ₹2,000", both languages. */
    tenderText: { hi: string; en: string };
    children: Record<string, { name: string; classLabel: string; sr: string }>;
  };
};

const mode = z.enum(["cash", "upi", "bank_transfer", "cheque"]);
const tender = z.object({ mode, amount: z.number().int().positive() });
const post = z.object({
  studentId: z.string().min(1),
  commandId: z.uuid(),
  amount: z.number().int().positive(),
  paymentDate: z.iso.date(),
  paymentMode: mode.nullable(),
  tenders: z.array(tender).min(2).max(4).nullable(),
  lateFeeWaiver: z.number().int().nonnegative(),
  reference: z.string().nullable(),
  remarks: z.string().nullable(),
  acknowledgeDailyDuplicate: z.boolean(),
  acknowledgeNearDuplicate: z.boolean(),
  quoteHash: z.string().nullable(),
}).refine((p) => (p.paymentMode === null) !== (p.tenders === null), "one of paymentMode and tenders");
const receipt = z.object({
  receiptId: z.string(), receiptNumber: z.string(), studentId: z.string(), amount: z.number(), paymentDate: z.string(),
  paymentMode: z.string(), tenders: z.array(tender).nullable(), receivedBy: z.string().nullable(), lateFeeWaived: z.number(),
  remaining: z.number().nullable(), printHref: z.string(), printExternal: z.boolean(),
});
const attempt = z.object({
  version: z.literal(1),
  adapter: z.enum(["bridge", "local"]),
  sessionLabel: z.string().min(1),
  createdAt: z.string(),
  posts: z.array(z.object({ post, state: z.enum(["pending", "saved", "uncertain", "refused"]), receipt: receipt.nullable(), message: z.string().nullable() })).min(1).max(8),
  summary: z.object({
    total: z.number(),
    paymentDate: z.string(),
    tenderText: z.object({ hi: z.string(), en: z.string() }),
    children: z.record(z.string(), z.object({ name: z.string(), classLabel: z.string(), sr: z.string() })),
  }),
});

/** A stored attempt, or null when there is none. Throws when one is stored but cannot be trusted. */
export function parseAttempt(raw: string | null, expect: { adapter: "bridge" | "local"; sessionLabel: string }): CollectAttempt | null {
  if (raw === null || raw === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("The unfinished payment in this browser could not be read.");
  }
  const parsed = attempt.safeParse(value);
  if (!parsed.success) throw new Error("The unfinished payment in this browser could not be read.");
  if (parsed.data.adapter !== expect.adapter || parsed.data.sessionLabel !== expect.sessionLabel) return null;
  return parsed.data as CollectAttempt;
}

export function attemptKey(adapter: "bridge" | "local", userId: string, sessionLabel: string): string {
  return `vppsone:collect-attempt:${adapter}:${userId}:${sessionLabel}`;
}

export function settle(attemptIn: CollectAttempt, commandId: string, update: { state: PostState; receipt?: SavedReceipt | null; message?: string | null }): CollectAttempt {
  return {
    ...attemptIn,
    posts: attemptIn.posts.map((p) =>
      p.post.commandId === commandId ? { ...p, state: update.state, receipt: update.receipt ?? p.receipt, message: update.message ?? null } : p,
    ),
  };
}

/** The posts still to send or to check, in order. */
export function unsettled(a: CollectAttempt): AttemptPost[] {
  return a.posts.filter((p) => p.state !== "saved");
}

export function allSaved(a: CollectAttempt): boolean {
  return a.posts.every((p) => p.state === "saved");
}

export function anyUncertain(a: CollectAttempt): boolean {
  return a.posts.some((p) => p.state === "uncertain");
}

/**
 * An attempt found in storage after a reload: a post still "pending" may have
 * left before the page went away, so it is checked by its id like a lost
 * answer, never sent again unasked.
 */
export function recovered(a: CollectAttempt): CollectAttempt {
  return { ...a, posts: a.posts.map((p) => (p.state === "pending" ? { ...p, state: "uncertain" as const } : p)) };
}

/** Nothing reached the ledger: every post was refused. The attempt can be dropped and the payment edited. */
export function nothingPosted(a: CollectAttempt): boolean {
  return a.posts.every((p) => p.state === "refused");
}

/** Saved receipts, in the children's order. */
export function savedReceipts(a: CollectAttempt): SavedReceipt[] {
  return a.posts.flatMap((p) => (p.state === "saved" && p.receipt ? [p.receipt] : []));
}

/**
 * The same post again, after the cashier ticked "this is a new payment" on a
 * duplicate refusal: the acknowledgement is the only field allowed to change,
 * and only from false to true. A definite refusal stored nothing, and the
 * ledger checks a replayed id against the body it first saw, so a changed body
 * goes with a fresh id. An uncertain post is never acknowledged: it is checked.
 */
export function acknowledge(p: CollectPost, ack: { daily?: boolean; near?: boolean }, freshCommandId: string): CollectPost {
  const daily = p.acknowledgeDailyDuplicate || Boolean(ack.daily);
  const near = p.acknowledgeNearDuplicate || Boolean(ack.near);
  const changed = daily !== p.acknowledgeDailyDuplicate || near !== p.acknowledgeNearDuplicate;
  return { ...p, acknowledgeDailyDuplicate: daily, acknowledgeNearDuplicate: near, commandId: changed ? freshCommandId : p.commandId };
}
