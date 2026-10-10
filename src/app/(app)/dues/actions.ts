"use server";

import { revalidatePath } from "next/cache";

import { logContactAction } from "@/app/(app)/fees/defaulters/actions";
import { closeDueAsDiscountAction } from "@/app/(app)/fees/students/close-due-actions";
import { activateRepaymentPlanAction, cancelRepaymentPlanAction } from "@/app/(app)/fees/students/repayment-plan-actions";
import { INITIAL_REPAYMENT_PLAN_ACTION_STATE } from "@/app/(app)/fees/students/repayment-plan-action-state";
import { loadLeftOwing } from "@/modules/defaulters/vx/data";
import {
  contactOutcomeFor,
  isCallOutcome,
  isWriteOffReason,
  monthlyAmountFor,
  validWriteOffAmount,
} from "@/modules/defaulters/vx/domain/families";
import { isIsoDate } from "@/modules/receipts/vx/domain/day-close";
import { previewRepaymentPlan } from "@/modules/repayment-plans/data/queries";
import { audienceLine, DEFAULT_AUDIENCE, isTemplateId, messageCost } from "@/modules/whatsapp/vx/domain/reminders";
import { assertPermission } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { schoolToday } from "@/vx/format";
import { decideWriteOffRequests, insertPromise, insertWriteOffRequest } from "@/vx/screens/dues/data";
import { insertBatch } from "@/vx/screens/reminders/data";
import { assertNotPreviewing } from "@/vx/view-as";

export type DuesActionResult = { ok: true; message?: string } | { ok: false; error: string };

function failure(caught: unknown): { ok: false; error: string } {
  return { ok: false, error: caught instanceof Error ? caught.message : "Something went wrong. Try again." };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanIds(ids: unknown): string[] {
  return Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 8) : [];
}

const SNOOZE_DAYS: Record<string, string | null> = { promised: null, visit: null, noreach: "1", wrong: null, time: "7" };

/**
 * Log a call for a family. The contact goes into the fee app's own log (one
 * row per child, so the classic Defaulters screen reads the same history);
 * a promise's day and amount also go into `vppsone.fee_call_promises`.
 */
export async function logCallAction(input: {
  studentIds: string[];
  sessionLabel: string;
  outcome: string;
  promisedOn?: string | null;
  amount?: number | null;
  note?: string;
  phone?: string | null;
}): Promise<DuesActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    const ids = cleanIds(input.studentIds);
    if (ids.length === 0) return { ok: false, error: "Pick a family first." };
    if (!isCallOutcome(input.outcome)) return { ok: false, error: "Choose how the call went." };
    const needsDay = input.outcome === "promised" || input.outcome === "visit";
    const day = input.promisedOn ?? "";
    if (needsDay && (!isIsoDate(day) || day < schoolToday())) return { ok: false, error: "Pick a day from today on." };
    const amount = Math.round(Number(input.amount ?? 0));
    if (input.outcome === "promised" && !(amount > 0)) return { ok: false, error: "Enter the amount they promised." };
    const note = (input.note ?? "").trim().slice(0, 500);

    // Every child is tried. Stopping at the first failure left the earlier
    // siblings logged, and the obvious retry logged them twice.
    let logged = 0;
    let lastError: string | null = null;
    for (const id of ids) {
      const form = new FormData();
      form.set("studentId", id);
      form.set("channel", "call");
      form.set("outcome", contactOutcomeFor(input.outcome));
      form.set("sessionLabel", input.sessionLabel);
      if (needsDay) form.set("promisedDate", day);
      const snooze = SNOOZE_DAYS[input.outcome];
      if (snooze) form.set("snoozeDays", snooze);
      if (note) form.set("note", note);
      if (input.phone) form.set("contactedPhone", input.phone);
      const res = await logContactAction({ status: "idle" }, form);
      if (res.status === "error") lastError = res.message ?? "Could not log the call.";
      else logged += 1;
    }
    if (logged === 0) return { ok: false, error: lastError ?? "Could not log the call." };
    if (lastError) {
      revalidatePath("/dues");
      return { ok: false, error: `Logged for ${logged} of ${ids.length} children; do not log it again. The rest failed: ${lastError}` };
    }

    if (needsDay) {
      await insertPromise({
        sessionLabel: input.sessionLabel,
        studentId: ids[0],
        kind: input.outcome === "visit" ? "visit" : "pay",
        promisedOn: day,
        amount: input.outcome === "visit" ? 0 : amount,
        note: note || null,
        createdBy: staff.id,
        createdByName: staff.displayName,
      });
    }
    revalidatePath("/dues");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

/**
 * Queue one WhatsApp reminder for a family. QUEUED ONLY: nothing is sent from
 * VPPS One (CLAUDE.md rule 8); the batch waits for the fee app's sender.
 */
