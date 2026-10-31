"use server";

import { revalidatePath } from "next/cache";

import { sendRemindersAction } from "@/app/(app)/fees/reminders/actions";
import {
  importDeliveryReport,
  markNumberHealth,
  resolveFailedSends,
  resolveStuckSends,
  type SendResolution,
} from "@/modules/whatsapp/data/delivery-store";
import { resolveReminderSessionLabel } from "@/modules/whatsapp/data/reminder-session";
import { istToday } from "@/modules/whatsapp/domain/fee-reminders";
import { toWhatsappDestination } from "@/modules/whatsapp/domain/phone";
import { explainUnusablePhone, phoneKey } from "@/modules/whatsapp/domain/phone-numbers";
import { drainFinancialViewRefresh } from "@/modules/system-sync/data/financial-view-refresh";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { createClient } from "@/modules/fees/platform/supabase/server";
import {
  hasStaffPermission,
  requireAnyStaffPermission,
  requireStaffPermission,
} from "@/modules/fees/platform/session";
import { formatDdMmYyyy } from "@/platform/helpers/date";
import { assertNotTestAccount, assertSessionWritable, assertStudentsVisible, assertStudentVisible } from "@/platform/auth/test-session-access";
import { writtenBeforeWatermark } from "@/platform/migration/cutover-watermark";
import { readCutoverWatermark } from "@/platform/migration/cutover-watermark-reader";

/**
 * What the failure desk can do: resend, fix a number, close a failure by hand,
 * say what a number is worth, and read AiSensy's report.
 *
 * **Resend is not a second send path.** It rebuilds the same form the Send
 * screen posts — the failed run's notice, language and installments, with the
 * failed families named by hand — and hands it to `sendRemindersAction`. So the
 * resend gets every guard, the budget, the quiet hours, the ledger re-check, the
 * sibling grouping, and above all the claim: the sender takes today's failed row
 * back with an update guarded on its status, so two people pressing Resend at
 * once send ONE message and the second press reads "already". The old run-page
 * retry read the failed rows and sent them with no claim at all.
 *
 * Re-quoted from today's ledger, every child: a family that paid since is
 * reported as paid and not messaged, and a two-child family's figure is today's
 * figure for both children.
 *
 * One (go-live Phase F, ported from fees origin/main 3cc2de4b + 2c0ada0a):
 * every action that names a reminder, a student or a session checks the
 * test-session fence first — a test account acts on TEST rows only, real staff
 * never on TEST ones (`assertStudentsVisible` on the sends' own students,
 * `assertStudentVisible`, `assertSessionWritable`); and a reminder the fees
 * app wrote before cutover is never re-sent from One (critique0 #12, the
 * cutover line in `migration_runs`), because the fees app may have retried it.
 */

