"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CheckoutStatus } from "@/modules/payments/data/online/orders";
import { validateLineAmounts } from "@/modules/payments/domain/online/pay-breakdown";
import { PAY_COPY, type Bilingual } from "@/modules/payments/domain/online/pay-page-copy";
import { isAndroidUserAgent } from "@/modules/payments/domain/online/upi-launch";
import { formatInr } from "@/platform/helpers/currency";

import { AmountChoices, defaultSelection, errorCopy, selectedAmount, type CheckoutChild, type Selection } from "./amount-choices";
import { AppPicker, type UpiLink } from "./app-picker";
import { confirmCheckoutAction, startCheckoutAction } from "./checkout-actions";
import { PayBar } from "./pay-bar";
import { BRAND, Both } from "./pay-ui";
import { NotPaidScreen, SuccessScreen } from "./result-screens";
import { WaitingScreen } from "./waiting-screen";

export type { CheckoutChild } from "./amount-choices";

/**
 * The only script the one-tap pay page ships: the amount cards, the Pay bar,
 * the payment step, and the wait for the result — one screen at a time.
 *
 *   choose → (pick_app → waiting) | paying → received | failed
 *
 * The payment step is one of two (`payWith`, set by the school):
 *
 *   checkout  Razorpay's checkout, opened on this page.
 *   upi       the UPI app tiles for a UPI Payment Link. WhatsApp's browser
 *             will not follow Razorpay's redirect to `upi://`, but it does
 *             open one the parent TAPS — so the tap on Pay opens the link,
 *             and the app tile is the second, deliberate tap.
 *
 * Every way a result arrives is handled without a button for the parent to
 * press: the checkout handler, a dismissed checkout, the page coming back to
 * the foreground after the UPI app, and a page reopened after WhatsApp killed
 * it on the way. Each asks the server, which asks Razorpay; nothing here
 * decides that money was received.
 *
 * Kept free of Radix and next-intl on purpose: the shared chunk is at its
 * ceiling, and this page has to open fast on a phone inside WhatsApp.
 */

type RazorpayHandlerResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayInstance = { open: () => void; on: (event: string, handler: (response: unknown) => void) => void };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type Phase = "choose" | "opening" | "paying" | "pick_app" | "waiting" | "received" | "failed";
type Notice = Bilingual | null;

/**
 * The app step, kept for the tab: an app that is not installed sends Android
 * back to this page, and the parent should land on the same tiles, not on a
 * fresh Pay that would open a second link. Any storage failure just means Pay
 * again.
 */
const LINK_KEY = (code: string) => `vpps-pay-link:${code}`;
const LINK_KEPT_MS = 30 * 60_000;

function keepLink(code: string, link: UpiLink | null) {
  try {
    if (link) sessionStorage.setItem(LINK_KEY(code), JSON.stringify({ ...link, at: Date.now() }));
    else sessionStorage.removeItem(LINK_KEY(code));
  } catch {
    // Private mode or storage off: nothing to keep.
  }
}

function keptLink(code: string): UpiLink | null {
  try {
    const kept = JSON.parse(sessionStorage.getItem(LINK_KEY(code)) ?? "null") as (UpiLink & { at: number }) | null;
    return kept && Date.now() - kept.at < LINK_KEPT_MS ? kept : null;
  } catch {
    return null;
  }
}

function toTop() {
  try {
    window.scrollTo(0, 0);
  } catch {
    // Not every browser lets a page scroll itself; the screens are fixed anyway.
  }
}

