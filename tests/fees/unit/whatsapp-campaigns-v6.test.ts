import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activeCampaignName,
  APPROVED_V6,
  describeV6Campaign,
  fillBody,
  studentsLine,
  V6_BUTTON_LABELS,
  V6_CAMPAIGNS,
} from "@/modules/whatsapp/domain/campaign-bodies-v6";
import { campaignFor, type NoticeValues } from "@/modules/whatsapp/domain/campaigns";
import { aisensyTemplateParams, payNowButton } from "@/modules/whatsapp/data/aisensy";

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


const AISENSY = readFileSync(join(process.cwd(), "src/modules/whatsapp/data/aisensy.ts"), "utf8");

/**
 * The `_v6` fee notices, as they will be submitted to Meta.
 *
 * An approved template cannot be edited — changing one means a new name and
 * another review — so what is pinned here is what Meta will be asked to
 * approve, and the slot builders that will fill it.
 */

const child = (overrides: Partial<NoticeValues> = {}): NoticeValues => ({
  parentName: "Ramesh Lal Gurjar",
  studentName: "Aaradhya Gurjar",
  studentClass: "Class 2",
  installmentPhrase: "Installment 3",
  amountDue: 9125,
  receivedSoFar: 6500,
  balanceDue: 11750,
  lastDate: "30-10-2026",
  prevSessionLabel: "2025-26",
  prevYearBalance: 2000,
  lateFeePhrase: "Rs. 1,000 per installment", // @allow-raw-money-format: a slot value, as the builder composes it
  lateFeeApplied: 1000,
  promisedDate: "28-10-2026",
  promiseRecordedDate: "20-10-2026",
  ...overrides,
});

