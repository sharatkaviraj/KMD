// @vitest-environment jsdom
// Ported from the fees app (tests/ui/interaction/pay-checkout-panel.test.tsx).
// One change: the fees app drives it with @testing-library/react and
// user-event, which One does not install, so the same calls come from
// `tests/support/dom-testing-lite.tsx` (react-dom/client in jsdom). The body
// below is the fees original, except that a contact phone in two fixtures is
// a synthetic 99999 number (rule 6).
import { fireEvent, render, screen, waitFor, within } from "../../../support/dom-testing-lite";
import userEvent from "../../../support/dom-testing-lite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const startCheckoutAction = vi.fn();
const confirmCheckoutAction = vi.fn();

// One router for every render, as Next's own is: a fresh object each time
// would re-run every effect that depends on it.
const router = { push: vi.fn(), replace: vi.fn(), refresh, back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return { ...real, useRouter: () => router };
});
vi.mock("@/app/pay/[code]/checkout-actions", () => ({
  startCheckoutAction: (...args: unknown[]) => startCheckoutAction(...args),
  confirmCheckoutAction: (...args: unknown[]) => confirmCheckoutAction(...args),
}));

import { CheckoutPanel, type CheckoutChild } from "@/app/pay/[code]/checkout-panel";

type Options = Record<string, unknown> & { handler: (response: unknown) => Promise<void>; modal: { ondismiss: () => void } };
let lastOptions: Options | null = null;
let scrollTo: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  lastOptions = null;
  // Razorpay's checkout, as far as the panel can see it.
  (window as unknown as { Razorpay: unknown }).Razorpay = vi.fn(function (this: unknown, options: Options) {
    lastOptions = options;
    return { open: vi.fn(), on: vi.fn() };
  });
  startCheckoutAction.mockReset();
  confirmCheckoutAction.mockReset();
  refresh.mockReset();
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState({}, "", "/pay/CODE");
});
afterEach(() => {
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  vi.restoreAllMocks();
});

const aarti: CheckoutChild = {
  index: 0,
  firstName: "Aarti",
  classLabel: "Class 6",
  min: 100,
  max: 27150,
  choices: [
    { key: "due_so_far", amount: 18400, lateFee: 1000 },
    { key: "whole_year", amount: 27150, lateFee: 1000 },
  ],
};
const rahul: CheckoutChild = {
  index: 1,
  firstName: "Rahul",
  classLabel: "Class 3",
  min: 100,
  max: 9000,
  choices: [{ key: "whole_year", amount: 9000, lateFee: 0 }],
};

const payButton = () => screen.findByRole("button", { name: /का भुगतान करें/ });
// A Response body reads once: every poll gets its own.
const answers = (...states: unknown[]) => {
  const spy = vi.spyOn(global, "fetch");
  states.forEach((state, index) => {
    const reply = () => Promise.resolve(new Response(JSON.stringify(state)));
    if (index === states.length - 1) spy.mockImplementation(reply);
    else spy.mockImplementationOnce(reply);
  });
  return spy;
};

