import { afterEach, describe, expect, it, vi } from "vitest";

import { suggestionsForToday } from "@/modules/whatsapp/domain/today-suggestions";
import { buildInstallmentCalendar } from "@/modules/whatsapp/domain/installment-calendar";

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
 * What the send screen's Today strip offers, by the calendar alone.
 *
 * Anchored to fixed dates: a suggestion that names the wrong notice on the
 * wrong day is the office sending a waiver note a week after the waiver ended.
 */

const schedule = [
  { dueDate: "2026-04-20" },
  { dueDate: "2026-07-20" },
  { dueDate: "2026-10-20" },
  { dueDate: "2027-01-20" },
];
const on = (today: string) =>
  suggestionsForToday(buildInstallmentCalendar({ schedule, today }), today);

describe("suggestionsForToday", () => {
  it("offers installment 3's waiver window six days after its due date", () => {
    const waiver = on("2026-10-26").find((entry) => entry.installmentNo === 3);
    expect(waiver).toMatchObject({
      situation: "late_fee_waiver",
      messageDate: "2026-10-30",
      lateFee: "yes",
    });
  });

  it("offers the waiver's last day on the tenth day", () => {
    expect(on("2026-10-30").find((entry) => entry.installmentNo === 3)?.situation).toBe(
      "waiver_last_call",
    );
  });

  it("moves to the final notice once the waiver has gone", () => {
    expect(on("2026-11-05").find((entry) => entry.installmentNo === 3)?.situation).toBe(
      "overdue_final",
    );
  });

  it("offers a polite note inside the pre-due window, and the firm one from three days out", () => {
    expect(on("2027-01-12").find((entry) => entry.installmentNo === 4)?.situation).toBe("upcoming");
    expect(on("2027-01-18").find((entry) => entry.installmentNo === 4)?.situation).toBe(
      "upcoming_final",
    );
  });

  it("never calls the due date itself late", () => {
    const due = on("2026-10-20").find((entry) => entry.installmentNo === 3);
    expect(due?.situation).toBe("upcoming_final");
    expect(due?.lateFee).toBe("any");
  });

  it("says nothing about an installment long past or far ahead", () => {
    expect(on("2026-10-26").map((entry) => entry.installmentNo)).toEqual([3]);
  });
});
