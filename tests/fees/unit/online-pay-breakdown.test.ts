import { describe, expect, it } from "vitest";

import { verifyCheckoutSignature } from "@/modules/payments/domain/online/checkout-signature";
import { checkFetchedOrderCapture } from "@/modules/payments/domain/online/order-capture-check";
import {
  amountChoices,
  lastPaid,
  lineBounds,
  paidProgress,
  payableFigures,
  prefillAmount,
  readPayPageData,
  rowState,
  splitRows,
  validateLineAmounts,
  type PayPageRow,
} from "@/modules/payments/domain/online/pay-breakdown";
import { checkoutOfferRefusal } from "@/modules/payments/domain/online/pay-scope";
import { HANDLED_EVENTS, readRazorpayEvent } from "@/modules/payments/domain/online/razorpay-events";
import { signRazorpayBody } from "@/modules/payments/domain/online/razorpay-signature";

describe("the tap-to-pick amount cards", () => {
  it("offers 'due so far' then 'whole year', and says the late fee inside them", () => {
    expect(amountChoices({ rows: [], clear_to_date: 18400, whole_session: 27150, late_fee_pending: 1000 })).toEqual([
      { key: "due_so_far", amount: 18400, lateFee: 1000 },
      { key: "whole_year", amount: 27150, lateFee: 1000 },
    ]);
  });

  it("shows one card when 'due so far' is the whole year", () => {
    expect(amountChoices({ rows: [], clear_to_date: 9000, whole_session: 9000, late_fee_pending: 0 })).toEqual([
      { key: "whole_year", amount: 9000, lateFee: 0 },
    ]);
  });

  it("leaves out a 'due so far' the bounds would refuse, or one that is nothing", () => {
    expect(amountChoices({ rows: [], clear_to_date: 50, whole_session: 26300, late_fee_pending: 0 }).map((choice) => choice.key)).toEqual(["whole_year"]);
    expect(amountChoices({ rows: [], clear_to_date: 0, whole_session: 8750, late_fee_pending: 0 }).map((choice) => choice.key)).toEqual(["whole_year"]);
  });

  it("offers nothing to a child who owes nothing", () => {
    expect(amountChoices({ rows: [], clear_to_date: 0, whole_session: 0, late_fee_pending: 0 })).toEqual([]);
  });
});

describe("while late fees are waived on online payment (this year)", () => {
  const row = (overrides: Partial<PayPageRow>): PayPageRow => ({
    installment_no: 1, label: null, due_date: "2026-04-20", carry_forward: false, charged: 8750, paid: 0,
    fees_pending: 8750, late_fee: 0, late_fee_paid: 0, late_fee_pending: 0, total_pending: 8750, status: null, ...overrides,
  });
  // Aarti on 2026-10-30: installment 3 carries a ₹1,000 late fee nobody has paid.
  const aarti = {
    rows: [
      row({ installment_no: 2, due_date: "2026-07-20", paid: 200, fees_pending: 8550, total_pending: 8550 }),
      row({ installment_no: 3, due_date: "2026-10-20", late_fee: 1000, late_fee_pending: 1000, total_pending: 9750 }),
      row({ installment_no: 4, due_date: "2027-01-20" }),
    ],
    clear_to_date: 18300,
    whole_session: 27050,
    late_fee_pending: 1000,
  };

  it("asks for fees only, and never names a late fee on a card", () => {
    expect(payableFigures(aarti, true)).toEqual({ dueSoFar: 17300, wholeYear: 26050, lateFee: 0 });
    expect(amountChoices(aarti, true)).toEqual([
      { key: "due_so_far", amount: 17300, lateFee: 0 },
      { key: "whole_year", amount: 26050, lateFee: 0 },
    ]);
  });

  it("takes a late fee the family already paid off what is owed, as the waiver moves it onto fees", () => {
    const paidOne = {
      ...aarti,
      rows: [row({ installment_no: 1, fees_pending: 0, paid: 8750, late_fee: 1000, late_fee_paid: 1000, total_pending: 0 }), ...aarti.rows],
    };
    expect(payableFigures(paidOne, true)).toEqual({ dueSoFar: 16300, wholeYear: 25050, lateFee: 0 });
  });

  it("calls a row paid once its fees are, whatever its late fee", () => {
    const feesPaid = row({ fees_pending: 0, paid: 8750, late_fee: 1000, late_fee_pending: 1000, total_pending: 1000 });
    expect(rowState(feesPaid, "2026-10-30", true)).toBe("paid");
    expect(rowState(feesPaid, "2026-10-30", false)).toBe("overdue");
    expect(splitRows({ rows: [feesPaid] }, true).settled).toHaveLength(1);
  });

  it("changes nothing with the waiver off", () => {
    expect(payableFigures(aarti, false)).toEqual({ dueSoFar: 18300, wholeYear: 27050, lateFee: 1000 });
  });
});

