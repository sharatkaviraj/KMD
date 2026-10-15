import "server-only";

import { fetchAllPages } from "@/platform/helpers/chunk";
import { createClient } from "@/modules/fees/platform/supabase/server";

/**
 * Money/history views must scope to the session frozen on the payment's
 * installment, NOT the student's current class. Installments are generated
 * per session and never re-pointed, so `payment → installments.class_id →
 * classes.session_label` is the promotion-proof anchor: after a year-end
 * promotion a student's current class belongs to the NEW session, but their
 * prior-year receipts/ledger rows stay attributed to the session their
 * installments were frozen in.
 *
 * `receipts` has no `session_label` column, so the receipt scope is derived
 * through `payments.installment_id`.
 *
 * Roster views (students, defaulters, Payment Desk, dashboard) intentionally
 * stay on current-class scoping — those answer "who is in this session now".
 */

/**
 * Receipt ids whose payments settled an installment frozen to `sessionLabel`.
 * A receipt belongs to a session if ANY of its payments hit a session-scoped
 * installment.
 *
 * **Paged, because a single request silently returns a short answer.**
 *
 * This asked for one page with `.limit(20000)` and a comment reasoning that
 * 20k was "comfortably above any realistic single-session volume". That
 * ceiling was never reached and never could be: PostgREST caps every response
 * at its own `db-max-rows`, which is 1000 on Supabase, and it truncates with
 * no error and no flag. The requested limit does not raise the server's.
 *
 * So the function returned the ids of the first 1000 payment rows and reported
 * them as the whole set. On 2026-09-17 the live session reached 1008 payment
 * rows and the office watched four of that morning's five receipts disappear
 * from Transactions — SVP20260917-0002 through -0005, whose every payment row
 * fell past the cut. SVP20260917-0001 survived on the technicality that 2 of
 * its 3 rows sat inside the first 1000. The day's money band stayed correct
 * because it is computed elsewhere, so the screen disagreed with itself: five
 * receipts counted, one listed.
 *
 * It fails in the worst possible direction. Both callers treat this list as
 * complete — `getWorkbookTransactions` filters `receipts` by it, and Finance
 * Controls intersects its day's money rows against it — so a short answer does
 * not degrade a view, it hides posted money from the register and the day
 * close. And it gets worse every time a payment is posted.
 *
 * `fetchAllPages` is the same helper `getAllReceiptReversalTotals` already
 * uses against this exact trap, for the same reason stated there: "PostgREST
 * truncates at `max-rows` with no error and no flag; a short answer here would
 * silently un-reverse receipts." Paging needs a stable total order or a row
 * can land on two pages or none, so the read is ordered by the primary key.
 *
 * The longer-term fix is to stop materialising an id list at all and scope
 * through the join, as `src/modules/receipts/data/queries.ts` does with its
 * `SESSION_SCOPE_EMBED` and as the note at the foot of this file recommends.
 * That removes the list rather than making it complete. This change makes the
 * answer correct today without reshaping two live money queries.
 */
export async function loadSessionScopedReceiptIds(
  sessionLabel: string,
  /** The cookie client by default; a caller that has checked `fees:view` may pass the service-role one. */
  client?: Pick<Awaited<ReturnType<typeof createClient>>, "from">,
): Promise<string[]> {
  const supabase = client ?? (await createClient());

  const { data, error } = await fetchAllPages<{ receipt_id: string | null }>((from, to) =>
    supabase
      .from("payments")
      .select(
        "receipt_id, installment_ref:installments!inner(class_ref:classes!inner(session_label))",
      )
      .eq("installment_ref.class_ref.session_label", sessionLabel)
      // A stable, unique order. Without one, PostgREST's pages are cut out of
      // an unordered scan and a row can repeat across pages or be skipped
      // between them — which is the same silent shortfall by another route.
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (error) {
    throw new Error(
      `Unable to scope receipts to session: ${
        (error as { message?: string })?.message ?? String(error)
      }`,
    );
  }

  return [
    ...new Set(
      data
        .map((row) => row.receipt_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

/*
 * There is deliberately no `loadSessionScopedStudentIds` here any more.
 *
 * It returned every student id in a session and callers fed that to
 * PostgREST's `.in("id", …)`, which serialises into the request URL. On the
 * live session that is 481 uuids — a ~17,800-character URL — and the fetch was
 * rejected before it left Node, which is what broke the Ledger page in
 * production ("Unable to load students for ledger: TypeError: fetch failed").
 * TEST-2026-27 has 79 students, so it worked everywhere it was tested.
 *
 * Scope students by JOINING through the installment instead, as
 * `getLedgerPageData` now does:
 *
 *     .select("…, installments!inner(id, class_ref:classes!inner(session_label))")
 *     .eq("installments.class_ref.session_label", sessionLabel)
 *
 * Same promotion-proof anchor, no id list, and the URL stays constant however
 * large the roster grows.
 */
