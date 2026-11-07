import "server-only";

import { can } from "@/platform/auth/permissions";
import { getBridgeAiPhotos } from "@/platform/fees-bridge/client";
import type { AiPhoto, AiPhotoSkip } from "../domain/bundle";
import { AiReportError, type AiReportRequest } from "./access";

/**
 * The AI report's photographs, one page at a time. They live in Fees (the
 * student-photos store) and come through the One bridge: at most 40 a page,
 * about 2 MB of images, so a page stays under Vercel's 4.5 MB response limit.
 * The browser asks for the next page with `after` until `next` is null.
 *
 * One keeps no photographs of its own, so a rehearsal year or a test account
 * gets none, and the read-me says so.
 */

export type AiPhotoPage =
  | { source: "fees"; photos: AiPhoto[]; skipped: AiPhotoSkip[]; next: string | null; total: number | null }
  | { source: "none"; photos: []; skipped: []; next: null; total: 0; reason: string };

export async function readPhotoPage({ staff, sessionLabel, live }: AiReportRequest, after: string | null): Promise<AiPhotoPage> {
  if (!can(staff, "students:view")) throw new AiReportError("forbidden", "Student photographs are not open to this account.");
  if (!live) {
    return { source: "none", photos: [], skipped: [], next: null, total: 0, reason: "photographs are kept in the Fees app and come only with the real year" };
  }
  const page = await getBridgeAiPhotos(sessionLabel, after);
  return { source: "fees", photos: page.photos, skipped: page.skipped, next: page.next, total: page.total };
}
