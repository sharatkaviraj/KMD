/**
 * "See One as a chosen person" (D-544): the cookie that says so.
 *
 * An administrator picks a member of staff and One draws every screen as that
 * person sees it — their menu, their classes, their tasks — and refuses every
 * change while it does. This file is only the cookie's shape, kept pure so the
 * proxy, the request's staff resolver and the data clients' write lock all
 * read it the same way.
 *
 * The value is `<administrator's auth user id>.<chosen staff profile id>`.
 * The first half binds the cookie to the person who set it: on a shared office
 * PC the next person to sign in is never shown somebody else's screens, and a
 * cookie copied from another browser does nothing for anyone but its owner.
 * It is a hint, never a grant — `current-staff.ts` checks that the signed-in
 * person is an active administrator and that the chosen person may be shown
 * before anything is drawn as them.
 */

export const VIEW_AS_PERSON_COOKIE = "vx_view_person";

/** Two hours: long enough to look around, short enough not to be forgotten in. */
export const VIEW_AS_PERSON_MAX_AGE = 60 * 60 * 2;

/**
 * The language the view is shown in, when the administrator switches it while
 * looking (`en`, `hi` or `both`). Without it the screens speak the chosen
 * person's own language. Switching it saves nothing: it is this browser's,
 * and it goes when the view ends.
 */
export const VIEW_AS_LANGUAGE_COOKIE = "vx_view_lang";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ViewAsPersonCookie = { actorUserId: string; subjectId: string };

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function encodeViewAsPerson(actorUserId: string, subjectId: string): string {
  if (!isUuid(actorUserId) || !isUuid(subjectId)) throw new Error("Not a staff member.");
  return `${actorUserId.toLowerCase()}.${subjectId.toLowerCase()}`;
}

/** The cookie's two ids, or null when it is absent or not exactly that shape. */
export function readViewAsPerson(value: string | null | undefined): ViewAsPersonCookie | null {
  if (!value || value.length > 80) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [actorUserId, subjectId] = parts;
  if (!isUuid(actorUserId) || !isUuid(subjectId)) return null;
  return { actorUserId: actorUserId.toLowerCase(), subjectId: subjectId.toLowerCase() };
}

/** True when this cookie was set by `userId` — the proxy's cheap test, before any database read. */
export function viewAsPersonBelongsTo(value: string | null | undefined, userId: string | null | undefined): boolean {
  const parsed = readViewAsPerson(value);
  return Boolean(parsed && userId && parsed.actorUserId === userId.toLowerCase());
}
