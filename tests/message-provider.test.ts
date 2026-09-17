import { describe, expect, it } from "vitest";

import {
  MOCK_ID_PREFIX,
  digitsForOutcome,
  isMockProviderMessageId,
  isRetryable,
  mockOutcomeFor,
  mockProviderMessageId,
  outcomeErrors,
  providerOutcomes,
} from "@/modules/collection/domain/provider";

/**
 * The mock provider's *decisions*, which is the half that has to be right.
 *
 * Whether `fetch` is called is the adapter's business and needs a server
 * environment; what a given number should produce is arithmetic, and these are
 * the cases QA.md names: success, slow, timeout, 429, 500 and a duplicate.
 */

describe("which outcome a number forces", () => {
  it("covers every digit", () => {
    const seen = new Set(
      Array.from({ length: 10 }, (_, digit) => mockOutcomeFor(`98765432${digit}`)),
    );

    // Not `toEqual(new Set(providerOutcomes))` — the assertion that matters is
    // that every named outcome is *reachable*, so a digit table that quietly
    // lost a case fails here rather than in a QA run that never sees a 429.
    for (const outcome of providerOutcomes) {
      expect([...seen]).toContain(outcome);
    }
  });

  it.each([
    ["9876543210", "sent"],
    ["9876543214", "sent"],
    ["9876543215", "slow"],
    ["9876543216", "timeout"],
    ["9876543217", "rate_limited"],
    ["9876543218", "server_error"],
    ["9876543219", "duplicate"],
  ] as const)("%s → %s", (phone, expected) => {
    expect(mockOutcomeFor(phone)).toBe(expected);
  });

  it("ignores surrounding whitespace, because a pasted number carries it", () => {
    expect(mockOutcomeFor("  9876543217  ")).toBe("rate_limited");
  });

  it("succeeds for anything that does not end in a digit", () => {
    // The real provider decides what a bad number is. A seventh outcome here
    // would make the mock disagree with production about it.
    expect(mockOutcomeFor("")).toBe("sent");
    expect(mockOutcomeFor("not a phone")).toBe("sent");
  });

  it("offers the fixture a digit for every outcome", () => {
    for (const outcome of providerOutcomes) {
      expect(digitsForOutcome(outcome).length).toBeGreaterThan(0);
    }
  });
});

describe("the id the mock hands back", () => {
  it("is the same every time for the same send", () => {
    // This is what makes `duplicate` a test rather than a coin toss: a second
    // dispatch has to be indistinguishable from a replayed callback.
    const first = mockProviderMessageId("11111111-2222-3333-4444-555555555555");
    const second = mockProviderMessageId("11111111-2222-3333-4444-555555555555");

    expect(first).toBe(second);
  });

  it("differs between sends", () => {
    expect(mockProviderMessageId("a")).not.toBe(mockProviderMessageId("b"));
  });

  it("is marked, so a mocked send can never read as a real one", () => {
    const id = mockProviderMessageId("abc");

    expect(id.startsWith(MOCK_ID_PREFIX)).toBe(true);
    expect(isMockProviderMessageId(id)).toBe(true);
    expect(isMockProviderMessageId("wamid.HBgMOTE5")).toBe(false);
    expect(isMockProviderMessageId(null)).toBe(false);
  });
});

describe("what the office is told, and what they can do about it", () => {
  it.each(["timeout", "rate_limited", "server_error"] as const)(
    "%s reads as an instruction, not as a status code",
    (outcome) => {
      const message = outcomeErrors[outcome];

      expect(message.en.length).toBeGreaterThan(10);
      expect(message.hi.length).toBeGreaterThan(5);
      // "429" in front of the office is a number somebody has to go and ask
      // about. The sentence has to say what to do instead.
      expect(message.en).not.toMatch(/\b(4\d\d|5\d\d)\b/);
    },
  );

  it("offers a retry only where there is work left to retry", () => {
    expect(isRetryable("timeout")).toBe(true);
    expect(isRetryable("rate_limited")).toBe(true);
    expect(isRetryable("server_error")).toBe(true);

    expect(isRetryable("sent")).toBe(false);
    expect(isRetryable("slow")).toBe(false);
    // The whole reason `duplicate` exists: the message went. Offering "try
    // again" on it is an invitation to send the same thing twice.
    expect(isRetryable("duplicate")).toBe(false);
  });
});
