import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { templateMessageBody } from "@/platform/whatsapp/payload";
import {
  approvedV6Campaign,
  describeV6Campaign,
  hasPayNowButton,
  PAY_URL_PREFIX,
  V6_CAMPAIGNS,
  V7_CAMPAIGNS,
} from "@/modules/whatsapp/domain/campaign-bodies-v6";
import {
  activeCampaignName,
  activeCampaignNameOrNull,
  APPROVED_V7,
  isHubApproved,
  V7_SITUATIONS,
  v7CampaignName,
} from "@/modules/whatsapp/domain/campaign-generation";
import { SITUATION_VALUES, type NoticeSituation } from "@/modules/whatsapp/domain/campaigns";

const NOTICE_SITUATIONS = SITUATION_VALUES as readonly NoticeSituation[];

/**
 * VPPS One's Pay now generation, `_v7` (go-live Phase D, plan §6.2,
 * critique0 #31).
 *
 * Meta fixes a URL button's host at approval, and every `_v6` Pay now opens
 * the fees app. So One submits `_v7`: the same eleven notices with exactly
 * the `_v6` slot layout — five body params, then the Pay now suffix as the
 * sixth `templateParams` entry — and only the host changed. If the count or
 * order a send carries ever disagrees with the submitted template, AiSensy
 * answers 400, so the count is pinned per situation here.
 */

/** What the owner submits: body slots + one URL-button suffix, per situation. */
const V7_TEMPLATE_PARAMS: Record<NoticeSituation, number | null> = {
  upcoming: 6,
  upcoming_final: 6,
  fee_due: 6,
  balance: 6,
  overdue_final: 6,
  late_fee_waiver: 6,
  waiver_last_call: 6,
  promise_due: 6,
  promise_lapsed: 6,
  exam_clearance: 6,
  prevyear: 6,
  // No Pay now, so no `_v7`: it goes under the earlier text-only generation.
  late_fee_applied: null,
};

const SAMPLE = {
  parentName: "Test Parent",
  studentName: "Test Child",
  studentClass: "Class 2",
  amountDue: 9125,
  balanceDue: 11750,
  receivedSoFar: 6500,
  prevYearBalance: 20000,
  prevSessionLabel: "2025-26",
  lateFeeApplied: 1000,
  installmentPhrase: "Installment 3",
  lastDate: "20-10-2026",
  lateFeePhrase: "Rs. 1,000 per installment",
  promisedDate: "28-10-2026",
  promiseRecordedDate: "26-10-2026",
};

