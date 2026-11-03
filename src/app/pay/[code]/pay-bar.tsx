import { PAY_COPY } from "@/modules/payments/domain/online/pay-page-copy";
import { formatInr } from "@/platform/helpers/currency";

import { BRAND, Both } from "./pay-ui";

/**
 * The Pay button, pinned to the bottom of the screen so it is always in view —
 * with the details open, with the number pad up, on the smallest phone. The
 * page leaves room under its last line for it (`page.tsx`).
 */
export function PayBar({
  total,
  ok,
  opening,
  disabled,
  upiOnly,
  onPay,
}: {
  total: number;
  ok: boolean;
  opening: boolean;
  disabled: boolean;
  upiOnly: boolean;
  onPay: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="mx-auto w-full max-w-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onPay}
          disabled={disabled || !ok}
          className="focus-ring flex min-h-[60px] w-full items-center justify-center rounded-xl px-4 py-2 text-lg font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: BRAND }}
        >
          {opening ? (
            <Both text={PAY_COPY.opening} />
          ) : ok ? (
            <Both text={PAY_COPY.pay(formatInr(total))} />
          ) : (
            <Both text={PAY_COPY.enterAmount} />
          )}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          {upiOnly ? PAY_COPY.methodsLine : PAY_COPY.methods.hi}
        </p>
      </div>
    </div>
  );
}