describe("choosing how much, on one screen", () => {
  it("opens on 'due so far', says its late fee out loud, and Pay sends that", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "ok", keyId: "rzp_live_x", orderId: "order_1", amountPaise: 1840000, contact: "+919999900001" });
    render(<CheckoutPanel code="CODE" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    expect(screen.getByRole("radio", { name: /अब तक का बकाया/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByText(/विलंब शुल्क ₹1,000 सहित/).length).toBeGreaterThan(0);
    await userEvent.click(await payButton());
    expect(startCheckoutAction).toHaveBeenCalledWith("CODE", [{ index: 0, amount_rupees: 18400 }]);
    expect(lastOptions).toMatchObject({ key: "rzp_live_x", order_id: "order_1", amount: 1840000, prefill: { contact: "+919999900001" }, theme: { color: "#06426F" } });
  });

  it("one tap on 'Whole year' changes what Pay says and sends", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "in_progress" });
    answers({ state: "waiting" });
    render(<CheckoutPanel code="CODE" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(screen.getByRole("radio", { name: /पूरे साल का बकाया/ }));
    expect((await payButton()).textContent).toContain("₹27,150");
    await userEvent.click(await payButton());
    expect(startCheckoutAction).toHaveBeenCalledWith("CODE", [{ index: 0, amount_rupees: 27150 }]);
  });

  it("'Other amount' checks the number where it is typed, before anything is sent", async () => {
    render(<CheckoutPanel code="CODE" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(screen.getByRole("radio", { name: /अपनी राशि लिखें/ }));
    const box = screen.getByRole("spinbutton");
    await userEvent.type(box, "50");
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText(/कम से कम ₹100/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /राशि भरें/ }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(box);
    await userEvent.type(box, "100");
    expect((await payButton()).textContent).toContain("₹100");
    expect(startCheckoutAction).not.toHaveBeenCalled();
  });

  it("several children: a row each, leave one out, change another in its sheet", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "in_progress" });
    answers({ state: "waiting" });
    render(<CheckoutPanel code="CODE" childLines={[aarti, rahul]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    expect((await payButton()).textContent).toContain("₹27,400");

    await userEvent.click(screen.getByRole("checkbox", { name: "Pay for Rahul" }));
    expect((await payButton()).textContent).toContain("₹18,400");

    await userEvent.click(screen.getAllByRole("button", { name: /बदलें/ })[0]);
    const sheet = screen.getByRole("dialog", { name: "Amount for Aarti" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /पूरे साल का बकाया/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: /ठीक है/ }));

    await userEvent.click(await payButton());
    expect(startCheckoutAction).toHaveBeenCalledWith("CODE", [{ index: 0, amount_rupees: 27150 }]);
  });

  it("says when an earlier payment is still being processed, and opens nothing", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "in_progress" });
    answers({ state: "confirming" });
    render(<CheckoutPanel code="CODE" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());
    expect((await screen.findAllByText(/पिछला भुगतान अभी प्रक्रिया में/)).length).toBeGreaterThan(0);
    expect(lastOptions).toBeNull();
  });
});

