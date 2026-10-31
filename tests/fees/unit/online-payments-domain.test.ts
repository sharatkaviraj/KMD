import { describe, expect, it } from "vitest";

import { checkFetchedCapture, modeOfKey, paymentIntentRef } from "@/modules/payments/domain/online/capture-check";
import { paiseToWholeRupees, rupeesToPaise } from "@/modules/payments/domain/online/money";
import {
  isOnlineSituation,
  onlineOfferRefusal,
  parentReasonFor,
  readPayScope,
} from "@/modules/payments/domain/online/pay-scope";
import { readRazorpayEvent } from "@/modules/payments/domain/online/razorpay-events";
import { signRazorpayBody, verifyRazorpaySignature } from "@/modules/payments/domain/online/razorpay-signature";

const STUDENT = "398ae781-5149-4f99-9eca-92d7bf31b1bf";

describe("INR and paise at the provider boundary", () => {
  it("converts whole rupees exactly", () => {
    expect(rupeesToPaise(14125)).toBe(1_412_500);
    expect(paiseToWholeRupees(1_412_500)).toBe(14125);
  });

  it("refuses to round: a fractional rupee is quarantined, not converted", () => {
    expect(paiseToWholeRupees(1_412_550)).toBeNull();
    expect(paiseToWholeRupees(99)).toBeNull();
    expect(() => rupeesToPaise(10.5)).toThrow();
    expect(() => rupeesToPaise(0)).toThrow();
    expect(() => rupeesToPaise(-100)).toThrow();
    expect(paiseToWholeRupees(Number.NaN)).toBeNull();
  });
});

describe("webhook signature", () => {
  const secret = "whsec_test_only_not_a_real_secret";
  const body = '{"entity":"event","event":"payment.captured"}';

  it("accepts Razorpay's HMAC over the exact raw body", () => {
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, secret), secret)).toBe(true);
  });

  it("refuses a body changed by even one space (re-serialised JSON is not the body)", () => {
    const signature = signRazorpayBody(body, secret);
    expect(verifyRazorpaySignature(JSON.stringify(JSON.parse(body), null, 1), signature, secret)).toBe(false);
  });

  it("refuses the wrong secret, a missing header, and junk of the wrong shape", () => {
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, "other"), secret)).toBe(false);
    expect(verifyRazorpaySignature(body, null, secret)).toBe(false);
    expect(verifyRazorpaySignature(body, "abc", secret)).toBe(false);
    expect(verifyRazorpaySignature(body, "z".repeat(64), secret)).toBe(false);
    expect(verifyRazorpaySignature(body, signRazorpayBody(body, secret), "")).toBe(false);
  });
});

describe("reading an event", () => {
  const event = {
    entity: "event",
    account_id: "acc_TEST",
    event: "payment_link.paid",
    contains: ["payment_link", "order", "payment"],
    payload: {
      payment_link: { entity: { id: "plink_ABC123", status: "paid", amount: 800000, amount_paid: 800000, reference_id: "vp1_abc", customer: { contact: "+919999999999", email: "parent@example.com" } } },
      payment: { entity: { id: "pay_XYZ789", amount: 800000, currency: "INR", status: "captured", method: "upi", vpa: "parent@okhdfc", contact: "+919999999999", email: "parent@example.com" } },
    },
    created_at: 1793180000,
  };

  it("keeps ids and amounts", () => {
    const facts = readRazorpayEvent(event);
    expect(facts).toMatchObject({ eventType: "payment_link.paid", accountId: "acc_TEST", paymentId: "pay_XYZ789", paymentLinkId: "plink_ABC123" });
    expect(facts?.facts.payment_amount).toBe(800000);
  });

  it("stores nothing personal: no phone, e-mail or VPA survives", () => {
    const stored = JSON.stringify(readRazorpayEvent(event));
    expect(stored).not.toMatch(/9999999999|parent@|okhdfc/);
  });

  it("rejects ids of the wrong shape and things that are not events", () => {
    expect(readRazorpayEvent({ ...event, payload: { payment: { entity: { id: "../../x" } } } })?.paymentId).toBeNull();
    expect(readRazorpayEvent({ entity: "payment" })).toBeNull();
    expect(readRazorpayEvent(null)).toBeNull();
  });
});

