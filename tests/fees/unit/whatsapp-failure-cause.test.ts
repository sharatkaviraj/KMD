import { describe, expect, it } from "vitest";

import {
  CAUSE_COPY,
  classifyFailure,
  errorCodeIn,
  FAILURE_CAUSES,
  isDeadNumberCause,
  isSystemicCause,
  resendPolicyFor,
} from "@/modules/whatsapp/domain/failure-cause";

/**
 * The one rule that turns AiSensy's and WhatsApp's words into the office's.
 * A wrong cause is a wrong button: "Resend" on a dead number pays for a second
 * failure, "Fix number" on a template fault sends the office hunting through
 * forty correct phone numbers.
 */
describe("classifyFailure", () => {
  it.each([
    [{ code: "131026" }, "not_on_whatsapp"],
    [{ text: "(#131026) Message undeliverable" }, "not_on_whatsapp"],
    [{ text: "Receiver is incapable of receiving this message" }, "not_on_whatsapp"],
    [{ text: "Not a valid WhatsApp user" }, "not_on_whatsapp"],
    [{ code: "131050" }, "opted_out"],
    [{ text: "User has blocked the business" }, "opted_out"],
    [{ code: "131049" }, "whatsapp_limit"],
    [{ text: "This message was not delivered to maintain healthy ecosystem engagement." }, "whatsapp_limit"],
    [{ text: "Pair rate limit hit" }, "whatsapp_limit"],
    [{ text: "Template params does not match the campaign" }, "template"],
    [{ code: "132001" }, "template"],
    [{ text: "Campaign is not live" }, "template"],
    [{ text: "AISENSY_API_KEY is not configured." }, "account"],
    [{ text: "Insufficient wallet balance" }, "account"],
    [{ httpStatus: 401, text: "" }, "account"],
    [{ text: "Media download failed" }, "media"],
    [{ text: "Invalid destination" }, "invalid_number"],
    [{ text: "fetch failed", httpStatus: 0 }, "network"],
    [{ text: "Request timed out" }, "network"],
    [{ httpStatus: 502, text: "Bad Gateway" }, "network"],
    [{ text: "Could not claim send slot: connection reset" }, "network"],
    [{ text: "Something nobody has seen before" }, "unknown"],
  ] as const)("%o → %s", (input, expected) => {
    expect(classifyFailure(input)).toBe(expected);
  });

  it("reads the code before the words, so a code in the sentence decides", () => {
    // "limit" appears, but 131026 says the number is dead — the code wins.
    expect(classifyFailure({ text: "Undeliverable (131026), retry limit reached" })).toBe(
      "not_on_whatsapp",
    );
  });

  it("does not mistake an account block for a family blocking the school", () => {
    expect(classifyFailure({ text: "Your account is blocked" })).toBe("account");
  });

  it("does not read 'profile' as a missing file", () => {
    expect(classifyFailure({ text: "User profile is not available" })).toBe("unknown");
  });

  it("ignores a short number inside a sentence, but honours it in a code field", () => {
    expect(classifyFailure({ text: "Row 4 could not be parsed" })).toBe("unknown");
    expect(classifyFailure({ code: "4" })).toBe("whatsapp_limit");
  });
});

describe("what each cause allows", () => {
  it("only dead-number causes move a family to the other parent", () => {
    expect(FAILURE_CAUSES.filter(isDeadNumberCause)).toEqual([
      "invalid_number",
      "not_on_whatsapp",
      "opted_out",
    ]);
  });

  it("template and account faults are the school's, shown once for everybody", () => {
    expect(FAILURE_CAUSES.filter(isSystemicCause)).toEqual(["template", "account"]);
  });

  it("gives every cause a policy, a label and a Hindi line", () => {
    for (const cause of Object.keys(CAUSE_COPY) as Array<keyof typeof CAUSE_COPY>) {
      expect(resendPolicyFor(cause)).toBeTruthy();
      expect(CAUSE_COPY[cause].label.length).toBeGreaterThan(0);
      expect(CAUSE_COPY[cause].hindi).toMatch(/[ऀ-ॿ]/);
    }
  });

  it("never offers a same-day resend for a WhatsApp limit, or any resend for an opt-out", () => {
    expect(resendPolicyFor("whatsapp_limit")).toBe("tomorrow");
    expect(resendPolicyFor("opted_out")).toBe("never");
    expect(resendPolicyFor("stuck")).toBe("check_first");
  });
});

describe("errorCodeIn", () => {
  it("pulls a WhatsApp code out of a sentence", () => {
    expect(errorCodeIn("(#131026) Message undeliverable")).toBe("131026");
    expect(errorCodeIn("Delivered")).toBeNull();
  });
});
