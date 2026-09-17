import { describe, expect, it } from "vitest";

import {
  describeGaps,
  feeColumnsFor,
  gapFields,
  heldValue,
  isGap,
  isGapForAll,
  type HeldValue,
} from "@/modules/collection/domain/gaps";
import type { CollectionField } from "@/modules/collection/domain/fields";

/**
 * "Only the children we are missing this for."
 *
 * The rules that matter are about **size**. A gap filter that reads too widely
 * asks nineteen teachers about five hundred children; one that reads too
 * narrowly leaves the nine it exists to find exactly where they were. And the
 * sentence describing it has to match the set it describes, because a teacher
 * told she is being asked about a different nine is a teacher who rings the
 * office to check.
 */

const field = (over: Partial<CollectionField> = {}): CollectionField => ({
  id: "f1",
  key: "guardian_phone",
  labelHi: "अभिभावक का फ़ोन",
  labelEn: "Guardian phone",
  inputType: "tel",
  mode: "confirm",
  exactLen: 10,
  pattern: null,
  maxValue: null,
  options: null,
  feeColumn: "guardian_phone",
  helpHi: null,
  helpEn: null,
  isActive: true,
  sortOrder: 1,
  ...over,
});

const held = (over: Partial<HeldValue> = {}): HeldValue => ({
  recorded: null,
  fee: null,
  ...over,
});

describe("what the school holds", () => {
  it("prefers VPPS One's own accepted answer", () => {
    // The same precedence the link and the review queue use. Two answers here
    // and three answers elsewhere is how "missing" comes to mean three things.
    expect(heldValue(held({ recorded: "9800000001", fee: "9800000002" }))).toBe(
      "9800000001",
    );
  });

  it("falls back to the fee app's column", () => {
    expect(heldValue(held({ fee: "9800000002" }))).toBe("9800000002");
  });

  it("treats blank and whitespace as nothing at all", () => {
    // An imported empty cell arrives as "" and a hand-typed one as " ". Both
    // are a hole; treating either as a value is how a gap round misses the
    // children it was built for.
    expect(heldValue(held({ recorded: "", fee: "" }))).toBeNull();
    expect(heldValue(held({ recorded: "   " }))).toBeNull();
    expect(heldValue(held({ recorded: "  ", fee: "9800000002" }))).toBe("9800000002");
  });

  it("trims what it returns", () => {
    expect(heldValue(held({ recorded: " 9800000001 " }))).toBe("9800000001");
  });
});

describe("whether a child is a gap", () => {
  it("is a gap when nothing is held", () => {
    expect(isGap(held())).toBe(true);
  });

  it("is not a gap when anything is held", () => {
    expect(isGap(held({ fee: "9800000002" }))).toBe(false);
  });

  it("does not treat a wrong-looking value as missing", () => {
    // Nine digits is a different problem from no number at all, and rolling
    // them together puts a child the office must fix onto a teacher's list
    // with nothing to say which she is looking at. Validity is validateField's.
    expect(isGap(held({ recorded: "987654321" }))).toBe(false);
    expect(isGap(held({ recorded: "not a number" }))).toBe(false);
  });
});

describe("a child against several filters", () => {
  const missingBoth = new Map<string, HeldValue>([
    ["guardian_phone", held()],
    ["date_of_birth", held()],
  ]);

  const missingOne = new Map<string, HeldValue>([
    ["guardian_phone", held()],
    ["date_of_birth", held({ fee: "2015-04-02" })],
  ]);

  it("needs every filter to be a gap", () => {
    expect(isGapForAll(missingBoth, ["guardian_phone", "date_of_birth"])).toBe(true);
  });

  it("is not selected when only one is missing", () => {
    // **The smaller set.** Two gaps mean the children missing *both*. Reading
    // this as "any" is a round that goes to more children than was picked.
    expect(isGapForAll(missingOne, ["guardian_phone", "date_of_birth"])).toBe(false);
    expect(isGapForAll(missingOne, ["guardian_phone"])).toBe(true);
  });

  it("treats a field nobody has a row for as missing", () => {
    expect(isGapForAll(new Map(), ["guardian_phone"])).toBe(true);
  });

  it("selects nobody when there are no filters", () => {
    // Not everybody. A missing filter must never widen the blast radius, and
    // "no filter means everyone" is the shape that turns a half-built form
    // into a send to the whole school.
    expect(isGapForAll(missingBoth, [])).toBe(false);
  });
});

describe("resolving gap keys to fields", () => {
  const fields = [
    field(),
    field({ id: "f2", key: "date_of_birth", feeColumn: "date_of_birth" }),
    field({ id: "f3", key: "blood_group", feeColumn: null }),
  ];

  it("keeps registry order rather than the order they were typed", () => {
    expect(gapFields(fields, ["blood_group", "guardian_phone"]).map((f) => f.key)).toEqual(
      ["guardian_phone", "blood_group"],
    );
  });

  it("drops a key naming a field that no longer exists", () => {
    // Dropping narrows. Every other reading of an unknown key widens, which
    // is the one direction this must never fail in (D-150).
    expect(gapFields(fields, ["retired_field"])).toEqual([]);
  });

  it("asks for each fee column once, and for none when none is named", () => {
    expect(feeColumnsFor(fields)).toEqual(["guardian_phone", "date_of_birth"]);
    expect(feeColumnsFor([field({ feeColumn: null })])).toEqual([]);
    expect(feeColumnsFor([field(), field({ id: "f9" })])).toEqual(["guardian_phone"]);
  });
});

describe("how the filter reads to a teacher", () => {
  const phone = field();
  const dob = field({
    id: "f2",
    key: "date_of_birth",
    labelHi: "जन्मतिथि",
    labelEn: "Date of birth",
  });

  it("says nothing when nothing is filtered", () => {
    expect(describeGaps([])).toBeNull();
  });

  it("names one gap in both languages", () => {
    expect(describeGaps([phone])).toEqual({
      hi: "अभिभावक का फ़ोन दर्ज नहीं है",
      en: "no Guardian phone on record",
    });
  });

  it("joins two with `and`, because the filter is AND", () => {
    // **Not a wording preference.** "or" describes a bigger set than the round
    // covers, which is a teacher told she is being asked about children she
    // is not.
    const described = describeGaps([phone, dob]);

    expect(described?.en).toBe("no Guardian phone and Date of birth on record");
    expect(described?.en).not.toContain(" or ");
    expect(described?.hi).toBe("अभिभावक का फ़ोन और जन्मतिथि दर्ज नहीं है");
    expect(described?.hi).not.toContain(" या ");
  });

  it("counts more than two rather than listing them", () => {
    const described = describeGaps([phone, dob, field({ id: "f3", key: "blood_group" })]);

    expect(described?.en).toBe("3 things missing");
    expect(described?.hi).toContain("3");
  });

  it("writes numbers in Latin digits in both halves", () => {
    // A test elsewhere asserts no Devanagari numeral reaches a teacher; the
    // school reads roll numbers in Latin anyway.
    const described = describeGaps([phone, dob, field({ id: "f3", key: "blood_group" })]);

    expect(described?.hi).not.toMatch(/[०-९]/);
  });
});