describe("the page's small summaries", () => {
  const row = (overrides: Partial<PayPageRow>): PayPageRow => ({
    installment_no: 1, label: null, due_date: "2026-04-20", carry_forward: false, charged: 9250, paid: 9250,
    fees_pending: 0, late_fee: 0, late_fee_paid: 0, late_fee_pending: 0, total_pending: 0, status: null, ...overrides,
  });
  const rows = [
    row({}),
    row({ installment_no: 2, due_date: "2026-07-20", charged: 8750, paid: 100, fees_pending: 8650, total_pending: 8650 }),
    row({ installment_no: 3, due_date: "2026-10-20", charged: 8750, paid: 0, fees_pending: 8750, late_fee: 1000, late_fee_pending: 1000, total_pending: 9750 }),
  ];

  it("counts paid fees and paid late fees against what is still owed", () => {
    expect(paidProgress({ rows, clear_to_date: 18400, whole_session: 18400, late_fee_pending: 1000 })).toEqual({ paid: 9350, owed: 18400, fraction: 9350 / 27750 });
    expect(paidProgress({ rows: [], clear_to_date: 0, whole_session: 0, late_fee_pending: 0 }).fraction).toBe(1);
  });

  it("folds fully paid rows away from the details", () => {
    const { settled, open } = splitRows({ rows });
    expect(settled.map((entry) => entry.installment_no)).toEqual([1]);
    expect(open.map((entry) => entry.installment_no)).toEqual([2, 3]);
  });

  it("finds the latest payment that became receipts, for the reopened page's banner", () => {
    expect(
      lastPaid({
        orders: [
          { public_ref: "b", status: "open", amount_rupees: 500, created_at: "2026-10-30T05:00:00Z", receipts: [] },
          { public_ref: "a", status: "accounted", amount_rupees: 100, created_at: "2026-10-30T03:56:58Z", receipts: [{ line_no: 1, receipt_number: "SVP20261030-0001", amount: 100 }] },
        ],
      }),
    ).toEqual({ amount: 100, at: "2026-10-30T03:56:58Z", receiptNumbers: ["SVP20261030-0001"] });
    expect(lastPaid({ orders: [] })).toBeNull();
  });
});

describe("what each amount box may hold", () => {
  it("is ₹100 to the whole session, or exactly the balance when that is less", () => {
    expect(lineBounds({ whole_session: 26300 })).toEqual({ min: 100, max: 26300 });
    expect(lineBounds({ whole_session: 50 })).toEqual({ min: 50, max: 50 });
    expect(lineBounds({ whole_session: 0 })).toEqual({ min: 0, max: 0 });
  });

  it("opens on clear-dues-to-date, raised to the minimum when only a few rupees are due now", () => {
    expect(prefillAmount({ clear_to_date: 17550, whole_session: 26300 })).toBe(17550);
    expect(prefillAmount({ clear_to_date: 50, whole_session: 26300 })).toBe(100);
    expect(prefillAmount({ clear_to_date: 50, whole_session: 50 })).toBe(50);
    expect(prefillAmount({ clear_to_date: 0, whole_session: 8750 })).toBe(0);
    expect(prefillAmount({ clear_to_date: 0, whole_session: 0 })).toBe(0);
  });

  it("sends only the children with an amount, and refuses anything out of bounds", () => {
    const children = [
      { index: 0, whole_session: 26300 },
      { index: 1, whole_session: 50 },
      { index: 2, whole_session: 9000 },
    ];
    expect(validateLineAmounts(children, { 0: 500, 1: 50, 2: null })).toEqual({
      lines: [
        { index: 0, amount_rupees: 500 },
        { index: 1, amount_rupees: 50 },
      ],
      total: 550,
      errors: {},
      ok: true,
    });
    const bad = validateLineAmounts(children, { 0: 99, 1: 51, 2: 100.5 });
    expect(bad.errors).toEqual({ 0: "below_min", 1: "above_max", 2: "not_whole" });
    expect(bad.ok).toBe(false);
    expect(validateLineAmounts(children, { 0: null, 1: 0, 2: undefined }).ok).toBe(false);
    expect(validateLineAmounts(children, { 0: 26300, 2: 9000 }, 30000).ok).toBe(false);
  });
});

describe("a row's chip", () => {
  const row = (over: Partial<PayPageRow>): PayPageRow => ({
    installment_no: 1, label: null, due_date: "2026-07-20", carry_forward: false, charged: 8750, paid: 0,
    fees_pending: 8750, late_fee: 0, late_fee_paid: 0, late_fee_pending: 0, total_pending: 8750, status: null, ...over,
  });

  it("comes from the row's own figures and today's date", () => {
    expect(rowState(row({ total_pending: 0, fees_pending: 0, paid: 8750 }), "2026-10-30")).toBe("paid");
    expect(rowState(row({}), "2026-10-30")).toBe("overdue");
    expect(rowState(row({ due_date: "2027-01-20", paid: 1000 }), "2026-10-30")).toBe("part_paid");
    expect(rowState(row({ due_date: "2027-01-20" }), "2026-10-30")).toBe("upcoming");
  });
});

