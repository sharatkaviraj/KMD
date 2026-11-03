import { PAY_COPY } from "@/modules/payments/domain/online/pay-page-copy";
import { formatInr } from "@/platform/helpers/currency";

import { Both, FullScreen } from "./pay-ui";

/**
 * How a payment ends, as a whole screen nobody can miss. Before 2026-10-30 a
 * received payment was a line of green text below the breakdown, and the
 * first parent to pay never saw it.
 */

export function SuccessScreen({
  receipts,
  nowDue,
  animate,
  onPayMore,
}: {
  receipts: Array<{ receiptNumber: string; amount: number }>;
  nowDue: number;
  animate: boolean;
  onPayMore: () => void;
}) {
  const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  return (
    <FullScreen tone="success" label={PAY_COPY.receivedTitle(formatInr(total)).en}>
      <div className="flex flex-col items-center gap-4 pt-6 text-center">
        <svg viewBox="0 0 96 96" className="h-28 w-28" aria-hidden="true">
          <circle cx="48" cy="48" r="44" fill="#059669" />
          <path
            d="M28 50 L42 64 L70 34"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="64"
            strokeDashoffset={animate ? 64 : 0}
          >
            {animate ? <animate attributeName="stroke-dashoffset" from="64" to="0" dur="0.6s" begin="0.15s" fill="freeze" /> : null}
          </path>
        </svg>
        <Both
          text={total > 0 ? PAY_COPY.receivedTitle(formatInr(total)) : PAY_COPY.received}
          className="text-3xl font-bold text-emerald-900"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-white p-4 text-center shadow-sm">
        {receipts.map((receipt) => (
          <p key={receipt.receiptNumber} className="text-base font-semibold text-foreground">
            {PAY_COPY.receiptLine(receipt.receiptNumber, formatInr(receipt.amount)).hi}
          </p>
        ))}
        <Both text={PAY_COPY.receiptOnWhatsApp} className="text-base font-semibold text-emerald-800" />
        <p className="text-sm text-muted-foreground">
          {nowDue > 0 ? PAY_COPY.nowDue(formatInr(nowDue)).hi : PAY_COPY.allPaid.hi}
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 text-base font-semibold text-emerald-900">
        <span aria-hidden="true" className="text-2xl">
          ↖
        </span>
        <Both text={PAY_COPY.backToWhatsApp} />
      </div>

      {nowDue > 0 ? (
        <button type="button" onClick={onPayMore} className="focus-ring mt-auto text-center text-sm font-semibold text-emerald-900 underline underline-offset-4">
          {PAY_COPY.payMore.hi}
        </button>
      ) : null}
    </FullScreen>
  );
}

export function NotPaidScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <FullScreen tone="failed" label={PAY_COPY.failedTitle.en}>
      <div className="flex flex-col items-center gap-4 pt-6 text-center">
        <svg viewBox="0 0 96 96" className="h-24 w-24" aria-hidden="true">
          <circle cx="48" cy="48" r="44" fill="#D97706" />
          <path d="M48 26v28" stroke="#FFFFFF" strokeWidth="9" strokeLinecap="round" />
          <circle cx="48" cy="68" r="5" fill="#FFFFFF" />
        </svg>
        <Both text={PAY_COPY.failedTitle} className="text-3xl font-bold text-amber-950" />
        <Both text={PAY_COPY.failedNote} className="text-lg font-semibold text-amber-900" />
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="focus-ring mt-4 flex min-h-[60px] w-full items-center justify-center rounded-xl bg-amber-700 px-4 text-lg font-bold text-white"
      >
        <Both text={PAY_COPY.tryAgain} />
      </button>
      <Both text={PAY_COPY.counter} className="text-center text-xs text-amber-900" />
    </FullScreen>
  );
}
