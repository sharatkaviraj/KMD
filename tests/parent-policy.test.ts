import { describe, expect, it } from "vitest";

import {
  exceptionIsNamed,
  mayDispatchToParent,
  staleReasons,
  type ParentSnapshot,
} from "@/modules/collection/domain/parent-policy";

/**
 * P9: a parent message is approved by a person against what is true when it
 * goes, and the app sends nothing to a parent unless the school named an
 * exception and switched it on. Synthetic numbers only.
 */

const snapshot = (over: Partial<ParentSnapshot> = {}): ParentSnapshot => ({
  destination: "9000000001",
  contact: "9000000001",
  record: { kind: "request", id: "r1", version: "2026-10-01T10:00:00Z" },
  content: "abc",
  policyVersion: 1,
  ...over,
});

describe("staleReasons()", () => {
  it("is empty when nothing has moved", () => {
    expect(staleReasons(snapshot(), snapshot(), false)).toEqual([]);
  });

  it("names every difference, not only the first", () => {
    const now = snapshot({
      contact: "9000000002",
      record: { kind: "request", id: "r1", version: "2026-10-02T09:00:00Z" },
      policyVersion: 2,
    });
    expect(staleReasons(snapshot(), now, false)).toEqual(["contact_changed", "record_changed", "policy_changed"]);
  });

  it("treats a number reported as wrong as a reason in itself", () => {
    expect(staleReasons(snapshot(), snapshot(), true)).toEqual(["route_flagged"]);
  });

  it("sees a changed text and a changed destination", () => {
    expect(staleReasons(snapshot(), snapshot({ content: "abd", destination: "9000000003" }), false)).toEqual([
      "destination_changed",
      "content_changed",
    ]);
  });
});

describe("the automatic exception", () => {
  const named = { autoRecipients: "Guardians of the class", autoTrigger: "On issue", autoContent: "report_link", autoCorrection: "Send a correction" };

  it("is real only when all four things are named", () => {
    expect(exceptionIsNamed(named)).toBe(true);
    expect(exceptionIsNamed({ ...named, autoCorrection: "  " })).toBe(false);
    expect(exceptionIsNamed({ ...named, autoTrigger: null })).toBe(false);
  });
});

describe("mayDispatchToParent()", () => {
  const exception = {
    approvalRequired: false,
    autoRecipients: "r",
    autoTrigger: "t",
    autoContent: "c",
    autoCorrection: "x",
  };

  it("refuses while the school's switch is off, whatever the policy says", () => {
    expect(mayDispatchToParent({ switchOn: false, policy: exception, stale: [] }).ok).toBe(false);
  });

  it("refuses a category that requires approval — the default", () => {
    const verdict = mayDispatchToParent({ switchOn: true, policy: { ...exception, approvalRequired: true }, stale: [] });
    expect(verdict.ok).toBe(false);
  });

  it("refuses an exception that does not name everything, even with the switch on", () => {
    expect(mayDispatchToParent({ switchOn: true, policy: { ...exception, autoContent: null }, stale: [] }).ok).toBe(false);
  });

  it("refuses anything stale, saying why", () => {
    const verdict = mayDispatchToParent({ switchOn: true, policy: exception, stale: ["contact_changed"] });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason.en).toMatch(/guardian/);
  });

  it("allows only the one case the school deliberately set up", () => {
    expect(mayDispatchToParent({ switchOn: true, policy: exception, stale: [] })).toEqual({ ok: true });
  });
});