describe("checking a fetched payment", () => {
  const payment = { id: "pay_1", amount: 800000, currency: "INR", status: "captured", captured: true, order_id: "order_1", method: "upi", fee: 16000, tax: 2880, created_at: 1793180000 };
  const link = { id: "plink_1", reference_id: "vp1_abc", order_id: "order_1", payments: [{ payment_id: "pay_1", status: "captured" }] };

  it("passes a captured payment on one of our links, amounts from the API", () => {
    const result = checkFetchedCapture({ payment, link, mode: "live" });
    expect(result).toMatchObject({ ok: true, facts: { amount_paise: 800000, provider_mode: "live", reference_id: "vp1_abc", fee_paise: 16000 } });
  });

  it("never records authorised-only money", () => {
    expect(checkFetchedCapture({ payment: { ...payment, status: "authorized", captured: false }, link, mode: "live" })).toEqual({ ok: false, reason: "not_captured" });
  });

  it("refuses a payment on somebody else's link, or one the link does not list, or another order", () => {
    expect(checkFetchedCapture({ payment, link: { ...link, reference_id: "other_123" }, mode: "live" })).toEqual({ ok: false, reason: "not_our_link" });
    expect(checkFetchedCapture({ payment, link: null, mode: "live" })).toEqual({ ok: false, reason: "not_our_link" });
    expect(checkFetchedCapture({ payment, link: { ...link, payments: [{ payment_id: "pay_2" }] }, mode: "live" })).toEqual({ ok: false, reason: "link_does_not_list_payment" });
    expect(checkFetchedCapture({ payment, link: { ...link, order_id: "order_2" }, mode: "live" })).toEqual({ ok: false, reason: "order_mismatch" });
  });

  it("reads a link's EMPTY payment list as not-listed-yet: what a UPI link reported for real money", () => {
    // Production, 2026-10-29: same order on both sides, `payments: []`.
    expect(checkFetchedCapture({ payment, link: { ...link, payments: [] }, mode: "live" })).toMatchObject({ ok: true });
    // An empty list is no licence for another order.
    expect(checkFetchedCapture({ payment, link: { ...link, order_id: "order_2", payments: [] }, mode: "live" })).toEqual({ ok: false, reason: "order_mismatch" });
  });

  it("lets a matching intent reference stand in for the link's list and order (UPI links), never for anything else", () => {
    const qrLink = { ...link, order_id: "order_link", payments: [{ payment_id: "pay_other" }] };
    expect(checkFetchedCapture({ payment, link: qrLink, mode: "live" })).toEqual({ ok: false, reason: "link_does_not_list_payment" });
    expect(checkFetchedCapture({ payment, link: qrLink, mode: "live", intentRefMatched: true })).toMatchObject({ ok: true });
    // Still our link, still captured money.
    expect(checkFetchedCapture({ payment, link: { ...qrLink, reference_id: "other_1" }, mode: "live", intentRefMatched: true })).toEqual({ ok: false, reason: "not_our_link" });
    expect(checkFetchedCapture({ payment: { ...payment, status: "authorized", captured: false }, link: qrLink, mode: "live", intentRefMatched: true })).toEqual({ ok: false, reason: "not_captured" });
  });

  it("reads the intent reference only from a payment's object notes", () => {
    expect(paymentIntentRef({ notes: { intent_ref: "x4tFprD69f96RPiqEdwVm4MG" } })).toBe("x4tFprD69f96RPiqEdwVm4MG");
    expect(paymentIntentRef({ notes: [] })).toBeNull();
    expect(paymentIntentRef({ notes: { intent_ref: "short" } })).toBeNull();
    expect(paymentIntentRef({})).toBeNull();
  });

  it("reads the mode from the key, never from a separate setting", () => {
    expect(modeOfKey("rzp_live_x")).toBe("live");
    expect(modeOfKey("rzp_test_x")).toBe("test");
    expect(modeOfKey("sk_live_x")).toBeNull();
  });
});

describe("the Pay now scope", () => {
  const scope = { studentIds: [STUDENT], installments: [2, 1, 1], lastYear: true, situation: "fee_due", amount: 14125 };

  it("normalises and keeps what the sender wrote", () => {
    expect(readPayScope(scope)).toEqual({ ...scope, installments: [1, 2] });
    expect(readPayScope(null)).toBeNull();
    expect(readPayScope({ ...scope, studentIds: ["not-a-uuid"] })).toBeNull();
  });

  it("offers online only for one student on a fees-only notice", () => {
    expect(onlineOfferRefusal(readPayScope(scope))).toBeNull();
    expect(onlineOfferRefusal(readPayScope({ ...scope, studentIds: [STUDENT, "4cb8fcb5-58d5-4a4f-a476-d01561b0b91f"] }))).toBe("family_message");
    expect(onlineOfferRefusal(readPayScope({ ...scope, situation: "late_fee_applied" }))).toBe("notice_not_online");
    expect(onlineOfferRefusal(readPayScope({ ...scope, situation: "balance" }))).toBe("notice_not_online");
    expect(onlineOfferRefusal(readPayScope({ ...scope, installments: [], lastYear: false }))).toBe("nothing_selected");
    expect(isOnlineSituation("waiver_last_call")).toBe(false);
  });

  it("explains a refusal without naming anybody", () => {
    expect(parentReasonFor(["nothing_due"])).toMatch(/Nothing is due/);
    expect(parentReasonFor(["late_fee_pending"])).toMatch(/late fee/);
  });
});
