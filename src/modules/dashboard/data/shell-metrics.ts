import "server-only";

import { getReceiptReversalTotals, isReceiptReversed } from "@/modules/receipts/data/reversals";
import { isDiscountCloseout } from "@/platform/money/write-off";
import { cacheSafeUnstableCache, getCacheSafeClient } from "@/modules/fees/platform/supabase/cache-safe";
import { DASHBOARD_STALENESS_CEILING_SECONDS } from "@/modules/dashboard/domain/cache-contract";
import { fetchAllPages } from "@/platform/helpers/chunk";

/**
 * Lightweight numbers for the workspace shell chrome ("Ledger Calm 2.0"):
 * the sidebar "Day so far" card and the nav count pills. Deliberately much
 * cheaper than the dashboard summary RPC — two narrow queries, cached per
 * (session, day) and revalidated by the same `session:{label}` tag the
 * finance sync already busts after every posting.
 */
export type ShellPulse = {
  todayTotalAmount: number;
  todayReceiptCount: number;
  overdueStudentCount: number;
  /**
   * Written off today, shown BESIDE the collected figure and never inside it.
   *
   * Excluding a write-off from the total is necessary but not sufficient: an
   * office that wrote off ₹8,000 this morning and sees "Day so far ₹0" has no
   * way to tell a quiet day from a day whose one entry went somewhere else.
   * Stating it separately is what "shown separately" means — the number is
   * visible, and it is visibly not collection.
   */
  todayWrittenOffAmount: number;
};

/**
 * Exported so the workspace shell can use it as the `.catch()` value when it
 * starts this read without awaiting it. A shell whose pulse read failed shows
 * zeros in one sidebar card; it does not fail to render.
 */
export const EMPTY_SHELL_PULSE: ShellPulse = {
  todayTotalAmount: 0,
  todayReceiptCount: 0,
  overdueStudentCount: 0,
  todayWrittenOffAmount: 0,
};

const EMPTY_PULSE = EMPTY_SHELL_PULSE;

function getSchoolDateStamp(referenceDate = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate);
}

/**
 * Columns this module reads. `v_workbook_student_financials` is the
 * STUDENT-level view: it has `outstanding_amount` / `record_status` but NOT
 * `balance_status` (that one lives on the installment-level
 * `v_workbook_installment_balances`). Naming the columns here lets a unit test
 * assert them against the generated DB types — a wrong name used to fail
 * silently at runtime and render the whole card as zero.
 */
export const SHELL_PULSE_FINANCIALS_COLUMNS = [
  "session_label",
  "record_status",
  "outstanding_amount",
] as const;

async function getShellPulseUncached(sessionLabel: string): Promise<ShellPulse> {
  const supabase = await getCacheSafeClient();
  const today = getSchoolDateStamp();

  const [todayReceipts, defaulterCount] = await Promise.all([
    // `payment_mode` is selected rather than filtered on, so today's write-offs
    // can be reported beside the collected figure instead of vanishing from it.
    // One round trip to Mumbai partitioned in JS beats two queries, and it
    // keeps the reversal check applying to both halves.
    supabase
      .from("receipts")
      .select(
        "id, total_amount, payment_mode, student_ref:students!inner(class_ref:classes!inner(session_label))",
      )
      .eq("student_ref.class_ref.session_label", sessionLabel)
      .eq("payment_date", today),
    // Matches what the Defaulters page lists (active students still owing
    // anything) so the nav pill agrees with its click-through destination.
    supabase
      .from("v_workbook_student_financials")
      .select("student_id", { count: "exact", head: true })
      .eq("session_label", sessionLabel)
      .eq("record_status", "active")
      .gt("outstanding_amount", 0),
  ]);

  // Degrade per query: a failure on one side must never blank the other.
  const allRows = todayReceipts.error
    ? []
    : ((todayReceipts.data ?? []) as Array<{
        id: string;
        total_amount: number | null;
        payment_mode: string | null;
      }>);

  // A reversal never touches receipts.total_amount — it writes a compensating
  // payment_adjustments row — so summing the column counts money that was taken
  // back. The sidebar was reporting ₹11,000 for a day whose only two receipts
  // had both been reversed.
  const reversalTotals = await getReceiptReversalTotals(allRows.map((row) => row.id));
  const liveRows = allRows.filter(
    (row) => !isReceiptReversed(reversalTotals, row.id, row.total_amount ?? 0),
  );

  // A write-off is not collection. It posts a receipt so the decision is
  // auditable, but no cash crossed the counter — the card was reporting a
  // leaver's written-off balance as money taken today, which is the bug this
  // split exists for. Every dashboard RPC has carried the same predicate since
  // `20260526120000`; this read had never caught up.
  const receiptRows = liveRows.filter((row) => !isDiscountCloseout(row.payment_mode));
  const writtenOffRows = liveRows.filter((row) => isDiscountCloseout(row.payment_mode));

  return {
    todayTotalAmount: receiptRows.reduce((sum, row) => sum + (row.total_amount ?? 0), 0),
    todayReceiptCount: receiptRows.length,
    overdueStudentCount: defaulterCount.error ? 0 : defaulterCount.count ?? 0,
    todayWrittenOffAmount: writtenOffRows.reduce((sum, row) => sum + (row.total_amount ?? 0), 0),
  };
}

