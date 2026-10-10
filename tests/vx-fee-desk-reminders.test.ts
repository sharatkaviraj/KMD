import { describe, expect, it } from "vitest";

import {
  audienceLine,
  bandIndexOf,
  DEFAULT_AUDIENCE,
  funnelRates,
  leftOutBy,
  messageCost,
  parseAudience,
  pickAudience,
  quotedAmount,
  renderMessage,
  respectsQuietHours,
  templateSegments,
  type AudienceFamily,
} from "@/modules/whatsapp/vx/domain/reminders";

const fam = (over: Partial<AudienceFamily>): AudienceFamily => ({
  key: "f",
  studentIds: ["s"],
  fatherName: "Test Parent",
  kidsLine: "Test · Class 4",
  classLabels: ["Class 4"],
  pendingToday: 3000,
  notDueYet: 6000,
  usesBus: false,
  overdueInstallments: [2],
  promised: false,
  paidLast3Days: false,
  left: false,
  ...over,
});

describe("cost", () => {
  it("is shown before sending, at ₹0.88 a message", () => {
    expect(messageCost(0)).toBe(0);
    expect(messageCost(1)).toBe(1);
    expect(messageCost(92)).toBe(81);
  });
});

describe("message", () => {
  const values = {
    hi: { parent: "टेस्ट", student: "बच्चा", amount: "₹3,000", "due date": "15 सितंबर" },
    en: { parent: "Test", student: "Child", amount: "₹3,000", "due date": "15 Sep" },
  };

  it("is Hindi first, English below, per the chosen language", () => {
    const both = renderMessage("gentle", "both", values);
    expect(both.hi).toContain("₹3,000");
    expect(both.hi).toContain("टेस्ट जी");
    expect(both.en).toContain("Dear Test");
    expect(renderMessage("gentle", "hi", values).en).toBeNull();
    expect(renderMessage("gentle", "en", values).hi).toBeNull();
  });

  it("marks the fields filled in for each family", () => {
    const segs = templateSegments("Dear {parent}, {amount}", values.en);
    expect(segs.filter((s) => s.field).map((s) => s.field)).toEqual(["parent", "amount"]);
    expect(segs.map((s) => s.text).join("")).toBe("Dear Test, ₹3,000");
  });
});

describe("audience", () => {
  const list = [
    fam({ key: "a" }),
    fam({ key: "b", promised: true }),
    fam({ key: "c", paidLast3Days: true }),
    fam({ key: "d", left: true }),
    fam({ key: "e", pendingToday: 0, notDueYet: 4000, overdueInstallments: [] }),
    fam({ key: "f", pendingToday: 12000, usesBus: true, classLabels: ["UKG"] }),
  ];

  it("leaves out promised, recently paid and left by default", () => {
    expect(pickAudience(list, DEFAULT_AUDIENCE).map((f) => f.key)).toEqual(["a", "f"]);
    expect(leftOutBy(list, DEFAULT_AUDIENCE, "promised")).toBe(1);
    expect(leftOutBy(list, DEFAULT_AUDIENCE, "left")).toBe(1);
  });

  it("reaches not-due-yet families only when pending today is off", () => {
    const off = { ...DEFAULT_AUDIENCE, pendingToday: false };
    expect(pickAudience(list, off).map((f) => f.key)).toContain("e");
    expect(quotedAmount(list[0], off)).toBe(9000);
    expect(quotedAmount(list[0], DEFAULT_AUDIENCE)).toBe(3000);
  });

  it("narrows by amount, bus and class band", () => {
    expect(pickAudience(list, { ...DEFAULT_AUDIENCE, big: true }).map((f) => f.key)).toEqual(["f"]);
    expect(pickAudience(list, { ...DEFAULT_AUDIENCE, bus: true }).map((f) => f.key)).toEqual(["f"]);
    expect(pickAudience(list, { ...DEFAULT_AUDIENCE, bands: [0] }).map((f) => f.key)).toEqual(["f"]);
    expect(bandIndexOf("11 Commerce")).toBe(4);
  });

  it("describes and round-trips the filters", () => {
    expect(audienceLine({ ...DEFAULT_AUDIENCE, inst2: true, bus: true })).toBe("Pending today · Inst 2 · all classes · has bus");
    const saved = parseAudience(JSON.parse(JSON.stringify({ ...DEFAULT_AUDIENCE, bands: [3, 1, 1, 9] })));
    expect(saved.bands).toEqual([1, 3]);
    expect(parseAudience(null)).toEqual(DEFAULT_AUDIENCE);
  });
});

describe("results", () => {
  it("reads the funnel as rates", () => {
    expect(funnelRates({ sent: 200, delivered: 190, read: 152, paid: 30 })).toEqual({ delivered: 95, read: 80, paid: 15 });
    expect(funnelRates({ sent: 0, delivered: 0, read: 0, paid: 0 })).toEqual({ delivered: 0, read: 0, paid: 0 });
  });

  it("keeps quiet hours", () => {
    expect(respectsQuietHours(10)).toBe(true);
    expect(respectsQuietHours(20)).toBe(false);
    expect(respectsQuietHours(7)).toBe(false);
  });
});
