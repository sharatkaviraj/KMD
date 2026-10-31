import { afterEach, describe, expect, it, vi } from "vitest";

import {
  describeLadder,
  LADDER_STEPS,
  ladderCampaignDraft,
  ladderCampaignName,
  ladderStepFor,
  WAIVER_WINDOW_DAYS,
} from "@/modules/whatsapp/domain/reminder-ladder";
import {
  campaignsDueOn,
  describeSchedule,
  messageDateFor,
  parseCampaignSchedule,
} from "@/modules/whatsapp/domain/campaign-schedule";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";
import { savedAudienceFrom } from "@/modules/whatsapp/domain/audience";

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
 * The reminder plan around each installment.
 *
 * Every date here is a promise to a parent — "pay by", "waived if paid by" —
 * and a plan that fires on the wrong day, or prints last term's date, is a
 * conversation at the counter the office will lose. Anchored to fixed dates,
 * never the clock.
 */

const CALENDAR = buildInstallmentCalendar({
  schedule: [
    { dueDate: "2026-04-20" },
    { dueDate: "2026-07-20" },
    { dueDate: "2026-10-20" },
    { dueDate: "2027-01-20" },
  ],
  today: "2026-10-26",
});

describe("the plan's steps", () => {
  it("runs in calendar order, before and after the due date", () => {
    const offsets = LADDER_STEPS.map((step) => step.offsetDays);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(offsets[0]).toBeLessThan(0);
    expect(offsets[offsets.length - 1]).toBeGreaterThan(0);
  });

  it("never reaches a hardship or quiet family — those are the office's own call", () => {
    for (const step of LADDER_STEPS) {
      expect(step.profiles).not.toContain("hardship");
      expect(step.profiles).not.toContain("quiet");
    }
  });

  it("asks an on-time family twice at most", () => {
    const onTime = LADDER_STEPS.filter((step) => step.profiles.includes("on_time"));
    expect(onTime.map((step) => step.key)).toEqual(["final_call", "waiver_last_day"]);
  });

  it("gives a chronic family every step", () => {
    expect(LADDER_STEPS.every((step) => step.profiles.includes("chronic"))).toBe(true);
  });

  it("runs the waiver's last day ON the waiver's last day", () => {
    const waiver = ladderStepFor("waiver")!;
    const last = ladderStepFor("waiver_last_day")!;
    expect(waiver.messageDateOffsetDays).toBe(WAIVER_WINDOW_DAYS);
    expect(last.messageDateOffsetDays).toBe(WAIVER_WINDOW_DAYS);
    expect(last.offsetDays).toBeLessThan(last.messageDateOffsetDays);
  });

  it("only sends the waiver notices to families the ledger charges a late fee", () => {
    expect(ladderStepFor("waiver")!.lateFee).toBe("yes");
    expect(ladderStepFor("waiver_last_day")!.lateFee).toBe("yes");
  });
});

