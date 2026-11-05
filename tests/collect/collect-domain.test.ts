import { describe, expect, it } from "vitest";

import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import { attemptKey, acknowledge, allSaved, nothingPosted, parseAttempt, recovered, savedReceipts, settle, unsettled, type CollectAttempt } from "@/modules/collect/domain/attempt";
import { changeDue, checkSplit, chequeDateIso, chequeReady, ledgerTender, notesTotal, bumpNote, receivedSuggestions, shapeChequeDate, splitSuggestions, tendersByChild } from "@/modules/collect/domain/cash";
import { addDays, dateStrip, datePickable, monthBounds, monthGrid, shiftMonth, stepDate } from "@/modules/collect/domain/dates";
import { amountSuggestions, checkShares, childTotals, familyAmountOk, familyMax, familySuggestions, splitFamily, typeDigit, type ChildMoney } from "@/modules/collect/domain/family";
import { CHECK_OVER, canJumpTo, checkReasons, direction, nextCard, previousCard, visibleCards, type CheckInput } from "@/modules/collect/domain/flow";
import { collectReference, collectRemarks, nextReason } from "@/modules/collect/domain/remarks";
import { bridgeQuery, classParts, inClass, isHouseholdSearch, queryShape, searchLocal, spellingKey } from "@/modules/collect/domain/search";
import { amountInWordsEn, amountInWordsHi } from "@/modules/collect/domain/words";
import type { CollectPost } from "@/modules/collect/domain/types";

const TODAY = "2026-11-05";

function row(no: number, due: string, fees: number, late = 0, extra: Partial<DeskLedgerRow> = {}): DeskLedgerRow {
  return {
    id: `00000000-0000-4000-8000-00000000000${no}`, installmentNo: no, label: `Installment ${no}`, isCarryForward: false,
    dueDate: due, charge: fees, feesPaid: 0, feesPending: fees, lateFeePending: late, lateFeeRaw: late, lateFeeWaived: 0,
    lateFeeStatus: late ? "pending" : "none", planPriority: 1, ...extra,
  };
}

describe("flow", () => {
  const plain: CheckInput = { children: 1, mode: "cash", paymentDate: TODAY, today: TODAY, paidToday: false, total: 3000, lateFee: 200, waiving: true, defaultReason: true };

  it("needs no check card for a plain cash payment", () => {
    expect(checkReasons(plain)).toEqual([]);
    expect(visibleCards(false, "pay")).toEqual(["who", "dues", "amount", "pay", "sealed"]);
  });

  it("names every reason the check card appears, in order", () => {
    expect(checkReasons({ ...plain, children: 2, mode: "split", paymentDate: "2026-11-01", paidToday: true, total: CHECK_OVER + 1, defaultReason: false }))
      .toEqual(["family", "split", "backdated", "paid_today", "over_limit", "waiver_reason"]);
    expect(checkReasons({ ...plain, mode: "cheque" })).toEqual(["cheque"]);
    expect(checkReasons({ ...plain, mode: "bank_transfer" })).toEqual(["bank"]);
  });

  it("does not check a sum of exactly the limit, nor a waiver reason when nothing is waived", () => {
    expect(checkReasons({ ...plain, total: CHECK_OVER })).toEqual([]);
    expect(checkReasons({ ...plain, lateFee: 0, defaultReason: false })).toEqual([]);
    expect(checkReasons({ ...plain, waiving: false, defaultReason: false })).toEqual([]);
  });

  it("walks forward and back, skipping the check card when not needed", () => {
    const done = new Set<"who" | "dues" | "amount" | "pay">(["who", "dues"]);
    expect(nextCard({ current: "dues", done, jumping: false, needsCheck: false })).toBe("amount");
    expect(nextCard({ current: "pay", done, jumping: false, needsCheck: true })).toBe("check");
    expect(previousCard({ current: "pay", needsCheck: false })).toBe("amount");
    expect(previousCard({ current: "check", needsCheck: true })).toBe("pay");
    expect(previousCard({ current: "who", needsCheck: false })).toBeNull();
    expect(previousCard({ current: "sealed", needsCheck: false })).toBeNull();
  });

  it("returns straight to the saving card after a jump back", () => {
    const done = new Set(["who", "dues", "amount", "pay"] as const);
    expect(nextCard({ current: "dues", done, jumping: true, needsCheck: true })).toBe("check");
    expect(nextCard({ current: "dues", done, jumping: true, needsCheck: false })).toBe("pay");
    const partial = new Set(["who", "dues"] as const);
    expect(nextCard({ current: "dues", done: partial, jumping: true, needsCheck: false })).toBe("amount");
  });

  it("never steps onto the sealed card", () => {
    expect(nextCard({ current: "pay", done: new Set(), jumping: false, needsCheck: false })).toBe("pay");
  });

  it("lets a chip be tapped only when answered and not saved", () => {
    expect(canJumpTo("amount", { current: "pay", done: new Set(["amount"]) }, false)).toBe(true);
    expect(canJumpTo("amount", { current: "pay", done: new Set(["amount"]) }, true)).toBe(false);
    expect(canJumpTo("pay", { current: "pay", done: new Set(["pay"]) }, false)).toBe(false);
    expect(direction("pay", "dues")).toBe(-1);
    expect(direction("dues", "pay")).toBe(1);
  });
});

