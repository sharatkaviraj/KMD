import { describe, expect, it } from "vitest";

import { m } from "@/messages";
import {
  countOf,
  countOfPair,
  decodeMessage,
  DEFAULT_LANGUAGE,
  encodeMessage,
  flat,
  isLanguage,
  languages,
  primary,
  resolveLanguage,
  secondary,
  SIGNED_OUT_LANGUAGE,
  t,
} from "@/platform/i18n/language";

const sample = t("नमस्ते", "Welcome");

describe("the language list", () => {
  it("is exactly the three the database allows", () => {
    // The CHECK constraint in
    // supabase/migrations/20260916202429_staff_language_allows_bilingual.sql.
    // If these drift, a profile exists that the app cannot render.
    expect([...languages]).toEqual(["hi", "en", "both"]);
  });

  it("defaults new profiles to Hindi", () => {
    // Most of the teaching staff read Hindi and they are most of the accounts;
    // an admin changes it when they create the profile (D-35).
    expect(DEFAULT_LANGUAGE).toBe("hi");
  });

  it("shows both when nobody has said", () => {
    // Bilingual is the only choice that cannot hide a word from anyone, which
    // is what the signed-out login screen needs (D-36).
    expect(SIGNED_OUT_LANGUAGE).toBe("both");
  });
});

describe("primary()", () => {
  it.each([
    ["hi", "नमस्ते"],
    ["both", "नमस्ते"],
    ["en", "Welcome"],
  ] as const)("leads with the right half for %s", (language, expected) => {
    expect(primary(sample, language)).toBe(expected);
  });
});

describe("secondary()", () => {
  it("is the English line only for bilingual readers", () => {
    expect(secondary(sample, "both")).toBe("Welcome");
  });

  it.each(["hi", "en"] as const)("is null for %s", (language) => {
    // A reader who asked for one language gets exactly one line — no leftover
    // separator, no second half in a language they did not want.
    expect(secondary(sample, language)).toBeNull();
  });

  it("has no second line when both halves are the same word", () => {
    // Proper nouns are most of these: a class is "Class 6 A" and a teacher is
    // their name in either language. "Class 6 A · Class 6 A" makes the app
    // look broken to exactly the readers who chose to see both.
    expect(secondary({ hi: "Class 6 A", en: "Class 6 A" }, "both")).toBeNull();
    expect(flat({ hi: "Class 6 A", en: "Class 6 A" }, "both")).toBe("Class 6 A");
  });
});

describe("countOf()", () => {
  /**
   * The bug this exists for: "9 of 45" interpolated around a translated "of"
   * renders in Hindi as "9 में से 45", which reads "out of 9, 45". It shipped
   * backwards on the attendance register and was caught on the collection link,
   * on a page that happened to be rendering for a Hindi reader.
   */
  it("counts up from the part in English", () => {
    expect(countOf(9, 45, "en")).toBe("9 of 45");
  });

  it("counts down from the whole in Hindi", () => {
    expect(countOf(9, 45, "hi")).toBe("45 में से 9");
    expect(countOf(9, 45, "both")).toBe("45 में से 9");
  });

  it("never puts the two numbers in the same order in both languages", () => {
    // The whole point: if these ever matched, one of them would be wrong.
    expect(countOf(9, 45, "en")).not.toBe(countOf(9, 45, "hi"));
  });

  it("is the same pair for a bilingual reader", () => {
    expect(countOfPair(9, 45)).toEqual({ hi: "45 में से 9", en: "9 of 45" });
    expect(flat(countOfPair(9, 45), "both")).toBe("45 में से 9 · 9 of 45");
  });

  it("copes with zero and with equality", () => {
    expect(countOf(0, 0, "en")).toBe("0 of 0");
    expect(countOf(40, 40, "hi")).toBe("40 में से 40");
  });
});

