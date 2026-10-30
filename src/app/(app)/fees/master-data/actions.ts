"use server";

import { revalidatePath } from "next/cache";

import { revalidateTagAfterWrite } from "@/modules/system-sync/data/finance-revalidation";

import type { ClassStatus, PaymentMode } from "@/platform/db/types";
import { createAcademicSession, createClass, createFeeHead, createRoute, deleteAcademicSession, deleteClass, deleteFeeHead, deleteRoute, setPaymentModeActive, updateAcademicSession, updateClass, updateFeeHead, updateRoute } from "@/modules/master-data/data/queries";
import { getActiveSessionLabel } from "@/modules/fees/platform/session-context/active";
import { setActiveSessionLabel } from "@/modules/fees/platform/session-context/set-active";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { assertClassVisible, assertNotTestAccount, assertSessionWritable } from "@/platform/auth/test-session-access";

export type MasterDataActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

function toSuccess(message: string): MasterDataActionState {
  return { status: "success", message };
}

function toError(error: unknown): MasterDataActionState {
  return {
    status: "error",
    message:
      error instanceof Error
        ? error.message
        : "Unable to save master data right now. Please try again.",
  };
}

function parseRequiredString(value: FormDataEntryValue | null, label: string) {
  const normalized = (value ?? "").toString().trim();

  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function parseOptionalString(value: FormDataEntryValue | null) {
  const normalized = (value ?? "").toString().trim();
  return normalized || null;
}

function parseClassStatus(value: FormDataEntryValue | null) {
  const normalized = (value ?? "").toString().trim();

  if (normalized === "active" || normalized === "inactive" || normalized === "archived") {
    return normalized satisfies ClassStatus;
  }

  throw new Error("Status is invalid.");
}

function parseBoolean(value: FormDataEntryValue | null) {
  return (value ?? "").toString().trim() === "yes";
}

function parseRequiredUuid(value: FormDataEntryValue | null, label: string) {
  const normalized = parseRequiredString(value, label);
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }

  return normalized;
}

function parseSortOrder(value: FormDataEntryValue | null) {
  const numeric = Number((value ?? "0").toString().trim());

  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error("Sort order must be a whole number greater than or equal to 0.");
  }

  return numeric;
}

function parseRequiredNonNegativeInt(value: FormDataEntryValue | null, label: string) {
  const numeric = Number((value ?? "0").toString().trim());

  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`${label} must be a whole number greater than or equal to 0.`);
  }

  return numeric;
}

function parsePaymentMode(value: FormDataEntryValue | null) {
  const normalized = (value ?? "").toString().trim();

  if (
    normalized === "cash" ||
    normalized === "upi" ||
    normalized === "bank_transfer" ||
    normalized === "cheque"
  ) {
    return normalized satisfies PaymentMode;
  }

  throw new Error("Payment mode is invalid.");
}

function sameSessionLabel(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

async function switchActiveSessionIfNeeded(sessionLabel: string, isCurrent: boolean) {
  if (!isCurrent) {
    return;
  }
  // Which session is live is the whole school's; never a test account's.
  await assertNotTestAccount(null);

  const activeSessionLabel = await getActiveSessionLabel();
  if (!sameSessionLabel(sessionLabel, activeSessionLabel)) {
    await setActiveSessionLabel(sessionLabel);
  }
}

function revalidateMasterDataSurface() {
  revalidatePath("/fees/master-data");
  revalidatePath("/fees/setup");
  revalidatePath("/fees/students");
  revalidatePath("/fees/students/new");
  revalidatePath("/fees/fee-setup");
  revalidatePath("/fees/fee-setup/generate");
  revalidatePath("/fees/imports");
  revalidatePath("/fees/payments");
  revalidatePath("/fees/collections");
  revalidatePath("/fees/finance-controls");
  revalidatePath("/fees/defaulters");
  revalidatePath("/fees/reports");
  revalidatePath("/fees/settings");
  // Creating, copying or activating a session writes fee_policy_configs, and
  // the fee-policy resolvers are cached under this tag for 300s. Without the
  // bust, loadPolicyForSession cannot find the brand-new session's row and
  // falls back to `snapshots.find(isActive) ?? snapshots[0]` — so for up to
  // five minutes the Payment Desk and post_student_payment would price the new
  // year off the OLD year's installment schedule and late fee.
  revalidateTagAfterWrite("fee-policy");
}

export async function createSessionAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    const sessionLabel = parseRequiredString(formData.get("sessionLabel"), "Session label");
    await assertSessionWritable(null, sessionLabel);
    const isCurrent = parseBoolean(formData.get("isCurrentSession"));

    await createAcademicSession({
      sessionLabel,
      status: parseClassStatus(formData.get("sessionStatus")),
      isCurrent,
      notes: parseOptionalString(formData.get("sessionNotes")),
    });

    await switchActiveSessionIfNeeded(sessionLabel, isCurrent);

    revalidateMasterDataSurface();
    return toSuccess("Academic session created.");
  } catch (error) {
    return toError(error);
  }
}

