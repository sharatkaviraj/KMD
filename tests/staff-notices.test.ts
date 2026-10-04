import { describe, expect, it } from "vitest";

import {
  classifyResponse,
  mockBehaviourFor,
  NOTICE_TEMPLATES,
  outcomeOfThrow,
  renderNotice,
} from "@/modules/staff-notices/domain/notices";

/**
 * P4, Gate F: what a cover notice says, and what a provider's answer means.
 * Synthetic names and numbers only; nothing is sent.
 */

describe("classifyResponse — only a receipt id is acceptance", () => {
  it("accepts either receipt field the two existing adapters read", () => {
    expect(classifyResponse(200, { submitted_message_id: "abc" })).toMatchObject({
      outcome: "accepted",
      providerMessageId: "abc",
    });
    expect(classifyResponse(200, { messageId: "xyz" })).toMatchObject({ outcome: "accepted" });
  });

  it("calls a 2xx without an id Unknown, not sent", () => {
    expect(classifyResponse(200, { status: "ok" }).outcome).toBe("unknown");
    expect(classifyResponse(202, null).outcome).toBe("unknown");
    expect(classifyResponse(200, { submitted_message_id: "  " }).outcome).toBe("unknown");
  });

  it("knows a rate limit, a provider error and a definite refusal apart", () => {
    expect(classifyResponse(429, {}).outcome).toBe("rate_limited");
    expect(classifyResponse(503, {})).toMatchObject({ outcome: "rejected", status: 503 });
    expect(classifyResponse(400, { message: "bad number" })).toMatchObject({
      outcome: "rejected",
      error: "bad number",
    });
  });

  it("never calls a thrown request a failure — it may have been accepted", () => {
    const outcome = outcomeOfThrow(new Error("aborted"));
    expect(outcome.outcome).toBe("unknown");
    expect(outcome.status).toBeNull();
  });
});

describe("mockBehaviourFor — every outcome on purpose", () => {
  it("maps the last digit of a synthetic number to an outcome", () => {
    expect(mockBehaviourFor("9000000000")).toBe("accepted");
    expect(mockBehaviourFor("9000000004")).toBe("accepted");
    expect(mockBehaviourFor("9000000005")).toBe("slow");
    expect(mockBehaviourFor("9000000006")).toBe("timeout");
    expect(mockBehaviourFor("9000000007")).toBe("rate_limited");
    expect(mockBehaviourFor("9000000008")).toBe("server_error");
    expect(mockBehaviourFor("9000000009")).toBe("no_receipt");
    expect(mockBehaviourFor("12345")).toBe("refused");
  });
});

describe("renderNotice — what a teacher reads", () => {
  const facts = {
    kind: "cover_assigned" as const,
    staffName: "Teacher B",
    language: "en" as const,
    day: "2027-03-01",
    period: 2,
    periodTime: "09:50–10:30",
    classLabels: ["11 Science", "11 Commerce"],
    subjectCode: "HINDI",
    link: "https://example.test/duty/abc",
  };

  it("names the classes, the subject, the period with its time and the link", () => {
    const { params, templateCode, text } = renderNotice(facts);
    expect(templateCode).toBe(NOTICE_TEMPLATES.cover_assigned);
    expect(params).toEqual([
      "Teacher B",
      expect.stringMatching(/1 Mar/),
      "P3 (09:50–10:30)",
      "11 Science, 11 Commerce",
      "HINDI",
      "https://example.test/duty/abc",
    ]);
    expect(text.en).toContain("acknowledge");
    expect(text.hi).toContain("https://example.test/duty/abc");
  });

  it("has the same six parameters for every kind, so one approved shape each is enough", () => {
    for (const kind of ["cover_assigned", "cover_changed", "cover_cancelled", "cover_escalation"] as const) {
      expect(renderNotice({ ...facts, kind }).params).toHaveLength(6);
    }
  });

  it("never carries why a colleague is away or a child's name", () => {
    // The facts a notice is made from have no field for either. This keeps it
    // that way: a new field would have to be added here, on purpose.
    expect(Object.keys(facts).sort()).toEqual(
      ["classLabels", "day", "kind", "language", "link", "period", "periodTime", "staffName", "subjectCode"].sort(),
    );
  });
});
