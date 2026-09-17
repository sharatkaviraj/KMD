import { describe, expect, it } from "vitest";

import {
  activeFields,
  isFieldKey,
  normalisePhone,
  orderFields,
  PHONE_LENGTH,
  slugFieldKey,
  validateField,
  type CollectionField,
} from "@/modules/collection/domain/fields";

/**
 * Ported from `sampark/src/lib/fields.ts` and `field-keys.ts`.
 *
 * The principle these exist for: **a nine-digit phone number must be
 * impossible to submit**, not something the office cleans up afterwards.
 */

const field = (over: Partial<CollectionField> = {}): CollectionField => ({
  id: "f1",
  key: "guardian_phone",
  labelHi: "अभिभावक का फ़ोन",
  labelEn: "Guardian phone",
  inputType: "text",
  mode: "confirm",
  exactLen: null,
  pattern: null,
  maxValue: null,
  options: null,
  feeColumn: null,
  helpHi: null,
  helpEn: null,
  isActive: true,
  sortOrder: 0,
  ...over,
});

const NOW = new Date("2026-09-17T12:00:00Z");

describe("blank", () => {
  /**
   * The rule that stops a form emptying a register on its first pass: a child
   * a teacher skipped is a child she has not answered for.
   */
  it("always means no change, never erase", () => {
    for (const inputType of ["text", "tel", "number", "date", "boolean", "select"] as const) {
      const result = validateField(field({ inputType }), "", NOW);
      expect(result.ok && result.value).toBeNull();
    }

    expect(validateField(field(), null, NOW)).toEqual({ ok: true, value: null });
    expect(validateField(field(), "   ", NOW)).toEqual({ ok: true, value: null });
  });
});

describe("phone numbers", () => {
  it("are the same number however they were typed", () => {
    for (const written of [
      "9876543210",
      "+91 98765 43210",
      "098765 43210",
      "98765-43210",
      "  919876543210  ",
    ]) {
      expect(normalisePhone(written)).toBe("9876543210");
    }
  });

  it("do not strip a prefix that is really the number", () => {
    // A bare ten-digit number starting 91 is plausible, so only length says a
    // prefix is a prefix.
    expect(normalisePhone("9112345678")).toBe("9112345678");
    expect(normalisePhone("0123456789")).toBe("0123456789");
  });

  it("are refused when short", () => {
    const result = validateField(field({ inputType: "tel" }), "98765432", NOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.en).toContain("10 digits");
    expect(!result.ok && result.error.hi).toBeTruthy();
  });

  it("are refused when they are not a mobile number", () => {
    // Indian mobile numbers start 6–9. A landline here is a number nobody
    // answers, sent by a school that thinks it has reached somebody.
    const result = validateField(field({ inputType: "tel" }), "1234567890", NOW);
    expect(result.ok).toBe(false);
  });

  it("are accepted and normalised", () => {
    const result = validateField(field({ inputType: "tel" }), "+91 98765 43210", NOW);
    expect(result).toEqual({ ok: true, value: "9876543210" });
    expect(PHONE_LENGTH).toBe(10);
  });

  it("are never refused for being a repeat", () => {
    // 134 numbers in the school Sampark was built for are held by more than
    // one child. A uniqueness check would reject the correct answer.
    const first = validateField(field({ inputType: "tel" }), "9876543210", NOW);
    const second = validateField(field({ inputType: "tel" }), "9876543210", NOW);
    expect(first).toEqual(second);
    expect(second.ok).toBe(true);
  });
});

describe("dates", () => {
  it("refuse the future", () => {
    const result = validateField(field({ inputType: "date" }), "2030-01-01", NOW);
    expect(result.ok).toBe(false);
  });

  it("refuse an age a school roll cannot hold", () => {
    // A typo in the year is the common case, and it is the one that makes a
    // report card say a child is forty.
    expect(validateField(field({ inputType: "date" }), "1980-01-01", NOW).ok).toBe(
      false,
    );
    expect(validateField(field({ inputType: "date" }), "2025-01-01", NOW).ok).toBe(
      false,
    );
  });

  it("accept a plausible one and store it as ISO", () => {
    const result = validateField(field({ inputType: "date" }), "2014-06-11", NOW);
    expect(result).toEqual({ ok: true, value: "2014-06-11" });
  });

  it("refuse something that is not a date at all", () => {
    expect(validateField(field({ inputType: "date" }), "last June", NOW).ok).toBe(
      false,
    );
  });
});

describe("numbers", () => {
  it("refuse a negative and anything past the maximum", () => {
    const marks = field({ inputType: "number", maxValue: 25 });
    expect(validateField(marks, "-1", NOW).ok).toBe(false);
    expect(validateField(marks, "30", NOW).ok).toBe(false);
    expect(validateField(marks, "25", NOW)).toEqual({ ok: true, value: "25" });
  });

  it("refuse text", () => {
    expect(validateField(field({ inputType: "number" }), "twelve", NOW).ok).toBe(
      false,
    );
  });
});

