import { describe, expect, it } from "vitest";

import {
  STAFF_ALERT_CAMPAIGN,
  formatPaidOn,
  parseStaffAlertNumbers,
  staffAlertPush,
  staffAlertTemplateParams,
  type StaffAlertFacts,
} from "@/modules/payments/domain/online/staff-alert-message";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";

/**
 * What the office is told about an online payment (fees
 * tests/unit/staff-alert-message.test.ts at origin/main 78e27e4f). One: the
 * receipt link is `/fees/receipts/`, and the student, receipt and numbers are
 * synthetic (rule 6). The WhatsApp half in One goes through the staff outbox
 * (tests/fees/integration/online-staff-alerts.test.ts); these values are kept
 * for parity and the push text.
 */

const live: StaffAlertFacts = {
  receiptId: "7b1e2c4a-0000-4000-8000-000000000001",
  receiptNumber: "SVP-2026-27-1042",
  amountRupees: 5000,
  studentName: "Test Child One",
  classLabel: "Class 2 - Section A",
  sessionLabel: "2026-27",
  // 06:12 UTC is 11:42 in India.
  postedAt: "2026-10-30T06:12:00.000Z",
};

describe("the WhatsApp template values", () => {
  it("is the fees app's approved campaign", () => {
    expect(STAFF_ALERT_CAMPAIGN).toBe("vpps_staff_online_payment_en_v1");
  });

  it("fills exactly the five slots, in order", () => {
    expect(staffAlertTemplateParams(live)).toEqual([
      "Test Child One",
      "Class 2 - Section A",
      "₹5,000",
      "SVP-2026-27-1042",
      "30-10-2026, 11:42 am",
    ]);
  });

  it("marks a test-session payment so it is never taken for real money", () => {
    const params = staffAlertTemplateParams({ ...live, sessionLabel: "TEST-2026-27" });
    expect(params[1]).toBe("Class 2 - Section A · TEST-2026-27");
    expect(staffAlertPush({ ...live, sessionLabel: "TEST-2026-27" }).title).toMatch(/^TEST · /);
  });

  it("never sends an empty slot, which AiSensy refuses", () => {
    const params = staffAlertTemplateParams({ ...live, studentName: "  ", classLabel: "", receiptNumber: "" });
    expect(params.every((value) => value.trim().length > 0)).toBe(true);
  });

  it("reads the time in India, whatever zone the server is in", () => {
    // 19:00 UTC on the 30th is 00:30 on the 31st in India.
    expect(formatPaidOn("2026-10-30T19:00:00.000Z")).toBe("31-10-2026, 12:30 am");
  });
});

describe("the phone notification", () => {
  it("leads with the amount and opens the receipt in One", () => {
    expect(staffAlertPush(live)).toEqual({
      title: "₹5,000 received online",
      body: "Test Child One · Class 2 - Section A · SVP-2026-27-1042",
      url: `/fees/receipts/${live.receiptId}`,
      tag: `online-payment-${live.receiptId}`,
    });
  });
});

describe("parseStaffAlertNumbers", () => {
  it("turns numbers into what AiSensy accepts, once each", () => {
    expect(
      parseStaffAlertNumbers("+919000000001, 9000000002,9000000002\n 09000000001", toWhatsappDestination),
    ).toEqual(["+919000000001", "+919000000002"]);
  });

  it("drops what is not an Indian mobile rather than messaging a stranger", () => {
    expect(parseStaffAlertNumbers("12345, 0141 2345678, abc", toWhatsappDestination)).toEqual([]);
  });
});