export function CheckoutPanel({
  code,
  payWith = "checkout",
  childLines: children,
  orderMaxRupees,
  initialStatus,
}: {
  code: string;
  payWith?: "checkout" | "upi";
  childLines: CheckoutChild[];
  orderMaxRupees: number;
  initialStatus: CheckoutStatus;
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<number, Selection>>(() =>
    Object.fromEntries(children.map((child) => [child.index, defaultSelection(child)])),
  );
  const [phase, setPhase] = useState<Phase>(
    initialStatus.state === "received" ? "received" : initialStatus.state === "confirming" ? "waiting" : "choose",
  );
  const [receipts, setReceipts] = useState(initialStatus.state === "received" ? initialStatus.receipts : []);
  const [checking, setChecking] = useState(initialStatus.state === "confirming");
  const [slow, setSlow] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<UpiLink | null>(null);
  const [android, setAndroid] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const pollUntil = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  phaseRef.current = phase;

  const amounts = Object.fromEntries(
    children.map((child) => [child.index, selectedAmount(child, selections[child.index] ?? defaultSelection(child))]),
  ) as Record<number, number | null>;
  const validation = validateLineAmounts(
    children.map((child) => ({ index: child.index, whole_session: child.max })),
    amounts,
    orderMaxRupees,
  );
  const owing = children.filter((child) => child.max > 0);
  const nowDue = children.reduce((sum, child) => sum + Math.max(0, child.max), 0);

  const settle = useCallback(
    (status: CheckoutStatus) => {
      if (status.state === "received") {
        if (phaseRef.current !== "received") {
          setCelebrate(true);
          try {
            navigator.vibrate?.(120);
          } catch {
            // No vibration on this phone: the screen says it all.
          }
        }
        setPhase("received");
        setReceipts(status.receipts);
        setNotice(null);
        setLink(null);
        keepLink(code, null);
        pollUntil.current = 0;
        // The breakdown behind this screen is server-rendered: re-read it with the payment in.
        router.refresh();
        return true;
      }
      if (status.state === "failed" && (phaseRef.current === "waiting" || phaseRef.current === "pick_app")) {
        setPhase("failed");
        setLink(null);
        keepLink(code, null);
        pollUntil.current = 0;
        return true;
      }
      if (status.state === "confirming") setChecking(true);
      return false;
    },
    [code, router],
  );

  const poll = useCallback(async () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    try {
      const response = await fetch(`/pay/${encodeURIComponent(code)}/status`, { method: "POST", cache: "no-store" });
      const status = (await response.json()) as CheckoutStatus;
      if (settle(status)) return;
    } catch {
      // A missed poll is retried below; nothing to tell the parent.
    }
    if (Date.now() < pollUntil.current) pollTimer.current = setTimeout(() => void poll(), 4000);
  }, [code, settle]);

  const keepPolling = useCallback(
    (forMs: number) => {
      pollUntil.current = Math.max(pollUntil.current, Date.now() + forMs);
      void poll();
    },
    [poll],
  );

  useEffect(() => {
    if (payWith === "upi" || window.Razorpay) {
      // A UPI link needs no script on this page at all.
      setReady(true);
    } else {
      const script = document.createElement("script");
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => setReady(true);
      document.body.appendChild(script);
    }
  }, [payWith]);

  // Once per page: which phone this is, and the app step it may be coming back to.
  useEffect(() => {
    setAndroid(isAndroidUserAgent(navigator.userAgent));
    setPageUrl(`${window.location.origin}${window.location.pathname}`);
    if (payWith !== "upi") return;
    const kept = initialStatus.state === "waiting" ? keptLink(code) : null;
    if (kept) {
      setLink(kept);
      setPhase("pick_app");
    }
    if (new URLSearchParams(window.location.search).get("notice") === "app_missing") setNotice(PAY_COPY.appMissing);
  }, [code, initialStatus.state, payWith]);

  useEffect(() => {
    // Reopened after WhatsApp dropped the page mid-payment: look straight away.
    if (initialStatus.state === "waiting" || initialStatus.state === "confirming") keepPolling(3 * 60_000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // Back from the UPI app: say so, and look now.
      if (phaseRef.current === "waiting") setChecking(true);
      if (pollUntil.current > Date.now()) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [initialStatus.state, keepPolling, poll]);

  // Every new screen starts at its top.
  useEffect(() => {
    toTop();
  }, [phase]);

  // Waiting a long while: reassure, and say not to pay twice.
  useEffect(() => {
    if (phase !== "waiting") return;
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 120_000);
    return () => clearTimeout(timer);
  }, [phase]);

  function select(index: number, next: Selection) {
    setNotice(null);
    setSelections((current) => ({ ...current, [index]: next }));
  }

  function backToChoose() {
    setLink(null);
    keepLink(code, null);
    setNotice(null);
    setChecking(false);
    setPhase("choose");
  }

  async function pay() {
    if (!validation.ok || (payWith === "checkout" && !window.Razorpay)) return;
    setNotice(null);
    setPhase("opening");
    const started = await startCheckoutAction(code, validation.lines);
    if (started.kind === "upi") {
      const opened = { amountPaise: started.amountPaise, upiUri: started.upiUri, shortUrl: started.shortUrl };
      setLink(opened);
      keepLink(code, opened);
      setChecking(false);
      setPhase("pick_app");
      // The UPI app takes the page to the background; coming back asks again.
      keepPolling(10 * 60_000);
      return;
    }
    if (started.kind !== "ok") {
      setPhase("choose");
      if (started.kind === "already_paid") return keepPolling(60_000);
      if (started.kind === "in_progress") {
        setNotice(PAY_COPY.inProgress);
        return keepPolling(3 * 60_000);
      }
      if (started.kind === "refused" && started.reason === "amount_out_of_range") return setNotice(PAY_COPY.amountChanged);
      if (started.kind === "try_again") return setNotice(PAY_COPY.busy);
      return setNotice(started.kind === "unavailable" ? PAY_COPY.unavailable : PAY_COPY.failed);
    }
    if (!window.Razorpay) {
      setPhase("choose");
      return setNotice(PAY_COPY.failed);
    }

    const checkout = new window.Razorpay({
      key: started.keyId,
      order_id: started.orderId,
      amount: started.amountPaise,
      currency: "INR",
      name: "VPPS",
      description: PAY_COPY.title.en,
      prefill: started.contact ? { contact: started.contact } : {},
      readonly: { contact: true },
      hidden: { contact: true },
      theme: { color: BRAND },
      timeout: 900,
      config: {
        display: {
          blocks: { upi: { name: "UPI", instruments: [{ method: "upi" }] } },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: true },
        },
      },
      modal: {
        confirm_close: true,
        ondismiss: () => {
          setPhase((current) => (current === "paying" ? "choose" : current));
          setNotice(PAY_COPY.dismissed);
          // Closed by hand, or the UPI app answered after the sheet shut: keep
          // looking quietly for two minutes.
          keepPolling(2 * 60_000);
        },
      },
      handler: async (response: RazorpayHandlerResponse) => {
        setPhase("waiting");
        setChecking(true);
        const status = await confirmCheckoutAction(
          code,
          response.razorpay_order_id,
          response.razorpay_payment_id,
          response.razorpay_signature,
        );
        if (!settle(status)) keepPolling(3 * 60_000);
      },
    });
    checkout.on("payment.failed", () => setNotice(PAY_COPY.failed));
    setPhase("paying");
    checkout.open();
  }

  if (phase === "received") {
    return (
      <SuccessScreen
        receipts={receipts}
        nowDue={nowDue}
        animate={celebrate}
        onPayMore={() => {
          setCelebrate(false);
          backToChoose();
        }}
      />
    );
  }
  if (phase === "failed") return <NotPaidScreen onRetry={backToChoose} />;
  if (phase === "pick_app" && link) {
    return (
      <AppPicker
        link={link}
        android={android}
        pageUrl={pageUrl}
        notice={notice}
        onAppTapped={() => {
          setNotice(null);
          setChecking(false);
          setPhase("waiting");
        }}
        onBack={backToChoose}
      />
    );
  }
  if (phase === "waiting") {
    return (
      <WaitingScreen
        amount={formatInr((link?.amountPaise ?? validation.total * 100) / 100)}
        checking={checking}
        slow={slow}
        onOtherApp={() => {
          if (link) {
            setChecking(false);
            setPhase("pick_app");
          } else backToChoose();
        }}
      />
    );
  }

  const busy = phase === "opening" || phase === "paying";
  const single = children.length === 1;
  const sheetChild = sheetFor === null ? null : (children.find((child) => child.index === sheetFor) ?? null);

  return (
    <section className="flex flex-col gap-3">
      {single ? (
        <AmountChoices
          child={children[0]}
          selection={selections[children[0].index] ?? defaultSelection(children[0])}
          error={validation.errors[children[0].index]}
          disabled={busy}
          onChange={(next) => select(children[0].index, next)}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {children.map((child) => {
            const selection = selections[child.index] ?? defaultSelection(child);
            const amount = amounts[child.index];
            const included = selection.kind !== "skip";
            const error = validation.errors[child.index];
            return (
              <li key={child.index} className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-2">
                <input
                  type="checkbox"
                  checked={included}
                  disabled={busy || child.max <= 0}
                  aria-label={PAY_COPY.include(child.firstName).en}
                  onChange={(event) => select(child.index, event.target.checked ? defaultSelection(child) : { ...selection, kind: "skip" })}
                  className="h-6 w-6 shrink-0 accent-sky-800"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-foreground">{child.firstName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {child.classLabel}
                    {error ? <span className="font-semibold text-red-700"> · {errorCopy(error, child.min, child.max).hi}</span> : null}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-bold tabular-nums text-foreground">
                    {child.max <= 0 ? "✓" : included && amount ? formatInr(amount) : PAY_COPY.notPayingNow.hi}
                  </span>
                  {child.max > 0 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setSheetFor(child.index)}
                      className="focus-ring text-sm font-semibold underline underline-offset-4"
                      style={{ color: BRAND }}
                    >
                      ✏️ {PAY_COPY.change.hi}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {notice ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Both text={notice} />
        </div>
      ) : null}

      {sheetChild ? (
        <div role="dialog" aria-modal="true" aria-label={PAY_COPY.amountFor(sheetChild.firstName).en} className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40">
          <div className="mx-auto w-full max-w-md rounded-t-2xl bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Both text={PAY_COPY.amountFor(sheetChild.firstName)} className="mb-3 text-lg font-bold text-foreground" />
            <AmountChoices
              child={sheetChild}
              selection={selections[sheetChild.index] ?? defaultSelection(sheetChild)}
              error={validation.errors[sheetChild.index]}
              onChange={(next) => select(sheetChild.index, next)}
            />
            <button
              type="button"
              onClick={() => setSheetFor(null)}
              className="focus-ring mt-4 flex min-h-[56px] w-full items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: BRAND }}
            >
              <Both text={PAY_COPY.done} />
            </button>
          </div>
        </div>
      ) : null}

      {owing.length > 0 ? (
        <PayBar
          total={validation.total}
          ok={validation.ok}
          opening={phase === "opening"}
          disabled={!ready || busy}
          upiOnly={payWith === "upi"}
          onPay={() => void pay()}
        />
      ) : null}
    </section>
  );
}
