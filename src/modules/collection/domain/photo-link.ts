import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A child's photo, at an address the phone can keep (owner, 8 Nov 2026).
 *
 * One handed out five-minute Supabase links, a new one on every page, so a
 * phone could never reuse a photo it had already fetched: every class list,
 * every note and every child sheet downloaded every face again at full size.
 * That is the "it takes time to load the picture" Janmejay saw.
 *
 * The address is now One's own route, the same all day:
 *
 *   /api/photos/students/<child>?v=<photo row>&d=<day>&s=<list|full>&t=<token>
 *
 * `t` is an HMAC of the child, the photo row and the day the link stops
 * working, made only after the reader's permission was checked (the same
 * check that decided which photos a teacher may see). The route checks the
 * token, not the reader again, so fifty faces cost fifty plain image requests,
 * not fifty permission lookups; the browser keeps each one until the link
 * expires. A replaced photo gets a new row id, so a new address, at once.
 *
 * Pure: the secret is passed in, so the rule is pinned by tests.
 */

export const PHOTO_LINK_SIZES = ["list", "full"] as const;
export type PhotoLinkSize = (typeof PHOTO_LINK_SIZES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

/**
 * The UTC day number the link stops working at the end of: the day after
 * today. Every link made today carries the same number, so it is the same
 * address all day, and it still works for a page left open past midnight.
 */
export function photoLinkDay(now: number = Date.now()): number {
  return Math.floor(now / DAY_MS) + 1;
}

/** Seconds a link made for `day` still works at `now`; 0 once expired. */
export function photoLinkSecondsLeft(day: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor(((day + 1) * DAY_MS - now) / 1000));
}

export function photoLinkToken(secret: string, studentId: string, photoId: string, day: number): string {
  return createHmac("sha256", secret).update(`student-photo:v1:${studentId.toLowerCase()}:${photoId.toLowerCase()}:${day}`).digest("base64url").slice(0, 32);
}

export function photoLinkHref(secret: string, studentId: string, photoId: string, size: PhotoLinkSize = "list", now: number = Date.now()): string {
  if (!UUID.test(studentId) || !UUID.test(photoId)) throw new Error("invalid_photo_identity");
  const day = photoLinkDay(now);
  const query = new URLSearchParams({ v: photoId, d: String(day), s: size, t: photoLinkToken(secret, studentId, photoId, day) });
  return `/api/photos/students/${studentId}?${query}`;
}

export type CheckedPhotoLink = { studentId: string; photoId: string; size: PhotoLinkSize; secondsLeft: number };

/**
 * The link's child, photo and size when its token is right and it has not
 * expired; null otherwise. An empty secret refuses everything.
 */
export function checkPhotoLink(secret: string, studentId: string, params: URLSearchParams, now: number = Date.now()): CheckedPhotoLink | null {
  if (!secret) return null;
  const photoId = params.get("v") ?? "";
  const dayText = params.get("d") ?? "";
  const size = (params.get("s") ?? "list") as PhotoLinkSize;
  const token = params.get("t") ?? "";
  if (!UUID.test(studentId) || !UUID.test(photoId) || !/^\d{1,7}$/.test(dayText) || !PHOTO_LINK_SIZES.includes(size)) return null;
  const day = Number(dayText);
  // A link is never made for more than a day ahead: refuse one from the future.
  if (day > photoLinkDay(now)) return null;
  const secondsLeft = photoLinkSecondsLeft(day, now);
  if (secondsLeft <= 0) return null;
  const expected = Buffer.from(photoLinkToken(secret, studentId, photoId, day));
  const presented = Buffer.from(token);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  return { studentId: studentId.toLowerCase(), photoId: photoId.toLowerCase(), size, secondsLeft };
}
