import { describe, expect, it } from "vitest";

import { decodeMessage } from "@/platform/i18n/language";

import {
  canDeactivate,
  checkboxValue,
  compareStaff,
  createStaffSchema,
  matchesStaffSearch,
  normalizePhone,
  normalizeShortName,
  SHORT_NAME_PATTERN,
  updateStaffSchema,
  type StaffProfile,
} from "@/modules/staff/domain/staff";

function profile(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: null,
    displayName: "Test Teacher",
    shortName: "TT",
    role: "teacher",
    phone: null,
    whatsappPhone: null,
    isTeaching: true,
    isActive: true,
    language: "hi",
    createdAt: "2026-09-16T00:00:00Z",
    ...overrides,
  };
}

describe("normalizeShortName()", () => {
  it.each([
    ["rks", "RKS"],
    ["  rks  ", "RKS"],
    ["RkS", "RKS"],
    ["A1", "A1"],
  ])("folds %s to %s", (input, expected) => {
    // Accepting the lowercase form and folding it is one fewer error message
    // for the same guarantee — the unique index is case-insensitive anyway.
    expect(normalizeShortName(input)).toBe(expected);
  });
});

describe("the short name shape", () => {
  it.each(["RKS", "TT", "A1", "ABCDEFGH", "12"])("accepts %s", (value) => {
    expect(SHORT_NAME_PATTERN.test(value)).toBe(true);
  });

  it.each([
    ["one character", "R"],
    ["nine characters", "ABCDEFGHI"],
    ["a space", "R K"],
    ["a dot", "R.K"],
    ["lowercase", "rks"],
    ["Devanagari", "रा"],
    ["empty", ""],
  ])("rejects %s", (_label, value) => {
    expect(SHORT_NAME_PATTERN.test(value)).toBe(false);
  });
});

