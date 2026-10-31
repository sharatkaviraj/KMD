import { afterEach, describe, expect, it, vi } from "vitest";

import { describeFamilyCampaign } from "@/modules/whatsapp/domain/campaign-bodies-v3";
import type { NoticeSituation } from "@/modules/whatsapp/domain/campaigns";
import {
  campaignNamesForNotice,
  chooseFamilyCampaign,
  FAMILY_TEMPLATE_SITUATIONS,
  familyNoticeValuesFor,
} from "@/modules/whatsapp/domain/family-notice";
import { groupIntoFamilies, type FamilyMemberInput } from "@/modules/whatsapp/domain/family-grouping";

// The fees app mocks these once in tests/setup.ts; One has no shared setup
// file, so each ported test carries the same three (go-live Phase D).
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache:
    <T extends (...args: unknown[]) => unknown>(callback: T) =>
    callback,
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});


/**
 * Which message a phone gets: the one naming all its children, or the one
 * naming one. Every branch here decides what a real parent reads about a real
 * debt, so all of them are pinned.
 */

function member(overrides: Partial<FamilyMemberInput> = {}): FamilyMemberInput {
  return {
    studentId: "s1",
    studentName: "Aaradhya Gurjar",
    studentClass: "Class 2",
    parentName: "Ramesh Lal Gurjar",
    destination: "+919876543210",
    dueAmount: 9125,
    preferredLanguage: null,
    sentCount: 0,
    secondaryDestination: null,
    ...overrides,
  };
}

const twoChildren = (language: "hi" | "en" = "hi") =>
  groupIntoFamilies(
    [
      member({ studentId: "a", dueAmount: 13250 }),
      member({ studentId: "b", studentName: "Bhavya Gurjar", studentClass: "Class 5", dueAmount: 9125 }),
    ],
    language,
  )[0]!;

const oneChild = () => groupIntoFamilies([member()], "hi")[0]!;

describe("chooseFamilyCampaign", () => {
  it.each(FAMILY_TEMPLATE_SITUATIONS)("gives a two-child phone the family template on %s", (situation) => {
    for (const language of ["hi", "en"] as const) {
      const chosen = chooseFamilyCampaign(twoChildren(language), situation);
      expect(chosen?.campaignName).toBe(`vpps_app_family_${situation}_${language}_v3`);
      expect(chosen?.approved).toBe(true);
    }
  });

  it("follows the family's language, not the run's", () => {
    // An English-speaking family inside a Hindi run reads English.
    const family = groupIntoFamilies(
      [member({ studentId: "a", preferredLanguage: "en" }), member({ studentId: "b" })],
      "hi",
    )[0]!;
    expect(chooseFamilyCampaign(family, "fee_due")?.campaignName).toBe(
      "vpps_app_family_fee_due_en_v3",
    );
  });

  it("gives a one-child phone the per-child notice", () => {
    // "Students: Aaradhya (2) · Total: Rs. 9,125" is the per-child notice with
    // worse wording.
    expect(chooseFamilyCampaign(oneChild(), "fee_due")).toBeNull();
  });

  it.each(["late_fee_applied", "upcoming_final", "promise_lapsed", "prevyear"] as const)(
    "keeps the per-child notice on %s, family template or not",
    (situation) => {
      expect(chooseFamilyCampaign(twoChildren(), situation)).toBeNull();
    },
  );

  it("names exactly the situations whose family template a run can fill", () => {
    // `late_fee_applied` has a family template and is deliberately absent — its
    // date, total and late-fee slots have no clean source in a run yet. The
    // file comment says why; this pins that it stays a decision, not an
    // accident.
    expect([...FAMILY_TEMPLATE_SITUATIONS]).toEqual(["fee_due", "balance", "upcoming"]);
    expect(describeFamilyCampaign("late_fee_applied", "hi")).not.toBeNull();
  });
});

describe("familyNoticeValuesFor", () => {
  it("fills the five slots from the family and the run, in the family's language", () => {
    const family = twoChildren("en");
    const campaign = chooseFamilyCampaign(family, "fee_due")!;
    const values = familyNoticeValuesFor(family, {
      lastDate: "20-10-2026",
      lateFeeAmount: 1000,
      lateFeeBasis: "per_installment",
    });

    expect(campaign.buildParams(values)).toEqual([
      "Ramesh Lal Gurjar",
      "Aaradhya Gurjar (2), Bhavya Gurjar (5)",
      "22,375",
      "20-10-2026",
      "Rs. 1,000 per installment",
    ]);
  });

  it("composes the late-fee line in Hindi for a Hindi family", () => {
    const values = familyNoticeValuesFor(twoChildren("hi"), {
      lastDate: "20-10-2026",
      lateFeeAmount: 1000,
      lateFeeBasis: "per_installment",
    });
    expect(values.lateFeePhrase).toBe("रु. 1,000 प्रति किश्त");
  });
});

describe("campaignNamesForNotice", () => {
  it("returns every name a family may have been messaged under, v6 included", () => {
    // The day v6 went Live, a family messaged that morning under v2 or the
    // family template must still read as contacted.
    expect(campaignNamesForNotice("fee_due", "hi")).toEqual([
      "vpps_app_fee_due_hi_v2",
      "vpps_app_family_fee_due_hi_v3",
      "vpps_app_fee_due_hi_v6",
    ]);
  });

  it.each(["late_fee_applied", "prevyear", "promise_lapsed", "upcoming_final"] as NoticeSituation[])(
    "returns the per-child name and the v6 name for %s",
    (situation) => {
      const names = campaignNamesForNotice(situation, "en");
      expect(names).toHaveLength(2);
      expect(names[1]).toBe(`vpps_app_${situation}_en_v6`);
    },
  );
});