describe("family split", () => {
  const a: ChildMoney = { id: "a", rows: [row(1, "2026-07-10", 3000, 200), row(2, "2026-09-10", 3000, 200), row(3, "2027-01-10", 3000)], takeLate: false };
  const b: ChildMoney = { id: "b", rows: [row(1, "2026-07-10", 0), row(2, "2026-09-10", 2000, 200), row(3, "2027-01-10", 2000)], takeLate: false };

  it("keeps fees and late fees apart", () => {
    expect(childTotals(a, TODAY)).toEqual({ fees: 9000, late: 400, overdueFees: 6000, max: 9000 });
    expect(childTotals({ ...a, takeLate: true }, TODAY).max).toBe(9400);
    expect(familyMax([a, b], TODAY)).toBe(13000);
  });

  it("pays the oldest dues across the family first", () => {
    // Jul: a 3000. Sep: a 3000 then b 2000. Then Jan.
    expect(splitFamily([a, b], 7000, "oldest")).toEqual([6000, 1000]);
    expect(splitFamily([a, b], 3000, "oldest")).toEqual([3000, 0]);
  });

  it("takes a late fee right after its fees when collecting it", () => {
    const aa = { ...a, takeLate: true };
    expect(splitFamily([aa, b], 3200, "oldest")).toEqual([3200, 0]);
    expect(splitFamily([aa, b], 3100, "oldest")).toEqual([3100, 0]);
  });

  it("clears child by child", () => {
    expect(splitFamily([a, b], 10000, "child")).toEqual([9000, 1000]);
  });

  it("takes typed amounts by hand and flags a child over what they owe", () => {
    const shares = splitFamily([a, b], 0, "manual", { a: 2000, b: 5000 });
    expect(shares).toEqual([2000, 5000]);
    expect(checkShares([a, b], shares, TODAY).map((s) => s.over)).toEqual([false, true]);
    expect(familyAmountOk([a, b], 0, "manual", shares, TODAY)).toBe(false);
    expect(familyAmountOk([a, b], 0, "manual", [2000, 4000], TODAY)).toBe(true);
  });

  it("refuses more than the family owes", () => {
    expect(familyAmountOk([a, b], 13001, "oldest", splitFamily([a, b], 13001, "oldest"), TODAY)).toBe(false);
    expect(familyAmountOk([a, b], 13000, "oldest", splitFamily([a, b], 13000, "oldest"), TODAY)).toBe(true);
  });

  it("offers up to four suggestions, no repeats, never more than owed", () => {
    // Jul overdue, Jan and Apr still to come: O clears July, N runs to January, Y is the year.
    const c: ChildMoney = { id: "c", rows: [row(1, "2026-07-10", 3000, 200), row(2, "2027-01-10", 3000), row(3, "2027-04-10", 3000)], takeLate: false };
    const list = amountSuggestions(c, TODAY, 2500);
    expect(list.map((s) => [s.key, s.amount])).toEqual([["O", 3000], ["N", 6000], ["Y", 9000], ["L", 2500]]);
    expect(amountSuggestions({ ...c, takeLate: true }, TODAY, null).map((s) => s.amount)).toEqual([3200, 6200, 9200]);
    // When the next installment is the last one, "up to next" is the year and is not offered twice.
    expect(amountSuggestions(a, TODAY, 3000).map((s) => s.key)).toEqual(["O", "Y", "L"]);
    expect(amountSuggestions(a, TODAY, 99_999).some((s) => s.key === "L")).toBe(false);
    const fam = familySuggestions([a, b], TODAY);
    expect(fam.find((s) => s.key === "Y")?.amount).toBe(13000);
    expect(fam.find((s) => s.key === "O")?.amount).toBe(8000);
  });

  it("types on the keypad: no leading zero, at most seven digits", () => {
    expect(typeDigit("", "0")).toBe("");
    expect(typeDigit("", "00")).toBe("");
    expect(typeDigit("5", "00")).toBe("500");
    expect(typeDigit("500", "⌫")).toBe("50");
    expect(typeDigit("1234567", "8")).toBe("1234567");
  });
});