/** The fence for a set of reminders: every one of their students must be this viewer's to touch. */
async function assertSendsVisible(sendIds: readonly string[]): Promise<void> {
  const ids = [...new Set(sendIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return;
  const { data, error } = await createAdminClient().from("whatsapp_reminder_sends").select("student_id").in("id", ids);
  if (error) throw new Error("Could not read those reminders.");
  await assertStudentsVisible(
    null,
    ((data ?? []) as Array<{ student_id: string | null }>).map((row) => row.student_id).filter((id): id is string => Boolean(id)),
  );
}

export type FixActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export const IDLE_FIX_ACTION: FixActionState = { status: "idle" };

const MAX_RESEND = 60;

type SendForResend = {
  id: string;
  student_id: string;
  run_id: string | null;
  sent_on: string;
  status: string;
  delivery_status: string | null;
  failure_cause?: string | null;
  resolution?: string | null;
  pay_scope: { studentIds?: unknown } | null;
  created_at: string;
  session_label: string;
};

type RunForResend = {
  id: string;
  situation: string;
  language: string;
  last_date: string | null;
  filters: {
    installments?: unknown;
    lastYear?: unknown;
    installmentMatch?: unknown;
    includeRte?: unknown;
  } | null;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Resend the given failed rows through the Send screen's own action.
 *
 * Shared by Resend, "Save & resend" and the stuck-row "It didn't go"; every
 * caller has checked `settings:write` first, and `sendRemindersAction` checks
 * it again.
 */
async function resendSends(sendIds: string[]): Promise<FixActionState> {
  const ids = [...new Set(sendIds.filter(Boolean))].slice(0, MAX_RESEND);
  if (ids.length === 0) return { status: "error", message: "Nothing selected to resend." };

  const supabase = createAdminClient();
  const today = istToday();

  const columns = "id, student_id, run_id, sent_on, status, delivery_status, pay_scope, created_at, session_label";
  const withCause = await supabase
    .from("whatsapp_reminder_sends")
    .select(`${columns}, failure_cause, resolution`)
    .in("id", ids);
  // Before `20261030190000` there is no cause or resolution column.
  const read = withCause.error
    ? await supabase.from("whatsapp_reminder_sends").select(columns).in("id", ids)
    : withCause;
  if (read.error) return { status: "error", message: `Could not read those reminders: ${read.error.message}` };

  const allRows = (read.data ?? []) as unknown as SendForResend[];
  await assertStudentsVisible(null, allRows.map((row) => row.student_id));
  const watermark = await readCutoverWatermark("public.whatsapp_reminder_sends");
  const rows = allRows.filter((row) => !writtenBeforeWatermark(row, watermark));
  const fromFeesApp = allRows.length - rows.length;
  let notFailing = 0;
  let heldForTomorrow = 0;
  const byRun = new Map<string, SendForResend[]>();
  let noRun = 0;
  for (const row of rows) {
    const failing =
      !row.resolution &&
      (row.status === "failed" || (row.status === "sent" && row.delivery_status === "failed"));
    if (!failing) {
      notFailing += 1;
      continue;
    }
    // WhatsApp held it back today; the same message today fails the same way.
    if (row.failure_cause === "whatsapp_limit" && row.sent_on === today) {
      heldForTomorrow += 1;
      continue;
    }
    if (!row.run_id) {
      noRun += 1;
      continue;
    }
    const list = byRun.get(row.run_id);
    if (list) list.push(row);
    else byRun.set(row.run_id, [row]);
  }

  const { data: runData } = byRun.size
    ? await supabase
        .from("whatsapp_campaign_runs")
        .select("id, situation, language, last_date, filters")
        .in("id", [...byRun.keys()])
    : { data: [] };
  const runs = new Map(((runData ?? []) as RunForResend[]).map((run) => [run.id, run]));

  let sent = 0;
  let failed = 0;
  let already = 0;
  let paidSince = 0;
  let notReachable = 0;
  const refusals: string[] = [];

  for (const [runId, group] of byRun) {
    const run = runs.get(runId);
    if (!run) {
      noRun += group.length;
      continue;
    }

    // The failed message's own children, so a family message is resent as a
    // family message. `withFamily` adds anyone else the sender groups with them.
    const studentIds = [
      ...new Set(
        group.flatMap((row) => {
          const scoped = Array.isArray(row.pay_scope?.studentIds)
            ? (row.pay_scope!.studentIds as unknown[]).filter((id): id is string => typeof id === "string")
            : [];
          return [row.student_id, ...scoped];
        }),
      ),
    ];

    const installments = Array.isArray(run.filters?.installments)
      ? (run.filters!.installments as unknown[]).map(Number).filter((n) => n >= 1 && n <= 4)
      : [];
    const tiles = [
      ...installments.map(String),
      ...(run.filters?.lastYear === true ? ["last_year"] : []),
    ];

    const form = new FormData();
    form.set("situation", run.situation);
    form.set("language", run.language);
    if (tiles.length > 0) form.set("installments", tiles.join(","));
    if (run.filters?.installmentMatch === "any" || run.filters?.installmentMatch === "all") {
      form.set("installmentMatch", String(run.filters.installmentMatch));
    }
    if (run.filters?.includeRte === true) form.set("includeRte", "true");
    // The notice's own date while parents can still meet it. A date that has
    // gone is left out, so the send opens on the office's current one — the
    // same date the Send screen would offer today — rather than being refused.
    if (run.last_date && run.last_date >= today) form.set("lastDate", formatDdMmYyyy(run.last_date));
    form.set("include", studentIds.join(","));
    for (const studentId of studentIds) form.append("studentId", studentId);
    form.set("withFamily", "1");
    form.set("skipNothingDue", "1");

    const outcome = await sendRemindersAction({ status: "idle" }, form);
    sent += outcome.sent ?? 0;
    failed += outcome.failed ?? 0;
    already += outcome.alreadySentToday ?? 0;
    paidSince += outcome.paidSince?.length ?? 0;
    notReachable += outcome.notOnList?.length ?? 0;
    if (outcome.status === "error" && !outcome.sent && outcome.message) refusals.push(outcome.message);
  }

  revalidatePath("/fees/reminders/fix");
  for (const runId of byRun.keys()) revalidatePath(`/fees/reminders/runs/${runId}`);

  const parts = [
    sent > 0 ? `${plural(sent, "message", "messages")} sent` : null,
    failed > 0 ? `${failed} failed again` : null,
    already > 0 ? `${already} already sent today (someone else may be resending)` : null,
    paidSince > 0 ? `${plural(paidSince, "child has", "children have")} paid since, not messaged` : null,
    notReachable > 0
      ? `${plural(notReachable, "child is", "children are")} not on today's list: no working number, no-call, or nothing owed`
      : null,
    heldForTomorrow > 0 ? `${heldForTomorrow} held by WhatsApp today, resend tomorrow` : null,
    notFailing > 0 ? `${notFailing} no longer failing` : null,
    noRun > 0 ? `${noRun} have no run on record; send them from the Send screen` : null,
    fromFeesApp > 0 ? `${fromFeesApp} not re-sent: they were sent by the fees app before the move to VPPS One` : null,
  ].filter(Boolean);

  if (refusals.length > 0 && sent === 0) {
    return { status: "error", message: [refusals[0], ...parts].join(" · ") };
  }
  return {
    status: sent > 0 ? "success" : "error",
    message: parts.length > 0 ? parts.join(" · ") : "Nothing was sent.",
  };
}

export async function resendFailuresAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Only an admin can send reminders." };
  }
  const sendIds = formData.getAll("sendId").map(String).filter(Boolean);
  try {
    return await resendSends(sendIds);
  } catch (caught) {
    return { status: "error", message: caught instanceof Error ? caught.message : "Could not resend." };
  }
}

/**
 * Save a family's numbers from the desk, and resend if asked.
 *
 * Writes the student record with the STAFF member's own client, so RLS decides
 * and the `audit_students` trigger records who changed what — the old number
 * and the new, without this action writing a second audit of its own. Siblings
 * whose record carried the same old number are changed with it when ticked: a
 * shared phone is one family's phone.
 */
export async function saveFamilyNumberAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  let staff: Awaited<ReturnType<typeof requireAnyStaffPermission>>;
  try {
    staff = await requireAnyStaffPermission(["students:write", "students:edit_basic"]);
  } catch {
    return { status: "error", message: "You cannot edit student contact details." };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  if (!studentId) return { status: "error", message: "No student given." };
  try {
    await assertStudentVisible(null, studentId);
    const siblingIdsToCheck = formData.getAll("siblingId").map(String).filter(Boolean).slice(0, 10);
    if (siblingIdsToCheck.length > 0) await assertStudentsVisible(null, siblingIdsToCheck);
  } catch {
    return { status: "error", message: "Could not find that student." };
  }
  const fatherRaw = String(formData.get("fatherPhone") ?? "").trim();
  const motherRaw = String(formData.get("motherPhone") ?? "").trim();

  for (const [label, raw] of [
    ["Father's number", fatherRaw],
    ["Mother's number", motherRaw],
  ] as const) {
    if (raw && !toWhatsappDestination(raw)) {
      return { status: "error", message: `${label}: ${explainUnusablePhone(raw) ?? "not a mobile number."}` };
    }
  }
  if (!fatherRaw && !motherRaw) {
    return { status: "error", message: "Enter at least one 10-digit mobile number." };
  }
  // Stored as the bare ten digits, the way the office types them.
  const father = fatherRaw ? phoneKey(toWhatsappDestination(fatherRaw)) : null;
  const mother = motherRaw ? phoneKey(toWhatsappDestination(motherRaw)) : null;

  const admin = createAdminClient();
  const { data: current, error: currentError } = await admin
    .from("students")
    .select("id, primary_phone, secondary_phone")
    .eq("id", studentId)
    .maybeSingle();
  if (currentError || !current) return { status: "error", message: "Could not find that student." };
  const oldFather = phoneKey(current.primary_phone as string | null);
  const oldMother = phoneKey(current.secondary_phone as string | null);

  const supabase = await createClient();
  const { error: updateError } = await supabase
    .from("students")
    .update({ primary_phone: father, secondary_phone: mother })
    .eq("id", studentId)
    .select("id")
    .single();
  if (updateError) return { status: "error", message: `Could not save: ${updateError.message}` };

  // Siblings on the same OLD number get the same correction, field for field.
  const siblingIds = formData
    .getAll("siblingId")
    .map(String)
    .filter((id) => id && id !== studentId);
  let siblingsChanged = 0;
  if (formData.get("applyToSiblings") === "1" && siblingIds.length > 0) {
    const { data: siblings } = await admin
      .from("students")
      .select("id, primary_phone, secondary_phone")
      .in("id", siblingIds.slice(0, 10));
    for (const sibling of (siblings ?? []) as Array<{
      id: string;
      primary_phone: string | null;
      secondary_phone: string | null;
    }>) {
      const changes: Record<string, string | null> = {};
      if (oldFather && phoneKey(sibling.primary_phone) === oldFather && father !== oldFather) {
        changes.primary_phone = father;
      }
      if (oldMother && phoneKey(sibling.secondary_phone) === oldMother && mother !== oldMother) {
        changes.secondary_phone = mother;
      }
      if (Object.keys(changes).length === 0) continue;
      const { error } = await supabase.from("students").update(changes).eq("id", sibling.id);
      if (!error) siblingsChanged += 1;
    }
  }

  // Re-typing a number WhatsApp rejected is the office vouching for it.
  // Only when they say so: an untouched dead number stays dead.
  const staffId = (staff?.id as string | undefined) ?? null;
  for (const [field, key] of [
    ["retryFather", father],
    ["retryMother", mother],
  ] as const) {
    if (formData.get(field) === "1" && key) {
      await markNumberHealth({
        supabase: admin,
        phoneKey: key,
        working: true,
        note: "Office re-entered the number",
        staffId,
      }).catch(() => undefined);
    }
  }

  // The reminder list reads numbers from the financial view; the student update
  // queued its refresh, and this applies it before anything reads it back.
  await drainFinancialViewRefresh();
  revalidatePath("/fees/reminders/fix");
  revalidatePath(`/fees/students/${studentId}`);

  // Who else is on the new number, so the office knows they will share one message.
  // `key` is ten validated digits, so it is safe inside the filter string.
  const shared = new Set<string>();
  for (const key of [father, mother].filter((value): value is string => Boolean(value))) {
    const { data: others } = await admin
      .from("students")
      .select("id, full_name, admission_no")
      .neq("id", studentId)
      .or(`primary_phone.ilike.*${key},secondary_phone.ilike.*${key}`)
      .limit(3);
    for (const other of (others ?? []) as Array<{
      id: string;
      full_name: string | null;
      admission_no: string | null;
    }>) {
      if (shared.size < 3) shared.add(`${other.full_name ?? ""} (${other.admission_no ?? ""})`);
    }
  }
  const savedLine =
    `Saved.${siblingsChanged > 0 ? ` ${plural(siblingsChanged, "sibling", "siblings")} updated too.` : ""}` +
    (shared.size > 0 ? ` Also on ${[...shared].join(", ")}, so they share one message.` : "");

  if (formData.get("resend") !== "1") return { status: "success", message: savedLine };

  if (!hasStaffPermission(staff, "settings:write")) {
    return { status: "success", message: `${savedLine} Ask an admin to press Resend.` };
  }
  const sendIds = formData.getAll("sendId").map(String).filter(Boolean);
  if (sendIds.length === 0) return { status: "success", message: savedLine };
  const resent = await resendSends(sendIds);
  return {
    status: resent.status === "error" ? "error" : "success",
    message: `${savedLine} ${resent.message ?? ""}`.trim(),
  };
}

const RESOLUTIONS: readonly SendResolution[] = ["called", "slip_sent", "dismissed"];

export async function markHandledAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Only an admin can close a failure." };
  }
  const resolution = String(formData.get("resolution") ?? "") as SendResolution;
  if (!RESOLUTIONS.includes(resolution)) return { status: "error", message: "Pick what happened." };
  const note = String(formData.get("note") ?? "").trim();
  if (resolution === "dismissed" && note.length < 3) {
    return { status: "error", message: "Say why this one is not being chased, so the record explains itself." };
  }
  const sendIds = formData.getAll("sendId").map(String).filter(Boolean);
  try {
    await assertSendsVisible(sendIds);
    const count = await resolveFailedSends({
      supabase: createAdminClient(),
      sendIds,
      resolution,
      note,
      staffId,
    });
    revalidatePath("/fees/reminders/fix");
    if (count === 0) return { status: "error", message: "Nothing open to close: it was resent or closed already." };
    const what =
      resolution === "called" ? "marked as called" : resolution === "slip_sent" ? "marked slip sent" : "dismissed";
    return { status: "success", message: `${plural(count, "failure", "failures")} ${what}.` };
  } catch (caught) {
    return { status: "error", message: caught instanceof Error ? caught.message : "Could not record that." };
  }
}

