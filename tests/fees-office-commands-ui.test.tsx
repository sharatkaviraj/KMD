// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Review F01: reversal and refund decisions through Fees, from One. Synthetic receipt and refund only. */
const actions = vi.hoisted(() => ({ reverse: vi.fn(), decide: vi.fn(), process: vi.fn(), check: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(app)/receipts/office-command-actions", () => ({
  reverseFeesReceiptAction: actions.reverse, decideFeesRefundAction: actions.decide, processFeesRefundAction: actions.process, checkFeesOfficeCommandAction: actions.check,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock("@/vx/i18n", () => ({ useVx: () => ({ tx: (p: { en: string }) => p.en }) }));

import { FeesRefundActions, ReverseReceiptButton } from "@/vx/screens/receipts/office-command";

const receiptId = "00000000-0000-4000-8000-0000000000a1";
const refundId = "00000000-0000-4000-8000-0000000000b1";
const done = (commandId: string) => ({ ok: true, data: { commandId, kind: "reversal", status: "completed", receiptId, receiptNumber: "SVP-1", studentId: refundId, sessionLabel: "2026-27", reversedAmount: 900, alreadyReversedAmount: 0, concessionAmount: 0, receiptReversed: true, reversedBy: "Office", completedAt: "2026-11-03T10:00:00Z" } });
let root: Root; let host: HTMLDivElement; let layer: HTMLDivElement;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find((b) => b.textContent?.startsWith(text))!;
async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function fillReversal(number = "svp-1") {
  await act(async () => button("Reverse receipt").click());
  await type(layer.querySelector("textarea")!, "Entered twice by mistake");
  await type(layer.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!, number);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const fn of Object.values(actions)) fn.mockReset();
  sessionStorage.clear();
  layer = document.createElement("div"); layer.id = "vx-layer"; document.body.append(layer);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); layer.remove(); vi.unstubAllGlobals(); });

describe("ReverseReceiptButton", () => {
  const render = () => act(async () => root.render(<ReverseReceiptButton receiptId={receiptId} receiptNumber="SVP-1" sessionLabel="2026-27" amount={900} />));

  it("needs a note and the typed number, keeps the command before sending, and shows what Fees did", async () => {
    actions.reverse.mockImplementation(async (payload: { commandId: string }) => {
      // Kept on the device before the request left.
      expect(JSON.parse(sessionStorage.getItem(`vppsone:fees-office:reversal:${receiptId}`)!).commandId).toBe(payload.commandId);
      return done(payload.commandId);
    });
    await render(); await fillReversal("wrong");
    expect(button("Reverse in Fees").disabled).toBe(true);
    await type(layer.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!, "svp-1");
    await act(async () => button("Reverse in Fees").click());
    expect(actions.reverse).toHaveBeenCalledWith(expect.objectContaining({ receiptId, sessionLabel: "2026-27", receiptNumber: "svp-1", reasonCode: "Wrong fee entry", reasonNote: "Entered twice by mistake" }));
    expect(layer.textContent).toContain("Reversed in Fees: ₹900 taken back.");
    expect(sessionStorage.getItem(`vppsone:fees-office:reversal:${receiptId}`)).toBeNull();
    expect(actions.refresh).toHaveBeenCalled();
  });

  it("after a lost answer, checks the same id and sends only that id again", async () => {
    actions.reverse.mockResolvedValueOnce({ ok: false, code: "unavailable", uncertain: true });
    await render(); await fillReversal();
    await act(async () => button("Reverse in Fees").click());
    const first = actions.reverse.mock.calls[0][0].commandId;
    expect(layer.textContent).toContain("It may have been saved");
    expect(button("Reverse in Fees").disabled).toBe(true);
    actions.check.mockResolvedValueOnce({ ok: true, data: { commandId: first, status: "not_found" } });
    await act(async () => button("Check what happened").click());
    expect(actions.check).toHaveBeenCalledWith(first);
    actions.reverse.mockResolvedValueOnce(done(first));
    await act(async () => button("Send the same request again").click());
    expect(actions.reverse.mock.calls[1][0].commandId).toBe(first);
    expect(layer.textContent).toContain("Reversed in Fees");
  });

  it("says why Fees refused and changes nothing", async () => {
    actions.reverse.mockResolvedValueOnce({ ok: false, code: "refund_in_progress", uncertain: false });
    await render(); await fillReversal();
    await act(async () => button("Reverse in Fees").click());
    expect(layer.querySelector('[role="alert"]')?.textContent).toContain("A refund is open on this receipt");
    expect(sessionStorage.getItem(`vppsone:fees-office:reversal:${receiptId}`)).toBeNull();
  });
});

describe("FeesRefundActions", () => {
  it("approves with the note and says so once Fees confirms", async () => {
    actions.decide.mockImplementation(async (_id: string, payload: { commandId: string }) => ({ ok: true, data: { commandId: payload.commandId, kind: "refund_decision", status: "completed", refundRequestId: refundId, refundStatus: "approved", amount: 400, receiptNumber: "SVP-1" } }));
    await act(async () => root.render(<FeesRefundActions refundId={refundId} kind="refund_approval" sessionLabel="2026-27" amount={400} />));
    await type(host.querySelector("input")!, "Fee charged twice");
    await act(async () => button("Approve").click());
    expect(actions.decide).toHaveBeenCalledWith(refundId, expect.objectContaining({ decision: "approve", note: "Fee charged twice", sessionLabel: "2026-27" }));
    expect(host.textContent).toContain("Approved in Fees.");
  });

  it("posts an approved refund only on the second tap", async () => {
    actions.process.mockImplementation(async (_id: string, payload: { commandId: string }) => ({ ok: true, data: { commandId: payload.commandId, kind: "refund_process", status: "completed", refundRequestId: refundId, refundStatus: "processed", amount: 400, reversedAmount: 400, receiptNumber: "SVP-1" } }));
    await act(async () => root.render(<FeesRefundActions refundId={refundId} kind="refund_processing" sessionLabel="2026-27" amount={400} />));
    await act(async () => button("Mark processed").click());
    expect(actions.process).not.toHaveBeenCalled();
    await act(async () => button("Tap again").click());
    expect(actions.process).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Refund posted in Fees: ₹400.");
  });
});