describe("cash", () => {
  it("works out change and shortfall", () => {
    expect(changeDue(4000, 3200)).toBe(800);
    expect(changeDue(3000, 3200)).toBe(-200);
  });

  it("suggests the round notes a parent hands over", () => {
    expect(receivedSuggestions(3200)).toEqual([3300, 3500, 4000]);
    expect(receivedSuggestions(0)).toEqual([]);
  });

  it("counts notes", () => {
    let n = bumpNote({}, 500, 6);
    n = bumpNote(n, 200, 1);
    n = bumpNote(n, 200, -5);
    expect(notesTotal(n)).toBe(3000);
  });

  it("makes Cash + UPI one payment with two tender lines that add up", () => {
    expect(checkSplit(6000, 4000)).toEqual({ ok: true, cash: 4000, upi: 2000 });
    expect(checkSplit(6000, null).ok).toBe(false);
    expect(checkSplit(6000, 0)).toMatchObject({ ok: false, reason: "zero" });
    expect(checkSplit(6000, 6000)).toMatchObject({ ok: false, reason: "covers_all" });
    expect(ledgerTender("split", 6000, 4000)).toEqual({ paymentMode: null, tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 2000 }] });
    expect(ledgerTender("upi", 6000, null)).toEqual({ paymentMode: "upi", tenders: null });
    expect(ledgerTender("split", 6000, 7000)).toBeNull();
    expect(splitSuggestions(6000)).toEqual([1000, 2000, 3000, 5000]);
    expect(splitSuggestions(900)).toEqual([400, 500]);
  });

  it("spreads one family's cash and UPI over the children, each adding up", () => {
    const lines = tendersByChild([3000, 2000, 1000], { cash: 4000, upi: 2000 });
    expect(lines[0]).toEqual({ paymentMode: "cash", tenders: null });
    expect(lines[1]).toEqual({ paymentMode: null, tenders: [{ mode: "cash", amount: 1000 }, { mode: "upi", amount: 1000 }] });
    expect(lines[2]).toEqual({ paymentMode: "upi", tenders: null });
  });

  it("checks cheque details and dates", () => {
    expect(chequeReady({ number: "123456", bank: "SBI" })).toBe(true);
    expect(chequeReady({ number: "12345", bank: "SBI" })).toBe(false);
    expect(chequeDateIso("05/11/2026")).toBe("2026-11-05");
    expect(chequeDateIso("31/02/2026")).toBe("");
    expect(shapeChequeDate("05112026")).toBe("05/11/2026");
  });
});

