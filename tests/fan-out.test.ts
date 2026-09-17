import { describe, expect, it } from "vitest";

import {
  MAX_GROUPS,
  groupsStillNeeded,
  isRecipientMode,
  isTooBig,
  planFanOut,
  recipientModes,
  scopeKey,
  scopeKindFor,
  type PlannableStudent,
} from "@/modules/collection/domain/fan-out";
import {
  chooseRecipient,
  describeScope,
  hasPhone,
  ownersFor,
  partitionByScope,
  type Owner,
  type Scope,
} from "@/modules/collection/domain/ownership";

/**
 * Turning one round into N links, and saying who gets left out.
 *
 * **Every test here is about a child not disappearing.** House is recorded for
 * about a third of a school and bus route for about half, so a house-wise send
 * grouped by house silently drops every child with no house on record — and
 * the dropped ones are exactly the children whose records are thinnest. The
 * office believes it asked about everyone and nobody finds out.
 *
 * So `unassigned` is asserted directly, never inferred from two totals
 * agreeing, and the totals are asserted to add up to the audience.
 */

const owner = (over: Partial<Owner> = {}): Owner => ({
  id: "t1",
  displayName: "Ravina",
  phone: "9812345670",
  classIds: ["c6"],
  houses: [],
  routeIds: [],
  ...over,
});

const child = (over: Partial<PlannableStudent> = {}): PlannableStudent => ({
  studentId: "s1",
  fullName: "Test Child",
  classId: "c6",
  classLabel: "Class 6",
  house: null,
  routeId: null,
  ...over,
});

const scope = (over: Partial<Scope> = {}): Scope => ({
  kind: "class",
  value: "c6",
  label: "Class 6",
  ...over,
});

const labels: Record<string, string> = { c6: "Class 6", c7: "Class 7" };
const labelOf = (_kind: string, value: string) => labels[value] ?? value;

describe("who is in charge", () => {
  it("finds the one person assigned", () => {
    const choice = chooseRecipient([owner()], scope());

    expect(choice.kind).toBe("one");
    expect(choice.kind === "one" && choice.ownerId).toBe("t1");
  });

  it("refuses to pick between two", () => {
    // Both people really do hold it. Dropping one on the strength of a send
    // would be a deletion nobody asked for — it is a choice for this round.
    const choice = chooseRecipient([owner(), owner({ id: "t2", displayName: "Jai" })], scope());

    expect(choice.kind).toBe("many");
    expect(choice.kind === "many" && choice.message.en).toContain("2 teachers");
    expect(choice.kind === "many" && choice.message.hi).not.toBe("");
  });

  it("says so when nobody holds it", () => {
    const choice = chooseRecipient([owner({ classIds: [] })], scope());

    expect(choice.kind).toBe("none");
    expect(choice.kind === "none" && choice.message.en).toContain("No teacher");
  });

  it("matches a route exactly, never by prefix", () => {
    // Several routes differ only by a parenthesised suffix. A loose match here
    // hands one route's children to another route's in-charge.
    const driver = owner({ routeIds: ["Amet Railway Station (Inside)"] });
    const inside = scope({ kind: "route", value: "Amet Railway Station (Inside)", label: "x" });
    const onRoad = scope({ kind: "route", value: "Amet Railway Station (On Road)", label: "y" });

    expect(ownersFor([driver], inside)).toHaveLength(1);
    expect(ownersFor([driver], onRoad)).toHaveLength(0);
  });

  it("does not match a scope with no value", () => {
    expect(ownersFor([owner()], scope({ value: "" }))).toEqual([]);
  });

  it("describes a scope in both languages", () => {
    expect(describeScope(scope({ kind: "house", label: "Chetak" })).en).toBe(
      "Chetak house",
    );
    expect(describeScope(scope({ kind: "house", label: "Chetak" })).hi).toContain(
      "Chetak",
    );
    // A class label is already how the school says it, in either language.
    expect(describeScope(scope()).en).toBe("Class 6");
  });

  it("leads a picker with the people who hold it", () => {
    const split = partitionByScope([owner({ id: "a" }), owner({ id: "b", classIds: [] })], scope());

    expect(split.owners.map((o) => o.id)).toEqual(["a"]);
    expect(split.others.map((o) => o.id)).toEqual(["b"]);
  });
});

