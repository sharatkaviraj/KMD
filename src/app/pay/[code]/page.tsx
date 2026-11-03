import type { Metadata } from "next";
import { headers } from "next/headers";
import { after } from "next/server";
import type { ReactNode } from "react";
import QRCode from "qrcode";

import { schoolProfile } from "@/platform/config/school";
import { formatInr } from "@/platform/helpers/currency";
import { formatMediumDate } from "@/platform/helpers/date";
import { buildStudentFeeUpiPayment } from "@/modules/payments/domain/upi";
import { buildOpenSchoolUpiPayment } from "@/modules/payments/domain/upi-open";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { isMissingColumn } from "@/platform/supabase/missing-column";
import { afterOnlinePosting } from "@/modules/payments/data/online/after-posting";
import { readCheckoutStatus, readPayPage } from "@/modules/payments/data/online/orders";
import { createRazorpayClient, readRazorpayConfig } from "@/modules/payments/data/online/razorpay-client";
import {
  processProviderPayment,
  quoteScope,
  readCheckoutOptions,
  readOnlineSwitches,
  readUpiOnlyLinks,
} from "@/modules/payments/data/online/service";
import { checkoutAudienceAllows, onlineOfferRefusal, readPayScope } from "@/modules/payments/domain/online/pay-scope";
import {
  UPI_APPS,
  chromeIntentUrl,
  readRazorpayUpiUri,
  upiAppIntentUrl,
} from "@/modules/payments/domain/online/upi-launch";
import { createAbsoluteUrl, getSiteUrl } from "@/platform/env";

import { Notice } from "@/ui/primitives/notice";
import { PendingSubmitButton } from "@/ui/shell/pending-submit-button";

import { startOnlinePaymentAction } from "./actions";
import { loadCheckoutSend } from "./checkout-send";
import { CheckoutView } from "./checkout-view";
import { sendIsFeesApps } from "./cutover-line";
import { isPayCodeShaped } from "./pay-code";
import { originFromHeaders } from "./request-origin";

/**
 * The pay link a parent taps from a WhatsApp reminder.
 *
 * The approved bodies already carry a raw `upi://` link, which works when a
 * phone recognises it and does nothing at all when it does not. WhatsApp will
 * not accept `upi://` as a template BUTTON, and a button is what gets tapped —
 * so the v3 templates point at `https://<site>/pay/{{code}}` and this page
 * builds the intent.
 *
 * **This is a payment link, not a portal.** It shows an amount, a reference and
 * a date, and nothing else. No name, no class, no admission number, no balance
 * history — deliberately stricter than `/r/[code]`, which at least confirms a
 * receipt exists. Anyone who guesses a code learns that somebody owes some money,
 * which is not information about anybody.
 *
 * The code is opaque, random and per-send, so it cannot be computed from an
 * admission number and used to enumerate what every family owes.
 *
 * Unauthenticated by design, and declared in the scan's `PUBLIC_BY_DESIGN` with
 * that reason. Uses the service-role client because the visitor has no session;
 * the query is a single indexed point lookup on `pay_code`.
 */

export const metadata: Metadata = {
  title: "Pay school fees",
  robots: { index: false, follow: false },
  // The one-tap page shows a child's first name and fees: never leak the
  // pay-code URL to Razorpay or anyone else through the Referer header.
  referrer: "no-referrer",
};

/**
 * The one-tap checkout view, when switched on and this link qualifies: one to
 * four children, a notice that may take money online, under 21 days old.
 * Null keeps every other path on the page exactly as it was.
 */
async function resolveCheckoutView(code: string) {
  if (!readRazorpayConfig()) return null;
  const send = await loadCheckoutSend(code);
  if (!send) return null;
  try {
    const supabase = createAdminClient();
    const options = await readCheckoutOptions(supabase);
    // While it is a pilot, a family outside it keeps the page as it was.
    if (!checkoutAudienceAllows(send.sessionLabel, options.allSessions)) return null;
    const data = await readPayPage(supabase, send.id);
    if (!data || !data.checkout_enabled) return null;
    return {
      data,
      status: await readCheckoutStatus(supabase, send.id),
      payWith: options.razorpayCheckout ? ("checkout" as const) : ("upi" as const),
      waiveLateFees: options.waiveLateFees,
    };
  } catch {
    return null;
  }
}

