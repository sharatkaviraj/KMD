import { describe, expect, it } from "vitest";

import { foldOutbox } from "@/vx/screens/messages/domain/outbox";

/* Smoke run, 20 Oct (dev group 25): one reminder queued a dozen times, and "absent today" from six days before. */

const row = (id: string, over: Partial<{ status: "queued" | "sent"; dedupeKey: string | null; forDay: string | null; queuedAt: string }> = {}) => ({
  id,
  status: "queued" as const,
  dedupeKey: null,
  forDay: null,
  queuedAt: "2026-10-20T03:00:00Z",
  ...over,
});

describe("foldOutbox", () => {
  it("folds the same message to the same person into one row, keeping the newest", () => {
    const items = [
      row("a", { dedupeKey: "teacher|reminder", queuedAt: "2026-10-12T03:00:00Z" }),
      row("b", { dedupeKey: "teacher|reminder", queuedAt: "2026-10-19T03:00:00Z" }),
      row("c", { dedupeKey: "teacher|reminder", queuedAt: "2026-10-15T03:00:00Z" }),
      row("d", { dedupeKey: "other|reminder" }),
    ];
    const folded = foldOutbox(items, "2026-10-20");
    expect(folded.items.map((x) => [x.id, x.copies])).toEqual([["b", 3], ["d", 1]]);
    expect(folded.items[0].repeatOf.sort()).toEqual(["a", "c"]);
  });

  it("sets day-bound messages whose day has passed apart", () => {
    const folded = foldOutbox([row("old", { forDay: "2026-10-14" }), row("today", { forDay: "2026-10-20" })], "2026-10-20");
    expect(folded.outOfDate.map((x) => x.id)).toEqual(["old"]);
    expect(folded.items.map((x) => x.id)).toEqual(["today"]);
  });

  it("leaves sent rows alone, even when they repeat or are old", () => {
    const folded = foldOutbox([row("s1", { status: "sent", dedupeKey: "k", forDay: "2026-10-01" }), row("s2", { status: "sent", dedupeKey: "k" })], "2026-10-20");
    expect(folded.items.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(folded.outOfDate).toEqual([]);
  });
});
