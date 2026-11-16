import { p, type Pair } from "@/vx/text";

/*
 * Marks send themselves (D-651). Once an exam's marks due day is over, a
 * paper whose every child has a mark, an absence or an exemption, and that
 * nobody has typed in for two hours, goes to the exam office by itself
 * (`vppsone.marks_send_themselves`, hourly). It goes where Send marks takes
 * it and nowhere else: showing marks to parents stays the admin's (D-647).
 */

type SentFacts = { entry_status: "open" | "submitted"; submitted_at: string | null; sent_itself_at?: string | null };

/**
 * Whether the paper reads as sent by itself: sent, and the send on file is the
 * one the database made. A hand-back and a person's later Send leave
 * `sent_itself_at` behind, so it no longer matches `submitted_at`.
 */
export function sentItself(paper: SentFacts): boolean {
  if (paper.entry_status !== "submitted" || !paper.submitted_at || !paper.sent_itself_at) return false;
  return Date.parse(paper.submitted_at) === Date.parse(paper.sent_itself_at);
}

/** Beside Send marks while the paper is open: what happens if the teacher forgets. Null with no due day. */
export function sendsItselfLine(dueLabel: string | null, duePassed = false): Pair | null {
  if (!dueLabel) return null;
  if (duePassed) {
    return p(
      "If you forget, it goes by itself two hours after your last mark",
      "भूल जाएँ तो आपके आखिरी अंक के दो घंटे बाद अपने-आप चला जाएगा",
    );
  }
  return p(
    `If you forget, it goes by itself after ${dueLabel}`,
    `भूल जाएँ तो ${dueLabel} के बाद अपने-आप चला जाएगा`,
  );
}

/** The sent page's line for a paper that went by itself. */
export function sentItselfLine(day: string, time: string): Pair {
  return p(
    `Sent by itself on ${day}, ${time}: every child had a mark after the due day`,
    `${day}, ${time} को अपने-आप भेजा गया: अंतिम दिन के बाद हर बच्चे के अंक भरे थे`,
  );
}

/** Under the exam's Marks due day, for the office. */
export const SENDS_ITSELF_HINT: Pair = p(
  "After this day, papers with every child's mark go to you by themselves",
  "इस दिन के बाद, जिन पेपरों में सब बच्चों के अंक हैं, वे अपने-आप आपके पास आ जाएँगे",
);