describe("yes and no", () => {
  it("are stored canonically whatever was tapped", () => {
    // So a later count does not have to know Hindi.
    for (const yes of ["yes", "Y", "true", "1", "हाँ", "हां"]) {
      expect(validateField(field({ inputType: "boolean" }), yes, NOW)).toEqual({
        ok: true,
        value: "yes",
      });
    }
    for (const no of ["no", "N", "false", "0", "नहीं"]) {
      expect(validateField(field({ inputType: "boolean" }), no, NOW)).toEqual({
        ok: true,
        value: "no",
      });
    }
  });

  it("refuse anything else", () => {
    expect(validateField(field({ inputType: "boolean" }), "maybe", NOW).ok).toBe(
      false,
    );
  });
});

describe("choices", () => {
  const blood = field({ inputType: "select", options: ["A+", "O-"] });

  it("must be on the list", () => {
    expect(validateField(blood, "A+", NOW)).toEqual({ ok: true, value: "A+" });
    expect(validateField(blood, "Z+", NOW).ok).toBe(false);
  });

  it("accept anything when the list is empty", () => {
    // A select with no options is a registry that has not been finished, not
    // a reason to refuse a teacher's answer.
    expect(
      validateField(field({ inputType: "select", options: [] }), "anything", NOW).ok,
    ).toBe(true);
  });
});

describe("text", () => {
  it("honours an exact length", () => {
    const aadhaar = field({ inputType: "text", exactLen: 4 });
    expect(validateField(aadhaar, "1234", NOW)).toEqual({ ok: true, value: "1234" });
    expect(validateField(aadhaar, "123", NOW).ok).toBe(false);
  });

  it("honours a pattern", () => {
    const code = field({ inputType: "text", pattern: "^[A-Z]{2}\\d{2}$" });
    expect(validateField(code, "AB12", NOW).ok).toBe(true);
    expect(validateField(code, "abc", NOW).ok).toBe(false);
  });

  it("does not lock a teacher out over a pattern somebody mistyped", () => {
    // A broken pattern is the registry's problem, not hers.
    const broken = field({ inputType: "text", pattern: "([" });
    expect(validateField(broken, "anything", NOW).ok).toBe(true);
  });
});

describe("every failure speaks both languages", () => {
  it("never returns an English-only message", () => {
    const cases: [CollectionField, string][] = [
      [field({ inputType: "tel" }), "123"],
      [field({ inputType: "number", maxValue: 5 }), "9"],
      [field({ inputType: "date" }), "2099-01-01"],
      [field({ inputType: "boolean" }), "maybe"],
      [field({ inputType: "select", options: ["A"] }), "B"],
      [field({ inputType: "text", exactLen: 4 }), "xy"],
    ];

    for (const [definition, raw] of cases) {
      const result = validateField(definition, raw, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.hi, `${definition.inputType} has no Hindi`).toBeTruthy();
      expect(result.error.en, `${definition.inputType} has no English`).toBeTruthy();
      expect(result.error.hi).not.toBe(result.error.en);
    }
  });
});

/* -------------------------------------------------------------- the keys */

describe("slugFieldKey()", () => {
  it("turns a label into an identifier", () => {
    expect(slugFieldKey("T-shirt size")).toBe("t_shirt_size");
    expect(slugFieldKey("  Guardian Phone  ")).toBe("guardian_phone");
  });

  it("gives a second question of the same name its own key", () => {
    // Last year's "T-shirt size" and this year's are different questions, and
    // a key is never renamed once anything points at it.
    expect(slugFieldKey("T-shirt size", new Set(["t_shirt_size"]))).toBe(
      "t_shirt_size_2",
    );
  });

  it("refuses a label with nothing usable in it", () => {
    // A Hindi-only label produces nothing, and "q_" alone would collide with
    // the next such label.
    expect(slugFieldKey("रक्त समूह")).toBeNull();
    expect(slugFieldKey("---")).toBeNull();
    expect(slugFieldKey("")).toBeNull();
  });

  it("makes a label starting with a digit into a valid key", () => {
    const key = slugFieldKey("2nd phone");
    expect(key).toBeTruthy();
    expect(isFieldKey(key!)).toBe(true);
  });

  it("produces something the pattern accepts, every time", () => {
    for (const label of ["Blood group", "Father's name", "Class 10 marks"]) {
      const key = slugFieldKey(label);
      expect(key, label).toBeTruthy();
      expect(isFieldKey(key!), `${label} → ${key}`).toBe(true);
    }
  });
});

describe("isFieldKey()", () => {
  it.each(["guardian_phone", "a1", "x_2_y"])("accepts %s", (key) => {
    expect(isFieldKey(key)).toBe(true);
  });

  it.each(["Guardian", "1phone", "a", "with space", "with-dash", ""])(
    "refuses %s",
    (key) => {
      expect(isFieldKey(key)).toBe(false);
    },
  );
});

describe("ordering", () => {
  it("is the school's own, then alphabetical", () => {
    const fields = [
      field({ id: "b", labelEn: "Zebra", sortOrder: 1 }),
      field({ id: "a", labelEn: "Apple", sortOrder: 1 }),
      field({ id: "c", labelEn: "Middle", sortOrder: 0 }),
    ];

    expect(orderFields(fields).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("drops the retired ones", () => {
    const fields = [field({ id: "on" }), field({ id: "off", isActive: false })];
    expect(activeFields(fields).map((entry) => entry.id)).toEqual(["on"]);
  });
});