export async function queueFamilyReminderAction(input: {
  studentIds: string[];
  sessionLabel: string;
  familyName: string;
  template: string;
  amount: number;
}): Promise<DuesActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    const ids = cleanIds(input.studentIds);
    if (ids.length === 0) return { ok: false, error: "Pick a family first." };
    const template = isTemplateId(input.template) ? input.template : "gentle";
    await insertBatch({
      sessionLabel: input.sessionLabel,
      name: `Dues · ${input.familyName.slice(0, 60) || "family"}`,
      template,
      language: "both",
      audience: DEFAULT_AUDIENCE,
      audienceLine: `${audienceLine(DEFAULT_AUDIENCE)} · one family`,
      studentIds: ids,
      familyCount: 1,
      moneyQuoted: Math.max(0, Math.round(Number(input.amount) || 0)),
      costEstimate: messageCost(1),
      scheduledFor: null,
      createdBy: staff.id,
      createdByName: staff.displayName,
    });
    revalidatePath("/reminders");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

export type PlanPreview =
  | {
      ok: true;
      scope: string;
      openingBalance: number;
      monthlyAmount: number;
      lateFeeWaived: number;
      schedule: { dueDate: string; amount: number }[];
      covers: string[];
      hasActivePlan: boolean;
      canActivate: boolean;
      errors: string[];
    }
  | { ok: false; error: string };

async function buildPreview(studentId: string, sessionLabel: string, scope: string, parts: number, firstDueDate: string): Promise<PlanPreview> {
  const first = await previewRepaymentPlan({ studentId, sessionLabel, scope, monthlyAmount: null, firstDueDate });
  if (!first.ok) return { ok: false, error: first.message };
  const opening = Math.round(first.preview.openingBalance);
  if (opening <= 0) return { ok: false, error: "Nothing is owed that a plan could cover." };
  const monthly = monthlyAmountFor(opening, parts);
  const res = await previewRepaymentPlan({ studentId, sessionLabel, scope, monthlyAmount: monthly, firstDueDate });
  if (!res.ok) return { ok: false, error: res.message };
  const pv = res.preview;
  return {
    ok: true,
    scope,
    openingBalance: Math.round(pv.openingBalance),
    monthlyAmount: monthly,
    lateFeeWaived: Math.round(pv.lateFeeWaived),
    schedule: pv.schedule.map((s) => ({ dueDate: s.dueDate, amount: s.amount })),
    covers: pv.items.map((i) => i.installmentLabel ?? (i.isCarryForward ? "Last year" : `Inst ${i.installmentNo ?? ""}`)),
    hasActivePlan: pv.hasActivePlan,
    canActivate: pv.canActivate,
    errors: pv.errors ?? [],
  };
}

function checkPlanInput(input: { studentId: string; parts: number; firstDueDate: string; scope: string }): string | null {
  if (!UUID.test(input.studentId)) return "Pick a child.";
  if (!Number.isInteger(input.parts) || input.parts < 2 || input.parts > 6) return "Choose 2 to 6 parts.";
  if (!isIsoDate(input.firstDueDate) || input.firstDueDate < schoolToday()) return "Pick the first day from today on.";
  if (input.scope !== "current_year_only" && input.scope !== "old_and_current") return "Choose what the plan covers.";
  return null;
}

/** The plan as the fee app would make it. A read: nothing is saved. */
export async function previewPlanAction(input: { studentId: string; sessionLabel: string; scope: string; parts: number; firstDueDate: string }): Promise<PlanPreview> {
  try {
    await assertPermission("fees:view");
    const bad = checkPlanInput(input);
    if (bad) return { ok: false, error: bad };
    return await buildPreview(input.studentId, input.sessionLabel, input.scope, input.parts, input.firstDueDate);
  } catch (caught) {
    return failure(caught);
  }
}

/** Start an EMI plan through the fee app's own action (admin, and only where plans are switched on). */
export async function activatePlanAction(input: {
  studentId: string;
  sessionLabel: string;
  scope: string;
  parts: number;
  firstDueDate: string;
  reason: string;
  clientRequestId: string;
}): Promise<{ ok: true; planId: string | null; message: string } | { ok: false; error: string }> {
  try {
    await assertPermission("fees:manage");
    await assertNotPreviewing();
    const bad = checkPlanInput(input);
    if (bad) return { ok: false, error: bad };
    const preview = await buildPreview(input.studentId, input.sessionLabel, input.scope, input.parts, input.firstDueDate);
    if (!preview.ok) return preview;
    if (!preview.canActivate) return { ok: false, error: preview.errors[0] ?? "This plan cannot be started." };
    const form = new FormData();
    form.set("studentId", input.studentId);
    form.set("sessionLabel", input.sessionLabel);
    form.set("scope", input.scope);
    form.set("monthlyAmount", String(preview.monthlyAmount));
    form.set("firstDueDate", input.firstDueDate);
    form.set("reason", input.reason.trim().slice(0, 300) || "Agreed on a call");
    form.set("expectedOpeningBalance", String(preview.openingBalance));
    form.set("clientRequestId", input.clientRequestId);
    form.set("acknowledged", "on");
    const res = await activateRepaymentPlanAction(INITIAL_REPAYMENT_PLAN_ACTION_STATE, form);
    if (res.status !== "success") return { ok: false, error: res.message ?? "Could not start the plan." };
    revalidatePath("/dues");
    return { ok: true, planId: res.planId, message: res.message ?? "" };
  } catch (caught) {
    return failure(caught);
  }
}

