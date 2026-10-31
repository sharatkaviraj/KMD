import "server-only";

import { drainFinancialViewRefresh } from "@/modules/system-sync/data/financial-view-refresh";
import { publishOfficeSyncEventWith } from "@/modules/system-sync/data/office-sync-events";
import {
  revalidateAfterPaymentPosting,
  revalidateSessionFinance,
} from "@/modules/system-sync/data/finance-revalidation";
import { isTransientParentRefusal } from "@/modules/whatsapp/data/aisensy";
import { sendReceiptNotice } from "@/modules/whatsapp/data/receipt-notice";
import { logWarn } from "@/platform/observability/log";

import { drainReceiptOutbox, readOnlineSwitches, type ReceiptSender } from "./service";
import { drainStaffPaymentAlerts } from "./staff-alerts";

/**
 * What has to happen the moment an online payment posts, wherever it posted.
 *
 * Until 2026-10-29 the webhook posted a payment within seconds and then did
 * nothing else: the receipt waited for the ten-minute reconciler (₹50 test:
 * posted 22:50:10 IST, receipt sent 23:00:06), the dashboard's `session:{label}`
 * cache was never told, and an open staff tab did not refresh. The desk does
 * all of that after every posting (`src/app/fees/payments/actions.ts`);
 * this is the same list for a posting with no staff session behind it.
 *
 * In order, because the order matters:
 *  1. Drain the matview queue. `sendReceiptNotice` reads the balance it quotes
 *     from `v_workbook_student_financials`, so a receipt sent before the drain
 *     tells the parent what they owed BEFORE paying.
 *  2. Bust the session and student caches.
 *  3. Publish an office-sync event, which is what makes open staff tabs refresh.
 *  4. Alert the office: a push to staff phones and, while its switch is on,
 *     WhatsApp to the staff numbers (`staff-alerts.ts`).
 *  5. Send the queued receipts now. The outbox lease and the one-claim-per-
 *     receipt index are what stop a receipt reaching the parent twice, so this
 *     is safe beside the cron, which stays the retry net.
 *
 * Every step is best-effort. The money has posted; a failure here leaves the
 * cron to finish, never an error for the caller to act on.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type OnlinePosting = { studentId: string; sessionLabel: string; paymentId: string };

/** The existing receipt notice, read back into the outbox's vocabulary. */
export function createReceiptSender(supabase: Db): ReceiptSender {
  return async (job) => {
    const result = await sendReceiptNotice({
      supabase,
      receiptId: job.receiptId,
      receiptNumber: job.receiptNumber,
      studentId: job.studentId,
      sessionLabel: job.sessionLabel,
      amountPaid: job.amountPaid,
      paymentDate: job.paymentDate,
      staffId: null,
      trigger: "auto",
    });
    if (result.sent) return { outcome: "provider_accepted", providerMessageId: result.providerMessageId };

    if (/already been sent/i.test(result.reason)) {
      // The receipt's own claim row says what happened the first time.
      const { data } = await supabase
        .from("whatsapp_reminder_sends")
        .select("status, provider_message_id")
        .eq("receipt_id", job.receiptId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.status === "sent") return { outcome: "provider_accepted", providerMessageId: data.provider_message_id ?? null };
      if (data?.status === "pending") {
        return { outcome: "uncertain", reason: "A send began and never reported back. Check AiSensy before resending." };
      }
      return { outcome: "failed", reason: "The first send failed. Resend from the receipt screen." };
    }
    // One only: the parent-send gate's refusal (D-353). Nothing reached
    // AiSensy either way, and the gate's CODE says which kind it was: a rule
    // (dispatch or the category off, a number not on the allowlist, a bad
    // destination) is suppressed for good; a read that failed this once
    // (`read_failed`, `actor_unknown`) is retried at the next pass, or one
    // database hiccup would lose the parent's receipt for good.
    if (result.refusalCode) {
      return isTransientParentRefusal(result.refusalCode)
        ? { outcome: "failed", reason: result.reason }
        : { outcome: "suppressed", reason: result.reason };
    }
    if (/switched off|no-call|never|No usable WhatsApp|awaiting Meta approval|No receipt campaign/i.test(result.reason)) {
      return { outcome: "suppressed", reason: result.reason };
    }
    return { outcome: "failed", reason: result.reason };
  };
}