export async function markNumberAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Only an admin can change this." };
  }
  const key = phoneKey(String(formData.get("phone") ?? ""));
  if (!key) return { status: "error", message: "No number given." };
  try {
    // A number's health is shared by every family on it, real ones included.
    await assertNotTestAccount(null);
  } catch {
    return { status: "error", message: "A test account cannot change what the whole school shares." };
  }
  const working = formData.get("working") === "1";
  try {
    await markNumberHealth({
      supabase: createAdminClient(),
      phoneKey: key,
      working,
      note: working ? "Office says it works" : "Office says it does not work",
      staffId,
    });
    revalidatePath("/fees/reminders/fix");
    return {
      status: "success",
      message: working
        ? "Marked as working. The next reminder will try it again."
        : "Marked as not working. Reminders will use the other parent's number.",
    };
  } catch (caught) {
    return { status: "error", message: caught instanceof Error ? caught.message : "Could not record that." };
  }
}

/** How large an AiSensy report may be. A term of campaigns is thousands of rows, not millions. */
const MAX_REPORT_BYTES = 5_000_000;

export async function importSessionReportAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  try {
    await requireStaffPermission("settings:write");
  } catch {
    return { status: "error", message: "Only an admin can import a report." };
  }
  const file = formData.get("report");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose the AiSensy campaign report (CSV) first." };
  }
  if (file.size > MAX_REPORT_BYTES) {
    return { status: "error", message: "That file is larger than a campaign report should be." };
  }
  try {
    const supabase = createAdminClient();
    const sessionLabel = await resolveReminderSessionLabel(supabase);
    await assertSessionWritable(null, sessionLabel);
    const summary = await importDeliveryReport({ supabase, csv: await file.text(), sessionLabel });
    if (summary.error) return { status: "error", message: summary.error };
    revalidatePath("/fees/reminders/fix");
    const parts = [
      `${summary.matched} updated`,
      summary.failed > 0 ? `${summary.failed} not delivered` : null,
      summary.delivered > 0 ? `${summary.delivered} delivered or read` : null,
      summary.unchanged > 0 ? `${summary.unchanged} already up to date` : null,
      summary.unmatched > 0 ? `${summary.unmatched} matched nothing in ${sessionLabel}` : null,
      summary.skipped > 0 ? `${summary.skipped} rows unreadable` : null,
    ].filter(Boolean);
    return { status: "success", message: parts.join(" · ") };
  } catch (caught) {
    return { status: "error", message: caught instanceof Error ? caught.message : "Could not read that file." };
  }
}