/** Never cached: the link expires, and a cached page would outlive it. */
export const revalidate = 0;

type PayPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type PayResult =
  | { state: "invalid" }
  | { state: "expired"; expiredOn: string }
  | {
      state: "ready";
      amount: number;
      reference: string;
      expiresOn: string | null;
      sendId: string;
      payScope: unknown;
    };

async function resolvePayCode(rawCode: string): Promise<PayResult> {
  const code = decodeURIComponent(rawCode).trim();

  // Reject anything that is not code-shaped before touching the database. This
  // is the whole rate-limiting story: the codes are 160 bits of randomness in a
  // unique index, so guessing is not a thing that can be done, and a malformed
  // request never reaches Postgres.
  if (!isPayCodeShaped(code)) {
    return { state: "invalid" };
  }

  try {
    const supabase = createAdminClient();
    type SendRow = {
      id: string;
      due_amount: number | null;
      pay_code_expires_on: string | null;
      pay_scope?: unknown;
      created_at: string | null;
      session_label: string | null;
      students: { admission_no?: string } | null;
    };
    const lookup = async (columns: string) => {
      const result = await supabase
        .from("whatsapp_reminder_sends")
        .select(columns)
        .eq("pay_code", code)
        .maybeSingle();
      return { data: result.data as unknown as SendRow | null, error: result.error };
    };
    let { data, error } = await lookup(
      "id, due_amount, pay_code_expires_on, pay_scope, created_at, session_label, students(admission_no)",
    );
    // Before `20261028140100` there is no `pay_scope`; the page is then the UPI
    // page it always was, never a dead link.
    if (isMissingColumn(error, "pay_scope")) {
      ({ data, error } = await lookup("id, due_amount, pay_code_expires_on, created_at, session_label, students(admission_no)"));
    }

    if (error || !data) return { state: "invalid" };
    // One only: a code the fees app minted is shown as a link with no amount —
    // the open UPI page, never an online payment or the message's old figure
    // (`cutover-line.ts`; critique0 #11).
    if (await sendIsFeesApps(data)) return { state: "invalid" };

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const expiresOn = data.pay_code_expires_on ? String(data.pay_code_expires_on) : null;
    // The amount is what was owed when the message went out. A parent paying
    // from a three-week-old link would pay the wrong figure, so the link stops
    // rather than quietly misleading them.
    if (expiresOn && expiresOn < today) {
      return { state: "expired", expiredOn: expiresOn };
    }

    const admissionNo = String(data.students?.admission_no ?? "");

    return {
      state: "ready",
      amount: Number(data.due_amount ?? 0),
      // The admission number goes into the UPI note so the office can match the
      // payment, and is NOT rendered on the page — the payer already knows it,
      // and a visitor who guessed the code must not learn it.
      reference: admissionNo,
      expiresOn,
      sendId: String(data.id),
      payScope: data.pay_scope ?? null,
    };
  } catch {
    return { state: "invalid" };
  }
}

