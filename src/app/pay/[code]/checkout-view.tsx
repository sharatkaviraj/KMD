import type { CheckoutStatus } from "@/modules/payments/data/online/orders";
import {
  amountChoices,
  lastPaid,
  lineBounds,
  paidProgress,
  payableFigures,
  rowState,
  splitRows,
  type PayPageChild,
  type PayPageData,
  type PayPageRow,
} from "@/modules/payments/domain/online/pay-breakdown";
import { PAY_COPY, type Bilingual } from "@/modules/payments/domain/online/pay-page-copy";
import { schoolProfile } from "@/platform/config/school";
import { formatInr } from "@/platform/helpers/currency";
import { formatMediumDate } from "@/platform/helpers/date";

import { CheckoutPanel } from "./checkout-panel";

/**
 * The one-tap pay page, built for a parent paying online for the first time:
 * the whole job fits one phone screen — whose fee, how much (cards to tap, not
 * a box to discover), and one Pay button that never scrolls away. The
 * installment-by-installment breakdown is one tap away in a native <details>,
 * rendered here on the server, so it costs the phone no script.
 *
 * Measured before this layout (2026-10-30, 375×812): the amount box and the
 * "received" message both started at 823 px, below the breakdown — off screen.
 *
 * Shows a child's FIRST NAME and class — never the admission number, a parent's
 * name or a phone. A late fee is always said out loud, never folded into a fee.
 */

function Both({ text, className }: { text: Bilingual; className?: string }) {
  return (
    <span className={className}>
      <span lang="hi" className="block">
        {text.hi}
      </span>
      <span lang="en" className="block text-[0.75em] font-normal opacity-70">
        {text.en}
      </span>
    </span>
  );
}

const STATE_TONE: Record<ReturnType<typeof rowState>, string> = {
  paid: "text-emerald-700",
  overdue: "text-red-700",
  part_paid: "text-amber-700",
  upcoming: "text-muted-foreground",
};

function RowLine({ row, today, waiveLateFees }: { row: PayPageRow; today: string; waiveLateFees: boolean }) {
  const state = rowState(row, today, waiveLateFees);
  const title = row.carry_forward ? PAY_COPY.lastYear.hi : PAY_COPY.installment(row.installment_no).hi;
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {title}
          {!row.carry_forward ? (
            <span className="font-normal text-muted-foreground"> · {formatMediumDate(row.due_date)}</span>
          ) : null}
        </p>
        {!waiveLateFees && row.late_fee_pending > 0 ? (
          <p className="text-xs font-semibold text-red-700">
            {PAY_COPY.lateFee.hi} {formatInr(row.late_fee_pending)}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-foreground">{formatInr(row.fees_pending)}</p>
        <p className={`text-[11px] font-semibold ${STATE_TONE[state]}`}>{PAY_COPY.state[state].hi}</p>
      </div>
    </li>
  );
}

function settledLabel(rows: PayPageRow[]): string {
  const numbers = rows.filter((row) => !row.carry_forward).map((row) => row.installment_no);
  const parts = [
    rows.some((row) => row.carry_forward) ? PAY_COPY.lastYear.hi : null,
    numbers.length > 0 ? `${PAY_COPY.installment(numbers[0]).hi.replace(/\s*\d+$/, "")} ${numbers.join(", ")}` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function ChildDetails({
  child,
  today,
  titled,
  waiveLateFees,
}: {
  child: PayPageChild;
  today: string;
  titled: boolean;
  waiveLateFees: boolean;
}) {
  const { settled, open } = splitRows(child, waiveLateFees);
  return (
    <div className="px-4 pb-3">
      {titled ? (
        <p className="pt-2 text-sm font-bold text-foreground">
          {child.first_name} <span className="font-normal text-muted-foreground">· {child.class_label}</span>
        </p>
      ) : null}
      {settled.length > 0 ? (
        <p className="py-1.5 text-xs font-semibold text-emerald-700">{PAY_COPY.paidRows(settledLabel(settled)).hi}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {open.map((row) => (
          <RowLine
            key={`${row.carry_forward ? "cf" : "i"}-${row.installment_no}-${row.due_date}`}
            row={row}
            today={today}
            waiveLateFees={waiveLateFees}
          />
        ))}
      </ul>
      {payableFigures(child, waiveLateFees).wholeYear <= 0 ? <p className="py-2 text-sm font-semibold text-emerald-700">{PAY_COPY.nothingOwed.hi}</p> : null}
    </div>
  );
}

function ChildLine({ child, waiveLateFees }: { child: PayPageChild; waiveLateFees: boolean }) {
  const progress = paidProgress(child, waiveLateFees);
  return (
    <section className="flex flex-col gap-1.5">
      <p className="text-lg font-bold leading-tight text-foreground">
        {child.first_name} <span className="text-sm font-semibold text-muted-foreground">· {child.class_label}</span>
      </p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {PAY_COPY.progress(formatInr(progress.paid), formatInr(progress.owed)).hi}
      </p>
    </section>
  );
}

export function CheckoutView({
  data,
  code,
  status,
  payWith,
  waiveLateFees,
}: {
  data: PayPageData;
  code: string;
  status: CheckoutStatus;
  payWith: "checkout" | "upi";
  /** This year a payment online forgives the child's late fees: none is shown, none asked for. */
  waiveLateFees: boolean;
}) {
  const paid = lastPaid(data);
  const single = data.children.length === 1;
  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-2.5 border-b border-border pb-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 2 KB icon, no image pipeline wanted on this page */}
        <img src="/branding/icon-192.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{schoolProfile.shortName}</p>
          <p className="text-xs text-muted-foreground">
            {PAY_COPY.title.hi} · {data.session_label}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground" title={PAY_COPY.secure.en}>
          🔒 Razorpay
        </span>
      </header>

      {paid ? (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
          ✓ {PAY_COPY.lastPaidBanner(formatInr(paid.amount), formatMediumDate(paid.at)).hi}
          <span className="block text-xs font-normal">{paid.receiptNumbers.join(", ")}</span>
        </p>
      ) : null}

      {single ? <ChildLine child={data.children[0]} waiveLateFees={waiveLateFees} /> : null}

      <CheckoutPanel
        code={code}
        payWith={payWith}
        orderMaxRupees={data.order_max_rupees}
        initialStatus={status}
        childLines={data.children.map((child) => {
          const { min, max } = lineBounds({ whole_session: payableFigures(child, waiveLateFees).wholeYear });
          return {
            index: child.index,
            firstName: child.first_name,
            classLabel: child.class_label,
            choices: amountChoices(child, waiveLateFees),
            min,
            max,
          };
        })}
      />

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
          <Both text={PAY_COPY.details} />
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        {data.children.map((child) => (
          <ChildDetails key={child.index} child={child} today={data.today} titled={!single} waiveLateFees={waiveLateFees} />
        ))}
      </details>

      <p className="text-center text-xs text-muted-foreground">{PAY_COPY.counter.hi}</p>
      <p className="text-center text-[11px] text-muted-foreground">{PAY_COPY.footer.hi}</p>
    </div>
  );
}