/**
 * A row that never heard back: a person checked AiSensy and says what happened.
 * "It didn't go" records the failure and resends in the same press.
 */
export async function resolveStuckAction(
  _prev: FixActionState,
  formData: FormData,
): Promise<FixActionState> {
  let staffId: string | null = null;
  try {
    const staff = await requireStaffPermission("settings:write");
    staffId = (staff?.id as string | undefined) ?? null;
  } catch {
    return { status: "error", message: "Only an admin can record this." };
  }
  const sendIds = formData.getAll("sendId").map(String).filter(Boolean);
  const outcome = String(formData.get("outcome") ?? "");
  if (sendIds.length === 0) return { status: "error", message: "Nothing selected." };
  if (outcome !== "sent" && outcome !== "failed") return { status: "error", message: "Pick what happened." };
  try {
    await assertSendsVisible(sendIds);
  } catch {
    return { status: "error", message: "Those reminders could not be found." };
  }

  const supabase = createAdminClient();
  const { data: pending } = await supabase
    .from("whatsapp_reminder_sends")
    .select("id")
    .in("id", sendIds)
    .eq("status", "pending");
  const ids = ((pending ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return { status: "error", message: "These are no longer pending." };

  try {
    await resolveStuckSends({
      supabase,
      sendIds: ids,
      outcome,
      reason:
        outcome === "sent"
          ? "Checked the AiSensy dashboard: it went."
          : "Checked the AiSensy dashboard: it did not go.",
      staffId,
    });
  } catch (caught) {
    return { status: "error", message: caught instanceof Error ? caught.message : "Could not record that." };
  }

  if (outcome === "sent") {
    revalidatePath("/fees/reminders/fix");
    return { status: "success", message: `${plural(ids.length, "reminder", "reminders")} recorded as sent.` };
  }
  const resent = await resendSends(ids);
  return { status: resent.status, message: `Recorded as not sent. ${resent.message ?? ""}`.trim() };
}