export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { code } = await params;
  const resolvedSearchParams = await searchParams;
  const result = await resolvePayCode(code);
  // The one-tap checkout comes first. A notice whose own date has passed still
  // opens it inside its 21 days: the figures are read live, never the message's.
  const checkout = result.state !== "invalid" ? await resolveCheckoutView(code) : null;
  // Online payment, when switched on and this link qualifies. Null means the
  // page is exactly what it was before online payments existed.
  const online =
    !checkout && result.state === "ready"
      ? await resolveOnlineOffer({
          sendId: result.sendId,
          payScope: result.payScope,
          returned: resolvedSearchParams.returned === "1",
          open: resolvedSearchParams.step === "open",
          check: resolvedSearchParams.check === "1",
        })
      : null;
  // NEXT_PUBLIC_SCHOOL_PHONE is optional; with none set, no half-sentence.
  const officeLine = schoolProfile.phone
    ? ` For the current figure, call the office on ${schoolProfile.phone}.`
    : null;

  return (
    // dvh, never the static viewport unit: on a phone browser with a chrome
    // bar the static unit is taller than what is actually visible, and the pay
    // button ends up underneath it.
    <main
      className={
        // The one-tap view carries its own one-line header and keeps its Pay
        // bar pinned to the bottom of the screen: start at the top, and leave
        // room under the last line for that bar.
        checkout
          ? "mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 px-4 pb-40 pt-3"
          : "mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10"
      }
    >
      {!checkout ? (
        <header className="text-center">
          <h1 className="text-lg font-bold text-foreground">{schoolProfile.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">School fee payment</p>
        </header>
      ) : null}

      {/* A link that cannot name an amount still pays the school. A dead end
          here was what a parent saw from a mistyped or old link — and what the
          office saw from every test send, which has no fee row behind it. */}
      {result.state === "invalid" ? (
        <OpenPayPanel
          title="Pay school fees by UPI"
          note={
            <>
              This link does not carry an amount. Enter the amount from your WhatsApp message.
              {officeLine}
            </>
          }
        />
      ) : null}

      {checkout ? (
        <CheckoutView
          data={checkout.data}
          code={decodeURIComponent(code).trim()}
          status={checkout.status}
          payWith={checkout.payWith}
          waiveLateFees={checkout.waiveLateFees}
        />
      ) : null}

      {!checkout && result.state === "expired" ? (
        <OpenPayPanel
          title="This link has expired"
          note={
            <>
              It was valid until {formatMediumDate(result.expiredOn)}, and the amount may have
              changed since. You can still pay by UPI below.
              {officeLine}
            </>
          }
        />
      ) : null}

      {result.state === "ready" && online ? (
        <OnlinePanel
          offer={online}
          code={decodeURIComponent(code).trim()}
          notice={typeof resolvedSearchParams.notice === "string" ? resolvedSearchParams.notice : null}
          officeLine={officeLine}
        />
      ) : null}

      {!checkout && result.state === "ready" && !online ? <PayPanel result={result} /> : null}

      {!checkout ? (
        <p className="text-center text-xs text-muted-foreground">
          This page shows only an amount and a payment reference. It carries no student details.
        </p>
      ) : null}
    </main>
  );
}

/**
 * The school's UPI QR for THIS payment — the same account as the QR printed at
 * the fee counter (HDFC, `shriveerpattassecsch.68347408@hdfcbank`, decoded and
 * checked against `SCHOOL_UPI_PAYMENT_CONFIG` on 2026-10-26), but carrying the
 * amount and the admission-number reference, so the parent cannot pay the
 * wrong figure and the office can match the payment.
 *
 * Drawn on the server, so the page ships no QR library to a parent's phone.
 * Null when it cannot be drawn: the button and the UPI ID below still work.
 */
async function paymentQr(uri: string): Promise<{ svg: string; png: string } | null> {
  try {
    const [svg, png] = await Promise.all([
      QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 }),
      QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 720 }),
    ]);
    return { svg: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, png };
  } catch {
    return null;
  }
}

async function PayPanel({ result }: { result: Extract<PayResult, { state: "ready" }> }) {
  const payment = buildStudentFeeUpiPayment({
    amount: result.amount,
    admissionNo: result.reference,
  });
  const qr = await paymentQr(payment.uri);

  return (
    // flex gap, never space-y: the expiry line is conditional.
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount due</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
          {formatInr(payment.amount)}
        </p>
      </div>

      {/* h-14 and full width: this is the only thing on the page anybody came to
          do, and it is being tapped on a phone one-handed. */}
      <a
        href={payment.uri}
        className="focus-ring flex h-14 w-full items-center justify-center rounded-xl bg-accent text-base font-bold text-accent-foreground"
      >
        Open UPI app to pay
      </a>

      {qr ? (
        <UpiQr
          qr={qr}
          alt={`UPI QR code to pay ${formatInr(payment.amount)} to ${payment.payeeName}`}
          caption={`${payment.payeeName} · amount filled in`}
        />
      ) : null}

      {/* The VPA as selectable text, because the button does nothing on a phone
          with no UPI app registered to the scheme — and a parent can still type
          this into the app they do have. */}
      <div className="rounded-lg border border-border bg-surface-2 p-3 text-center">
        <p className="text-xs text-muted-foreground">Or pay this UPI ID by hand</p>
        <p className="mt-1 select-all break-all font-mono text-sm font-semibold text-foreground">
          {payment.vpa}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Reference:{" "}
          <span className="select-all font-mono font-semibold text-foreground">
            {payment.displayReference}
          </span>
        </p>
      </div>

      {result.expiresOn ? (
        <p className="text-center text-xs text-muted-foreground">
          Valid until {formatMediumDate(result.expiresOn)}.
        </p>
      ) : null}
    </section>
  );
}