describe("the result takes over the whole screen", () => {
  it("after Razorpay's checkout, the green tick screen shows the receipt with no button to press", async () => {
    startCheckoutAction.mockResolvedValue({ kind: "ok", keyId: "rzp_live_x", orderId: "order_1", amountPaise: 1840000, contact: null });
    confirmCheckoutAction.mockResolvedValue({ state: "received", receipts: [{ receiptNumber: "SVP20261030-0001", amount: 18400 }] });
    render(<CheckoutPanel code="CODE" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());
    await lastOptions!.handler({ razorpay_payment_id: "pay_1", razorpay_order_id: "order_1", razorpay_signature: "sig" });
    const success = await screen.findByRole("dialog", { name: "Payment received" });
    expect(within(success).getByText(/SVP20261030-0001/)).toBeTruthy();
    expect(within(success).getAllByText(/₹18,400 मिल गए/).length).toBeGreaterThan(0);
    expect(confirmCheckoutAction).toHaveBeenCalledWith("CODE", "order_1", "pay_1", "sig");
    expect(refresh).toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("a page reopened after paying opens straight on the green tick screen", async () => {
    render(
      <CheckoutPanel
        code="CODE"
        childLines={[aarti]}
        orderMaxRupees={100000}
        initialStatus={{ state: "received", receipts: [{ receiptNumber: "SVP20261030-0001", amount: 100 }] }}
      />,
    );
    const success = screen.getByRole("dialog", { name: "Payment received" });
    expect(within(success).getByText(/अब बाकी ₹27,150/)).toBeTruthy();
  });
});

describe("paying through a UPI Payment Link", () => {
  const upiUri = "upi://pay?pa=vpps.rzp@icici&pn=VPPS&tr=TxnRef123&am=18400.00&cu=INR";
  const upiStart = { kind: "upi", amountPaise: 1840000, upiUri, shortUrl: "https://rzp.io/rzp/abc" };
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129 Mobile Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
  const asPhone = (userAgent: string) => vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(userAgent);

  beforeEach(() => {
    // Nothing on this path may depend on Razorpay's checkout script.
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  });

  it("never loads Razorpay's checkout; Pay shows the app tiles, the last-used app first", async () => {
    asPhone(ANDROID);
    localStorage.setItem("vpps-pay-last-app", "paytm");
    startCheckoutAction.mockResolvedValue(upiStart);
    answers({ state: "waiting" });
    render(<CheckoutPanel code="CODE" payWith="upi" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());

    expect(document.querySelector('script[src*="checkout.razorpay.com"]')).toBeNull();
    const picker = await screen.findByRole("dialog", { name: "Choose your UPI app" });
    const tiles = within(picker).getAllByRole("link");
    expect(tiles[0].textContent).toContain("Paytm");
    expect(tiles[0].textContent).toContain("पिछली बार");
    const phonePe = within(picker).getByRole("link", { name: /^PhonePe/ });
    expect(phonePe.getAttribute("href")).toMatch(/^intent:\/\/pay\?.*package=com\.phonepe\.app/);
    expect(phonePe.getAttribute("href")).toContain(encodeURIComponent("/pay/CODE?notice=app_missing"));
    expect(within(picker).getByRole("link", { name: /कोई और UPI ऐप/ }).getAttribute("href")).toBe(upiUri);
  });

  it("on an iPhone sends the parent on to Razorpay's own page instead", async () => {
    asPhone(IPHONE);
    startCheckoutAction.mockResolvedValue(upiStart);
    answers({ state: "waiting" });
    render(<CheckoutPanel code="CODE" payWith="upi" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());
    const onward = await screen.findByRole("link", { name: /आगे बढ़ें/ });
    expect(onward.getAttribute("href")).toBe("https://rzp.io/rzp/abc");
    expect(screen.queryByRole("link", { name: /^PhonePe/ })).toBeNull();
  });

  it("a tapped app shows the three steps; coming back checks by itself and lands on the green tick", async () => {
    asPhone(ANDROID);
    startCheckoutAction.mockResolvedValue(upiStart);
    answers({ state: "waiting" }, { state: "received", receipts: [{ receiptNumber: "SVP20261030-0002", amount: 18400 }] });
    render(<CheckoutPanel code="CODE" payWith="upi" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());
    fireEvent.click(await screen.findByRole("link", { name: /^PhonePe/ }));

    const waiting = await screen.findByRole("dialog", { name: "Complete the payment in the app" });
    expect(within(waiting).getAllByRole("listitem")).toHaveLength(3);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    const success = await screen.findByRole("dialog", { name: "Payment received" });
    expect(within(success).getByText(/SVP20261030-0002/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /I have paid/i })).toBeNull();
  });

  it("a payment the app declined says no money was taken, and Try again starts over", async () => {
    asPhone(ANDROID);
    startCheckoutAction.mockResolvedValue(upiStart);
    answers({ state: "waiting" }, { state: "failed" });
    render(<CheckoutPanel code="CODE" payWith="upi" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "none" }} />);
    await userEvent.click(await payButton());
    fireEvent.click(await screen.findByRole("link", { name: /^PhonePe/ }));

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    const notPaid = await screen.findByRole("dialog", { name: "Payment not completed" });
    expect(within(notPaid).getAllByText(/कोई पैसा नहीं कटा/).length).toBeGreaterThan(0);
    await userEvent.click(within(notPaid).getByRole("button", { name: /फिर से कोशिश करें/ }));
    expect(await payButton()).toBeTruthy();
  });

  it("brings a parent whose app is not installed back to the same tiles, not a second link", async () => {
    asPhone(ANDROID);
    sessionStorage.setItem("vpps-pay-link:CODE", JSON.stringify({ amountPaise: 1840000, upiUri, shortUrl: "https://rzp.io/rzp/abc", at: Date.now() }));
    window.history.replaceState({}, "", "/pay/CODE?notice=app_missing");
    answers({ state: "waiting" });
    render(<CheckoutPanel code="CODE" payWith="upi" childLines={[aarti]} orderMaxRupees={100000} initialStatus={{ state: "waiting" }} />);
    const picker = await screen.findByRole("dialog", { name: "Choose your UPI app" });
    expect(within(picker).getAllByText(/इस फ़ोन पर नहीं है/).length).toBeGreaterThan(0);
    expect(startCheckoutAction).not.toHaveBeenCalled();
  });
});
