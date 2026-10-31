import "server-only";

import { buildClassLabel } from "@/modules/fees/domain/policy-shaping";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { queueStaffNoticeToPermission } from "@/modules/staff-notices/data/enqueue";
import { logWarn } from "@/platform/observability/log";

/**
 * Telling the office about online payments (fees `staff-alerts.ts`, fees #107;
 * go-live Phase F, plan §8.4).
 *
 * The database queues one `staff_payment_alerts` row per online receipt (a
 * trigger on `receipts`, fee-migration `20261030170000`). This drains them,
 * called right after a posting (the webhook, the pay page, "Post now") and by
 * the ten-minute reconciler as the retry net; rows are leased, so those callers
 * never take one alert twice.
 *
 * Where One differs from the fees app, on purpose:
 *
 *  - **WhatsApp goes through the staff outbox**, never straight to AiSensy and
 *    never to a typed list of numbers (`online_payment_staff_whatsapp_numbers`
 *    is not read). While `online_payment_staff_whatsapp_enabled` is on, each
 *    alert becomes an `online_payment` staff notice for everybody with
 *    `fees:collect` — the people the fees app pushed to — and the outbox asks
 *    each person's consent, the switches, the window and the caps
 *    (`staff-notices/domain/gates.ts`). The alert row records `sent` once the
 *    notices are queued: whether each one went is on the outbox's own log.
 *  - **No Web Push.** One has no push sign-up (no subscription screen, and its
 *    service worker has no `push` handler), so `staff_push_subscriptions` is
 *    empty and every alert's push half is closed as `no_devices`. Porting
 *    `platform/push/web-push.ts` waits for a subscription screen.
 *  - **A child is named only if the school allows it** (`runtime_flags.
 *    staff_notice_student_names`); otherwise the class says who.
 *
 * The same drain also queues an `online_review` notice for every capture that
 * could not be posted automatically (`application_status = 'review_required'`),
 * to everybody with `fees:accounts`, once per capture. The outbox re-checks at
 * the moment it sends and drops it if somebody has already resolved it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const WHATSAPP_SWITCH = "online_payment_staff_whatsapp_enabled";
const REVIEW_LOOKBACK_MS = 3 * 86_400_000;

/** Any read failure reads as OFF. */
export async function readStaffAlertWhatsappOn(supabase: Db): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("app_settings").select("value").eq("key", WHATSAPP_SWITCH).maybeSingle();
    if (error) return false;
    return String(data?.value ?? "").toLowerCase() === "true";
  } catch {
    return false;
  }
}

type AlertRow = {
  id: string;
  receipt_id: string;
  student_id: string | null;
  receipt_number: string;
  amount_rupees: number;
  push_status: string;
  whatsapp_status: string;
  whatsapp_attempts: number;
};

type StudentFacts = { studentName: string; classLabel: string; sessionLabel: string | null };

type StudentRow = {
  id: string;
  full_name: string | null;
  class_ref: { class_name: string; section: string | null; stream_name: string | null; session_label: string | null } | null;
};

async function loadStudents(supabase: Db, ids: readonly string[]): Promise<Map<string, StudentFacts>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const facts = new Map<string, StudentFacts>();
  // A drain takes at most 10 alerts or 50 captures: far below the URL limit (rule 3b).
  if (unique.length === 0) return facts;
  const { data, error } = await supabase
    .from("students")
    .select("id, full_name, class_ref:classes(class_name, section, stream_name, session_label)")
    .in("id", unique);
  if (error) return facts;
  for (const row of (data ?? []) as StudentRow[]) {
    facts.set(row.id, {
      studentName: row.full_name ?? "",
      classLabel: row.class_ref ? buildClassLabel(row.class_ref) : "",
      sessionLabel: row.class_ref?.session_label ?? null,
    });
  }
  return facts;
}

export type StaffAlertDrain = { alerts: number; pushed: number; whatsappSent: number; reviews: number };