export async function updateSessionAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    const sessionLabel = parseRequiredString(formData.get("sessionLabel"), "Session label");
    await assertSessionWritable(null, sessionLabel);
    const isCurrent = parseBoolean(formData.get("isCurrentSession"));

    await updateAcademicSession({
      id: parseRequiredUuid(formData.get("sessionId"), "Session"),
      sessionLabel,
      status: parseClassStatus(formData.get("sessionStatus")),
      isCurrent,
      notes: parseOptionalString(formData.get("sessionNotes")),
    });

    await switchActiveSessionIfNeeded(sessionLabel, isCurrent);

    revalidateMasterDataSurface();
    return toSuccess("Academic session updated.");
  } catch (error) {
    return toError(error);
  }
}

export async function deleteSessionAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await deleteAcademicSession(parseRequiredUuid(formData.get("sessionId"), "Session"));
    revalidateMasterDataSurface();
    return toSuccess("Academic session deleted.");
  } catch (error) {
    return toError(error);
  }
}

export async function setLiveActiveSessionAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  await requireStaffPermission("settings:write");

  try {
    const sessionLabel = parseRequiredString(formData.get("sessionLabel"), "Session label");
    await assertSessionWritable(null, sessionLabel);
    // Making a session live changes it for everybody: never a test account.
    await assertNotTestAccount(null);
    const confirmation = parseRequiredString(formData.get("confirmSessionLabel"), "Confirmation");

    if (confirmation.trim().toLowerCase() !== sessionLabel.trim().toLowerCase()) {
      throw new Error("Please confirm the session label before making it live.");
    }

    await setActiveSessionLabel(sessionLabel);
    revalidateMasterDataSurface();
    return toSuccess(`${sessionLabel} is now the live session.`);
  } catch (error) {
    return toError(error);
  }
}

export async function createClassAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertSessionWritable(null, String(formData.get("sessionLabel") ?? ""));

    await createClass({
      sessionLabel: parseRequiredString(formData.get("sessionLabel"), "Session"),
      className: parseRequiredString(formData.get("className"), "Class name"),
      section: parseOptionalString(formData.get("section")),
      streamName: parseOptionalString(formData.get("streamName")),
      sortOrder: parseSortOrder(formData.get("sortOrder")),
      status: parseClassStatus(formData.get("classStatus")),
      notes: parseOptionalString(formData.get("classNotes")),
    });

    revalidateMasterDataSurface();
    return toSuccess("Class created.");
  } catch (error) {
    return toError(error);
  }
}

