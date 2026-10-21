import { describe, expect, it } from "vitest";

import { childMatches, tellApart, tellApartWithin } from "@/vx/domain/tell-apart";

/*
 * Same-named children, told apart on every child list (smoke 20 Oct,
 * dev.groups[11]): the note picker showed two "Ansh Namoona · Class 1" with
 * nothing between them. Synthetic names only.
 */

describe("tellApart", () => {
  const rows = [
    { id: "a", name: "Ansh  Namoona", admissionNo: "1201", fatherName: "Father One" },
    { id: "b", name: "ansh namoona", admissionNo: "1202", fatherName: "Father Two" },
    { id: "c", name: "Sai Jaanch", admissionNo: "1203", fatherName: null },
  ];

  it("gives a line only to children who share a name, in both languages", () => {
    const hints = tellApart(rows);
    expect(hints.get("a")).toEqual({ en: "SR 1201 · father Father One", hi: "SR 1201 · पिता Father One" });
    expect(hints.get("b")?.en).toBe("SR 1202 · father Father Two");
    expect(hints.has("c")).toBe(false);
  });

  it("does not call one child listed twice a namesake", () => {
    expect(tellApart([rows[2]!, { ...rows[2]! }]).size).toBe(0);
  });

  it("says nothing when there is nothing to tell them apart by", () => {
    expect(tellApart([{ id: "x", name: "Same Name" }, { id: "y", name: "Same Name" }]).size).toBe(0);
  });

  it("within a class only: namesakes in two classes are told apart by the class", () => {
    const kids = [
      { id: "1", classId: "c1", name: "Krishna Test", admissionNo: "11", fatherName: null },
      { id: "2", classId: "c2", name: "Krishna Test", admissionNo: "12", fatherName: null },
      { id: "3", classId: "c2", name: "Krishna Test", admissionNo: "13", fatherName: "Father Three" },
    ];
    const hints = tellApartWithin(kids, (k) => k.classId);
    expect(hints.has("1")).toBe(false);
    expect(hints.get("2")?.en).toBe("SR 12");
    expect(hints.get("3")?.en).toBe("SR 13 · father Father Three");
  });
});

describe("childMatches", () => {
  it("finds a child by every word of the name, the roll or the SR number", () => {
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: "1201" }, "1201")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: "4", admissionNo: null }, "4")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: null }, "namoona ansh")).toBe(true);
    expect(childMatches({ name: "Ansh Namoona", rollNo: null, admissionNo: null }, "rudra")).toBe(false);
    expect(childMatches({ name: "Ansh Namoona" }, "  ")).toBe(true);
  });
});