describe("ladderCampaignDraft", () => {
  it("is an ordinary saved campaign: one installment, the step's profiles, a schedule", () => {
    const draft = ladderCampaignDraft({
      installment: 4,
      step: ladderStepFor("waiver")!,
      calendar: CALENDAR,
      language: "hi",
      policyLateFeeAmount: 1000,
      auto: false,
    });

    expect(draft.name).toBe("Inst 4 · Late fee, waived if paid");
    expect(draft.situation).toBe("late_fee_waiver");
    expect(draft.filters.installments).toEqual([4]);
    expect(draft.filters.profiles).toEqual(["standard", "chronic"]);
    expect(draft.lastDate).toBe("2027-01-30");
    expect(draft.schedule).toEqual({
      installment: 4,
      offsetDays: 1,
      auto: false,
      messageDateOffsetDays: 10,
      ladderStep: "waiver",
    });
    // And it survives the round trip through the readers the runner uses.
    expect(savedAudienceFrom(draft.filters as unknown as Record<string, unknown>)).toEqual(draft.filters);
    expect(parseCampaignSchedule(draft.schedule)).toEqual(draft.schedule);
  });

  it("never starts sending itself unless asked", () => {
    const draft = ladderCampaignDraft({
      installment: 4,
      step: LADDER_STEPS[0]!,
      calendar: CALENDAR,
      language: "en",
      policyLateFeeAmount: 1000,
      auto: false,
    });
    expect(draft.schedule.auto).toBe(false);
  });

  it("names each step uniquely per installment", () => {
    const names = [1, 2, 3, 4].flatMap((installment) =>
      LADDER_STEPS.map((step) => ladderCampaignName(installment, step)),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("describeLadder", () => {
  const draft = (installment: number, key: string, auto = false) => {
    const built = ladderCampaignDraft({
      installment,
      step: ladderStepFor(key)!,
      calendar: CALENDAR,
      language: "hi",
      policyLateFeeAmount: 1000,
      auto,
    });
    return { id: `${installment}-${key}`, name: built.name, schedule: built.schedule };
  };

  it("marks a step with no campaign as not set up", () => {
    const [, , third] = describeLadder(CALENDAR, [], "2026-10-26");
    expect(third!.setUp).toBe(0);
    expect(third!.steps.every((step) => step.status === "not_set_up")).toBe(true);
  });

  it("reads sent, due, missed and upcoming off the slot dates", () => {
    const ladder = describeLadder(
      CALENDAR,
      [
        { ...draft(3, "due_soon"), ranForSlots: ["2026-10-10"] }, // ran
        { ...draft(3, "final_call"), ranForSlots: [] }, // 17 Oct — 9 days ago, past the window
        { ...draft(3, "waiver"), ranForSlots: [] }, // 21 Oct — 5 days ago
        { ...draft(3, "final_notice", true), ranForSlots: [] }, // 1 Nov — ahead
      ],
      "2026-10-26",
    );
    const third = ladder.find((entry) => entry.installmentNo === 3)!;
    const status = Object.fromEntries(third.steps.map((entry) => [entry.step.key, entry.status]));

    expect(status).toEqual({
      due_soon: "sent",
      final_call: "missed",
      waiver: "due",
      waiver_last_day: "not_set_up",
      final_notice: "upcoming",
      chronic_follow_up: "not_set_up",
    });
    expect(third.steps.find((entry) => entry.step.key === "final_notice")!.campaign?.auto).toBe(true);
    expect(third.setUp).toBe(4);
  });

  it("prints the waiver's own end date on both waiver steps", () => {
    const fourth = describeLadder(CALENDAR, [], "2026-10-26").find((e) => e.installmentNo === 4)!;
    const dates = fourth.steps
      .filter((entry) => entry.step.situation !== "upcoming" && entry.step.situation !== "upcoming_final")
      .map((entry) => [entry.step.key, entry.messageDate]);
    expect(Object.fromEntries(dates)).toMatchObject({
      waiver: "2027-01-30",
      waiver_last_day: "2027-01-30",
    });
  });
});

describe("campaign schedules — every morning, and dates that move", () => {
  it("parses an every-morning schedule and keeps the plan's extras", () => {
    expect(parseCampaignSchedule({ everyDay: true, auto: true, ladderStep: "promise_due" })).toEqual({
      everyDay: true,
      auto: true,
      ladderStep: "promise_due",
    });
    expect(describeSchedule({ everyDay: true })).toBe("Every morning");
  });

  it("parses a campaign saved before the extras to exactly what it always did", () => {
    expect(parseCampaignSchedule({ installment: 3, offsetDays: -10 })).toEqual({
      installment: 3,
      offsetDays: -10,
      auto: false,
    });
  });

  it("refuses a ladder key that is not a plain word", () => {
    expect(parseCampaignSchedule({ installment: 3, ladderStep: "drop table" })).toEqual({
      installment: 3,
      offsetDays: 0,
      auto: false,
    });
  });

  it("is due every morning it has not already run", () => {
    const due = campaignsDueOn(
      [
        { id: "a", name: "Promise due", situation: "promise_due", language: "hi", schedule: { everyDay: true }, ranForSlots: [] },
        { id: "b", name: "Promise due 2", situation: "promise_due", language: "hi", schedule: { everyDay: true }, ranForSlots: ["2026-10-26"] },
      ],
      CALENDAR,
      "2026-10-26",
    );
    expect(due.map((entry) => entry.id)).toEqual(["a"]);
    expect(due[0]!.scheduledFor).toBe("2026-10-26");
  });

  it("moves the printed date with the installment, and keeps the saved date when no offset is set", () => {
    expect(
      messageDateFor({ installment: 4, offsetDays: 1, messageDateOffsetDays: 10 }, CALENDAR, "2027-01-21"),
    ).toBe("2027-01-30");
    expect(messageDateFor({ everyDay: true, messageDateOffsetDays: 3 }, CALENDAR, "2026-10-26")).toBe(
      "2026-10-29",
    );
    expect(messageDateFor({ installment: 4, offsetDays: 1 }, CALENDAR, "2027-01-21")).toBeNull();
  });
});
