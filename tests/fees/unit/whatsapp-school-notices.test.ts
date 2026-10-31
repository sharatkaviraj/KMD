import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_SCHOOL_NOTICES,
  isSchoolNoticeApproved,
  SCHOOL_NOTICES,
  schoolNoticeCampaignName,
} from "@/modules/whatsapp/domain/school-notices";
import {
  SCHOOL_NOTICE_TEMPLATES,
  schoolNoticeTemplate,
} from "@/modules/whatsapp/domain/school-notice-bodies";
import { fillBody } from "@/modules/whatsapp/domain/campaign-bodies-v6";

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
 * School notices — absence, exam schedule, PTM, closure.
 *
 * Their own lane, so the rules that matter are the template's own: what Meta
 * will be asked to approve, and that no slot can ever go out empty (WhatsApp
 * refuses an empty parameter and the message simply does not go).
 */

describe("the school notice templates", () => {
  it("has one per notice per language, named for AiSensy", () => {
    expect(SCHOOL_NOTICE_TEMPLATES).toHaveLength(SCHOOL_NOTICES.length * 2);
    expect(schoolNoticeCampaignName("absent_today", "hi")).toBe("vpps_school_absent_hi_v1");
    expect(schoolNoticeCampaignName("school_closed", "en")).toBe("vpps_school_closed_en_v1");
    expect(schoolNoticeCampaignName("exam_schedule", "en")).toBe("vpps_school_exam_schedule_en_v1");
  });

  it("is switched on for exactly the eight Meta approved on 2026-10-26", () => {
    // Pinned by name, so a typo cannot quietly leave one language unsendable.
    expect([...APPROVED_SCHOOL_NOTICES].sort()).toEqual(
      SCHOOL_NOTICE_TEMPLATES.map((entry) => entry.campaignName).sort(),
    );
    expect(isSchoolNoticeApproved("absent_today", "hi")).toBe(true);
    expect(isSchoolNoticeApproved("school_closed", "hi")).toBe(true);
  });

  it.each(SCHOOL_NOTICE_TEMPLATES.map((entry) => [entry.campaignName, entry] as const))(
    "%s follows Meta's and AiSensy's rules",
    (_name, entry) => {
      const order = [...entry.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
      expect(order).toEqual(entry.slotOrder.map((_, index) => index + 1));
      expect(entry.metaSamples).toHaveLength(entry.slotOrder.length);
      expect(entry.body.trimEnd().endsWith("}}")).toBe(false);
      expect(entry.body).not.toMatch(/[([]\{\{|\}\}[)\]]/);
      expect(fillBody(entry.body, entry.metaSamples).length).toBeLessThanOrEqual(1024);
      expect(entry.body.split("\n")[0]).toMatch(/^\*.+\*$/);
    },
  );

  it("never sends an empty slot, even with a field left blank", () => {
    const params = schoolNoticeTemplate("exam_schedule", "en").buildParams({
      studentName: "Aaradhya Gurjar",
      studentClass: "Class 2",
      fields: { examName: "", startsOn: "02-12-2026", reportingTime: "" },
    });
    expect(params.every((value) => value.trim().length > 0)).toBe(true);
  });

  it("names the child and the class on an absence alert", () => {
    expect(
      schoolNoticeTemplate("absent_today", "hi").buildParams({
        studentName: "Aaradhya Gurjar",
        studentClass: "Class 2",
        fields: { date: "27-10-2026" },
      }),
    ).toEqual(["Aaradhya Gurjar", "Class 2", "27-10-2026"]);
  });

  it("addresses a closure to the household, every child on the phone", () => {
    expect(SCHOOL_NOTICES.find((entry) => entry.kind === "school_closed")?.addressedTo).toBe("household");
    const params = schoolNoticeTemplate("school_closed", "en").buildParams({
      studentName: "Aaradhya Gurjar · Class 2, Bhavya Gurjar · Class 5",
      studentClass: "Class 2",
      fields: { closedOn: "09-11-2026", reason: "Diwali holidays", reopensOn: "12-11-2026" },
    });
    expect(params[0]).toContain("Bhavya Gurjar");
  });
});