export async function updateClassAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertSessionWritable(null, String(formData.get("sessionLabel") ?? ""));
    // ...and the session the class is in now, not only the one it is given.
    await assertClassVisible(null, String(formData.get("classId") ?? ""));

    await updateClass({
      id: parseRequiredUuid(formData.get("classId"), "Class"),
      sessionLabel: parseRequiredString(formData.get("sessionLabel"), "Session"),
      className: parseRequiredString(formData.get("className"), "Class name"),
      section: parseOptionalString(formData.get("section")),
      streamName: parseOptionalString(formData.get("streamName")),
      sortOrder: parseSortOrder(formData.get("sortOrder")),
      status: parseClassStatus(formData.get("classStatus")),
      notes: parseOptionalString(formData.get("classNotes")),
    });

    revalidateMasterDataSurface();
    return toSuccess("Class updated.");
  } catch (error) {
    return toError(error);
  }
}

export async function deleteClassAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertClassVisible(null, String(formData.get("classId") ?? ""));
    await deleteClass(parseRequiredUuid(formData.get("classId"), "Class"));
    revalidateMasterDataSurface();
    return toSuccess("Class deleted.");
  } catch (error) {
    return toError(error);
  }
}

export async function createRouteAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);

    await createRoute({
      routeCode: parseOptionalString(formData.get("routeCode")),
      routeName: parseRequiredString(formData.get("routeName"), "Route name"),
      defaultInstallmentAmount: parseRequiredNonNegativeInt(
        formData.get("defaultInstallmentAmount"),
        "Default installment amount",
      ),
      isActive: parseBoolean(formData.get("routeIsActive")),
      notes: parseOptionalString(formData.get("routeNotes")),
    });

    revalidateMasterDataSurface();
    return toSuccess("Route created.");
  } catch (error) {
    return toError(error);
  }
}

export async function updateRouteAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);

    await updateRoute({
      id: parseRequiredUuid(formData.get("routeId"), "Route"),
      routeCode: parseOptionalString(formData.get("routeCode")),
      routeName: parseRequiredString(formData.get("routeName"), "Route name"),
      defaultInstallmentAmount: parseRequiredNonNegativeInt(
        formData.get("defaultInstallmentAmount"),
        "Default installment amount",
      ),
      isActive: parseBoolean(formData.get("routeIsActive")),
      notes: parseOptionalString(formData.get("routeNotes")),
    });

    revalidateMasterDataSurface();
    return toSuccess("Route updated.");
  } catch (error) {
    return toError(error);
  }
}

export async function deleteRouteAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await deleteRoute(parseRequiredUuid(formData.get("routeId"), "Route"));
    revalidateMasterDataSurface();
    return toSuccess("Route deleted.");
  } catch (error) {
    return toError(error);
  }
}

export async function createFeeHeadAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await createFeeHead(parseRequiredString(formData.get("feeHeadLabel"), "Fee head label"));
    revalidateMasterDataSurface();
    return toSuccess("Fee head created.");
  } catch (error) {
    return toError(error);
  }
}

export async function updateFeeHeadAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await updateFeeHead({
      id: parseRequiredString(formData.get("feeHeadId"), "Fee head"),
      label: parseRequiredString(formData.get("feeHeadLabel"), "Fee head label"),
      isActive: parseBoolean(formData.get("feeHeadIsActive")),
    });
    revalidateMasterDataSurface();
    return toSuccess("Fee head updated.");
  } catch (error) {
    return toError(error);
  }
}

export async function deleteFeeHeadAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await deleteFeeHead(parseRequiredString(formData.get("feeHeadId"), "Fee head"));
    revalidateMasterDataSurface();
    return toSuccess("Fee head deleted.");
  } catch (error) {
    return toError(error);
  }
}

export async function setPaymentModeActiveAction(
  _previous: MasterDataActionState,
  formData: FormData,
): Promise<MasterDataActionState> {
  try {
    await requireStaffPermission("settings:write");
    await assertNotTestAccount(null);
    await setPaymentModeActive({
      paymentMode: parsePaymentMode(formData.get("paymentMode")),
      isActive: parseBoolean(formData.get("modeIsActive")),
    });
    revalidateMasterDataSurface();
    return toSuccess("Payment mode updated.");
  } catch (error) {
    return toError(error);
  }
}
