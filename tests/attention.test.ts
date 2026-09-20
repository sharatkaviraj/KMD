import { describe, expect, it } from "vitest";

import { m } from "@/messages";
import { staffRoles, type StaffRole } from "@/platform/auth/permissions";
import {
  attentionFor,
  needsAttention,
  type AttentionFacts,
} from "@/modules/home/domain/attention";

/**
 * What a role home says needs attention, and — the part that matters —
 * what it says when it does not know.
 */

const BUSY: AttentionFacts = {
  registersOutstanding: 3,
  classesTotal: 19,
  absencesToday: 2,
  pendingSubmissions: 8,
  pendingCorrections: 1,
  failedJobs: 1,
  schoolOpenToday: true,
};

const CLEAR: AttentionFacts = {
  registersOutstanding: 0,
  classesTotal: 19,
  absencesToday: 0,
  pendingSubmissions: 0,
  pendingCorrections: 0,
  failedJobs: 0,
  schoolOpenToday: true,
};

const onBehalf = { canMarkOnBehalf: true };
const notOnBehalf = { canMarkOnBehalf: false };

describe("who is shown what", () => {
  it("gives the admin every exception, in PLAN §3's order", () => {
    expect(attentionFor("admin", BUSY, onBehalf).map((item) => item.key)).toEqual([
      "registers",
      "absences",
      "review",
      "corrections",
      "jobs",
    ]);
  });

  it("leads the office with its own work, not with the timetable's", () => {
    expect(attentionFor("office", BUSY, onBehalf).map((item) => item.key)).toEqual([
      "review",
      "corrections",
      "registers",
      "absences",
    ]);
  });

  it("gives the academic coordinator cover before attendance", () => {
    expect(
      attentionFor("academic_coordinator", BUSY, notOnBehalf).map((item) => item.key),
    ).toEqual(["absences", "registers"]);
  });

  it("gives a teacher nothing here, because her home is her class", () => {
    // A second list of the school's exceptions on her phone is somebody else's
    // work; hers is already the top of `/teach`.
    expect(attentionFor("teacher", BUSY, notOnBehalf)).toEqual([]);
  });

  it("gives the viewer no work queue at all", () => {
    // PLAN §3: read-only information, no per-child actions. Figures, not tasks.
    expect(attentionFor("view_only", BUSY, notOnBehalf)).toEqual([]);
  });

  it("gives the exam coordinator nothing rather than a count it cannot read", () => {
    // Incomplete papers and report readiness have no cheap count yet. An empty
    // queue is honest; a wrong one is not.
    expect(attentionFor("exam_coordinator", BUSY, notOnBehalf)).toEqual([]);
  });

  it.each(staffRoles)("%s is never shown an item twice", (role: StaffRole) => {
    const keys = attentionFor(role, BUSY, onBehalf).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("a count nobody could read", () => {
  it("is a dash, not a nought", () => {
    // D-93: a swallowed query error reports a confident zero, and on a
    // dashboard that tells an administrator the school has nothing outstanding.
    const [registers] = attentionFor(
      "admin",
      { ...CLEAR, unavailable: ["registers"] },
      onBehalf,
    );

    expect(registers.count).toBeNull();
    expect(registers.detail).toBeNull();
  });

  it("still counts as needing attention, because nobody knows that it does not", () => {
    const items = attentionFor("admin", { ...CLEAR, unavailable: ["jobs"] }, onBehalf);

    expect(needsAttention(items)).toBe(true);
  });

  it("leaves the counts that were read alone", () => {
    const items = attentionFor(
      "admin",
      { ...BUSY, unavailable: ["jobs"] },
      onBehalf,
    );

    expect(items.find((item) => item.key === "jobs")?.count).toBeNull();
    expect(items.find((item) => item.key === "review")?.count).toBe(8);
  });
});

describe("a queue of noughts is good news, said once", () => {
  it("knows when nothing is waiting", () => {
    expect(needsAttention(attentionFor("admin", CLEAR, onBehalf))).toBe(false);
  });

  it("knows when something is", () => {
    expect(needsAttention(attentionFor("admin", BUSY, onBehalf))).toBe(true);
  });

  it("is not fooled by one non-zero among noughts", () => {
    const items = attentionFor(
      "office",
      { ...CLEAR, pendingCorrections: 1 },
      onBehalf,
    );

    expect(needsAttention(items)).toBe(true);
  });
});

describe("every item says whose work it is and where to go", () => {
  it.each(attentionFor("admin", BUSY, onBehalf).map((item) => [item.key, item]))(
    "%s",
    (_key, item) => {
      expect(item.owner.en.length).toBeGreaterThan(3);
      expect(item.owner.hi.length).toBeGreaterThan(1);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.en.length).toBeGreaterThan(3);
    },
  );

  it("sends somebody who can mark on behalf where they can do something", () => {
    const able = attentionFor("office", BUSY, onBehalf);
    const not = attentionFor("academic_coordinator", BUSY, notOnBehalf);

    expect(able.find((item) => item.key === "registers")?.href).toBe(
      "/teach/attendance",
    );
    expect(not.find((item) => item.key === "registers")?.href).toBe("/teach/register");
  });

  it("gives the register count a denominator", () => {
    const [registers] = attentionFor("admin", BUSY, onBehalf);

    // Three out of nineteen and three out of four are different mornings.
    expect(registers.detail?.en).toBe("of 19");
  });

  it("drops the denominator when there are no classes to count against", () => {
    const [registers] = attentionFor("admin", { ...BUSY, classesTotal: 0 }, onBehalf);

    expect(registers.detail).toBeNull();
  });

  it("marks only the items that actually want doing", () => {
    const busy = attentionFor("admin", BUSY, onBehalf);
    const clear = attentionFor("admin", CLEAR, onBehalf);

    expect(busy.every((item) => item.tone === "warning")).toBe(true);
    expect(clear.every((item) => item.tone === "neutral")).toBe(true);
  });
});

describe("a closed day has no registers outstanding", () => {
  const onBehalf = { canMarkOnBehalf: true };

  /**
   * The bug this exists for, found on the deployed site on a Sunday.
   *
   * `registersOutstanding` was `classesTotal - submitted`, full stop. On a day
   * the school is shut nobody takes a register, so nothing is submitted, so the
   * administrator's home read **19 of 19 outstanding, whose work: teachers** —
   * nineteen teachers accused of not doing something that was never due.
   *
   * It had been wrong every weekend since R2.2. D-101 is the same question in
   * the nightly job, fixed there in 7.4; this was the second copy of it.
   */
  const SUNDAY: AttentionFacts = {
    registersOutstanding: 0,
    classesTotal: 19,
    absencesToday: 0,
    pendingSubmissions: 4,
    pendingCorrections: 0,
    failedJobs: 0,
    schoolOpenToday: false,
  };

  it("says the school is closed rather than counting classes", () => {
    const registers = attentionFor("admin", SUNDAY, onBehalf).find(
      (item) => item.key === "registers",
    );

    expect(registers?.count, "a closed day owes nothing").toBe(0);
    // "0 of 19" on a Sunday reads as nineteen teachers who have finished. The
    // row has to say why the number is nought.
    expect(registers?.detail).toEqual(m.homeSchoolClosedToday);
  });

  it("still counts the work that does not depend on the school being open", () => {
    // Somebody can review a collection answer on a Sunday. Silencing the whole
    // queue would be the opposite mistake.
    const review = attentionFor("admin", SUNDAY, onBehalf).find(
      (item) => item.key === "review",
    );

    expect(review?.count).toBe(4);
  });

  it("counts classes again on a day the school is open", () => {
    const openDay: AttentionFacts = { ...SUNDAY, registersOutstanding: 3 };
    const registers = attentionFor("admin", { ...openDay, schoolOpenToday: true }, onBehalf).find(
      (item) => item.key === "registers",
    );

    expect(registers?.count).toBe(3);
    expect(registers?.detail).not.toEqual(m.homeSchoolClosedToday);
  });
});