describe("flat()", () => {
  it("joins both halves for a bilingual reader", () => {
    expect(flat(sample, "both")).toBe("नमस्ते · Welcome");
  });

  it.each([
    ["hi", "नमस्ते"],
    ["en", "Welcome"],
  ] as const)("is one language and no separator for %s", (language, expected) => {
    expect(flat(sample, language)).toBe(expected);
  });
});

describe("resolveLanguage()", () => {
  it.each(languages)("passes %s through", (language) => {
    expect(resolveLanguage(language)).toBe(language);
  });

  it.each([
    ["an unknown string", "fr"],
    ["the empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["the wrong case", "HI"],
  ])("falls back to bilingual for %s", (_label, value) => {
    // Unknown means the preference is unknown, and showing both is the reading
    // of "unknown" that cannot hide anything from anybody.
    expect(resolveLanguage(value)).toBe("both");
  });
});

describe("isLanguage()", () => {
  it.each(languages)("accepts %s", (language) => {
    expect(isLanguage(language)).toBe(true);
  });

  it.each([["fr"], [""], [null], [undefined], [3], [{}]])(
    "rejects %s",
    (value) => {
      expect(isLanguage(value)).toBe(false);
    },
  );
});

describe("encodeMessage() / decodeMessage()", () => {
  it("round-trips a pair", () => {
    expect(decodeMessage(encodeMessage(sample))).toEqual(sample);
  });

  it.each([
    ["a separator character", t("एक · दो", "One · Two")],
    ["a quote", t('वह "यह" है', 'That is "it"')],
    ["a backslash", t("a\\b", "c\\d")],
    ["a newline", t("a\nb", "c\nd")],
    ["braces", t("{hi}", "{en}")],
  ])("survives %s", (_label, value) => {
    // JSON rather than a delimiter, because a name or a class label could
    // contain any separator — and a message that splits in the wrong place is
    // worse than one that is not translated at all.
    expect(decodeMessage(encodeMessage(value))).toEqual(value);
  });

  it.each([
    ["plain text", "Something went wrong"],
    ["JSON that is not a pair", '{"foo":1}'],
    ["a JSON array", "[1,2,3]"],
    ["half a pair", '{"hi":"only"}'],
    ["broken JSON", "{not json"],
    ["empty", ""],
  ])("falls back to both halves for %s", (_label, message) => {
    // Zod's own built-ins and database drivers produce untranslated strings.
    // Showing one in both slots beats showing nothing.
    const decoded = decodeMessage(message);
    expect(decoded.hi).toBe(message);
    expect(decoded.en).toBe(message);
  });
});

describe("the message catalogue", () => {
  const entries = Object.entries(m);

  it("is not empty", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it.each(entries)("%s has both halves", (key, value) => {
    expect(value.hi, `${key} has no Hindi`).toBeTruthy();
    expect(value.en, `${key} has no English`).toBeTruthy();
    expect(typeof value.hi).toBe("string");
    expect(typeof value.en).toBe("string");
  });

  it("has no entry whose halves are identical, except proper nouns", () => {
    // A pair whose halves match is usually a translation somebody skipped.
    // "VPPS One" is the same in both because it is a name.
    const properNouns = new Set(["appName"]);
    const identical = entries
      .filter(([key, value]) => !properNouns.has(key) && value.hi === value.en)
      .map(([key]) => key);

    expect(identical).toEqual([]);
  });

  it("has no Devanagari in an English half", () => {
    const devanagari = /[ऀ-ॿ]/;
    const wrong = entries
      .filter(([, value]) => devanagari.test(value.en))
      .map(([key]) => key);

    expect(wrong).toEqual([]);
  });

  it("has no bare Latin-only Hindi half", () => {
    // Every Hindi half should actually contain Devanagari — otherwise it is
    // the English string copied across, which renders as English for a reader
    // who asked for Hindi.
    const devanagari = /[ऀ-ॿ]/;
    const properNouns = new Set(["appName"]);
    const wrong = entries
      .filter(([key, value]) => !properNouns.has(key) && !devanagari.test(value.hi))
      .map(([key]) => key);

    expect(wrong).toEqual([]);
  });
});
