import { revalidatePath } from "next/cache";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { beginUpload } from "@/modules/collection/data/drive-upload-flow";
import { driveTarget, studentInScope, supabaseUploadStore } from "@/modules/collection/data/drive-documents";
import { readStorageSettings } from "@/modules/collection/data/storage-settings";
import {
  failureResponse,
  json,
  logDrive,
  readCapped,
  refuse,
  sameOrigin,
  withinRate,
} from "@/modules/collection/data/upload-http";
import { checkUploadRequest, drivesUploadsFor } from "@/modules/collection/domain/document-files";
import { assertPermission } from "@/platform/auth/current-staff";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { assertNotPreviewing } from "@/vx/view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a document upload into the school's Shared Drive (D-333).
 *
 * The browser says what it is about to send — child, kind, name, type, size
 * and sha256 — and gets back where to start. Its own random id for the file is
 * the document's id, so pressing Save twice, or retrying after a dropped
 * connection, finds the same upload instead of making a second document.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("forbidden", 403);

  let staff;
  try {
    staff = await assertPermission("documents:manage");
    await assertNotPreviewing();
  } catch {
    return refuse("forbidden", 403);
  }

  const raw = await readCapped(request, 8 * 1024);
  if (!raw) return refuse("invalid", 413);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return refuse("invalid", 400);
  }
  const parsed = checkUploadRequest(body);
  if (!parsed.ok) return refuse("invalid", 400);

  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return refuse("invalid", 409);
  if (!(await studentInScope(staff, parsed.value.studentId, sessionLabel))) return refuse("out_of_scope", 403);

  const settings = await readStorageSettings();
  const target = driveTarget(settings, await vercelOidcToken(request));
  if (!target || !drivesUploadsFor(settings, staff.id)) return refuse("provider_off", 409);
  if (!withinRate(`begin:${staff.id}`, 30)) return refuse("too_many", 429, { retryable: true });

  const started = Date.now();
  const documentId = parsed.value.documentId;
  try {
    const state = await beginUpload(supabaseUploadStore(), target, { staffId: staff.id }, { ...parsed.value, sessionLabel });
    if (state.state === "stored") revalidatePath("/teach/student/[id]", "page");
    logDrive({ op: "begin", documentId, ms: Date.now() - started, bytes: parsed.value.byteSize, status: 200, outcome: state.state });
    return json({ ok: true, documentId, ...state });
  } catch (error) {
    const response = failureResponse(error, { documentId });
    logDrive({ op: "begin", documentId, ms: Date.now() - started, bytes: parsed.value.byteSize, status: response.status, outcome: "refused" });
    return response;
  }
}
