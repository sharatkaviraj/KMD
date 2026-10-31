import {
  SCHOOL_UPI_PAYMENT_CONFIG,
  type StudentFeeUpiPayment,
} from "@/modules/payments/domain/upi";

/*
 * Its own file, not upi.ts: upi.ts reaches every staff route through the
 * payment sheet, and only the public pay page needs this. A route's bundle
 * ceiling is ratcheted down, never raised.
 */

/**
 * A payment to the school with NO amount filled in: what the WhatsApp pay page
 * offers when its link cannot say how much (mistyped, expired, or a test send),
 * so Pay now never ends at a dead end. The parent types the figure in their UPI
 * app. There is no admission number to put in the note, so the page asks for the
 * student's name there instead.
 */
export function buildOpenSchoolUpiPayment(): Omit<StudentFeeUpiPayment, "amount"> {
  const displayReference = "School fee";
  const params = new URLSearchParams({
    pa: SCHOOL_UPI_PAYMENT_CONFIG.vpa,
    pn: SCHOOL_UPI_PAYMENT_CONFIG.payeeName,
    cu: SCHOOL_UPI_PAYMENT_CONFIG.currency,
    tn: displayReference,
  });

  return {
    uri: `upi://pay?${params.toString().replaceAll("+", "%20")}`,
    displayReference,
    payeeName: SCHOOL_UPI_PAYMENT_CONFIG.payeeName,
    vpa: SCHOOL_UPI_PAYMENT_CONFIG.vpa,
  };
}