describe("the v6 registry", () => {
  it("covers every notice in both languages, once", () => {
    expect(V6_CAMPAIGNS).toHaveLength(24);
    const names = V6_CAMPAIGNS.map((entry) => entry.campaignName);
    expect(new Set(names).size).toBe(24);
    for (const name of names) expect(name).toMatch(/^vpps_app_[a-z_]+_(hi|en)_v6$/);
  });

  it("is switched on for exactly the 24 Meta approved on 2026-10-26", () => {
    // Pinned by name, so a typo cannot quietly leave one notice on the old set.
    expect([...APPROVED_V6].sort()).toEqual(V6_CAMPAIGNS.map((entry) => entry.campaignName).sort());
    expect(V6_CAMPAIGNS.every((entry) => entry.approved)).toBe(true);
    // VPPS One never hands out `_v6` (go-live plan §6.2): until a `_v7` is
    // approved the notice goes under the earlier text-only generation. The
    // fees app's assertion was that `_v6` is the active name.
    expect(activeCampaignName("fee_due", "hi")).not.toBe("vpps_app_fee_due_hi_v6");
    expect(activeCampaignName("fee_due", "hi")).toBe(campaignFor("fee_due", "hi").campaignName);
  });

  it.each(V6_CAMPAIGNS.map((entry) => [entry.campaignName, entry] as const))(
    "%s follows Meta's and AiSensy's rules",
    (_name, entry) => {
      // Numbered by order of appearance, 1..n, each exactly once.
      const order = [...entry.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      expect(order).toEqual(entry.slotOrder.map((_, index) => index + 1));
      expect(entry.metaSamples).toHaveLength(entry.slotOrder.length);
      // Never starts or ends on a variable.
      expect(entry.body.trimStart().startsWith("{{")).toBe(false);
      expect(entry.body.trimEnd().endsWith("}}")).toBe(false);
      // No bracket beside a brace: AiSensy's editor auto-pairs braces.
      expect(entry.body).not.toMatch(/[([]\{\{|\}\}[)\]]/);
      // Meta's ceiling for a body is 1024 characters, with the samples in.
      expect(fillBody(entry.body, entry.metaSamples).length).toBeLessThanOrEqual(1024);
      // The figure is in the first line, where a notification shows it.
      expect(entry.body.split("\n")[0]).toContain("{{1}}");
      // The title is bold, like every template before it.
      expect(entry.body.split("\n")[0]).toMatch(/^\*.+\*$/);
    },
  );

  it("gives every notice but late fee applied a Pay now button", () => {
    for (const entry of V6_CAMPAIGNS) {
      expect(entry.buttons).toContain("call_office");
      expect(entry.buttons.includes("pay_url")).toBe(entry.situation !== "late_fee_applied");
    }
  });

  it("keeps button labels inside Meta's 25 characters", () => {
    for (const labels of Object.values(V6_BUTTON_LABELS)) {
      for (const label of Object.values(labels)) expect([...label].length).toBeLessThanOrEqual(25);
    }
  });
});

describe("filling a v6 notice", () => {
  const ctx = {
    lateFeeSource: "ledger" as const,
    policyLateFeeAmount: 1000,
    lateFeeAmount: 4000,
    lateFeeBasis: "per_installment" as const,
  };

  it("names one child with their class", () => {
    expect(studentsLine([child()])).toBe("Aaradhya Gurjar · Class 2");
  });

  it("names every child on a phone, and quotes the phone's total", () => {
    const fee = describeV6Campaign("fee_due", "en")!;
    const params = fee.buildFamilyParams(
      [child(), child({ studentName: "Bhavya Gurjar", studentClass: "Class 5", amountDue: 4000 })],
      ctx,
    );
    expect(params).toEqual([
      "13,125",
      "Aaradhya Gurjar · Class 2, Bhavya Gurjar · Class 5",
      "Installment 3",
      "30-10-2026",
      // Ledger mode across two children: what the ledger charges the household.
      "Rs. 2,000", // @allow-raw-money-format: the composed slot value under test
    ]);
  });

  it("keeps the typed lever in custom mode, whatever the ledger says", () => {
    const fee = describeV6Campaign("overdue_final", "en")!;
    const params = fee.buildFamilyParams([child({ lateFeePhrase: "Rs. 4,000 per installment" }), child()], { // @allow-raw-money-format: the typed lever under test
      ...ctx,
      lateFeeSource: "custom",
    });
    expect(params[4]).toBe("Rs. 4,000 per installment"); // @allow-raw-money-format: the typed lever under test
  });

  it("adds fees and late fee for the late-fee-applied headline, and prints both under it", () => {
    const applied = describeV6Campaign("late_fee_applied", "hi")!;
    expect(applied.buildParams(child())).toEqual([
      "10,125",
      "Aaradhya Gurjar · Class 2",
      "Installment 3",
      "9,125",
      "1,000",
    ]);
  });

  it("puts the waive-by date last on both waiver notices", () => {
    for (const situation of ["late_fee_waiver", "waiver_last_call"] as const) {
      const params = describeV6Campaign(situation, "en")!.buildParams(child());
      expect(params).toEqual(["9,125", "Aaradhya Gurjar · Class 2", "Installment 3", "1,000", "30-10-2026"]);
    }
  });

  it("reads a promise back on the promise notices", () => {
    expect(describeV6Campaign("promise_due", "en")!.buildParams(child())[2]).toBe("20-10-2026");
    expect(describeV6Campaign("promise_lapsed", "en")!.buildParams(child())[2]).toBe("28-10-2026");
  });

  it("quotes the balance and what has come in on the balance notice", () => {
    expect(describeV6Campaign("balance", "en")!.buildParams(child()).slice(0, 3)).toEqual([
      "11,750",
      "Aaradhya Gurjar · Class 2",
      "6,500",
    ]);
  });

  it("never sends an empty late-fee phrase", () => {
    const params = describeV6Campaign("fee_due", "hi")!.buildParams(child({ lateFeePhrase: "" }));
    expect(params[4]).toBe("इस राशि पर लागू नहीं");
  });

  it("renders what the parent reads with every slot filled", () => {
    const entry = describeV6Campaign("fee_due", "en")!;
    const text = fillBody(entry.body, entry.metaSamples);
    expect(text.split("\n")[0]).toBe("*Fee due: Rs. 9,125*"); // @allow-raw-money-format: the rendered sample
    expect(text).not.toContain("{{");
  });
});

describe("the Pay now button", () => {
  it("is AiSensy's URL-button parameter carrying the send's pay code", () => {
    expect(payNowButton("abc123")).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "abc123" }],
    });
  });

  it("goes on the wire as the param after the body's, never as a buttons key", () => {
    // AiSensy counts Pay now as {{6}} on a five-slot body. Five params plus a
    // `buttons` entry was refused on 2026-10-26 ("Template params does not
    // match the campaign"); six params and no `buttons` key was delivered.
    const body = ["9,125", "Aarav · Class 2", "Installment 3", "30-10-2026", "Rs. 1,000"];
    expect(aisensyTemplateParams({ templateParams: body, buttons: [payNowButton("abc123")] })).toEqual(
      [...body, "abc123"],
    );
    expect(aisensyTemplateParams({ templateParams: body })).toBe(body);
    expect(aisensyTemplateParams({ templateParams: body, buttons: [] })).toBe(body);

    const wire = AISENSY.slice(AISENSY.indexOf("body: JSON.stringify"));
    expect(wire).not.toMatch(/\bbuttons:/);
  });

  it("is the sixth param on every v6 notice that shows it", () => {
    for (const entry of V6_CAMPAIGNS) {
      if (!entry.buttons.includes("pay_url")) continue;
      expect(entry.body).toContain("{{5}}");
      expect(entry.body).not.toContain("{{6}}");
    }
  });
});
