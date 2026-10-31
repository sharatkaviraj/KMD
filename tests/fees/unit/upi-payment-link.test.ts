import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCHOOL_UPI_PAYMENT_CONFIG,
  buildStudentFeeUpiPayment,
} from "@/modules/payments/domain/upi";
import { buildOpenSchoolUpiPayment } from "@/modules/payments/domain/upi-open";

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


describe("buildOpenSchoolUpiPayment", () => {
  it("pays the same school account with no amount, so the parent types it", () => {
    const payment = buildOpenSchoolUpiPayment();

    expect(payment.uri).toBe(
      "upi://pay?pa=shriveerpattassecsch.68347408%40hdfcbank&pn=SHRI%20VEER%20PATTA%20S%20SEC%20SCH&cu=INR&tn=School%20fee",
    );
    expect(payment.uri).not.toContain("am=");
    expect(payment.vpa).toBe(SCHOOL_UPI_PAYMENT_CONFIG.vpa);
  });
});

describe("buildStudentFeeUpiPayment", () => {
  it("builds a school UPI intent with exact rupee amount and admission reference", () => {
    const payment = buildStudentFeeUpiPayment({
      admissionNo: "ADM1234",
      amount: 8000,
    });

    expect(payment.uri).toBe(
      "upi://pay?pa=shriveerpattassecsch.68347408%40hdfcbank&pn=SHRI%20VEER%20PATTA%20S%20SEC%20SCH&am=8000&cu=INR&tn=Fee%20ADM1234",
    );
    expect(payment.displayReference).toBe("Fee ADM1234");
    expect(payment.payeeName).toBe(SCHOOL_UPI_PAYMENT_CONFIG.payeeName);
  });

  it("caps the UPI note to a short office-readable reference", () => {
    const payment = buildStudentFeeUpiPayment({
      admissionNo: "VERY-LONG-ADMISSION-NUMBER-123456789",
      amount: 12500.75,
    });

    expect(payment.displayReference.length).toBeLessThanOrEqual(35);
    expect(payment.uri).toContain("am=12501");
    expect(payment.uri).toContain("tn=");
  });
});
