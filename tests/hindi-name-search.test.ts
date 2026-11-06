import { describe, expect, it } from "vitest";

import { devanagariToLatin, hasDevanagari, matchesHindiName } from "@/modules/students/domain/hindi-name-search";

describe("finding a child by a name typed in Hindi (A-10)", () => {
  it("knows a Hindi query when it sees one", () => {
    expect(hasDevanagari("आरव")).toBe(true);
    expect(hasDevanagari("Aarav")).toBe(false);
    expect(hasDevanagari("12")).toBe(false);
  });

  it("transliterates the way the office spells", () => {
    expect(devanagariToLatin("आरव")).toBe("aarava");
    expect(devanagariToLatin("प्रिया")).toBe("priyaa");
    expect(devanagariToLatin("ज़ोया")).toBe("zoyaa");
  });

  it.each([
    ["आरव", "Aarav Sharma"],
    ["आरव", "Arav Kumar"],
    ["ईशान", "Ishan Meena"],
    ["इशान", "Ishaan Jain"],
    ["प्रियांशु", "Priyanshu Gurjar"],
    ["कैलाश", "Kelash Chand"],
    ["राम", "Ram Lal"],
    ["लक्ष्मी", "Laxmi Devi"],
    ["आदित्य", "Aditya Singh"],
    ["ज़ोया", "Zoya Khan"],
    ["शर्मा", "Aarav Sharma"],
    ["आरव शर्मा", "Aarav Sharma"],
    ["आरव", "aarav"],
  ])("%s finds %s", (query, name) => {
    expect(matchesHindiName(query, [name])).toBe(true);
  });

  it.each([
    ["आरव", "Sarvesh Kumar"],
    ["आरव", "Ishan Meena"],
    ["आरव शर्मा", "Aarav Meena"],
    ["", "Aarav"],
  ])("%s does not find %s", (query, name) => {
    expect(matchesHindiName(query, [name])).toBe(false);
  });

  it("matches the father's name too, and skips a missing one", () => {
    expect(matchesHindiName("सुरेश", ["Aarav Sharma", "Suresh Sharma"])).toBe(true);
    expect(matchesHindiName("सुरेश", ["Aarav Sharma", null])).toBe(false);
  });
});
