import { checkPhotoLink } from "@/modules/collection/domain/photo-link";
import { photoLinkSecret } from "@/modules/collection/data/photo-link";
import { PHOTOS_BUCKET } from "@/modules/collection/data/photo-storage";
import { createAdminClient } from "@/platform/supabase/admin";
import { listAvatar } from "@/platform/fees-bridge/list-avatar";

export const runtime = "nodejs";

const refused = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };

/**
 * One child's photo at a link One made after checking the reader may see it
 * (`modules/collection/domain/photo-link.ts`, owner 8 Nov 2026). The token is
 * the permission; nothing here reads the session, so a class of forty faces is
 * forty quick image requests the phone then keeps until the link expires
 * (`private`: never a CDN or shared cache, the same rule as D-442).
 *
 * `list` is the small one every list and avatar draws (a few kilobytes); `full`
 * is the stored photo, at most 600 px, for the viewer. A photo since replaced
 * or removed answers 404, and the screen keeps the child's initials.
 */
export async function GET(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await context.params;
  const link = checkPhotoLink(photoLinkSecret(), studentId, new URL(request.url).searchParams);
  if (!link) return new Response(null, { status: 404, headers: refused });
  try {
    const db = createAdminClient();
    const row = await db.from("student_photos").select("storage_path,content_type")
      .eq("id", link.photoId).eq("student_id", link.studentId).is("replaced_at", null).maybeSingle();
    if (row.error) return new Response(null, { status: 503, headers: refused });
    if (!row.data) return new Response(null, { status: 404, headers: refused });
    const file = await db.storage.from(PHOTOS_BUCKET).download(row.data.storage_path);
    if (file.error || !file.data) return new Response(null, { status: 503, headers: refused });
    const original = { bytes: await file.data.arrayBuffer(), contentType: row.data.content_type || "image/jpeg" };
    const out = link.size === "list" ? await listAvatar(original) : original;
    return new Response(out.bytes, {
      headers: {
        "Content-Type": out.contentType,
        "Content-Length": String(out.bytes.byteLength),
        // Kept by this browser only, until the link itself stops working.
        "Cache-Control": `private, max-age=${Math.min(link.secondsLeft, 172_800)}, immutable`,
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: refused });
  }
}
