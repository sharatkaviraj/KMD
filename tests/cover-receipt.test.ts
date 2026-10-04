import { describe, expect, it } from "vitest";

import { receiptSentence, type CoverReceipt } from "@/modules/substitutions/domain/cover-state";

/**
 * The cover receipt in words (P3). It is the first thing a coordinator reads
 * after pressing a button, so it must say what happened, not just count.
 */

const base: CoverReceipt = {
  commandId: "00000000-0000-4000-8000-000000000001",
  dayRevision: 1,
  assigned: 0,
  needsHelp: 0,
  added: 0,
  changed: 0,
  cancelled: 0,
  unchanged: 0,
  pinned: 0,
  skippedStarted: 0,
  noticesQueued: 0,
  noticesWithdrawn: 0,
  noticeRecipients: 0,
  recipientsWithoutPhone: 0,
  replayed: false,
};

describe("receiptSentence", () => {
  it("says a day with nothing to cover plainly, not as zero duties", () => {
    const sentence = receiptSentence(base);
    expect(sentence.en).toBe("No lessons need cover on this day");
    expect(sentence.hi).toBe("इस दिन किसी पाठ के लिए व्यवस्था नहीं चाहिए");
  });

  it("counts what was arranged, what still needs a person and who will be told", () => {
    const sentence = receiptSentence({
      ...base,
      assigned: 1,
      needsHelp: 7,
      noticesQueued: 1,
      noticeRecipients: 1,
      recipientsWithoutPhone: 1,
    });
    expect(sentence.en).toBe(
      "1 duty assigned · 7 need help · notices queued to 1 teacher · 1 without a phone — assigned, notice blocked",
    );
  });

  it("says when a hand-picked teacher was confirmed rather than changed", () => {
    expect(receiptSentence({ ...base, assigned: 3, unchanged: 3, pinned: 1 }).en).toBe(
      "3 duties assigned · 1 confirmed and pinned",
    );
  });

  it("says what a return cancelled, even when nothing is left", () => {
    const sentence = receiptSentence({ ...base, cancelled: 2 });
    expect(sentence.en).toBe("No lessons need cover on this day · 2 cancelled");
    expect(sentence.hi).toBe("इस दिन किसी पाठ के लिए व्यवस्था नहीं चाहिए · 2 रद्द");
  });
});
