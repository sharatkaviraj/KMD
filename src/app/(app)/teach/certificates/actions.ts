"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/platform/auth/current-staff";
import { isSessionAccessDenied } from "@/platform/auth/test-session-policy";
import { createCertificateRequest, recordRequestDownload, withdrawCertificateRequest } from "@/modules/certificates/data/requests";
import type { RequestErrorCode } from "@/modules/certificates/domain/request";

/** A refused permission or session is "forbidden"; anything else is worth a retry. */
function thrown(error: unknown): { ok: false; code: RequestErrorCode } {
  const denied = isSessionAccessDenied(error) || (error instanceof Error && error.message.startsWith("Permission denied"));
  return { ok: false, code: denied ? "forbidden" : "unavailable" };
}

/** A teacher asks the approver for a certificate (D-542). Asking prepares nothing. */
export async function askForCertificateAction(input: unknown) {
  try {
    await assertPermission("certificates:request");
    const result = await createCertificateRequest(input);
    if (result.ok) revalidatePath("/school-office");
    return result;
  } catch (error) { return thrown(error); }
}

export async function withdrawCertificateRequestAction(input: unknown) {
  try {
    await assertPermission("certificates:request");
    const result = await withdrawCertificateRequest(input);
    if (result.ok) revalidatePath("/school-office");
    return result;
  } catch (error) { return thrown(error); }
}

/** Written into the certificate's own history before the bytes are fetched, as the office does. */
export async function recordCertificateDownloadAction(input: unknown) {
  try {
    await assertPermission("certificates:request");
    return await recordRequestDownload(input);
  } catch (error) { return thrown(error); }
}
