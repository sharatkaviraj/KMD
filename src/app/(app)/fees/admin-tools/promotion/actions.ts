"use server";

import { revalidatePath } from "next/cache";

import { revalidateTagAfterWrite } from "@/modules/system-sync/data/finance-revalidation";
import { redirect } from "next/navigation";

import { deleteAcademicSession } from "@/modules/master-data/data/queries";
import {
  applyPromotionRun,
  createPromotionPreview,
  rollbackPromotionRun,
  updatePromotionEntryDecision,
  type PromotionEntryDecision,
} from "@/modules/promotion/data/queries";
import { requireStaffPermission } from "@/modules/fees/platform/session";

function asString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function createPromotionPreviewAction(formData: FormData) {
  // Guarded here, not only on the page. A Server Action is reachable
  // without ever rendering the screen that offers it, which is what
  // D-99 and tests/action-guards.test.ts exist for — and this one moves
  // every student in the school between sessions.
  //
  // `students:write` is the page's own guard, copied rather than chosen:
  // the point is to close a door, not to invent a stricter policy than the
  // school has been running.
  await requireStaffPermission("students:write");
  const sourceSession = asString(formData.get("sourceSessionLabel"));
  const targetSession = asString(formData.get("targetSessionLabel"));

  try {
    const result = await createPromotionPreview({
      sourceSessionLabel: sourceSession,
      targetSessionLabel: targetSession,
    });
    revalidatePath("/fees/admin-tools/promotion");
    redirect(`/fees/admin-tools/promotion/${result.run.id}`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to build promotion preview.";
    redirect(`/fees/admin-tools/promotion?error=${encodeURIComponent(message)}`);
  }
}

export async function applyPromotionRunAction(formData: FormData) {
  // Guarded here, not only on the page. A Server Action is reachable
  // without ever rendering the screen that offers it, which is what
  // D-99 and tests/action-guards.test.ts exist for — and this one moves
  // every student in the school between sessions.
  //
  // `students:write` is the page's own guard, copied rather than chosen:
  // the point is to close a door, not to invent a stricter policy than the
  // school has been running.
  await requireStaffPermission("students:write");
  const runId = asString(formData.get("runId"));
  const confirmation = asString(formData.get("confirmation"));

  if (!runId) {
    redirect(
      `/fees/admin-tools/promotion?error=${encodeURIComponent("Run id is required.")}`,
    );
  }

  if (confirmation !== "APPLY") {
    redirect(
      `/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent("Type APPLY to confirm the bulk class promotion.")}`,
    );
  }

  try {
    await applyPromotionRun(runId);
    // Transfer to Next Session copies the fee policy into the new year. The
    // fee-policy resolvers are cached for 300s under this tag; without the
    // bust, loadPolicyForSession cannot see the new row and silently falls
    // back to the outgoing year's schedule and late fee.
    revalidateTagAfterWrite("fee-policy");
    revalidatePath("/fees/admin-tools/promotion");
    revalidatePath(`/fees/admin-tools/promotion/${runId}`);
    redirect(
      `/fees/admin-tools/promotion/${runId}?notice=${encodeURIComponent("Promotion applied. Review the summary below and roll back if needed.")}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to apply promotion.";
    redirect(`/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent(message)}`);
  }
}

export async function rollbackPromotionRunAction(formData: FormData) {
  // Guarded here, not only on the page. A Server Action is reachable
  // without ever rendering the screen that offers it, which is what
  // D-99 and tests/action-guards.test.ts exist for — and this one moves
  // every student in the school between sessions.
  //
  // `students:write` is the page's own guard, copied rather than chosen:
  // the point is to close a door, not to invent a stricter policy than the
  // school has been running.
  await requireStaffPermission("students:write");
  const runId = asString(formData.get("runId"));
  const confirmation = asString(formData.get("confirmation"));

  if (!runId) {
    redirect(
      `/fees/admin-tools/promotion?error=${encodeURIComponent("Run id is required.")}`,
    );
  }

  if (confirmation !== "ROLLBACK") {
    redirect(
      `/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent("Type ROLLBACK to confirm.")}`,
    );
  }

  try {
    await rollbackPromotionRun(runId);
    revalidatePath("/fees/admin-tools/promotion");
    revalidatePath(`/fees/admin-tools/promotion/${runId}`);
    redirect(
      `/fees/admin-tools/promotion/${runId}?notice=${encodeURIComponent("Promotion rolled back.")}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to roll back promotion.";
    redirect(`/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent(message)}`);
  }
}

export async function deleteSessionByMistakeAction(formData: FormData) {
  const sessionId = asString(formData.get("sessionId"));
  const confirmation = asString(formData.get("confirmation"));

  if (!sessionId) {
    redirect(
      `/fees/admin-tools/promotion?error=${encodeURIComponent("Session id is required.")}`,
    );
  }

  if (confirmation !== "DELETE") {
    redirect(
      `/fees/admin-tools/promotion?error=${encodeURIComponent("Type DELETE to confirm removing the session created by mistake.")}`,
    );
  }

  try {
    await requireStaffPermission("settings:write");
    await deleteAcademicSession(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete session.";
    redirect(`/fees/admin-tools/promotion?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/fees/admin-tools/promotion");
  redirect(
    `/fees/admin-tools/promotion?notice=${encodeURIComponent("Session deleted. Its classes, fee setup, and copied policies were removed.")}`,
  );
}

export async function updatePromotionEntryDecisionAction(formData: FormData) {
  // Guarded here, not only on the page. A Server Action is reachable
  // without ever rendering the screen that offers it, which is what
  // D-99 and tests/action-guards.test.ts exist for — and this one moves
  // every student in the school between sessions.
  //
  // `students:write` is the page's own guard, copied rather than chosen:
  // the point is to close a door, not to invent a stricter policy than the
  // school has been running.
  await requireStaffPermission("students:write");
  const runId = asString(formData.get("runId"));
  const entryId = asString(formData.get("entryId"));
  const decisionRaw = asString(formData.get("decision"));

  if (!runId || !entryId) {
    redirect(
      `/fees/admin-tools/promotion?error=${encodeURIComponent("Run and entry are required.")}`,
    );
  }

  if (
    decisionRaw !== "pending" &&
    decisionRaw !== "promote" &&
    decisionRaw !== "graduate" &&
    decisionRaw !== "skip" &&
    decisionRaw !== "manual"
  ) {
    redirect(
      `/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent("Invalid decision.")}`,
    );
  }

  try {
    await updatePromotionEntryDecision({
      runId,
      entryId,
      decision: decisionRaw as PromotionEntryDecision,
    });
    revalidatePath(`/fees/admin-tools/promotion/${runId}`);
    // ?done= so the run page can confirm the save. Without it the dropdown
    // simply re-rendered and there was no way to tell a saved decision from
    // one that never took.
    redirect(`/fees/admin-tools/promotion/${runId}?done=entryDecisionSaved`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update decision.";
    redirect(`/fees/admin-tools/promotion/${runId}?error=${encodeURIComponent(message)}`);
  }
}
