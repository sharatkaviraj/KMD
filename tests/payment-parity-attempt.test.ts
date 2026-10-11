// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { clearPaymentAttempt, paymentAttemptKey, readPaymentAttempt, writePaymentAttempt, PaymentAttemptConflict, type PaymentAttempt } from "@/modules/payments/vx/attempt";
import { boot, STUDENT_ID } from "./payment-parity.fixture";

const key = paymentAttemptKey("TEST collector", boot.sessionLabel);
const attempt = (request: string): PaymentAttempt => ({ input: { clientRequestId: request, studentId: STUDENT_ID, sessionLabel: boot.sessionLabel, paymentDate: boot.today, mode: "cash", amount: 500, quickDiscountAmount: 0, lateFeeWaiver: 0, reference: "", remarks: "", receivedBy: "TEST collector", acknowledgeDuplicate: false }, form: { amount: "500" } });
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(key, JSON.stringify({ deleted: true, updatedAt: 0 }));
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

it("requires a confirmed mirror before posting even when primary storage is available", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("TEST private quota", "QuotaExceededError"); });
  await expect(writePaymentAttempt(key, attempt("first"))).rejects.toThrow("TEST private quota");
  write.mockRestore(); expect(await readPaymentAttempt(key, boot.sessionLabel)).toBeNull();
});

it("does not overwrite a damaged recovery record as if it were empty", async () => {
  localStorage.setItem(key, JSON.stringify({ version: 99, updatedAt: 0, value: { amount: 500 } }));
  await expect(readPaymentAttempt(key, boot.sessionLabel)).rejects.toThrow("could not be read safely");
  await expect(writePaymentAttempt(key, attempt("second"))).rejects.toThrow("could not be read safely");
});

it.each([false, 0, ""])("blocks a malformed recovery mirror containing %j", async value => {
  localStorage.setItem(key, JSON.stringify(value));
  await expect(readPaymentAttempt(key, boot.sessionLabel)).rejects.toThrow("mirror could not be read safely");
});

it("blocks missing primary storage with no confirmed fallback instead of inventing an empty state", async () => {
  localStorage.removeItem(key);
  await expect(readPaymentAttempt(key, boot.sessionLabel)).rejects.toThrow("Primary payment recovery storage is unavailable");
  await expect(writePaymentAttempt(key, attempt("first"))).rejects.toThrow("Primary payment recovery storage is unavailable");
});
