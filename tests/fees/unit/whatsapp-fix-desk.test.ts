import { describe, expect, it } from "vitest";

import {
  causeOfSend,
  fixActionFor,
  groupIntoFixFamilies,
  laneOfSend,
  owedOnInstallments,
  reachedLater,
  systemicGroups,
  type FixSendRow,
} from "@/modules/whatsapp/domain/fix-desk";
import {
  explainUnusablePhone,
  phoneKey,
  pickFamilyNumber,
} from "@/modules/whatsapp/domain/phone-numbers";

const NOW = new Date("2026-10-30T10:00:00+05:30");

function row(overrides: Partial<FixSendRow> = {}): FixSendRow {
  return {
    id: "send-1",
    studentId: "student-1",
    runId: "run-1",
    sentOn: "2026-10-30",
    createdAt: "2026-10-30T03:30:00Z",
    campaignName: "vpps_app_fee_due_hi_v6",
    destination: "+919000000011",
    destinationRole: "primary",
    dueAmount: 7600,
    status: "failed",
    deliveryStatus: null,
    failureCause: null,
    errorMessage: null,
    lastError: null,
    deliveryError: null,
    deliveryErrorCode: null,
    attempts: 1,
    lastAttemptAt: null,
    resolution: null,
    scopeStudentIds: [],
    ...overrides,
  };
}

describe("laneOfSend", () => {
  it("puts a refusal, an undelivered message and a long-pending send in their lanes", () => {
    expect(laneOfSend(row({ status: "failed" }), NOW)).toBe("refused");
    expect(laneOfSend(row({ status: "sent", deliveryStatus: "failed" }), NOW)).toBe("not_delivered");
    expect(laneOfSend(row({ status: "pending", createdAt: "2026-10-30T04:00:00Z" }), NOW)).toBe("stuck");
  });

  it("leaves a send that is still in flight, or arrived, or was handled, alone", () => {
    expect(laneOfSend(row({ status: "pending", createdAt: "2026-10-30T04:25:00Z" }), NOW)).toBeNull();
    expect(laneOfSend(row({ status: "sent", deliveryStatus: null }), NOW)).toBeNull();
    expect(laneOfSend(row({ status: "sent", deliveryStatus: "delivered" }), NOW)).toBeNull();
    expect(laneOfSend(row({ status: "failed", resolution: "called" }), NOW)).toBeNull();
  });
});

describe("causeOfSend", () => {
  it("prefers the stored cause, and reads the text for rows written before it existed", () => {
    expect(causeOfSend(row({ failureCause: "template" }), "refused")).toBe("template");
    expect(causeOfSend(row({ lastError: "Insufficient wallet balance" }), "refused")).toBe("account");
    expect(
      causeOfSend(row({ status: "sent", deliveryStatus: "failed", deliveryErrorCode: "131026" }), "not_delivered"),
    ).toBe("not_on_whatsapp");
  });
});

describe("reachedLater", () => {
  const failed = row({ id: "a", sentOn: "2026-10-28", createdAt: "2026-10-28T03:30:00Z" });

  it("clears a failure once a later reminder reached the same child", () => {
    expect(
      reachedLater(failed, [{ id: "b", studentId: "student-1", sentOn: "2026-10-29", createdAt: "2026-10-29T03:30:00Z" }]),
    ).toBe(true);
  });

  it("does not count the failed row itself, an earlier send, or another child", () => {
    expect(reachedLater(failed, [{ id: "a", studentId: "student-1", sentOn: "2026-10-28", createdAt: failed.createdAt }])).toBe(false);
    expect(reachedLater(failed, [{ id: "c", studentId: "student-1", sentOn: "2026-10-27", createdAt: "2026-10-27T03:30:00Z" }])).toBe(false);
    expect(reachedLater(failed, [{ id: "d", studentId: "student-2", sentOn: "2026-10-29", createdAt: "2026-10-29T03:30:00Z" }])).toBe(false);
  });
});