describe("search", () => {
  const roll = [
    { id: "1", name: "Reyansh Kumawat", sr: "1012", classLabel: "8A", father: "Bhanwar Lal Kumawat", phone: "9000000063" },
    { id: "2", name: "Prisha Kumawat", sr: "1265", classLabel: "5A", father: "Bhanwar Lal Kumawat", phone: "9000000063" },
    { id: "3", name: "Ishita Choudhary", sr: "0702", classLabel: "12 Science", father: "Ramesh Choudhary", phone: "9000000031" },
    { id: "4", name: "आरव मेहता", sr: "1043", classLabel: "7B", father: "सुनील मेहता", phone: "9000000012" },
    { id: "5", name: "Navya Joshi", sr: "1401", classLabel: "LKG", father: "Sanjay Joshi", phone: "9000000134" },
  ];

  it("reads the shape of the query", () => {
    expect(queryShape("")).toEqual({ kind: "empty" });
    expect(queryShape("90000 00063")).toEqual({ kind: "phone", digits: "9000000063" });
    expect(queryShape("+91 9000000063").kind).toBe("phone");
    expect(queryShape("000063")).toEqual({ kind: "phonepart", digits: "000063" });
    expect(queryShape("0702")).toEqual({ kind: "sr", digits: "0702" });
    expect(queryShape("मेहता").kind).toBe("hindi");
    expect(queryShape("8a rey")).toMatchObject({ kind: "class", grade: "8", section: "a" });
    expect(queryShape("lkg")).toMatchObject({ kind: "class", grade: "lkg" });
    expect(queryShape("12 sci isita")).toMatchObject({ kind: "class", grade: "12", section: "sci" });
    expect(queryShape("kumawat")).toMatchObject({ kind: "name" });
  });

  it("matches spelling variants", () => {
    expect(spellingKey("Kumavat")).toBe(spellingKey("Kumawat"));
    expect(spellingKey("Choudhary")).toBe(spellingKey("Chaudhari"));
    expect(spellingKey("Saanvi")).toBe(spellingKey("Sanvi"));
    expect(searchLocal(roll, "kumavat").map((s) => s.id)).toEqual(["2", "1"]);
    expect(searchLocal(roll, "isita").map((s) => s.id)).toEqual(["3"]);
  });

  it("finds a family by the father's phone, an SR without its zeros, a class, and Hindi", () => {
    expect(searchLocal(roll, "9000000063").map((s) => s.id).sort()).toEqual(["1", "2"]);
    expect(isHouseholdSearch(queryShape("9000000063"), 2)).toBe(true);
    expect(searchLocal(roll, "702").map((s) => s.id)).toEqual(["3"]);
    expect(searchLocal(roll, "5a").map((s) => s.id)).toEqual(["2"]);
    expect(searchLocal(roll, "12 sci").map((s) => s.id)).toEqual(["3"]);
    expect(searchLocal(roll, "मेहता").map((s) => s.id)).toEqual(["4"]);
    expect(searchLocal(roll, "lkg").map((s) => s.id)).toEqual(["5"]);
  });

  it("ranks the child's own name above the father's", () => {
    expect(searchLocal(roll, "ramesh").map((s) => s.id)).toEqual(["3"]);
    expect(searchLocal(roll, "prisha")[0].id).toBe("2");
  });

  it("reads class labels", () => {
    expect(classParts("Class 7 B")).toEqual({ grade: "7", section: "b" });
    expect(classParts("11 Commerce")).toEqual({ grade: "11", section: "com" });
    expect(inClass("12 Science", { grade: "12", section: "sci" })).toBe(true);
    expect(inClass("12 Arts", { grade: "12", section: "sci" })).toBe(false);
  });

  it("sends Fees only what it can search, without the class prefix", () => {
    expect(bridgeQuery(queryShape(""), "")).toBeNull();
    expect(bridgeQuery(queryShape("a"), "a")).toBeNull();
    expect(bridgeQuery(queryShape("7"), "7")).toBeNull();
    expect(bridgeQuery(queryShape("0702"), "0702")).toBe("0702");
    expect(bridgeQuery(queryShape("8a rey"), "8a rey")).toBe("rey");
    expect(bridgeQuery(queryShape("8 a reyansh"), "8 a reyansh")).toBe("reyansh");
    expect(bridgeQuery(queryShape("9000000063"), "90000 00063")).toBe("9000000063");
    expect(bridgeQuery(queryShape("Kumawat"), " Kumawat ")).toBe("Kumawat");
  });
});