describe("reading the page's figures", () => {
  it("refuses a payload that is not a usable page", () => {
    expect(readPayPageData(null)).toBeNull();
    expect(readPayPageData({ ok: false })).toBeNull();
    expect(readPayPageData({ ok: true, children: [] })).toBeNull();
    expect(readPayPageData({ ok: true, children: Array.from({ length: 5 }, () => ({ first_name: "A", rows: [] })) })).toBeNull();
    expect(readPayPageData({ ok: true, children: [{ first_name: "Aarti", rows: [] }] })).not.toBeNull();
  });
});

describe("which reminders open the one-tap checkout", () => {
  const scope = (over = {}) => ({ studentIds: ["2a5c5dc1-116a-4b2d-803c-e0e402f68f1e"], installments: [1], lastYear: false, situation: "fee_due", amount: 50, ...over });

  it("takes one to four children on any notice but the two waiver notices", () => {
    expect(checkoutOfferRefusal(scope())).toBeNull();
    expect(checkoutOfferRefusal(scope({ situation: "late_fee_applied" }))).toBeNull();
    expect(checkoutOfferRefusal(scope({ situation: "balance" }))).toBeNull();
    expect(checkoutOfferRefusal(scope({ studentIds: Array(4).fill("2a5c5dc1-116a-4b2d-803c-e0e402f68f1e") }))).toBeNull();
    expect(checkoutOfferRefusal(scope({ studentIds: Array(5).fill("2a5c5dc1-116a-4b2d-803c-e0e402f68f1e") }))).toBe("too_many_children");
    expect(checkoutOfferRefusal(scope({ situation: "late_fee_waiver" }))).toBe("notice_not_online");
    expect(checkoutOfferRefusal(scope({ situation: "waiver_last_call" }))).toBe("notice_not_online");
    expect(checkoutOfferRefusal(null)).toBe("no_scope");
  });
});

describe("a payment on one of our checkout orders", () => {
  const payment = { id: "pay_ABC1", amount: 25000, currency: "inr", status: "captured", captured: true, order_id: "order_OURS1", method: "upi", fee: 0, tax: 0, created_at: 1793180000 };

  it("is recorded only when it carries exactly our order id and is captured", () => {
    const ok = checkFetchedOrderCapture({ payment, providerOrderId: "order_OURS1", mode: "live" });
    expect(ok).toMatchObject({ ok: true, facts: { provider_order_id: "order_OURS1", amount_paise: 25000, currency: "INR", provider_mode: "live" } });
    expect(checkFetchedOrderCapture({ payment: { ...payment, order_id: "order_OTHER" }, providerOrderId: "order_OURS1", mode: "live" })).toEqual({ ok: false, reason: "order_mismatch" });
    expect(checkFetchedOrderCapture({ payment: { ...payment, status: "authorized", captured: false }, providerOrderId: "order_OURS1", mode: "live" })).toEqual({ ok: false, reason: "not_captured" });
    expect(checkFetchedOrderCapture({ payment: { ...payment, amount: 0 }, providerOrderId: "order_OURS1", mode: "live" })).toEqual({ ok: false, reason: "bad_amount" });
  });

  it("checks checkout's signature under the key secret, and refuses malformed ids", () => {
    const keySecret = "key_secret_for_tests";
    const signature = signRazorpayBody("order_OURS1|pay_ABC1", keySecret);
    expect(verifyCheckoutSignature({ orderId: "order_OURS1", paymentId: "pay_ABC1", signature, keySecret })).toBe(true);
    expect(verifyCheckoutSignature({ orderId: "order_OURS1", paymentId: "pay_ABC2", signature, keySecret })).toBe(false);
    expect(verifyCheckoutSignature({ orderId: "order_OURS1", paymentId: "pay_ABC1", signature, keySecret: "webhook_secret" })).toBe(false);
    expect(verifyCheckoutSignature({ orderId: "x|y", paymentId: "pay_ABC1", signature, keySecret })).toBe(false);
  });

  it("is woken by order.paid, which names the payment and the order", () => {
    expect(HANDLED_EVENTS.has("order.paid")).toBe(true);
    const facts = readRazorpayEvent({
      entity: "event",
      event: "order.paid",
      account_id: "acc_1",
      payload: { payment: { entity: { id: "pay_ABC1", order_id: "order_OURS1", contact: "+919999999999" } }, order: { entity: { id: "order_OURS1", status: "paid" } } },
    });
    expect(facts).toMatchObject({ eventType: "order.paid", paymentId: "pay_ABC1", facts: { order_id: "order_OURS1", order_status: "paid" } });
    expect(JSON.stringify(facts)).not.toContain("9999999999");
  });
});
