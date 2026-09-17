import { describe, expect, it } from "vitest";

import {
  authoredIn,
  isAuthoredEmpty,
  optionalHalf,
  readAuthored,
  requiredHalf,
} from "@/platform/i18n/authored";
import { authoredPlain, authoredTitle } from "@/ui/authored-text";
import { languages, t } from "@/platform/i18n/language";
import { requestInputSchema } from "@/modules/collection/domain/requests";

/**
 * Text somebody typed, as opposed to text this app ships.
 *
 * The thing under test is the fallback rule. Four screens rendered a request's
 * title as `language === "en" ? titleEn : titleHi`, which is a blank title the
 * moment only one half exists — and requiring both halves, which is what kept
 * that safe, is the thing PLAN §3a asks to stop doing (B-05, B-14).
 */

const HINDI_ONLY = { hi: "फ़ोन नंबर", en: null };
const ENGLISH_ONLY = { hi: null, en: "Phone numbers" };
const BOTH = { hi: "फ़ोन नंबर", en: "Phone numbers" };
const NEITHER = { hi: null, en: null };

describe("which language a value was written in", () => {
  it.each([
    [HINDI_ONLY, "hi"],
    [ENGLISH_ONLY, "en"],
    [BOTH, "both"],
  ] as const)("%o was written in %s", (value, expected) => {
    expect(authoredIn(value)).toBe(expected);
  });

  it("treats whitespace as nothing", () => {
    expect(authoredIn({ hi: "   ", en: null })).toBeNull();
    expect(isAuthoredEmpty({ hi: "", en: "  " })).toBe(true);
    expect(isAuthoredEmpty(NEITHER)).toBe(true);
    expect(isAuthoredEmpty(HINDI_ONLY)).toBe(false);
  });
});

describe("what a reader sees", () => {
  it("gives a reader their own language when it exists", () => {
    expect(readAuthored(BOTH, "hi")).toEqual({
      text: "फ़ोन नंबर",
      language: "hi",
      fellBack: false,
    });
    expect(readAuthored(BOTH, "en")).toEqual({
      text: "Phone numbers",
      language: "en",
      fellBack: false,
    });
  });

  it("falls back rather than rendering nothing, and says that it did", () => {
    // The bug, as a test: a Hindi reader used to get an empty title here.
    const read = readAuthored(ENGLISH_ONLY, "hi");

    expect(read?.text).toBe("Phone numbers");
    expect(read?.language).toBe("en");
    expect(read?.fellBack).toBe(true);
  });

  it("falls back the other way too", () => {
    const read = readAuthored(HINDI_ONLY, "en");

    expect(read?.text).toBe("फ़ोन नंबर");
    expect(read?.fellBack).toBe(true);
  });

  it("never returns an empty string for a value that has one half", () => {
    for (const language of languages) {
      for (const value of [HINDI_ONLY, ENGLISH_ONLY, BOTH]) {
        expect(readAuthored(value, language)?.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns null when nothing was typed, rather than an empty string", () => {
    for (const language of languages) {
      expect(readAuthored(NEITHER, language)).toBeNull();
    }
  });

  describe("a bilingual reader", () => {
    it("gets both halves when both exist", () => {
      expect(readAuthored(BOTH, "both")?.text).toBe("फ़ोन नंबर · Phone numbers");
    });

    it("gets the one that exists, not a dangling separator", () => {
      expect(readAuthored(HINDI_ONLY, "both")?.text).toBe("फ़ोन नंबर");
      expect(readAuthored(ENGLISH_ONLY, "both")?.text).toBe("Phone numbers");
    });

    it("is not told it fell back, because nothing was missing from its view", () => {
      expect(readAuthored(HINDI_ONLY, "both")?.fellBack).toBe(false);
    });
  });
});

describe("which half a form asks for", () => {
  it("asks an English reader for English and a Hindi reader for Hindi", () => {
    expect(requiredHalf("en")).toBe("en");
    expect(requiredHalf("hi")).toBe("hi");
  });

  it("asks a bilingual account for one, not two", () => {
    // "both" describes how they read, not a promise to type twice.
    expect(requiredHalf("both")).toBe("hi");
    expect(optionalHalf("both")).toBe("en");
  });

  it.each(languages)("%s is offered the half it is not asked for", (language) => {
    expect(optionalHalf(language)).not.toBe(requiredHalf(language));
  });
});

describe("as a page title", () => {
  const fallback = t("निवेदन", "Request");

  it("fills both halves so primary() can never be blank", () => {
    expect(authoredTitle(ENGLISH_ONLY, fallback)).toEqual({
      hi: "Phone numbers",
      en: "Phone numbers",
    });
  });

  it("keeps two halves when there are two", () => {
    expect(authoredTitle(BOTH, fallback)).toEqual(BOTH);
  });

  it("uses the caller's fallback when nothing was typed", () => {
    expect(authoredTitle(NEITHER, fallback)).toEqual(fallback);
  });
});

describe("as a message body", () => {
  it("is the sender's own language, and never starts with a dangling dash", () => {
    expect(authoredPlain(HINDI_ONLY, "hi")).toBe("फ़ोन नंबर");
    expect(authoredPlain(HINDI_ONLY, "en")).toBe("फ़ोन नंबर");
    expect(authoredPlain(NEITHER, "en")).toBe("");
  });
});

describe("the request schema asks for one title", () => {
  const valid = {
    titleHi: "फ़ोन नंबर",
    titleEn: "",
    classId: "11111111-2222-4333-8444-555555555555",
    assignedStaffId: "",
    fieldIds: ["22222222-3333-4444-8555-666666666666"],
    dueDate: "",
    reasonHi: "",
    reasonEn: "",
  };

  it("accepts a Hindi-only title", () => {
    const parsed = requestInputSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.titleHi).toBe("फ़ोन नंबर");
      // The blank half becomes null, not "". One representation of "nothing
      // was typed" is what lets the fallback be a rule rather than a guess.
      expect(parsed.data.titleEn).toBeNull();
    }
  });

  it("accepts an English-only title", () => {
    const parsed = requestInputSchema.safeParse({
      ...valid,
      titleHi: "",
      titleEn: "Phone numbers",
    });

    expect(parsed.success).toBe(true);
  });

  it("still refuses a request with no title at all", () => {
    const parsed = requestInputSchema.safeParse({ ...valid, titleHi: "", titleEn: "" });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      // Reported against a field the form renders. An error attached to
      // nothing is an error nobody sees.
      expect(parsed.error.issues[0]?.path).toEqual(["titleHi"]);
    }
  });

  it("refuses whitespace as a title", () => {
    expect(
      requestInputSchema.safeParse({ ...valid, titleHi: "   ", titleEn: "" }).success,
    ).toBe(false);
  });
});