export async function drainStaffPaymentAlerts(args: {
  supabase: Db;
  outOfTime?: () => boolean;
  /** Tests: the outbox calls. */
  queue?: typeof queueStaffNoticeToPermission;
  dispatch?: typeof dispatchStaffNotices;
  now?: () => Date;
}): Promise<StaffAlertDrain> {
  const { supabase } = args;
  const queue = args.queue ?? queueStaffNoticeToPermission;
  const dispatch = args.dispatch ?? dispatchStaffNotices;
  const now = args.now ?? (() => new Date());
  const result: StaffAlertDrain = { alerts: 0, pushed: 0, whatsappSent: 0, reviews: 0 };

  const { data, error } = await supabase.rpc("staff_payment_alert_claim", { p_limit: 10, p_lease_seconds: 120 });
  if (error) {
    logWarn("staff_alerts.claim_failed", { error: error.message ?? "unknown" });
  } else {
    const alerts = (data ?? []) as AlertRow[];
    result.alerts = alerts.length;
    if (alerts.length > 0) {
      const [students, whatsappOn] = await Promise.all([
        loadStudents(supabase, alerts.map((alert) => alert.student_id ?? "")),
        readStaffAlertWhatsappOn(supabase),
      ]);
      for (const alert of alerts) {
        const stamp = now().toISOString();
        if (args.outOfTime?.()) {
          await supabase.from("staff_payment_alerts").update({ locked_until: null, updated_at: stamp }).eq("id", alert.id);
          continue;
        }
        const update: Record<string, unknown> = { locked_until: null, updated_at: stamp };
        if (alert.push_status === "queued") {
          update.push_status = "no_devices";
          update.push_devices = 0;
          update.push_done_at = stamp;
        }
        if (["queued", "partial", "failed"].includes(alert.whatsapp_status)) {
          const student = alert.student_id ? students.get(alert.student_id) : undefined;
          if (!whatsappOn) {
            update.whatsapp_status = "off";
            update.whatsapp_done_at = stamp;
          } else if (!student?.sessionLabel) {
            // Without the session the outbox cannot tell a TEST payment from a
            // real one, so it is not queued at all.
            update.whatsapp_status = "not_configured";
            update.whatsapp_done_at = stamp;
            update.last_error = "The student's session could not be read; no staff notice queued.";
          } else {
            try {
              await queue({
                key: `online_payment:${alert.receipt_id}`,
                kind: "online_payment",
                permission: "fees:collect",
                sessionLabel: student.sessionLabel,
                payload: {
                  receipt_id: alert.receipt_id,
                  receipt_number: alert.receipt_number,
                  amount_rupees: Number(alert.amount_rupees ?? 0),
                  student_name: student.studentName,
                  class_label: student.classLabel,
                },
                notAfter: new Date(now().getTime() + 86_400_000),
              });
              update.whatsapp_status = "sent";
              update.whatsapp_done_at = stamp;
              update.whatsapp_attempts = alert.whatsapp_attempts + 1;
              update.last_error = null;
              result.whatsappSent += 1;
            } catch (caught) {
              update.whatsapp_status = "failed";
              update.whatsapp_attempts = alert.whatsapp_attempts + 1;
              update.last_error = (caught instanceof Error ? caught.message : "queue failed").slice(0, 300);
              update.next_attempt_at = new Date(now().getTime() + 60_000 * 2 ** (alert.whatsapp_attempts + 1)).toISOString();
            }
          }
        }
        await supabase.from("staff_payment_alerts").update(update).eq("id", alert.id);
      }
    }
  }

  result.reviews = await queueOnlineReviewNotices({ supabase, queue, now }).catch((caught) => {
    logWarn("staff_alerts.review_queue_failed", { error: caught instanceof Error ? caught.message : "unknown" });
    return 0;
  });

  if (result.whatsappSent > 0 || result.reviews > 0) {
    // Best effort: the five-minute job is the retry net.
    await Promise.resolve()
      .then(() => dispatch({ max: result.whatsappSent * 4 + result.reviews * 4 + 5 }))
      .catch(() => null);
  }
  return result;
}

type CaptureRow = {
  id: string;
  amount_paise: number | null;
  intent_id: string | null;
  order_id: string | null;
  created_at: string;
};

/**
 * One `online_review` notice per capture that needs a person, from the last
 * three days. Idempotent on the capture: running every ten minutes queues each
 * once. The session comes from the payment's link (intent) or, for a pay-page
 * order, from the reminder it answered; a capture with neither is not queued.
 */
export async function queueOnlineReviewNotices(args: {
  supabase: Db;
  queue?: typeof queueStaffNoticeToPermission;
  now?: () => Date;
}): Promise<number> {
  const { supabase } = args;
  const queue = args.queue ?? queueStaffNoticeToPermission;
  const now = args.now ?? (() => new Date());
  const since = new Date(now().getTime() - REVIEW_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from("online_payment_captures")
    .select("id, amount_paise, intent_id, order_id, created_at")
    .eq("application_status", "review_required")
    .is("resolved_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message ?? "Could not read the captures");
  const captures = (data ?? []) as CaptureRow[];
  if (captures.length === 0) return 0;

  const intentIds = [...new Set(captures.map((c) => c.intent_id).filter((id): id is string => Boolean(id)))];
  const orderIds = [...new Set(captures.map((c) => c.order_id).filter((id): id is string => Boolean(id)))];
  const [intents, orders] = await Promise.all([
    intentIds.length
      ? supabase.from("online_payment_intents").select("id, student_id, session_label").in("id", intentIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("online_payment_orders").select("id, send_id").in("id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);
  const intentById = new Map(
    ((intents.data ?? []) as Array<{ id: string; student_id: string | null; session_label: string | null }>).map((row) => [row.id, row]),
  );
  const sendByOrder = new Map(((orders.data ?? []) as Array<{ id: string; send_id: string | null }>).map((row) => [row.id, row.send_id]));
  const sendIds = [...new Set([...sendByOrder.values()].filter((id): id is string => Boolean(id)))];
  const sends = sendIds.length
    ? await supabase.from("whatsapp_reminder_sends").select("id, student_id, session_label").in("id", sendIds)
    : { data: [] };
  const sendById = new Map(
    ((sends.data ?? []) as Array<{ id: string; student_id: string | null; session_label: string | null }>).map((row) => [row.id, row]),
  );

  const placed = captures.map((capture) => {
    const intent = capture.intent_id ? intentById.get(capture.intent_id) : undefined;
    const send = capture.order_id ? sendById.get(sendByOrder.get(capture.order_id) ?? "") : undefined;
    return {
      capture,
      studentId: intent?.student_id ?? send?.student_id ?? null,
      sessionLabel: intent?.session_label ?? send?.session_label ?? null,
    };
  });
  const students = await loadStudents(supabase, placed.map((row) => row.studentId ?? ""));

  let queued = 0;
  for (const row of placed) {
    if (!row.sessionLabel) continue;
    const student = row.studentId ? students.get(row.studentId) : undefined;
    queued += await queue({
      key: `online_review:${row.capture.id}`,
      kind: "online_review",
      permission: "fees:accounts",
      sessionLabel: row.sessionLabel,
      payload: {
        capture_id: row.capture.id,
        amount_rupees: Math.round(Number(row.capture.amount_paise ?? 0) / 100),
        student_name: student?.studentName ?? "",
        class_label: student?.classLabel ?? "",
      },
      notAfter: new Date(now().getTime() + 2 * 86_400_000),
    });
  }
  return queued;
}
