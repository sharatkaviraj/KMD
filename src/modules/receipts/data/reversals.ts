import "server-only";

import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { getCacheSafeClient } from "@/modules/fees/platform/supabase/cache-safe";
import { createClient } from "@/modules/fees/platform/supabase/server";



type SupabaseLike = Pick<Awaited<ReturnType<typeof createClient>>, "from">;

/**
 * Batch lookup of reversal totals for a set of receipts, via the
 * v_receipt_reversal_totals view (payment_adjustments 'reversal' rows summed
 * per receipt). Returns a map of receiptId -> reversed amount (positive).
 *
 * Pass `client` when calling from a cache-safe context (unstable_cache) where
 * the cookie-based client cannot be created.
 *
 * THROWS on a failed read, and this is the whole point.
 *
 * Both functions here used to discard the error and return whatever rows had
 * arrived, described as degrading to "no badge". That undersold it: an absent
 * row does not mean "not reversed" to any caller, it means "reversed by ₹0".
 * The same map decides `isReceiptReversed`, which is what excludes a receipt
 * from a collection figure — so a failed read does not drop a badge, it counts
 * money the school gave back as money it collected. The live session carries
 * ₹1,28,850 of reversals.
 *
 * The callers are the day-close cron, the Dashboard's collection totals,
 * Finance Controls, every export and report, and the public receipt
 * verification page a parent opens. Every one of them would rather fail than
 * quietly overstate collection, which is also this project's rule: a reversed
 * receipt "is excluded from every collection figure".
 */
export async function getReceiptReversalTotals(
  receiptIds: readonly string[],
  client?: SupabaseLike,
): Promise<Map<string, number>> {
  const uniqueIds = [...new Set(receiptIds.filter(Boolean))];
  const totals = new Map<string, number>();

  if (uniqueIds.length === 0) {
    return totals;
  }

  /*
   * **The cache-safe client, because several callers are inside a cache.**
   *
   * `createClient()` reads cookies, and Next refuses a dynamic data source
   * inside `unstable_cache()`. Three of the callers above are cached — the
   * Payment Desk's "today's collection", its recent-receipt list, and the
   * shell's DAY SO FAR card — so this read threw inside them and the desk
   * rendered its error boundary: "The protected workspace hit an error."
   *
   * **It only failed once somebody had taken a payment.** The early return
   * three lines up is taken whenever the id list is empty, which is exactly
   * what "no receipts today" produces — so the desk worked every morning and
   * broke on the first receipt of the day, every day. Nothing about that is
   * visible until a database has a receipt dated today, which is why it
   * survived the port: `schoolfees-dev` had no receipts at all.
   *
   * `getCacheSafeClient()` returns the service-role client whenever the key is
   * present, which is what the callers' own reads already use — the totals
   * either side of this line come from it. A caller that has a client already
   * still passes one, and nothing about who may call this changes: every entry
   * point authorizes first, and `tests/architecture.test.ts` requires it.
   */
  const supabase = client ?? (await getCacheSafeClient());
  const { data, error } = await fetchInChunks(uniqueIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    supabase
      .from("v_receipt_reversal_totals")
      .select("receipt_id, reversed_amount")
      .in("receipt_id", chunk),
  );

  if (error) {
    throw new Error(
      `Unable to read receipt reversal totals for ${uniqueIds.length} receipt(s): ${
        (error as { message?: string })?.message ?? String(error)
      }. Refusing to report reversals as zero — a reversed receipt would be counted as collection.`,
    );
  }

  for (const row of (data ?? []) as Array<{ receipt_id: string; reversed_amount: number }>) {
    totals.set(row.receipt_id, row.reversed_amount);
  }

  return totals;
}

/**
 * Every reversal total in the project, unfiltered.
 *
 * The `.in(...)` variant above chunks at 200 ids, so scanning a whole session's
 * receipts through it costs one request per 200 receipts. This costs one — the
 * view holds a single row per reversed receipt, and reversals are rare
 * (correction paths, not a daily occurrence), so the whole thing is smaller
 * than one page of the receipts it describes.
 *
 * Paged rather than unbounded because PostgREST truncates at `max-rows` with no
 * error and no flag; a short answer here would silently un-reverse receipts.
 *
 * Throws on a failed read, like its sibling. The comment here used to say the
 * total "degrades to counts a reversed receipt" — which is the failure, stated
 * plainly and then accepted. Guarding the truncation case while waving through
 * the error case left the same wrong number by the other door.
 */
export async function getAllReceiptReversalTotals(
  client?: SupabaseLike,
): Promise<Map<string, number>> {
  // Cache-safe for the same reason as its sibling above: callers include
  // cached scopes, and `createClient()` reads cookies.
  const supabase = client ?? (await getCacheSafeClient());
  const { data, error } = await fetchAllPages<{ receipt_id: string; reversed_amount: number }>(
    (from, to) =>
      supabase
        .from("v_receipt_reversal_totals")
        .select("receipt_id, reversed_amount")
        .order("receipt_id", { ascending: true })
        .range(from, to),
  );

  if (error) {
    throw new Error(
      `Unable to read the project's receipt reversal totals: ${
        (error as { message?: string })?.message ?? String(error)
      }. Refusing to report reversals as zero — reversed receipts would be counted as collection.`,
    );
  }

  const totals = new Map<string, number>();
  for (const row of data) {
    totals.set(row.receipt_id, row.reversed_amount);
  }
  return totals;
}

/** A receipt reads as REVERSED when reversals cover its full amount. */
export function isReceiptReversed(
  totals: Map<string, number>,
  receiptId: string,
  totalAmount: number,
): boolean {
  return totalAmount > 0 && (totals.get(receiptId) ?? 0) >= totalAmount;
}
