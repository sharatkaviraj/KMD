import { describe, expect, it } from "vitest";

import { costUsd, dayStartIst, dollars, monthStartIst } from "@/modules/assist/domain/cost";
import { assistFeatures, decisionFor, FEATURE_PERMISSIONS, featureTier, isAssistFeature } from "@/modules/assist/domain/features";
import { hasStrayToken, maskPersonal, restoreDeep } from "@/modules/assist/domain/redact";
import { ASSIST_TASKS, isAssistTaskId } from "@/modules/assist/domain/tasks";
import { looksLikeQuestion, translateTarget } from "@/modules/assist/domain/text";
import { staffPermissions } from "@/platform/auth/permissions";

/* Test data only (rule 6): every name and number below is invented. */

describe("what leaves the school", () => {
  it("masks phone numbers, Aadhaar-like numbers and emails, and puts them back", () => {
    const text = "Call 98765 43210 or +91-9123456789, ID 1234 5678 9012, mail qa.parent@example.test";
    const masked = maskPersonal(text);
    expect(masked.text).not.toMatch(/\d{5}/);
    expect(masked.text).not.toContain("example.test");
    expect(masked.restore(masked.text)).toBe(text);
  });

  it("masks every known name, whole and in parts, in Latin and Devanagari", () => {
    const masked = maskPersonal("Qatest Kumar was quiet. Qatest smiled later. क्यूटेस्ट ने काम किया।", ["Qatest Kumar", "क्यूटेस्ट"]);
    expect(masked.text).not.toContain("Qatest");
    expect(masked.text).not.toContain("Kumar");
    expect(masked.text).not.toContain("क्यूटेस्ट");
    expect(masked.restore(masked.text)).toBe("Qatest Kumar was quiet. Qatest smiled later. क्यूटेस्ट ने काम किया।");
  });

  it("never masks part of a longer word", () => {
    const masked = maskPersonal("Ramesh met Ram.", ["Ram"]);
    expect(masked.text.startsWith("Ramesh")).toBe(true);
    expect(masked.text).toContain("[[N1]]");
  });

  it("restores inside nested answers and spots an invented placeholder", () => {
    const masked = maskPersonal("[[N1]]", []);
    expect(masked.text).toBe("[[N1]]");
    const { restore } = maskPersonal("Qaname", ["Qaname"]);
    expect(restoreDeep({ a: ["[[N1]] did well"], n: 3 }, restore)).toEqual({ a: ["Qaname did well"], n: 3 });
    expect(hasStrayToken("Hello [[N7]]")).toBe(true);
    expect(hasStrayToken("Hello {parent}")).toBe(false);
  });
});

