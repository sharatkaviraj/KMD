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

import { absentAlertChanges } from "@/vx/screens/messages/domain/outbox";

describe("absentAlertChanges (a corrected register)", () => {
  it("never queues a parent again after the first message was sent", () => {
    const out = absentAlertChanges(["kid-a", "kid-b"], true, [{ id: "m1", studentId: "kid-a", status: "sent" }]);
    expect(out.add).toEqual(["kid-b"]);
    expect(out.drop).toEqual([]);
  });

  it("takes back a waiting message for a child now present, but never a sent one", () => {
    const out = absentAlertChanges([], true, [
      { id: "m1", studentId: "kid-a", status: "sent" },
      { id: "m2", studentId: "kid-b", status: "queued" },
    ]);
    expect(out.drop).toEqual(["m2"]);
    expect(out.add).toEqual([]);
  });

  it("a cancelled message does not count: the child can be queued again", () => {
    const out = absentAlertChanges(["kid-a"], true, [{ id: "m1", studentId: "kid-a", status: "cancelled" }]);
    expect(out.add).toEqual(["kid-a"]);
  });

  it("with WhatsApp off, nothing is added and waiting ones are taken back", () => {
    const out = absentAlertChanges(["kid-a"], false, [{ id: "m1", studentId: "kid-a", status: "queued" }]);
    expect(out).toEqual({ drop: ["m1"], add: [], keep: 0 });
  });
});