/**
 * The same school account with no amount filled in, for a link that cannot say
 * how much. The parent types the figure; the UPI note asks for the student's
 * name, because there is no admission number to put there.
 */
async function OpenPayPanel({ title, note }: { title: string; note: ReactNode }) {
  const payment = buildOpenSchoolUpiPayment();
  const qr = await paymentQr(payment.uri);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="text-center">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{note}</p>
      </div>

      <a
        href={payment.uri}
        className="focus-ring flex h-14 w-full items-center justify-center rounded-xl bg-accent text-base font-bold text-accent-foreground"
      >
        Open UPI app to pay
      </a>

      {qr ? (
        <UpiQr
          qr={qr}
          alt={`UPI QR code to pay ${payment.payeeName}`}
          caption={`${payment.payeeName} · enter the amount`}
        />
      ) : null}

      <div className="rounded-lg border border-border bg-surface-2 p-3 text-center">
        <p className="text-xs text-muted-foreground">Or pay this UPI ID by hand</p>
        <p className="mt-1 select-all break-all font-mono text-sm font-semibold text-foreground">
          {payment.vpa}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Write the student&apos;s name in the UPI note, so the office can match your payment.
        </p>
      </div>
    </section>
  );
}

/**
 * The QR, for the two cases the button cannot reach: paying from another phone
 * in the house (scan it), and a phone where the upi:// link opens nothing (save
 * it, then UPI app › Scan › choose from gallery).
 */