describe("normalizePhone()", () => {
  it.each([
    ["plain", "9876543210"],
    ["spaced", "98765 43210"],
    ["dashed", "98765-43210"],
    ["with +91", "+91 98765 43210"],
    ["with 91", "919876543210"],
    ["with a leading zero", "09876543210"],
    ["with brackets", "(98765) 43210"],
  ])("reads %s as the ten digits", (_label, input) => {
    expect(normalizePhone(input)).toBe("9876543210");
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["too short", "98765"],
    ["letters only", "abcd"],
  ])("returns null for %s", (_label, input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it.each([
    ["starting 5", "5876543210"],
    ["starting 1", "1234567890"],
    ["starting 0 after trimming", "0123456789"],
  ])("refuses %s rather than guessing", (_label, input) => {
    // Indian mobiles start 6–9. A landline or a typo that merely has ten
    // digits must not be stored as a mobile: a wrong number that looks right
    // is worse than a blank, because Phase 5 will message it.
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("createStaffSchema", () => {
  const valid = {
    displayName: "  Sunita Verma  ",
    shortName: "sv",
    role: "teacher",
    phone: "+91 98765 43210",
    whatsappPhone: "",
    isTeaching: true,
    preferredLanguage: "hi",
  };

  it("trims, folds and normalises in one pass", () => {
    const result = createStaffSchema.parse(valid);
    expect(result.displayName).toBe("Sunita Verma");
    expect(result.shortName).toBe("SV");
    expect(result.phone).toBe("9876543210");
    expect(result.whatsappPhone).toBeNull();
  });

  it("treats a blank phone as absent, not as invalid", () => {
    const result = createStaffSchema.parse({ ...valid, phone: "   " });
    expect(result.phone).toBeNull();
  });

  it("rejects a name of one character", () => {
    const result = createStaffSchema.safeParse({ ...valid, displayName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects a short name with a space in it", () => {
    const result = createStaffSchema.safeParse({ ...valid, shortName: "S V" });
    expect(result.success).toBe(false);
  });

  it("rejects a role that is not a role", () => {
    const result = createStaffSchema.safeParse({ ...valid, role: "headmaster" });
    expect(result.success).toBe(false);
  });

  it("rejects a phone that is not a mobile number", () => {
    const result = createStaffSchema.safeParse({ ...valid, phone: "12345" });
    expect(result.success).toBe(false);
  });

  it("carries both languages so the screen can pick one", () => {
    const result = createStaffSchema.safeParse({ ...valid, shortName: "!" });
    expect(result.success).toBe(false);
    if (!result.success) {
      // A schema is parsed in a server action, long before a component exists,
      // so it cannot know which language the reader asked for. It encodes the
      // pair; the screen decodes and shows the half that reader wants (D-35).
      const decoded = decodeMessage(result.error.issues[0].message);
      expect(decoded.hi).toBeTruthy();
      expect(decoded.en).toBeTruthy();
      expect(decoded.hi).not.toBe(decoded.en);
    }
  });

  it("encodes every message it produces, not just some", () => {
    // A message that was never encoded decodes to itself in both halves, so a
    // reader on English would be shown Hindi. Checking every field's failure
    // is what stops one being missed.
    const broken = {
      displayName: "A",
      shortName: "!",
      role: "teacher",
      phone: "12345",
      whatsappPhone: "nope",
      isTeaching: true,
      preferredLanguage: "hi",
    };

    const result = createStaffSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      for (const issue of result.error.issues) {
        const decoded = decodeMessage(issue.message);
        expect(
          decoded.hi,
          `${String(issue.path[0])} has an unencoded message: ${issue.message}`,
        ).not.toBe(decoded.en);
      }
    }
  });
});

describe("updateStaffSchema", () => {
  it("has no short name field at all", () => {
    // The immutability is a database trigger. Leaving the field out of the
    // schema means the form cannot even offer the edit, which is a clearer
    // promise than one that submits and is rejected.
    expect(Object.keys(updateStaffSchema.shape)).not.toContain("shortName");
  });

  it("still validates everything else", () => {
    const result = updateStaffSchema.safeParse({
      displayName: "Ok Name",
      role: "office",
      phone: "9876543210",
      whatsappPhone: "",
      isTeaching: false,
      preferredLanguage: "en",
    });
    expect(result.success).toBe(true);
  });
});

describe("checkboxValue()", () => {
  it.each([
    ["on", true],
    ["true", true],
    [null, false],
    ["", false],
    ["off", false],
  ])("reads %s as %s", (input, expected) => {
    // An unchecked checkbox is absent from FormData, not present and false.
    expect(checkboxValue(input)).toBe(expected);
  });
});

describe("compareStaff()", () => {
  it("puts active before inactive", () => {
    const active = profile({ isActive: true, displayName: "Zzz" });
    const inactive = profile({ isActive: false, displayName: "Aaa" });
    expect([inactive, active].sort(compareStaff)[0]).toBe(active);
  });

  it("puts teaching staff before non-teaching", () => {
    const teaching = profile({ isTeaching: true, displayName: "Zzz" });
    const office = profile({ isTeaching: false, displayName: "Aaa" });
    expect([office, teaching].sort(compareStaff)[0]).toBe(teaching);
  });

  it("falls back to the name", () => {
    const a = profile({ displayName: "Anita" });
    const b = profile({ displayName: "Bhavna" });
    expect([b, a].sort(compareStaff).map((p) => p.displayName)).toEqual([
      "Anita",
      "Bhavna",
    ]);
  });

  it("sinks inactive staff even when they teach", () => {
    // Inactive profiles are kept because the timetable still names them, not
    // because anybody is looking for them.
    const inactiveTeacher = profile({ isActive: false, isTeaching: true });
    const activeOffice = profile({ isActive: true, isTeaching: false });
    expect([inactiveTeacher, activeOffice].sort(compareStaff)[0]).toBe(
      activeOffice,
    );
  });
});

describe("matchesStaffSearch()", () => {
  const person = profile({
    displayName: "Sunita Verma",
    shortName: "SV",
    phone: "9876543210",
  });

  it.each([
    ["an empty query", ""],
    ["whitespace", "   "],
    ["part of the name", "verma"],
    ["the wrong case", "SUNITA"],
    ["the short name", "sv"],
    ["a run of phone digits", "98765"],
    ["a phone typed with spaces", "987 654"],
  ])("matches on %s", (_label, query) => {
    expect(matchesStaffSearch(person, query)).toBe(true);
  });

  it.each([["an unrelated name", "gupta"], ["a different number", "91111"]])(
    "does not match %s",
    (_label, query) => {
      expect(matchesStaffSearch(person, query)).toBe(false);
    },
  );

  it("needs at least three digits before it searches phones", () => {
    // Otherwise typing "9" lights up most of the staff room.
    expect(matchesStaffSearch(person, "98")).toBe(false);
  });

  it("searches the WhatsApp number too", () => {
    const withWhatsapp = profile({ phone: null, whatsappPhone: "9123456780" });
    expect(matchesStaffSearch(withWhatsapp, "912345")).toBe(true);
  });
});

describe("canDeactivate()", () => {
  const me = "11111111-1111-1111-1111-111111111111";

  it("allows deactivating somebody else", () => {
    expect(canDeactivate(profile({ id: "other" }), me).allowed).toBe(true);
  });

  it("refuses your own account", () => {
    // You would lose the app on the next navigation, and if you were the only
    // admin nobody could undo it.
    const verdict = canDeactivate(profile({ id: me }), me);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toMatch(/your own/i);
  });

  it("refuses somebody already inactive", () => {
    const verdict = canDeactivate(profile({ id: "other", isActive: false }), me);
    expect(verdict.allowed).toBe(false);
  });

  it("gives a reason as a pair whenever it refuses", () => {
    // A pair, not a rendered string: the domain cannot know which language
    // the reader asked for, so it hands back both and the screen chooses.
    for (const target of [profile({ id: me }), profile({ id: "x", isActive: false })]) {
      const verdict = canDeactivate(target, me);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason?.hi).toBeTruthy();
      expect(verdict.reason?.en).toBeTruthy();
    }
  });
});