describe("a number a message could be sent to", () => {
  it.each(["9812345670", "98123 45670", "98123-45670"])("%s is one", (phone) => {
    expect(hasPhone(phone)).toBe(true);
  });

  it.each([null, undefined, "", "   ", "987654321", "98123456701"])(
    "%o is not",
    (phone) => {
      expect(hasPhone(phone)).toBe(false);
    },
  );
});

describe("cutting a round into links", () => {
  it("makes one link per class, to its class teacher", () => {
    const plan = planFanOut(
      [child(), child({ studentId: "s2" }), child({ studentId: "s3", classId: "c7", classLabel: "Class 7" })],
      [owner(), owner({ id: "t2", displayName: "Jai", classIds: ["c7"] })],
      "class_teacher",
      labelOf,
    );

    expect(plan.ready.map((g) => g.scope.label)).toEqual(["Class 6", "Class 7"]);
    expect(plan.ready[0].studentIds).toEqual(["s1", "s2"]);
    expect(plan.ready[0].ownerName).toBe("Ravina");
    expect(plan.totals).toEqual({ links: 2, students: 3, skipped: 0 });
  });

  it("keeps the order the caller resolved the classes in", () => {
    // Insertion order, which is school order (D-130). Sorting labels as text
    // is what put Class 10 between Class 1 and Class 2 on four screens (B-06).
    const plan = planFanOut(
      [
        child({ studentId: "a", classId: "c2", classLabel: "Class 2" }),
        child({ studentId: "b", classId: "c10", classLabel: "Class 10" }),
      ],
      [
        owner({ id: "t1", classIds: ["c2"] }),
        owner({ id: "t2", displayName: "Jai", classIds: ["c10"] }),
      ],
      "class_teacher",
      (_k, v) => (v === "c2" ? "Class 2" : "Class 10"),
    );

    expect(plan.ready.map((g) => g.scope.label)).toEqual(["Class 2", "Class 10"]);
  });

  it("blocks a class with two class teachers rather than choosing", () => {
    const plan = planFanOut(
      [child()],
      [owner(), owner({ id: "t2", displayName: "Jai" })],
      "class_teacher",
      labelOf,
    );

    expect(plan.ready).toEqual([]);
    expect(plan.blocked[0].reason).toBe("many-owners");
    expect(plan.totals).toEqual({ links: 0, students: 0, skipped: 1 });
  });

  it("blocks a class with no class teacher", () => {
    const plan = planFanOut([child()], [], "class_teacher", labelOf);

    expect(plan.blocked[0].reason).toBe("no-owner");
    expect(plan.totals.skipped).toBe(1);
  });

  it("blocks a teacher with no number, and names her", () => {
    // A link nobody can be sent is a roster frozen for nothing. Caught before
    // anything is created, so the preview can offer a box to type one into.
    const plan = planFanOut([child()], [owner({ phone: null })], "class_teacher", labelOf);

    expect(plan.blocked[0].reason).toBe("no-phone");
    expect(plan.blocked[0].message.en).toContain("Ravina");
    expect(plan.blocked[0].message.hi).toContain("Ravina");
  });

  it("nobody is unassigned in class mode, because every child has a class", () => {
    const plan = planFanOut(
      [child({ house: null, routeId: null })],
      [owner()],
      "class_teacher",
      labelOf,
    );

    expect(plan.unassigned).toEqual([]);
  });

  it("names every child with no house when grouping by house", () => {
    // **The one this module exists for.** A house-wise send silently drops
    // every child with no house on record, and they are exactly the children
    // whose records are thinnest.
    const plan = planFanOut(
      [
        child({ studentId: "s1", house: "Chetak" }),
        child({ studentId: "s2", house: null }),
        child({ studentId: "s3", house: null }),
      ],
      [owner({ houses: ["Chetak"] })],
      "house_incharge",
      (_k, v) => v,
    );

    expect(plan.ready).toHaveLength(1);
    expect(plan.unassigned.map((row) => row.studentId)).toEqual(["s2", "s3"]);
    expect(plan.unassigned[0].reason).toBe("no-house");
    expect(plan.unassigned[0].fullName).not.toBe("");
  });

  it("names every child with no route when grouping by route", () => {
    const plan = planFanOut(
      [child({ routeId: null })],
      [owner({ routeIds: ["r1"] })],
      "route_incharge",
      (_k, v) => v,
    );

    expect(plan.unassigned[0].reason).toBe("no-route");
  });

  it("accounts for every child in the audience", () => {
    // The invariant. Covered plus skipped is everybody — a plan where they do
    // not add up has lost somebody, silently, which is the whole failure mode.
    const students = [
      child({ studentId: "a", house: "Chetak" }),
      child({ studentId: "b", house: "Rana Pratap" }),
      child({ studentId: "c", house: null }),
      child({ studentId: "d", house: "Unowned House" }),
    ];

    const plan = planFanOut(
      students,
      [owner({ houses: ["Chetak"] }), owner({ id: "t2", houses: ["Rana Pratap"] })],
      "house_incharge",
      (_k, v) => v,
    );

    expect(plan.totals.students + plan.totals.skipped).toBe(students.length);
    expect(plan.totals.students).toBe(2);
    expect(plan.totals.skipped).toBe(2);
  });

  it("selects nobody from nobody", () => {
    const plan = planFanOut([], [owner()], "class_teacher", labelOf);

    expect(plan.totals).toEqual({ links: 0, students: 0, skipped: 0 });
  });
});