describe("cost", () => {
  it("prices Haiku 5.5 and Sonnet 5.5 per million tokens", () => {
    expect(costUsd("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 1_000_000 })).toBeCloseTo(0.505, 6);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 1500, output_tokens: 300 })).toBeCloseTo(0.0003, 6);
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 3000, output_tokens: 2000 })).toBeCloseTo(0.026, 6);
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2, 6);
    expect(costUsd("an-unknown-model", { input_tokens: 10, output_tokens: 10 })).toBe(0);
  });

  it("uses Haiku's long-prompt card above 100K prompt tokens", () => {
    expect(costUsd("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1, 6);
  });

  it("formats small amounts for the admin", () => {
    expect(dollars(0)).toBe("$0.00");
    expect(dollars(0.004)).toBe("<$0.01");
    expect(dollars(12.4)).toBe("$12.40");
  });

  it("resets the budget and the daily cap on the IST calendar", () => {
    // 31 Oct 20:00 UTC is 1 Nov 01:30 in India.
    const now = new Date("2026-10-31T20:00:00Z");
    expect(monthStartIst(now).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(dayStartIst(now).toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(monthStartIst(new Date("2026-10-15T06:00:00Z")).toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });
});

describe("features", () => {
  it("only ever asks for permissions the app has", () => {
    for (const feature of assistFeatures) {
      for (const permission of FEATURE_PERMISSIONS[feature]) expect(staffPermissions).toContain(permission);
    }
  });

  it("uses Sonnet only where a parent or the principal reads the result, or a photo is read", () => {
    expect(assistFeatures.filter((f) => featureTier(f) === "careful").sort()).toEqual(["brief", "form", "remarks", "results"]);
  });

  it("every task belongs to a known feature", () => {
    for (const [id, spec] of Object.entries(ASSIST_TASKS)) {
      expect(isAssistTaskId(id)).toBe(true);
      expect(isAssistFeature(spec.feature)).toBe(true);
      expect(spec.effort).toBe("low");
    }
    expect(isAssistTaskId("toString")).toBe(false);
  });

  it("tells kept from edited from discarded", () => {
    expect(decisionFor("Good work.", " Good   work. ")).toBe("kept");
    expect(decisionFor("Good work.", "Very good work.")).toBe("edited");
    expect(decisionFor("Good work.", "  ")).toBe("discarded");
  });
});

describe("tasks clean what comes back", () => {
  it("note tags are limited to the screen's own tags", () => {
    const spec = ASSIST_TASKS["note.polish"];
    const input = spec.input.parse({ text: "finds fractions hard", tags: [{ code: "studies", label: "Studies" }], childName: null });
    expect(spec.finish!({ text: "Finds fractions hard.", tags: ["studies", "made-up", "studies"] }, input)).toEqual({ text: "Finds fractions hard.", tags: ["studies"] });
  });

  it("column matches use only real headings and free fields, once each", () => {
    const spec = ASSIST_TASKS["columns.match"];
    const input = spec.input.parse({
      headers: ["Pita ka naam", "Mob", "Notes"],
      fields: [
        { key: "fatherName", label: "Father name", description: "" },
        { key: "phone", label: "Phone", description: "" },
        { key: "fullName", label: "Name", description: "" },
      ],
      taken: ["fullName"],
    });
    const out = spec.finish!(
      {
        matches: [
          { header: "Pita ka naam", field: "fatherName" },
          { header: "Mob", field: "phone" },
          { header: "Notes", field: "fullName" },
          { header: "Invented", field: "phone" },
          { header: "Mob", field: "fatherName" },
        ],
      },
      input,
    );
    expect(out?.matches).toEqual([
      { header: "Pita ka naam", field: "fatherName" },
      { header: "Mob", field: "phone" },
    ]);
  });

  it("a read form keeps only values in the shapes the wizard accepts", () => {
    const spec = ASSIST_TASKS["form.read"];
    const input = spec.input.parse({ image: { mediaType: "image/jpeg", data: "x".repeat(200) }, classes: ["Class 5", "Class 6"] });
    const out = spec.finish!(
      {
        values: [
          { field: "fullName", value: " Qatest Child ", sure: true },
          { field: "dob", value: "2019-08-21", sure: true },
          { field: "gender", value: "Boy", sure: true },
          { field: "classLabel", value: "Class 9", sure: true },
          { field: "phone", value: "+91 98765-43210", sure: false },
          { field: "fullName", value: "Second copy", sure: true },
        ],
      },
      input,
    );
    expect(out?.values).toEqual([
      { field: "fullName", value: "Qatest Child", sure: true },
      { field: "phone", value: "9876543210", sure: false },
    ]);
  });

  it("remarks are matched back by ref, never by a name, and fit the card", () => {
    const spec = ASSIST_TASKS["remarks.class"];
    expect(spec.input.safeParse({ exam: "Term 1", classLabel: "6 A", children: [{ ref: "Qatest", percent: 50, attendance: 80, strongest: null, weakest: null }] }).success).toBe(false);
    const input = spec.input.parse({ exam: "Term 1", classLabel: "6 A", children: [{ ref: "C1", percent: 50, attendance: 80, strongest: "Maths", weakest: null }] });
    const out = spec.finish!({ remarks: [{ ref: "C1", en: "x".repeat(300), hi: "अ".repeat(300) }, { ref: "C9", en: "stray", hi: "" }] }, input);
    expect(out?.remarks).toHaveLength(1);
    expect(`${out!.remarks[0].en}\n${out!.remarks[0].hi}`.length).toBeLessThanOrEqual(400);
  });

  it("Ask links only pages this person can open", () => {
    const spec = ASSIST_TASKS["ask.answer"];
    const input = spec.input.parse({ question: "how do I add a note?", role: "teacher", language: "en", pages: [{ href: "/teach/notes", label: "Notes" }] });
    expect(spec.finish!({ answer: "Open Notes.", links: ["/teach/notes", "/settings"], search: " " }, input)).toEqual({ answer: "Open Notes.", links: ["/teach/notes"], search: null });
  });

  it("rejects input the screen should never send", () => {
    expect(ASSIST_TASKS["text.translate"].input.safeParse({ text: "", to: "en", names: [] }).success).toBe(false);
    expect(ASSIST_TASKS["cover.plan"].input.safeParse({ classLabel: "6 A", subject: null, minutes: 500, language: "hi" }).success).toBe(false);
    expect(ASSIST_TASKS["form.read"].input.safeParse({ image: { mediaType: "image/gif", data: "x".repeat(200) }, classes: [] }).success).toBe(false);
  });
});

describe("text judgements", () => {
  it("offers English for a Hindi note and Hindi for an English one", () => {
    expect(translateTarget("आज बच्चा चुप था")).toBe("en");
    expect(translateTarget("Quiet in class today")).toBe("hi");
  });

  it("tells a question from a name or a number", () => {
    expect(looksLikeQuestion("how do I mark attendance")).toBe(true);
    expect(looksLikeQuestion("हाज़िरी कैसे लगाएँ")).toBe(true);
    expect(looksLikeQuestion("kaise fees jama kare")).toBe(true);
    expect(looksLikeQuestion("Qatest Kumar")).toBe(false);
    expect(looksLikeQuestion("SVP20261010-0001")).toBe(false);
  });
});
