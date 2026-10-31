"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { afterOnlinePosting } from "@/modules/payments/data/online/after-posting";
import { applyCapture } from "@/modules/payments/data/online/service";
import { ONLINE_SWITCH_KEYS } from "@/modules/payments/domain/online/switches";
import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { assertNotTestAccount, assertStudentsVisible, passesFence } from "@/platform/auth/test-session-access";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { requireStaffPermission } from "@/modules/fees/platform/session";

/**
 * The three things a person does on the online-payments screen.
 *
 * Each re-checks its own permission rather than trusting the page that
 * rendered the button, and each runs through a database function that repeats
 * every money check: a press here cannot post a capture the ledger disagrees
 * with, only one that is still exactly what the parent paid against.
 *
 * One only (go-live Phase E): each also needs One's `fees:accounts` (the
 * screen's own gate), and each passes the test-session fence — a capture is
 * posted or closed only by someone who may see every student it pays for, and
 * the switches are school-wide, so a test account never flips one. The fees
 * app's four staff-alert actions arrive with the alerts sender (Phase 8).
 */

const PATH = "/fees/payments/online";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** The students a capture pays for: its link's one student, or each of its order's children. */
async function captureStudentIds(supabase: Db, captureId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("online_payment_captures")
    .select("intent_id, order_id, online_payment_intents(student_id), online_payment_orders(online_payment_order_lines(student_id))")
    .eq("id", captureId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    online_payment_intents?: { student_id?: string | null } | null;
    online_payment_orders?: { online_payment_order_lines?: Array<{ student_id?: string | null }> } | null;
  };
  const ids = row.online_payment_intents
    ? [row.online_payment_intents.student_id]
    : (row.online_payment_orders?.online_payment_order_lines ?? []).map((line) => line.student_id);
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * May this person act on this capture? A capture whose students cannot be
 * read (an unknown link, say) has no session to place it in, so only an
 * account that is not a test account may act on it.
 */
async function captureVisible(viewer: CurrentStaff, supabase: Db, captureId: string): Promise<boolean> {
  const studentIds = await captureStudentIds(supabase, captureId);
  if (studentIds === null) return false;
  if (studentIds.length === 0) return passesFence(() => assertNotTestAccount(viewer));
  return passesFence(() => assertStudentsVisible(viewer, studentIds));
}

/** Post a recorded capture now (automatic posting is off, or it was waiting). */
export async function postOnlinePaymentAction(formData: FormData): Promise<void> {
  const viewer = await assertPermission("fees:accounts");
  const staff = await requireStaffPermission("payments:write");
  const captureId = String(formData.get("captureId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) redirect(`${PATH}?notice=not_posted`);
  const supabase = createAdminClient();
  if (!(await captureVisible(viewer, supabase, captureId))) redirect(`${PATH}?notice=not_posted`);
  const outcome = await applyCapture(supabase, captureId, `staff:${staff.id}`);
  if (outcome === "applied") {
    // The same follow-through as the webhook: views, caches, staff tabs, and
    // the parent's receipt now.
    const { data } = await supabase
      .from("online_payment_captures")
      .select("provider_payment_id")
      .eq("id", captureId)
      .maybeSingle();
    if (data?.provider_payment_id) await afterOnlinePosting({ supabase, paymentIds: [data.provider_payment_id] });
  }
  revalidatePath(PATH);
  redirect(
    `${PATH}?notice=${outcome === "applied" ? "posted" : outcome === "duplicate" ? "already" : outcome === "review_required" ? "review" : "not_posted"}`,
  );
}

/**
 * Close a payment in review with a note saying what was done — posted by hand
 * at the desk, refunded through Razorpay, matched to another student. This
 * records the decision; it moves no money and deletes nothing.
 */
export async function resolveOnlineReviewAction(formData: FormData): Promise<void> {
  const viewer = await assertPermission("fees:accounts");
  const staff = await requireStaffPermission("finance:approve");
  const captureId = String(formData.get("captureId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(captureId) || note.length < 5) redirect(`${PATH}?notice=note_needed`);
  const supabase = createAdminClient();
  if (!(await captureVisible(viewer, supabase, captureId))) redirect(`${PATH}?notice=note_needed`);
  await supabase.rpc("online_payment_resolve_review", {
    p_capture_id: captureId,
    p_staff_id: staff.id,
    p_note: note,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?notice=resolved`);
}

/**
 * Flip one kill switch. Admin only, and written to the online audit trail.
 *
 * Only the seven boolean switches the screen shows (`ONLINE_SWITCH_KEYS`).
 * `online_payment_order_max_rupees` is a number, set by the operator, and the
 * staff-alert switch waits for Phase 8.
 */
export async function setOnlineSwitchAction(formData: FormData): Promise<void> {
  const viewer = await assertPermission("fees:accounts");
  const staff = await requireStaffPermission("settings:write");
  const key = String(formData.get("key") ?? "");
  const value = String(formData.get("value") ?? "") === "true" ? "true" : "false";
  if (!(ONLINE_SWITCH_KEYS as readonly string[]).includes(key)) redirect(`${PATH}?notice=not_switched`);
  if (!(await passesFence(() => assertNotTestAccount(viewer)))) redirect(`${PATH}?notice=not_switched`);
  const supabase = createAdminClient();
  await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  await supabase.from("online_payment_audit").insert({
    action: "switch_changed",
    detail: { key, value },
    actor: `staff:${staff.id}`,
  });
  revalidatePath(PATH);
  redirect(`${PATH}?notice=switched`);
}