describe("the modes", () => {
  it.each(recipientModes)("%s is a mode, and buckets by something", (mode) => {
    expect(isRecipientMode(mode)).toBe(true);
    expect(["class", "house", "route"]).toContain(scopeKindFor(mode));
  });

  it("does not accept a mode it has never heard of", () => {
    expect(isRecipientMode("subject_teacher")).toBe(false);
    expect(isRecipientMode("")).toBe(false);
  });
});

describe("the cap", () => {
  it("refuses a plan that would mint more links than anybody meant to", () => {
    const big = {
      ready: Array.from({ length: MAX_GROUPS + 1 }, () => ({}) as never),
      blocked: [],
      unassigned: [],
      totals: { links: MAX_GROUPS + 1, students: 0, skipped: 0 },
    };

    expect(isTooBig(big)).toBe(true);
    expect(isTooBig({ ...big, ready: [] })).toBe(false);
  });
});

describe("resume", () => {
  const ready = [
    { scope: scope({ label: "Class 6" }) },
    { scope: scope({ label: "Class 7", value: "c7" }) },
  ] as never[] as Parameters<typeof groupsStillNeeded>[0];

  it("asks only for the groups that do not exist yet", () => {
    // A fan-out is deliberately not one transaction: if link seven of eleven
    // fails, the first six are kept, because six live tokens are six classes
    // the office can send to right now.
    const still = groupsStillNeeded(ready, [{ kind: "class", label: "Class 6" }]);

    expect(still.map((g) => g.scope.label)).toEqual(["Class 7"]);
  });

  it("asks for nothing when everything exists", () => {
    expect(
      groupsStillNeeded(ready, [
        { kind: "class", label: "Class 6" },
        { kind: "class", label: "Class 7" },
      ]),
    ).toEqual([]);
  });

  it("tells two kinds with the same label apart", () => {
    // A house and a class could both be called "6". They are two links, and
    // the unique index is on the pair.
    const still = groupsStillNeeded(ready, [{ kind: "house", label: "Class 6" }]);

    expect(still).toHaveLength(2);
    expect(scopeKey({ kind: "class", label: "6" })).not.toBe(
      scopeKey({ kind: "house", label: "6" }),
    );
  });
});
