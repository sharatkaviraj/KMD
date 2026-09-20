"use server";

import { revalidatePath } from "next/cache";

import {
  applyLedgerRegenerationBatch,
  createLedgerRegenerationPreview,
} from "@/modules/fees/data/regeneration";
import type { LedgerRegenerationActionState } from "@/modules/fees/domain/types";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { revalidateCoreFinancePaths } from "@/modules/system-sync/domain/finance-sync";

function parseRequiredString(value: FormDataEntryValue | null, label: string) {
  const normalized = (value ?? "").toString().trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function toErrorState(error: unknown): LedgerRegenerationActionState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Unable to run dues update right now. Please try again.",
    batchId: null,
    preview: null,
  };
}

function toSuccessState(message: string): LedgerRegenerationActionState {
  return {
    status: "success",
    message,
    batchId: null,
    preview: null,
  };
}

function revalidateRegenerationSurface() {
  revalidatePath("/fees");
  revalidatePath("/fees/setup");
  revalidatePath("/fees/students");
  revalidatePath("/fees/fee-setup");
  revalidatePath("/fees/fee-setup/generate");
  revalidatePath("/fees/ledger");
  revalidatePath("/fees/payments");
  revalidatePath("/fees/collections");
  revalidatePath("/fees/defaulters");
  revalidatePath("/fees/reports");
  revalidateCoreFinancePaths();
}

export async function runLedgerRegenerationAction(
  _previous: LedgerRegenerationActionState,
  formData: FormData,
): Promise<LedgerRegenerationActionState> {
  try {
    await requireStaffPermission("fees:write");

    const reason = parseRequiredString(formData.get("reason"), "Reason");
    const previewResult = await createLedgerRegenerationPreview({ reason });
    const result = await applyLedgerRegenerationBatch(previewResult.batchId);

    revalidateRegenerationSurface();

    const recalculated =
      Number(result.applied.rowsInserted ?? 0) +
      Number(result.applied.rowsUpdated ?? 0) +
      Number(result.applied.rowsCancelled ?? 0);
    const studentsAffected = Number(result.applied.affectedStudents ?? 0);

    return toSuccessState(
      `Dues updated: ${recalculated} rows recalculated across ${studentsAffected} students.`,
    );
  } catch (error) {
    return toErrorState(error);
  }
}
