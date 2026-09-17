import { describe, expect, it } from "vitest";

import { emptyAudience, type Audience } from "@/modules/collection/domain/audience";
import {
  audienceFromParams,
  audienceToParams,
  hasReason,
  needsReason,
  roundHref,
  roundInputSchema,
  roundStatusLabel,
} from "@/modules/collection/domain/rounds";

/**
 * A round, as a form and as a URL.
 *
 * The URL is the state, so a hand-edited or stale one is an input like any
 * other — and every test about it is the same test: **it may narrow, never
 * widen.** A parameter left behind by an earlier click that quietly turned
 * "Class 6" back into the whole school would be a send nobody chose.
 */

const audience = (over: Partial<Audience>): Audience => ({
  ...emptyAudience,
  ...over,
});

describe("reading the audience out of the URL", () => {
  it("reads nothing as nobody", () => {
    expect(audienceFromParams({})).toEqual(emptyAudience);
  });

  it("reads one class and many", () => {
    expect(audienceFromParams({ class: "c6" }).classIds).toEqual(["c6"]);
    expect(audienceFromParams({ class: ["c6", "c7"] }).classIds).toEqual(["c6", "c7"]);
  });

  it("reads a comma-separated list, because people edit URLs", () => {
    expect(audienceFromParams({ class: "c6,c7" }).classIds).toEqual(["c6", "c7"]);
  });

  it("drops blanks and duplicates rather than resolving them", () => {
    expect(audienceFromParams({ class: "c6,,c6, " }).classIds).toEqual(["c6"]);
  });

  it("reads the other dimensions", () => {
    const parsed = audienceFromParams({
      house: "Chetak",
      route: ["r1", "r2"],
      gap: "guardian_phone",
      q: "Sharma",
    });

    expect(parsed.houses).toEqual(["Chetak"]);
    expect(parsed.routeIds).toEqual(["r1", "r2"]);
    expect(parsed.gaps).toEqual([{ fieldKey: "guardian_phone" }]);
    expect(parsed.search).toBe("Sharma");
  });

  it("reads `all=1` as the deliberate everybody", () => {
    expect(audienceFromParams({ all: "1" }).allEnrolled).toBe(true);
    expect(audienceFromParams({ all: "0" }).allEnrolled).toBe(false);
    expect(audienceFromParams({ all: "yes" }).allEnrolled).toBe(false);
  });

  it("lets a ticked class beat a leftover `all=1`", () => {
    // **The widening case.** A parameter left behind by an earlier click must
    // not turn "Class 6" back into the whole school without anybody choosing
    // it. Narrowing is always the safe reading.
    const parsed = audienceFromParams({ all: "1", class: "c6" });

    expect(parsed.allEnrolled).toBe(false);
    expect(parsed.classIds).toEqual(["c6"]);
  });

  it("never reads an explicit student list from the URL", () => {
    // A frozen list is the whole audience, so accepting one from a query
    // string would be letting a hand-typed URL name exactly who gets asked.
    // It arrives from an upload, through a POST, matched against the roll.
    expect(audienceFromParams({ student: ["s1", "s2"] }).studentIds).toEqual([]);
  });
});

describe("writing the audience back into a URL", () => {
  const roundTrip = (input: Audience) =>
    audienceFromParams(Object.fromEntries(audienceToParams(input)));

  it("survives a round trip", () => {
    const original = audience({
      classIds: ["c6"],
      houses: ["Chetak"],
      gaps: [{ fieldKey: "guardian_phone" }],
      search: "Sharma",
    });

    expect(roundTrip(original)).toEqual(original);
  });

  it("leaves out what is not set, so the URL says what is actually filtered", () => {
    expect(audienceToParams(emptyAudience).toString()).toBe("");
    expect(roundHref(emptyAudience)).toBe("/collection/rounds/new");
  });

  it("writes `all=1` only while no class narrows it", () => {
    expect(audienceToParams(audience({ allEnrolled: true })).get("all")).toBe("1");
    expect(
      audienceToParams(audience({ allEnrolled: true, classIds: ["c6"] })).get("all"),
    ).toBeNull();
  });

  it("builds a href a person could read", () => {
    expect(roundHref(audience({ classIds: ["c6"] }))).toBe(
      "/collection/rounds/new?class=c6",
    );
  });
});