function UpiQr({
  qr,
  alt,
  caption,
}: {
  qr: { svg: string; png: string };
  alt: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-white p-4">
      <p className="text-xs font-semibold text-neutral-700">Scan and pay with any UPI app</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL drawn on the server */}
      <img src={qr.svg} alt={alt} width={224} height={224} className="size-56" />
      <p className="text-[11px] text-neutral-600">{caption}</p>
      <a
        href={qr.png}
        download="school-fee-upi-qr.png"
        className="focus-ring inline-flex h-11 items-center rounded-lg border border-neutral-300 px-4 text-sm font-semibold text-neutral-900"
      >
        Save QR to phone
      </a>
      <p className="text-center text-[11px] leading-snug text-neutral-600">
        Saved it? Open your UPI app, tap Scan, and pick the QR from your gallery.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- online */

type OnlineOffer =
  | { kind: "pay"; amount: number; printed: number; upiOnly: boolean }
  /**
   * The link exists and an Android phone is here to pay it: show UPI buttons to
   * tap rather than Razorpay's redirect (`domain/online/upi-launch.ts`).
   * `upiUri` is null when Razorpay's redirect could not be read or checked;
   * the page then offers Razorpay's own page and the Chrome escape.
   */
  | {
      kind: "launch";
      amount: number;
      upiUri: string | null;
      razorpayUrl: string | null;
      notYetReceived: boolean;
    }
  | { kind: "received" }
  | { kind: "confirming" }
  | { kind: "nothing_due" }
  | { kind: "unknown" };

/**
 * Whether this link may take an online payment, and for how much.
 *
 * Null leaves the page exactly as it was before online payments: no keys, the
 * switch off, a family message, or a notice that is not one of the
 * fees-only ones (`domain/online/pay-scope.ts`).
 *
 * The amount is RE-QUOTED from the ledger here, never read from the message:
 * a family who paid part at the counter since the message went out is asked
 * for what is left. If the quote cannot be read the page says so and names no
 * figure, rather than offering a stale one.
 *
 * A parent coming back from Razorpay (`?returned=1`) triggers a server-side
 * look at the provider — the redirect itself proves nothing. So does "I have
 * paid" on the UPI buttons (`?step=open&check=1`), which stays on the buttons
 * when nothing has arrived, because that parent may simply not have paid yet.
 */
async function resolveOnlineOffer(args: {
  sendId: string;
  payScope: unknown;
  returned: boolean;
  /** `?step=open`: an Android phone sent here by "Pay online" for UPI buttons. */
  open: boolean;
  check: boolean;
}): Promise<OnlineOffer | null> {
  const config = readRazorpayConfig();
  if (!config) return null;
  const scope = readPayScope(args.payScope);
  if (!scope || onlineOfferRefusal(scope)) return null;

  try {
    const supabase = createAdminClient();
    const switches = await readOnlineSwitches(supabase);

    const readIntent = async () => {
      const { data } = await supabase
        .from("online_payment_intents")
        .select("id, status, provider_link_id, provider_short_url, amount_paise")
        .eq("send_id", args.sendId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as {
        id: string;
        status: string;
        provider_link_id: string | null;
        provider_short_url: string | null;
        amount_paise: number;
      } | null;
    };

    let intent = await readIntent();
    if (
      intent?.status === "link_created" &&
      (args.returned || args.check) &&
      intent.provider_link_id
    ) {
      const client = createRazorpayClient(config);
      const link = await client.fetchPaymentLink(intent.provider_link_id);
      if (link.kind === "ok") {
        const posted: string[] = [];
        for (const payment of link.value.payments ?? []) {
          const outcome = await processProviderPayment({
            supabase,
            client,
            paymentId: payment.payment_id,
            autoPosting: switches.autoPosting,
            actor: "pay_page_return",
            linkId: link.value.id,
          });
          if (outcome === "applied") posted.push(payment.payment_id);
        }
        // Posted from here: the receipt goes now, after the page has rendered.
        if (posted.length > 0) {
          after(() => afterOnlinePosting({ supabase: createAdminClient(), paymentIds: posted }));
        }
      }
      intent = await readIntent();
    }

    if (intent?.status === "accounted") return { kind: "received" };
    if (intent && (intent.status === "paid" || intent.status === "review_required")) {
      return { kind: "confirming" };
    }
    if (args.returned && intent?.status === "link_created") return { kind: "confirming" };
    if (!switches.links) return null;

    const quote = await quoteScope(supabase, scope.studentIds[0], scope);
    if (!quote) return { kind: "unknown" };
    if (quote.reasons.includes("nothing_due")) return { kind: "nothing_due" };
    if (!quote.eligible) return null;
    // The buttons pay THIS intent's link, so only while the ledger still asks
    // for the same figure. Otherwise the ordinary button below opens a fresh one.
    if (
      args.open &&
      intent?.status === "link_created" &&
      intent.provider_link_id &&
      Math.round(quote.total * 100) === Number(intent.amount_paise)
    ) {
      const client = createRazorpayClient(config);
      return {
        kind: "launch",
        amount: quote.total,
        upiUri: readRazorpayUpiUri(
          await client.fetchUpiIntentUri(intent.provider_link_id),
          Number(intent.amount_paise),
        ),
        razorpayUrl: intent.provider_short_url,
        notYetReceived: args.check,
      };
    }
    return {
      kind: "pay",
      amount: quote.total,
      printed: scope.amount,
      // The same rule `ensureProviderLink` uses, so the page names the methods
      // the link will actually take.
      upiOnly: config.mode === "live" && (await readUpiOnlyLinks(supabase)),
    };
  } catch {
    return { kind: "unknown" };
  }
}

async function OnlinePanel({
  offer,
  code,
  notice,
  officeLine,
}: {
  offer: OnlineOffer;
  code: string;
  notice: string | null;
  officeLine: string | null;
}) {
  if (offer.kind === "unknown") {
    return (
      <OpenPayPanel
        title="We could not confirm the current amount"
        note={<>Please try again in a few minutes.{officeLine}</>}
      />
    );
  }

  if (offer.kind === "launch") {
    return <LaunchPanel offer={offer} code={code} notice={notice} />;
  }

  if (offer.kind !== "pay") {
    const copy = {
      received: {
        title: "Payment received",
        body: "Thank you. Your receipt will reach you on WhatsApp.",
      },
      confirming: {
        title: "Confirming your payment",
        body: "Your payment is being confirmed with the bank. Please do not pay again. The receipt will reach you on WhatsApp.",
      },
      nothing_due: {
        title: "Nothing is due on this link",
        body: "This amount has already been paid. Thank you.",
      },
    }[offer.kind];
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5 text-center">
        <h2 className="text-base font-bold text-foreground">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">
          {copy.body}
          {officeLine}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount due</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{formatInr(offer.amount)}</p>
        {offer.amount !== offer.printed ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Updated from the school&apos;s records. Your message showed {formatInr(offer.printed)}.
          </p>
        ) : null}
      </div>

      {notice === "busy" ? (
        <Notice tone="warning">The payment service did not answer. Please try again in a minute.</Notice>
      ) : null}
      {notice === "unavailable" ? (
        <Notice tone="warning">
          Online payment is not available for this link right now. Please pay at the fee counter.
        </Notice>
      ) : null}

      <form action={startOnlinePaymentAction}>
        <input type="hidden" name="code" value={code} />
        {/* Pending the moment it is tapped: a parent who sees nothing happen taps
            again. A second tap is harmless (same intent, same link), but it
            should not look like it is needed. */}
        <PendingSubmitButton
          variant="accent"
          pendingLabel="Opening secure payment…"
          className="h-14 w-full rounded-xl text-base font-bold"
        >
          Pay {formatInr(offer.amount)} online
        </PendingSubmitButton>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        {offer.upiOnly
          ? "By UPI (Google Pay, PhonePe, Paytm and others), through Razorpay."
          : "UPI, debit or credit card, or netbanking, through Razorpay."}{" "}
        Your receipt will reach you on WhatsApp. You can also pay at the school fee counter.
      </p>
    </section>
  );
}

/**
 * The UPI buttons an Android phone gets after "Pay online".
 *
 * Every way out is a link the parent TAPS, because that is what an in-app
 * browser hands to Android; the redirect Razorpay sends is not. The order is
 * the order of what works most often: the phone's own UPI chooser, one app by
 * name (`intent://`, for browsers that act on that form only), Chrome, and
 * last Razorpay's page — which is exactly what this replaced, so it is never
 * worse than before.
 */
async function LaunchPanel({
  offer,
  code,
  notice,
}: {
  offer: Extract<OnlineOffer, { kind: "launch" }>;
  code: string;
  notice: string | null;
}) {
  const pagePath = `/pay/${encodeURIComponent(code)}?step=open`;
  // The host this phone is on, not the env default, which is localhost in
  // production and would make the Chrome escape and the app fallbacks dead.
  const pageUrl = createAbsoluteUrl(pagePath, originFromHeaders(await headers()) ?? getSiteUrl());
  const inChrome = chromeIntentUrl(pageUrl);
  const secondary =
    "focus-ring flex h-12 w-full items-center justify-center rounded-xl border border-border text-sm font-semibold text-foreground";

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Amount due</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{formatInr(offer.amount)}</p>
      </div>

      {offer.notYetReceived ? (
        <Notice tone="info">
          We have not received this payment yet. If you have just paid, wait a minute and check
          again. Please do not pay twice.
        </Notice>
      ) : null}
      {notice === "app_missing" ? (
        <Notice tone="warning">That app is not on this phone. Please choose another one.</Notice>
      ) : null}

      {offer.upiUri ? (
        <>
          <a
            href={offer.upiUri}
            className="focus-ring flex h-14 w-full items-center justify-center rounded-xl bg-accent text-base font-bold text-accent-foreground"
          >
            Pay {formatInr(offer.amount)} with a UPI app
          </a>
          <div className="flex flex-col gap-2">
            <p className="text-center text-xs text-muted-foreground">Or open your app directly</p>
            <div className="grid grid-cols-2 gap-2">
              {UPI_APPS.map((app) => (
                <a
                  key={app.key}
                  href={upiAppIntentUrl(offer.upiUri as string, app, `${pageUrl}&notice=app_missing`)}
                  className="focus-ring flex h-12 items-center justify-center rounded-lg border border-border text-sm font-semibold text-foreground"
                >
                  {app.label}
                </a>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {inChrome ? (
        <a href={inChrome} className={secondary}>
          Nothing opened? Open this page in Chrome
        </a>
      ) : null}
      {offer.razorpayUrl ? (
        <a href={offer.razorpayUrl} className={secondary}>
          Pay on Razorpay&apos;s page
        </a>
      ) : null}

      <a
        href={`${pagePath}&check=1`}
        className="focus-ring text-center text-sm font-semibold text-accent underline-offset-4 hover:underline"
      >
        I have paid — check my payment
      </a>

      <p className="text-center text-xs text-muted-foreground">
        By UPI, through Razorpay. Your receipt will reach you on WhatsApp. You can also pay at the
        school fee counter.
      </p>
    </section>
  );
}