describe("fixActionFor", () => {
  const base = { sentOn: "2026-10-30", today: "2026-10-30", failedDestination: "+919000000011" };

  it("offers Resend for a network failure", () => {
    const action = fixActionFor({ ...base, cause: "network", nextDestination: "+919000000011", nextParent: "father" });
    expect(action.canResend).toBe(true);
    expect(action.label).toBe("Resend");
  });

  it("sends a dead father's number to the mother once there is one", () => {
    const action = fixActionFor({
      ...base,
      cause: "not_on_whatsapp",
      nextDestination: "+919000000012",
      nextParent: "mother",
    });
    expect(action.canResend).toBe(true);
    expect(action.label).toBe("Resend to mother's number");
  });

  it("asks for a number, not a resend, while the dead number is still the only one", () => {
    const action = fixActionFor({ ...base, cause: "not_on_whatsapp", nextDestination: "+919000000011", nextParent: "father" });
    expect(action.canResend).toBe(false);
    expect(action.label).toBe("Fix number");
  });

  it("asks for a number when nothing on record works", () => {
    const action = fixActionFor({ ...base, cause: "network", nextDestination: null, nextParent: null });
    expect(action.canResend).toBe(false);
    expect(action.policy).toBe("needs_number");
  });

  it("holds a WhatsApp limit until tomorrow", () => {
    expect(
      fixActionFor({ ...base, cause: "whatsapp_limit", nextDestination: base.failedDestination, nextParent: "father" }).canResend,
    ).toBe(false);
    expect(
      fixActionFor({
        ...base,
        sentOn: "2026-10-29",
        cause: "whatsapp_limit",
        nextDestination: base.failedDestination,
        nextParent: "father",
      }).canResend,
    ).toBe(true);
  });

  it("says Call for a family who stopped messages on the only number", () => {
    const action = fixActionFor({ ...base, cause: "opted_out", nextDestination: base.failedDestination, nextParent: "father" });
    expect(action.canResend).toBe(false);
    expect(action.label).toBe("Call");
  });

  it("never resends a stuck row before a person has checked", () => {
    const action = fixActionFor({ ...base, cause: "stuck", nextDestination: base.failedDestination, nextParent: "father" });
    expect(action.canResend).toBe(false);
  });
});

describe("groupIntoFixFamilies", () => {
  it("makes one card per phone, newest failure first, biggest debt on top", () => {
    const families = groupIntoFixFamilies([
      { ...row({ id: "1", sentOn: "2026-10-28" }), studentId: "s1", destination: "+919000000011", dueAmount: 3800 },
      { ...row({ id: "2", sentOn: "2026-10-30" }), studentId: "s1", destination: "9000000011", dueAmount: 3800 },
      { ...row({ id: "3" }), studentId: "s2", destination: "+919000000013", dueAmount: 15200 },
    ]);
    expect(families).toHaveLength(2);
    expect(families[0]!.latest.id).toBe("3");
    expect(families[1]!.problems.map((problem) => problem.id)).toEqual(["2", "1"]);
  });

  it("never merges two families that both have no usable number", () => {
    const families = groupIntoFixFamilies([
      { ...row({ id: "1" }), studentId: "s1", destination: "" },
      { ...row({ id: "2" }), studentId: "s2", destination: "" },
    ]);
    expect(families).toHaveLength(2);
  });
});

describe("systemicGroups", () => {
  it("collapses one template fault into one banner, and ignores family faults", () => {
    const groups = systemicGroups([
      { cause: "template", campaignName: "a", sendId: "1" },
      { cause: "template", campaignName: "a", sendId: "2" },
      { cause: "not_on_whatsapp", campaignName: "a", sendId: "3" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sendIds).toEqual(["1", "2"]);
  });
});

describe("owedOnInstallments", () => {
  it("sums what the message asked for, across the children it covered", () => {
    const pending = new Map([
      ["s1", [0, 0, 3800, 3800]],
      ["s2", [0, 1000, 0, 0]],
    ]);
    expect(owedOnInstallments(pending, ["s1", "s2"], [2, 3])).toBe(4800);
    expect(owedOnInstallments(pending, ["s1"], [1, 2])).toBe(0);
  });
});

describe("pickFamilyNumber", () => {
  const none = () => undefined;

  it("uses the father's number, then the mother's", () => {
    expect(pickFamilyNumber("90000 00011", "9000000012", none)).toMatchObject({
      destination: "+919000000011",
      parent: "father",
      other: "+919000000012",
    });
    expect(pickFamilyNumber("90000 0012", "9000000012", none)).toMatchObject({
      destination: "+919000000012",
      parent: "mother",
    });
  });

  it("skips a number WhatsApp rejected", () => {
    const dead = (key: string) => (key === "9000000011" ? "not_on_whatsapp" : undefined);
    expect(pickFamilyNumber("9000000011", "9000000012", dead)).toMatchObject({
      destination: "+919000000012",
      parent: "mother",
      fatherDead: "not_on_whatsapp",
      other: null,
    });
    expect(pickFamilyNumber("9000000011", null, dead).destination).toBeNull();
  });
});

describe("phone helpers", () => {
  it("keys a number by its last ten digits however it was typed", () => {
    expect(phoneKey("+91 90000 00011")).toBe("9000000011");
    expect(phoneKey("919000000011")).toBe("9000000011");
    expect(phoneKey("12345")).toBeNull();
  });

  it("says why a number cannot be messaged", () => {
    expect(explainUnusablePhone("90000 0012")).toBe("9 digits. A mobile number has 10.");
    expect(explainUnusablePhone("5829012345")).toMatch(/Starts with 5/);
    expect(explainUnusablePhone("9000000011")).toBeNull();
    expect(explainUnusablePhone("")).toBeNull();
  });
});
