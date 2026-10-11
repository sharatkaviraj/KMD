// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { clearPaymentAttempt, paymentAttemptKey, readPaymentAttempt, writePaymentAttempt, PaymentAttemptConflict, type PaymentAttempt } from "@/modules/payments/vx/attempt";
import { boot, STUDENT_ID } from "./payment-parity.fixture";

const key = paymentAttemptKey("TEST collector", boot.sessionLabel);
const attempt = (request: string): PaymentAttempt => ({ input: { clientRequestId: request, studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: boot.today, mode: "cash", amount: 500, quickDiscountAmount: 0, lateFeeWaiver: 0, reference: "", remarks: "", receivedBy: "TEST collector", acknowledgeDuplicate: false }, form: { amount: "500" } });
beforeEach(() => {
  localStorage.clear();
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (_key: string, work: () => Promise<unknown>) => { const next = tail.then(work); tail = next.then(() => undefined, () => undefined); return next; } } });
});
it("does not let a second tab overwrite an unresolved request", async () => {
  const results = await Promise.allSettled([writePaymentAttempt(key, attempt("first")), writePaymentAttempt(key, attempt("second"))]);
  expect(results[0].status).toBe("fulfilled"); expect(results[1]).toMatchObject({ status: "rejected", reason: expect.any(PaymentAttemptConflict) });
  expect(await readPaymentAttempt(key, boot.sessionLabel)).toEqual(attempt("first"));
});
it("freezes financial fields under the same request while permitting duplicate acknowledgment", async () => {
  const original = attempt("first"); await writePaymentAttempt(key, original);
  await expect(writePaymentAttempt(key, { ...original, input: { ...original.input, amount: 900 } })).rejects.toBeInstanceOf(PaymentAttemptConflict);
  await writePaymentAttempt(key, { ...original, input: { ...original.input, acknowledgeDuplicate: true } });
  expect((await readPaymentAttempt(key, boot.sessionLabel))?.input).toEqual({ ...original.input, acknowledgeDuplicate: true });
});
it("does not let a stale receipt clear another request", async () => {
  await writePaymentAttempt(key, attempt("second")); await clearPaymentAttempt(key, "first");
  expect(await readPaymentAttempt(key, boot.sessionLabel)).toEqual(attempt("second"));
  await clearPaymentAttempt(key, "second"); expect(await readPaymentAttempt(key, boot.sessionLabel)).toBeNull();
});
it("refuses posting when cross-tab recovery cannot be protected", async () => {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  await expect(writePaymentAttempt(key, attempt("first"))).rejects.toThrow("cannot protect");
  expect(await readPaymentAttempt(key, boot.sessionLabel)).toBeNull();
});
