import { describe, expect, it } from "vitest";

import { canUndo, noticeCampaigns, outboxText, reminderMessages, waLink, type DueRow } from "@/vx/screens/messages/domain/outbox";

const amount = (n: number) => `₹${n}`;
const date = (iso: string) => iso;

const row = (over: Partial<DueRow>): DueRow => ({
  studentId: "s1",
  studentName: "Test Child",
  fatherName: "Test Parent",
  phone: "9876500001",
  dueDate: "2026-07-10",
  pending: 1000,
  ...over,
});

describe("To send", () => {
  it("joins Hindi and English and skips the empty one", () => {
    expect(outboxText("नमस्ते", "Hello")).toBe("नमस्ते\n\nHello");
    expect(outboxText("", "Hello")).toBe("Hello");
    expect(outboxText(null, " Hi ")).toBe("Hi");
  });

  it("builds a wa.me link only for an Indian mobile number", () => {
    expect(waLink("+91 98765 00001", "a b")).toBe("https://wa.me/919876500001?text=a%20b");
    expect(waLink("12345", "x")).toBeNull();
    expect(waLink(null, "x")).toBeNull();
  });

  it("allows undo for ten minutes only", () => {
    const now = new Date("2026-10-11T10:00:00Z");
    expect(canUndo("2026-10-11T09:55:00Z", now)).toBe(true);
    expect(canUndo("2026-10-11T09:49:00Z", now)).toBe(false);
    expect(canUndo(null, now)).toBe(false);
  });

  it("turns a calendar audience into campaigns", () => {
    expect(noticeCampaigns("parents")).toEqual(["school"]);
    expect(noticeCampaigns("staff")).toEqual(["staff"]);
    expect(noticeCampaigns("both")).toEqual(["school", "staff"]);
  });
});

describe("fee reminder messages", () => {
  const today = "2026-10-11";

  it("quotes what is overdue today from the oldest due date, one message per family", () => {
    const { messages } = reminderMessages(
      [
        row({ studentId: "s1", studentName: "Asha Test", dueDate: "2026-07-10", pending: 1000 }),
        row({ studentId: "s2", studentName: "Ravi Test", dueDate: "2026-09-10", pending: 500 }),
        row({ studentId: "s1", studentName: "Asha Test", dueDate: "2026-12-10", pending: 900 }),
      ],
      "gentle",
      "en",
      today,
      amount,
      date,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].amount).toBe(1500);
    expect(messages[0].dueDate).toBe("2026-07-10");
    expect(messages[0].en).toContain("₹1500");
    expect(messages[0].en).toContain("Asha, Ravi");
    expect(messages[0].hi).toBe("");
  });

  it("quotes the next installment for a coming-up reminder", () => {
    const { messages } = reminderMessages(
      [row({ dueDate: "2026-07-10", pending: 1000 }), row({ dueDate: "2026-12-10", pending: 900 }), row({ dueDate: "2027-02-10", pending: 800 })],
      "upcoming",
      "both",
      today,
      amount,
      date,
    );
    expect(messages[0].amount).toBe(900);
    expect(messages[0].dueDate).toBe("2026-12-10");
    expect(messages[0].hi).toContain("₹900");
  });

  it("leaves out families who owe nothing now and counts those without a number", () => {
    const result = reminderMessages(
      [row({ studentId: "a", phone: "9876500002", dueDate: "2026-12-10" }), row({ studentId: "b", phone: null })],
      "final",
      "en",
      today,
      amount,
      date,
    );
    expect(result.messages).toHaveLength(0);
    expect(result.nothingOwed).toBe(1);
    expect(result.noPhone).toBe(1);
  });
});