describe("the _v7 set", () => {
  it("is the eleven Pay now notices in Hindi and English: 22 templates", () => {
    expect(V7_CAMPAIGNS).toHaveLength(22);
    expect(new Set(V7_CAMPAIGNS.map((entry) => entry.situation))).toEqual(new Set(V7_SITUATIONS));
    expect(V7_SITUATIONS).not.toContain("late_fee_applied");
    for (const situation of NOTICE_SITUATIONS) {
      expect(V7_SITUATIONS.includes(situation)).toBe(V7_TEMPLATE_PARAMS[situation] !== null);
    }
  });

  it.each(V7_CAMPAIGNS.map((entry) => [entry.campaignName, entry] as const))(
    "%s keeps the _v6 layout word for word",
    (_name, entry) => {
      const v6 = describeV6Campaign(entry.situation, entry.language)!;
      expect(entry.campaignName).toBe(v7CampaignName(entry.situation, entry.language));
      expect(entry.generation).toBe("v7");
      expect(entry.body).toBe(v6.body);
      expect(entry.slotOrder).toEqual(v6.slotOrder);
      expect(entry.buttons).toEqual(v6.buttons);
      expect(entry.buttons).toContain("pay_url");
      expect(entry.metaSamples).toEqual(v6.metaSamples);
      expect(entry.buildParams(SAMPLE)).toEqual(v6.buildParams(SAMPLE));
    },
  );

  it.each(V7_CAMPAIGNS.map((entry) => [entry.campaignName, entry] as const))(
    "%s sends exactly the parameter count submitted for its situation",
    (_name, entry) => {
      // The pinned count is the body's slots plus Pay now. In Meta's format
      // (D-562) Pay now is its own button component, so the body carries one
      // fewer and the button carries the pay code.
      const wire = templateMessageBody({
        to: "+919000000001",
        name: entry.campaignName,
        languageCode: entry.language,
        bodyParams: entry.buildParams(SAMPLE),
        urlButtonSuffix: "pc_test",
      }) as { template: { components: Array<{ type: string; parameters: Array<{ text?: string }> }> } };
      const body = wire.template.components.find((part) => part.type === "body")!;
      const button = wire.template.components.find((part) => part.type === "button")!;
      expect(body.parameters.length + button.parameters.length).toBe(V7_TEMPLATE_PARAMS[entry.situation]!);
      expect(button.parameters).toEqual([{ type: "text", text: "pc_test" }]);
      // And the `_v6` send of the same values carried the same body.
      const v6 = describeV6Campaign(entry.situation, entry.language)!;
      expect(v6.buildParams(SAMPLE)).toHaveLength(body.parameters.length);
    },
  );

  it("approves only real _v7 names, each with its pinned count", () => {
    const names = new Set(V7_CAMPAIGNS.map((entry) => entry.campaignName));
    for (const name of APPROVED_V7) {
      expect(names.has(name), `${name} is not a _v7 template`).toBe(true);
      const entry = V7_CAMPAIGNS.find((candidate) => candidate.campaignName === name)!;
      expect(entry.approved).toBe(true);
      expect(V7_TEMPLATE_PARAMS[entry.situation]).toBe(entry.slotOrder.length + 1);
    }
  });

  it("is listed for the owner word for word in docs/cutover/AISENSY-TEMPLATES.md", () => {
    const doc = readFileSync(join(process.cwd(), "docs/cutover/AISENSY-TEMPLATES.md"), "utf8").replace(/\r\n/g, "\n");
    for (const entry of V7_CAMPAIGNS) {
      expect(doc).toContain("#### `" + entry.campaignName + "`");
      expect(doc).toContain("```\n" + entry.body + "\n```");
    }
    expect(doc).toContain("https://one.vpps.co.in/pay/{{1}}");
  });

  it("opens Pay now on One's own host", () => {
    expect(PAY_URL_PREFIX).toBe("https://one.vpps.co.in/pay/");
    expect(hasPayNowButton(v7CampaignName("fee_due", "hi"))).toBe(true);
  });
});

describe("VPPS One never sends _v6", () => {
  it("never names a _v6 campaign as the one to send, approved or not", () => {
    for (const situation of NOTICE_SITUATIONS) {
      for (const language of ["hi", "en"] as const) {
        // `_v8` is the hub's copy of `_v7`; either is fine, `_v6` never is.
        expect(["v7", "v8"]).toContain(approvedV6Campaign(situation, language)?.generation ?? "v7");
        expect(activeCampaignNameOrNull(situation, language) ?? "").not.toMatch(/_v6$/);
        try {
          expect(activeCampaignName(situation, language)).not.toMatch(/_v6$/);
        } catch (caught) {
          // An unapproved earlier generation throws; that is not a _v6 send.
          expect(String(caught)).not.toMatch(/_v6/);
        }
      }
    }
  });

  it("still knows the fees app's _v6 names, to recognise its sends", () => {
    expect(V6_CAMPAIGNS.every((entry) => entry.campaignName.endsWith("_v6"))).toBe(true);
  });

  it("falls back to the text-only generation while neither _v8 nor _v7 is approved", () => {
    if (APPROVED_V7.size > 0) return;
    let fellBack = 0;
    for (const situation of NOTICE_SITUATIONS) {
      for (const language of ["hi", "en"] as const) {
        if (isHubApproved(situation, language)) {
          // The hub's copy goes, under its own name (D-566).
          expect(approvedV6Campaign(situation, language)?.campaignName).toBe(`vpps_app_${situation}_${language}_v8`);
          expect(activeCampaignNameOrNull(situation, language)).toBe(`vpps_app_${situation}_${language}_v8`);
          continue;
        }
        fellBack += 1;
        expect(approvedV6Campaign(situation, language)).toBeNull();
        expect(activeCampaignNameOrNull(situation, language) ?? "").not.toMatch(/_v[678]$/);
      }
    }
    // late_fee_applied has no Pay now and so no `_v8`: it always falls back.
    expect(fellBack).toBeGreaterThan(0);
  });
});