export async function getShellPulse(sessionLabel: string): Promise<ShellPulse> {
  try {
    return await cacheSafeUnstableCache(
      async () => getShellPulseUncached(sessionLabel),
      ["shell-pulse", sessionLabel, getSchoolDateStamp()],
      { tags: [`session:${sessionLabel}`] },
    )();
  } catch {
    return EMPTY_PULSE;
  }
}

/**
 * The "Dues" badge alone: how many active children have fees pending today
 * — due before today, or last session's balance (fees/domain/due-rule.ts).
 *
 * It used to count every child who owed anything this year, not-due-yet
 * installments included, so the badge said "479 waiting" over a Dues & calls
 * screen that listed 315 children to call (smoke 20 Oct). It now counts what
 * that screen counts, by the rule every money screen uses.
 *
 * `getShellPulse` reads this count beside today's receipts under
 * `session:{label}`, the tag every posting busts — so on a collection morning
 * each receipt re-scanned `v_workbook_student_financials` (about 480 ms) for a
 * nav badge (perf "busted pulse cache"). The badge has its own entry instead,
 * deliberately NOT under the session tag, with the dashboard's five-minute
 * ceiling (DASHBOARD_STALENESS_CEILING_SECONDS) as its expiry: a count of
 * families on a nav pill may lag a payment by a few minutes, while every
 * money figure keeps the session tag and stays exact.
 *
 * Null when it could not be read, so the badge is hidden rather than nought.
 */
export async function getDuesBadgeCount(sessionLabel: string): Promise<number | null> {
  try {
    return await cacheSafeUnstableCache(
      async () => {
        const supabase = await getCacheSafeClient();
        const today = getSchoolDateStamp();
        const [active, due] = await Promise.all([
          fetchAllPages<{ student_id: string }>((from, to) =>
            supabase
              .from("v_workbook_student_financials")
              .select("student_id")
              .eq("session_label", sessionLabel)
              .eq("record_status", "active")
              .gt("outstanding_amount", 0)
              .order("student_id")
              .range(from, to),
          ),
          fetchAllPages<{ student_id: string }>((from, to) =>
            supabase
              .from("v_workbook_installment_balances")
              .select("student_id")
              .eq("session_label", sessionLabel)
              .gt("pending_amount", 0)
              .neq("balance_status", "waived")
              .or(`due_date.lt.${today},is_carry_forward.eq.true`)
              .order("installment_id")
              .range(from, to),
          ),
        ]);
        // Thrown, not returned: unstable_cache keeps no entry for a failure.
        if (active.error) throw new Error(String((active.error as { message?: string }).message ?? active.error));
        if (due.error) throw new Error(String((due.error as { message?: string }).message ?? due.error));
        const activeIds = new Set(active.data.map((r) => r.student_id));
        return new Set(due.data.map((r) => r.student_id).filter((id) => activeIds.has(id))).size;
      },
      ["dues-badge", sessionLabel, getSchoolDateStamp()],
      { tags: [`dues-badge:${sessionLabel}`], revalidate: DASHBOARD_STALENESS_CEILING_SECONDS },
    )();
  } catch {
    return null;
  }
}
