import { NextResponse } from "next/server";

import { approvedStudentPhotos } from "@/modules/collection/data/approved-photos";
import { rethrowNextSignal } from "@/platform/helpers/next-signals";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One request names at most this many children (a big class, with room). */
const PHOTO_LOOKUP_MAX = 80;

/**
 * Which of these children have a photo this reader may see, and where it is
 * (owner, 8 Nov 2026: "photos are not visible in many parts of One"). Screens
 * that list children without loading their photos ask here, through
 * `vx/ui/student-photos.ts`, so a face can appear on any list by passing the
 * child's id. The same permission rule as every other photo
 * (`approvedStudentPhotos`): a teacher gets their own classes' children only.
 *
 * GET, so it works while an administrator looks at One as somebody else
 * (D-544 refuses every other method), and it answers as that person.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").map((id) => id.trim().toLowerCase()).filter((id) => UUID.test(id)))].slice(0, PHOTO_LOOKUP_MAX);
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  if (!ids.length) return NextResponse.json({ photos: {} }, { headers });
  try {
    const photos = await approvedStudentPhotos(ids);
    return NextResponse.json({ photos: Object.fromEntries(photos) }, { headers });
  } catch (error) {
    rethrowNextSignal(error);
    // No permission: these children have no photo for this reader, and the
    // page need not ask again. No session or a failed read: ask again later.
    // Never an error page.
    if (error instanceof Error && error.message === "not_permitted") return NextResponse.json({ photos: {} }, { headers });
    return NextResponse.json({ photos: {}, failed: true }, { headers });
  }
}
