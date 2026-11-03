import { p, type Pair } from "@/vx/text";
import type { InboxItem } from "@/vx/screens/admin/types";

/*
 * Batch decisions in Needs you (review N01). Only items that are decided in
 * place can be picked together, and only with items that mean the same thing:
 * approving future leave is not recording past leave as taken, and neither is
 * accepting a change to a child's record. Money requests (refunds, write-offs,
 * reversals) and cover are never batched: they are decided on their own.
 */
export type BatchGroup = "leave_future" | "leave_past" | "reviews";

export const BATCH_GROUPS: readonly BatchGroup[] = ["leave_future", "leave_past", "reviews"];

export function batchGroupOf(item: InboxItem): BatchGroup | null {
  if (item.kind === "leave" && item.leaveId) return item.leavePast ? "leave_past" : "leave_future";
  if ((item.kind === "submission" || item.kind === "confirmations") && (item.submissionIds?.length ?? 0) > 0) return "reviews";
  return null;
}

/** Selected items by group, in list order; an item that is not batchable is never kept. */
export function groupSelection(items: readonly InboxItem[], selected: ReadonlySet<string>): Record<BatchGroup, InboxItem[]> {
  const out: Record<BatchGroup, InboxItem[]> = { leave_future: [], leave_past: [], reviews: [] };
  for (const item of items) {
    if (!selected.has(item.id)) continue;
    const group = batchGroupOf(item);
    if (group) out[group].push(item);
  }
  return out;
}

export type BatchChoice = { group: BatchGroup; yes: boolean };

/** The button words for each group's two answers, and what each does. */
export const BATCH_WORDS: Record<BatchGroup, { title: Pair; yes: Pair; no: Pair; yesMeans: Pair; noMeans: Pair }> = {
  leave_future: {
    title: p("Leave requests", "छुट्टी के अनुरोध"),
    yes: p("Approve", "मंज़ूर करें"),
    no: p("Decline", "अस्वीकार करें"),
    yesMeans: p("Each teacher is marked away for those days; their periods will need cover.", "हर शिक्षक उन दिनों अनुपस्थित दर्ज होंगे; उनके पीरियड की व्यवस्था करनी होगी।"),
    noMeans: p("Each teacher is told the leave was not approved.", "हर शिक्षक को बताया जाएगा कि छुट्टी मंज़ूर नहीं हुई।"),
  },
  leave_past: {
    title: p("Leave already taken", "पहले ली गई छुट्टी"),
    yes: p("Record as taken", "ली गई दर्ज करें"),
    no: p("Decline as past", "बीती हुई मानकर अस्वीकार करें"),
    yesMeans: p("The days are recorded as leave. No cover is arranged for days that are over.", "दिन छुट्टी के रूप में दर्ज होंगे। बीते दिनों की व्यवस्था नहीं होगी।"),
    noMeans: p("The requests are closed as past without recording leave.", "अनुरोध बिना छुट्टी दर्ज किए बंद होंगे।"),
  },
  reviews: {
    title: p("Changes to student records", "विद्यार्थी रिकॉर्ड में बदलाव"),
    yes: p("Accept", "स्वीकार करें"),
    no: p("Decline", "अस्वीकार करें"),
    yesMeans: p("Each change is written to the child's record.", "हर बदलाव बच्चे के रिकॉर्ड में लिखा जाएगा।"),
    noMeans: p("Each change is turned back; the record stays as it is.", "हर बदलाव लौटाया जाएगा; रिकॉर्ड जैसा है वैसा रहेगा।"),
  },
};

export type ItemOutcome = { state: "waiting" } | { state: "saving" } | { state: "done" } | { state: "failed"; why: Pair };

/** What to say when a batch ends: every item accounted for, failures never folded into success. */
export function batchSummary(outcomes: ReadonlyMap<string, ItemOutcome>): { done: number; failed: number; line: Pair } {
  let done = 0;
  let failed = 0;
  for (const outcome of outcomes.values()) {
    if (outcome.state === "done") done += 1;
    else if (outcome.state === "failed") failed += 1;
  }
  const line = failed === 0
    ? p(`All ${done} saved.`, `सभी ${done} सहेजे गए।`)
    : p(`${done} saved · ${failed} could not be saved — they are still here to try again.`, `${done} सहेजे गए · ${failed} सहेजे नहीं जा सके — वे फिर कोशिश के लिए यहीं हैं।`);
  return { done, failed, line };
}
