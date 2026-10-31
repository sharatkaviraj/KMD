import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROFILE_SELECTION,
  effectiveProfile,
  isDefaultProfileSelection,
  parseProfileSelection,
  profileSelectionValue,
  suggestReminderProfile,
} from "@/modules/whatsapp/domain/reminder-profile";
import {
  reminderQuery,
  savedAudienceFrom,
  savedAudienceParams,
  REMINDER_QUERY_KEYS,
} from "@/modules/whatsapp/domain/audience";

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
 * How hard one family is chased.
 *
 * A wrong suggestion is quiet in both directions: a late payer filed as
 * on-time gets one polite note and nothing after, and an on-time payer filed
 * as chronic gets the whole ladder. Both look fine on screen.
 */

const none = { lateFeeInstallments: [], overdueInstallments: [], onRepaymentPlan: false };

describe("suggestReminderProfile", () => {
  it("has nothing to judge by before the first due date", () => {
    expect(suggestReminderProfile({ ...none, passedInstallments: 0 })).toEqual({
      profile: "standard",
      reason: "Nothing due yet to judge by",
    });
  });

  it("calls a clean record on-time", () => {
    expect(suggestReminderProfile({ ...none, passedInstallments: 2 })).toEqual({
      profile: "on_time",
      reason: "Paid all 2 installments so far on time",
    });
  });

  it("counts a waived or paid late fee as late — the waiver forgave the charge, not the lateness", () => {
    expect(
      suggestReminderProfile({ ...none, passedInstallments: 2, lateFeeInstallments: [1] }),
    ).toEqual({ profile: "standard", reason: "Late on installment 1" });
  });

  it("calls two late installments chronic, counting late fees and unpaid fees together", () => {
    expect(
      suggestReminderProfile({
        ...none,
        passedInstallments: 3,
        lateFeeInstallments: [1],
        overdueInstallments: [3],
      }),
    ).toEqual({ profile: "chronic", reason: "Late on installments 1 and 3" });
  });

  it("does not count one installment twice when it is both late-feed and still owed", () => {
    expect(
      suggestReminderProfile({
        ...none,
        passedInstallments: 2,
        lateFeeInstallments: [2],
        overdueInstallments: [2],
      }).profile,
    ).toBe("standard");
  });

  it("puts a family on a plan in hardship whatever their record", () => {
    expect(
      suggestReminderProfile({
        passedInstallments: 3,
        lateFeeInstallments: [1, 2, 3],
        overdueInstallments: [1, 2, 3],
        onRepaymentPlan: true,
      }).profile,
    ).toBe("hardship");
  });

  it("never suggests quiet — that is a decision about a family, not their money", () => {
    const cases = [0, 1, 2, 3].map((passed) =>
      suggestReminderProfile({ ...none, passedInstallments: passed }).profile,
    );
    expect(cases).not.toContain("quiet");
  });
});

describe("effectiveProfile", () => {
  const suggestion = { profile: "chronic" as const, reason: "Late on installments 1 and 2" };

  it("follows the ledger when the office has not chosen", () => {
    expect(effectiveProfile(null, suggestion)).toEqual({
      profile: "chronic",
      source: "suggested",
      reason: "Late on installments 1 and 2",
    });
  });

  it("keeps the office's choice and says what the ledger would have picked", () => {
    expect(effectiveProfile("standard", suggestion)).toEqual({
      profile: "standard",
      source: "set",
      reason: "Set by the office (the ledger suggests Chronic)",
    });
  });
});

describe("the profiles query value", () => {
  it("opens on the default for absent, blank or garbage values", () => {
    expect(parseProfileSelection(null)).toBeNull();
    expect(parseProfileSelection("")).toBeNull();
    expect(parseProfileSelection("banana,0")).toBeNull();
  });

  it("keeps screen order and drops duplicates", () => {
    expect(parseProfileSelection("quiet,chronic,quiet")).toEqual(["chronic", "quiet"]);
    expect(parseProfileSelection(["hardship", "on_time"])).toEqual(["on_time", "hardship"]);
  });

  it("round-trips through its own serialiser", () => {
    const value = profileSelectionValue(["quiet", "on_time"]);
    expect(value).toBe("on_time,quiet");
    expect(parseProfileSelection(value)).toEqual(["on_time", "quiet"]);
  });

  it("leaves hardship and quiet out of the default", () => {
    expect(DEFAULT_PROFILE_SELECTION).toEqual(["on_time", "standard", "chronic"]);
    expect(isDefaultProfileSelection(["chronic", "on_time", "standard"])).toBe(true);
    expect(isDefaultProfileSelection(["chronic"])).toBe(false);
  });

  it("travels in the one key list, so no form can drop it", () => {
    expect(REMINDER_QUERY_KEYS).toContain("profiles");
  });
});

describe("a saved campaign remembers its profiles", () => {
  it("replays a campaign saved before profiles existed on the default", () => {
    expect(savedAudienceFrom({}).profiles).toEqual(["on_time", "standard", "chronic"]);
  });

  it("stores and replays a ladder step's profiles", () => {
    const saved = savedAudienceFrom({ installments: [4], profiles: ["standard", "chronic"] });
    expect(saved.profiles).toEqual(["standard", "chronic"]);
    expect(savedAudienceParams(saved).profiles).toBe("standard,chronic");
  });

  it("emits the profiles on every query string", () => {
    const query = reminderQuery({
      ...savedAudienceFrom({ installments: [1] }),
      includeStudentIds: [],
      excludeStudentIds: [],
      situation: "fee_due",
      language: "hi",
      lastDate: "",
      lateFeeAmount: 1000,
      lateFeeBasis: "per_installment",
      lateFeeSource: "custom",
      preDueWindowDays: 10,
    });
    expect(query.get("profiles")).toBe("on_time,standard,chronic");
  });
});
