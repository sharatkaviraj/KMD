import { PAY_COPY } from "@/modules/payments/domain/online/pay-page-copy";

import { Both, FullScreen } from "./pay-ui";

/**
 * While the parent is in their UPI app, and when they come back: what to do,
 * in three numbered steps, and — once they are back — that the page is
 * checking by itself. There is no "I have paid" button to find.
 */
export function WaitingScreen({
  amount,
  checking,
  slow,
  onOtherApp,
}: {
  amount: string;
  checking: boolean;
  slow: boolean;
  onOtherApp: () => void;
}) {
  return (
    <FullScreen label={PAY_COPY.waitingTitle.en}>
      <div className="flex flex-col items-center gap-3 text-center">
        <svg viewBox="0 0 48 48" className="h-16 w-16 animate-pulse text-sky-700" aria-hidden="true">
          <rect x="13" y="4" width="22" height="40" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="24" cy="37" r="2" fill="currentColor" />
          <path d="M19 18h10M19 24h10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <Both text={PAY_COPY.waitingTitle} className="text-lg font-bold text-foreground" />
        <p className="text-3xl font-bold tabular-nums text-foreground">{amount}</p>
      </div>

      <ol className="flex flex-col gap-3">
        {PAY_COPY.steps.map((step, index) => (
          <li key={step.en} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-700 text-base font-bold text-white">
              {index + 1}
            </span>
            <Both text={step} className="text-base font-semibold text-foreground" />
          </li>
        ))}
      </ol>

      {checking ? (
        <div role="status" className="flex items-center justify-center gap-2 text-base font-semibold text-sky-900">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-sky-700 border-t-transparent" aria-hidden="true" />
          <Both text={PAY_COPY.checking} />
        </div>
      ) : null}
      {slow ? (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Both text={PAY_COPY.slowConfirm} />
        </div>
      ) : null}

      <button type="button" onClick={onOtherApp} className="focus-ring mt-auto text-center text-base font-semibold text-foreground">
        <Both text={PAY_COPY.otherAppInstead} />
      </button>
    </FullScreen>
  );
}