describe("whether the round has to say why", () => {
  it("does not for a whole class", () => {
    // A whole class explains itself. Demanding a sentence for it is asking the
    // office to write "because they are Class 6".
    expect(needsReason(audience({ classIds: ["c6", "c7"] }))).toBe(false);
  });

  it("does not for everybody", () => {
    expect(needsReason(audience({ allEnrolled: true }))).toBe(false);
  });

  it("does for a gap filter", () => {
    // Nine of forty-six, with nothing to say why, reads to a teacher as a
    // broken list — and the conscientious ones ring the office to check.
    expect(needsReason(audience({ classIds: ["c6"], gaps: [{ fieldKey: "p" }] }))).toBe(
      true,
    );
    expect(needsReason(audience({ allEnrolled: true, gaps: [{ fieldKey: "p" }] }))).toBe(
      true,
    );
  });

  it("does for a house, a route, a search and an uploaded list", () => {
    expect(needsReason(audience({ houses: ["Chetak"] }))).toBe(true);
    expect(needsReason(audience({ routeIds: ["r1"] }))).toBe(true);
    expect(needsReason(audience({ allEnrolled: true, search: "Sharma" }))).toBe(true);
    expect(needsReason(audience({ studentIds: ["s1"] }))).toBe(true);
  });

  it("does not ask for a reason for a round that selects nobody", () => {
    // There is nothing to explain yet, and an error about a missing reason on
    // an empty form is an error about the wrong thing.
    expect(needsReason(emptyAudience)).toBe(false);
  });

  it("counts a reason in either language as given", () => {
    expect(hasReason({ reasonHi: null, reasonEn: null })).toBe(false);
    expect(hasReason({ reasonHi: "  ", reasonEn: "" })).toBe(false);
    expect(hasReason({ reasonHi: "कारण", reasonEn: null })).toBe(true);
    expect(hasReason({ reasonHi: null, reasonEn: "because" })).toBe(true);
  });
});

describe("the round form", () => {
  const valid = {
    titleHi: "फ़ोन नंबर",
    titleEn: "",
    fieldIds: ["11111111-2222-4333-8444-555555555555"],
    dueDate: "2026-09-30",
    reasonHi: "",
    reasonEn: "",
  };

  it("accepts one title half, like a request's (B-05)", () => {
    expect(roundInputSchema.safeParse(valid).success).toBe(true);
    expect(
      roundInputSchema.safeParse({ ...valid, titleHi: "", titleEn: "Phone numbers" })
        .success,
    ).toBe(true);
  });

  it("refuses a round with no title at all", () => {
    const parsed = roundInputSchema.safeParse({ ...valid, titleHi: "", titleEn: "" });

    expect(parsed.success).toBe(false);
    // Reported against a field the form actually renders — an error attached
    // to nothing is an error nobody sees (D-129).
    expect(parsed.error?.issues[0]?.path).toEqual(["titleHi"]);
  });

  it("refuses a round that asks for nothing", () => {
    expect(roundInputSchema.safeParse({ ...valid, fieldIds: [] }).success).toBe(false);
  });

  it("treats a blank due date as no due date", () => {
    const parsed = roundInputSchema.safeParse({ ...valid, dueDate: "" });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.dueDate).toBeNull();
  });

  it("refuses a due date that is not a date", () => {
    expect(roundInputSchema.safeParse({ ...valid, dueDate: "30/09/2026" }).success).toBe(
      false,
    );
  });

  it("turns blank authored halves into null rather than empty strings", () => {
    const parsed = roundInputSchema.safeParse(valid);

    expect(parsed.data?.titleEn).toBeNull();
    expect(parsed.data?.reasonHi).toBeNull();
  });
});

describe("how a round's status reads", () => {
  it("names the ones it knows in both languages", () => {
    for (const status of ["draft", "open", "closed"]) {
      const label = roundStatusLabel(status);
      expect(label.hi).not.toBe("");
      expect(label.en).not.toBe("");
      expect(label.hi).not.toBe(label.en);
    }
  });

  it("reads a status it has never heard of as itself", () => {
    expect(roundStatusLabel("archived")).toEqual({ hi: "archived", en: "archived" });
  });
});
