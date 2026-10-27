import { revalidatePath } from "next/cache";

import { acceptChunk, currentState } from "@/modules/collection/data/drive-upload-flow";
import { driveTarget, supabaseUploadStore } from "@/modules/collection/data/drive-documents";
import { readStorageSettings } from "@/modules/collection/data/storage-settings";
import { failureResponse, json, readCapped, refuse, sameOrigin } from "@/modules/collection/data/upload-http";
import { UPLOAD_CHUNK_BYTES, isUuid } from "@/modules/collection/domain/document-files";
import { assertPermission } from "@/platform/auth/current-staff";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { assertNotPreviewing } from "@/vx/view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One chunk to Google and back, retried; generous for a slow school link.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

async function uploader(request: Request) {
  if (!sameOrigin(request)) return null;
  try {
    const staff = await assertPermission("documents:manage");
    await assertNotPreviewing();
    return staff;
  } catch {
    return null;
  }
}

/**
 * Where an upload has got to, asked of Drive itself. The uploader calls this
 * after a dropped connection and carries on from the answer.
 */
export async function GET(request: Request, context: Context) {
  const staff = await uploader(request);
  if (!staff) return refuse("forbidden", 403);
  const { id } = await context.params;
  if (!isUuid(id)) return refuse("not_found", 404);

  const target = driveTarget(await readStorageSettings(), await vercelOidcToken(request));
  if (!target) return refuse("provider_off", 409);

  try {
    const state = await currentState(supabaseUploadStore(), target, { staffId: staff.id }, id);
    if (state.state === "stored") revalidatePath("/teach/student/[id]", "page");
    return json({ ok: true, documentId: id, ...state });
  } catch (error) {
    return failureResponse(error, { documentId: id });
  }
}

/** One chunk: `PUT /documents/uploads/<id>?offset=<n>` with the raw bytes. */
export async function PUT(request: Request, context: Context) {
  const staff = await uploader(request);
  if (!staff) return refuse("forbidden", 403);
  const { id } = await context.params;
  if (!isUuid(id)) return refuse("not_found", 404);

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) return refuse("offset", 400);

  const bytes = await readCapped(request, UPLOAD_CHUNK_BYTES);
  if (!bytes) return refuse("size", 413);

  const target = driveTarget(await readStorageSettings(), await vercelOidcToken(request));
  if (!target) return refuse("provider_off", 409);

  try {
    const state = await acceptChunk(supabaseUploadStore(), target, { staffId: staff.id }, { documentId: id, offset, bytes });
    if (state.state === "stored") revalidatePath("/teach/student/[id]", "page");
    return json({ ok: true, documentId: id, ...state });
  } catch (error) {
    return failureResponse(error, { documentId: id });
  }
}