/** The students and sessions these Razorpay payments actually posted to. */
export async function postingsForPayments(supabase: Db, paymentIds: readonly string[]): Promise<OnlinePosting[]> {
  const ids = [...new Set(paymentIds.filter((id) => /^pay_[A-Za-z0-9]+$/.test(id)))];
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("online_payment_captures")
    .select(
      "provider_payment_id, application_status, online_payment_intents(student_id, session_label), " +
        "online_payment_orders(online_payment_order_lines(student_id, session_label))",
    )
    .in("provider_payment_id", ids);
  if (error) return [];
  const postings: OnlinePosting[] = [];
  for (const row of (data ?? []) as Array<{
    provider_payment_id: string;
    application_status: string;
    online_payment_intents?: { student_id?: string; session_label?: string } | null;
    online_payment_orders?: { online_payment_order_lines?: Array<{ student_id?: string; session_label?: string }> } | null;
  }>) {
    if (row.application_status !== "applied") continue;
    // A Payment Link capture posts one student; an order capture, one per child.
    const targets = row.online_payment_intents
      ? [row.online_payment_intents]
      : (row.online_payment_orders?.online_payment_order_lines ?? []);
    for (const target of targets) {
      if (!target?.student_id || !target.session_label) continue;
      postings.push({ studentId: target.student_id, sessionLabel: target.session_label, paymentId: row.provider_payment_id });
    }
  }
  return postings;
}

/** Steps 1–3: views, caches, staff tabs. */
export async function refreshAfterOnlinePosting(supabase: Db, postings: readonly OnlinePosting[]): Promise<void> {
  if (postings.length === 0) return;
  await drainFinancialViewRefresh();

  const studentIds = [...new Set(postings.map((posting) => posting.studentId))];
  const bySession = new Map<string, string[]>();
  for (const posting of postings) {
    bySession.set(posting.sessionLabel, [...(bySession.get(posting.sessionLabel) ?? []), posting.studentId]);
  }
  for (const [sessionLabel, ids] of bySession) {
    revalidateSessionFinance(sessionLabel, ids);
    await publishOfficeSyncEventWith(supabase, {
      sessionLabel,
      entityType: "payment",
      action: "posted_online",
      affectedStudentIds: [...new Set(ids)],
      metadata: { source: "razorpay" },
    });
  }
  revalidateAfterPaymentPosting(studentIds);
}

/**
 * All four steps, for the callers that post one payment and are done: the
 * webhook's `after()`, the pay page's return check, and "Post now" on the
 * online-payments screen.
 */
export async function afterOnlinePosting(args: {
  supabase: Db;
  paymentIds: readonly string[];
  sendReceipt?: ReceiptSender;
}): Promise<{ postings: number; receiptsSent: number }> {
  try {
    const postings = await postingsForPayments(args.supabase, args.paymentIds);
    if (postings.length === 0) return { postings: 0, receiptsSent: 0 };
    await refreshAfterOnlinePosting(args.supabase, postings);
    // The office hears before the parent's receipt goes: staff alerts read
    // nothing from the matview, so they need not wait behind the outbox.
    await drainStaffPaymentAlerts({ supabase: args.supabase }).catch((caught) => {
      logWarn("online.staff_alerts.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    });
    const drained = await drainReceiptOutbox({
      supabase: args.supabase,
      sendReceipt: args.sendReceipt ?? createReceiptSender(args.supabase),
      switches: await readOnlineSwitches(args.supabase),
    });
    return { postings: postings.length, receiptsSent: drained.sent };
  } catch (caught) {
    logWarn("online.after_posting.failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return { postings: 0, receiptsSent: 0 };
  }
}