/** Undo a plan just made. The fee app cancels it; it stays on file as cancelled. */
export async function undoPlanAction(input: { planId: string; studentId: string; sessionLabel: string }): Promise<DuesActionResult> {
  try {
    await assertPermission("fees:manage");
    await assertNotPreviewing();
    const form = new FormData();
    form.set("planId", input.planId);
    form.set("studentId", input.studentId);
    form.set("sessionLabel", input.sessionLabel);
    form.set("reason", "Undone straight after it was made");
    const res = await cancelRepaymentPlanAction(INITIAL_REPAYMENT_PLAN_ACTION_STATE, form);
    if (res.status !== "success") return { ok: false, error: res.message ?? "Could not undo the plan." };
    revalidatePath("/dues");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

/** Ask an admin to write off what a child who left still owes. Nothing moves until they decide. */
export async function requestWriteOffAction(input: { studentId: string; sessionLabel: string; amount: number; reasonCode: string; note: string }): Promise<DuesActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    if (!isWriteOffReason(input.reasonCode)) return { ok: false, error: "Choose why." };
    const left = (await loadLeftOwing()).find((l) => l.studentId === input.studentId);
    if (!left) return { ok: false, error: "This child no longer owes anything." };
    const amount = Number(input.amount);
    if (!validWriteOffAmount(amount, left.owed)) return { ok: false, error: `Enter an amount from ₹1 to ₹${Math.round(left.owed)}.` };
    const outcome = await insertWriteOffRequest({
      sessionLabel: input.sessionLabel,
      studentId: input.studentId,
      amount,
      reasonCode: input.reasonCode,
      note: input.note.trim().slice(0, 500) || null,
      requestedBy: staff.id,
      requestedByName: staff.displayName,
    });
    revalidatePath("/dues");
    return outcome === "exists" ? { ok: true, message: "exists" } : { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

const WRITE_OFF_LABEL: Record<string, string> = {
  moved: "Family moved away",
  hardship: "Family in hardship",
  too_small: "Too small to chase",
  settled: "Settled by talk",
};

/**
 * An admin writes off what a child who left owes, or declines a request to.
 * The write-off goes through the fee app's own close-as-discount action (a
 * discount receipt; nothing is deleted), and only then is the request marked
 * approved, so a failed posting leaves it waiting under Needs you.
 */
export async function decideWriteOffAction(input: {
  studentId: string;
  sessionLabel: string;
  decision: "approve" | "decline";
  amount: number;
  reasonCode: string;
  note: string;
}): Promise<DuesActionResult> {
  try {
    const staff = await assertPermission("fees:view");
    await assertNotPreviewing();
    if (!feePermissionsFor(staff.role).includes("finance:write")) return { ok: false, error: "Only an admin can decide a write-off." };
    if (!UUID.test(input.studentId)) return { ok: false, error: "Pick a child." };
    const note = input.note.trim().slice(0, 500);

    if (input.decision === "decline") {
      const closed = await decideWriteOffRequests(input.studentId, input.sessionLabel, "declined", staff.id, note || null);
      if (closed === 0) return { ok: false, error: "There is no write-off waiting for this child." };
      revalidatePath("/dues");
      revalidatePath("/inbox");
      revalidatePath("/");
      return { ok: true, message: "declined" };
    }

    if (!isWriteOffReason(input.reasonCode)) return { ok: false, error: "Choose why." };
    const left = (await loadLeftOwing()).find((l) => l.studentId === input.studentId);
    if (!left) return { ok: false, error: "This child no longer owes anything." };
    const amount = Number(input.amount);
    if (!validWriteOffAmount(amount, left.owed)) return { ok: false, error: `Enter an amount from ₹1 to ₹${Math.round(left.owed)}.` };

    const form = new FormData();
    form.set("studentId", input.studentId);
    form.set("sessionLabel", input.sessionLabel);
    form.set("amount", String(Math.round(amount)));
    form.set("reason", note ? `${WRITE_OFF_LABEL[input.reasonCode]}: ${note}` : WRITE_OFF_LABEL[input.reasonCode]);
    form.set("writeOffReason", "left_school");
    const result = await closeDueAsDiscountAction({ status: "idle", message: null, receiptNumber: null }, form);
    if (result.status !== "success") return { ok: false, error: result.message ?? "Could not write this off." };
    // The money has moved; a failure to close the request must not read as a failed write-off.
    await decideWriteOffRequests(input.studentId, input.sessionLabel, "approved", staff.id, note || null).catch(() => 0);
    revalidatePath("/dues");
    revalidatePath("/inbox");
    revalidatePath("/");
    return { ok: true, message: result.receiptNumber ?? "approved" };
  } catch (caught) {
    return failure(caught);
  }
}