describe("amount in words", () => {
  it("writes English the Indian way", () => {
    expect(amountInWordsEn(0)).toBe("");
    expect(amountInWordsEn(6200)).toBe("Six thousand two hundred rupees only");
    expect(amountInWordsEn(115_021)).toBe("One lakh fifteen thousand twenty-one rupees only");
    expect(amountInWordsEn(20_000_000)).toBe("Two crore rupees only");
  });

  it("writes Hindi with each number's own word", () => {
    expect(amountInWordsHi(6200)).toBe("छह हज़ार दो सौ रुपये");
    expect(amountInWordsHi(4599)).toBe("चार हज़ार पाँच सौ निन्यानबे रुपये");
    expect(amountInWordsHi(150_000)).toBe("एक लाख पचास हज़ार रुपये");
  });
});

describe("paid on", () => {
  const rule = { today: TODAY, sessionStart: "2026-04-01" };

  it("offers the last seven days ending today", () => {
    expect(dateStrip(TODAY)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", TODAY]);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("refuses future days and days before the session", () => {
    expect(datePickable("2026-11-06", rule)).toBe(false);
    expect(datePickable("2026-03-31", rule)).toBe(false);
    expect(datePickable("2026-04-01", rule)).toBe(true);
    expect(datePickable("2026-02-30", rule)).toBe(false);
    expect(stepDate(TODAY, 1, rule)).toBe(TODAY);
    expect(stepDate(TODAY, -1, rule)).toBe("2026-11-04");
  });

  it("lays a month out in six weeks, Sunday first", () => {
    const grid = monthGrid("2026-11", rule);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toMatchObject({ date: "2026-11-01", day: 1 }); // 1 Nov 2026 is a Sunday
    expect(grid.find((c) => c?.date === "2026-11-06")?.pickable).toBe(false);
    expect(grid.find((c) => c?.date === TODAY)).toMatchObject({ today: true, pickable: true });
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthBounds("2026-11", rule)).toEqual({ prev: true, next: false });
    expect(monthBounds("2026-04", rule)).toEqual({ prev: false, next: true });
  });
});

describe("remarks", () => {
  it("writes the cheque's number as the reference and its bank in the remarks; nothing for UPI or bank", () => {
    expect(collectReference("cheque", { number: " 123456 " })).toBe("123456");
    expect(collectReference("upi", { number: "999" })).toBeNull();
    expect(collectReference("bank_transfer", { number: "" })).toBeNull();
    expect(collectRemarks({ mode: "cheque", cheque: { bank: "SBI", date: "01/11/2026" }, waiving: false, lateFee: 0, reason: "desk" })).toBe("Cheque: SBI, dated 2026-11-01; subject to clearing.");
    expect(collectRemarks({ mode: "upi", cheque: { bank: "", date: "" }, waiving: false, lateFee: 200, reason: "desk" })).toBeNull();
    expect(collectRemarks({ mode: "cash", cheque: { bank: "", date: "" }, waiving: true, lateFee: 200, reason: "hardship" })).toBe("Late fee waived: Hardship.");
    expect(nextReason("principal")).toBe("desk");
  });
});

describe("the saved attempt", () => {
  const post = (studentId: string, commandId: string): CollectPost => ({
    studentId, commandId, amount: 1000, paymentDate: TODAY, paymentMode: "cash", tenders: null, lateFeeWaiver: 0,
    reference: null, remarks: null, acknowledgeDailyDuplicate: false, acknowledgeNearDuplicate: false, quoteHash: "a".repeat(32),
  });
  const ids = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000a2"];
  const base: CollectAttempt = {
    version: 1, adapter: "bridge", sessionLabel: "2026-27", createdAt: "2026-11-05T05:00:00Z",
    posts: [{ post: post("s1", ids[0]), state: "pending", receipt: null, message: null }, { post: post("s2", ids[1]), state: "pending", receipt: null, message: null }],
    summary: { total: 2000, paymentDate: TODAY, tenderText: { hi: "नकद", en: "Cash" }, children: { s1: { name: "A", classLabel: "1A", sr: "1" }, s2: { name: "B", classLabel: "2A", sr: "2" } } },
  };
  const receipt = { receiptId: "r1", receiptNumber: "SVP-1", studentId: "s1", amount: 1000, paymentDate: TODAY, paymentMode: "cash", tenders: null, receivedBy: null, lateFeeWaived: 0, remaining: 0, printHref: "/receipts/SVP-1", printExternal: false };

  it("round-trips through storage and refuses what it cannot trust", () => {
    expect(parseAttempt(JSON.stringify(base), { adapter: "bridge", sessionLabel: "2026-27" })).toEqual(base);
    expect(parseAttempt(null, { adapter: "bridge", sessionLabel: "2026-27" })).toBeNull();
    expect(parseAttempt(JSON.stringify(base), { adapter: "local", sessionLabel: "2026-27" })).toBeNull();
    expect(() => parseAttempt("{oops", { adapter: "bridge", sessionLabel: "2026-27" })).toThrow();
    expect(() => parseAttempt(JSON.stringify({ ...base, version: 2 }), { adapter: "bridge", sessionLabel: "2026-27" })).toThrow();
    expect(attemptKey("bridge", "u1", "2026-27")).toBe("vppsone:collect-attempt:bridge:u1:2026-27");
  });

  it("after a partial failure keeps the saved child and retries only the rest, same id", () => {
    const one = settle(base, ids[0], { state: "saved", receipt });
    const two = settle(one, ids[1], { state: "refused", message: "no" });
    expect(savedReceipts(two).map((r) => r.receiptNumber)).toEqual(["SVP-1"]);
    expect(unsettled(two).map((p) => p.post.commandId)).toEqual([ids[1]]);
    expect(allSaved(two)).toBe(false);
    expect(allSaved(settle(two, ids[1], { state: "saved", receipt: { ...receipt, studentId: "s2" } }))).toBe(true);
  });

  it("checks every unsent post after a reload instead of sending it", () => {
    const back = recovered(settle(base, ids[0], { state: "saved", receipt }));
    expect(back.posts.map((p) => p.state)).toEqual(["saved", "uncertain"]);
    expect(nothingPosted(settle(settle(base, ids[0], { state: "refused" }), ids[1], { state: "refused" }))).toBe(true);
    expect(nothingPosted(settle(base, ids[0], { state: "refused" }))).toBe(false);
  });

  it("acknowledges a duplicate only by turning it on, with a fresh id when the body changes", () => {
    const fresh = "00000000-0000-4000-8000-0000000000ff";
    const acked = acknowledge(post("s1", ids[0]), { daily: true }, fresh);
    expect(acked).toMatchObject({ acknowledgeDailyDuplicate: true, commandId: fresh });
    expect(acknowledge(acked, { daily: false }, ids[1]).acknowledgeDailyDuplicate).toBe(true);
    expect(acknowledge(acked, {}, ids[1]).commandId).toBe(fresh);
  });
});
