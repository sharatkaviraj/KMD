import { runTeacherPhotoCopy } from "./teacher-photo-copy";

/*
 * The teachers' photo copy carries on by itself (owner, 8 Nov 2026). Started by
 * the roster card's button (`refresh-roster-button.tsx`) for a real admin on the live session only: a few
 * seconds after One opens, it runs the same copy "Refresh roster now" runs
 * (`teacher-photo-copy.ts`). The server asks One's own database what is
 * missing first, so Fees is read only while a photo is still to copy.
 *
 * Not a schedule (D-457): nothing runs unless an admin has One open, and the
 * device remembers when to look again. All copied: six hours. Cut short (the
 * page closed): three minutes. Fees could not be reached: an hour. Photos
 * Fees cannot hand over: a day, so a broken photo never makes every open
 * page through Fees again.
 */

const KEY = "vx_photo_copy_next";
const AGAIN = 30_000;
const SOON = 3 * 60_000;
const HOUR = 3_600_000;

function nextRun(): number | null {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return null;
  }
}

function setNextRun(at: number) {
  try {
    localStorage.setItem(KEY, String(at));
  } catch {
    // No storage: the copy simply waits for the next open.
  }
}

/** One turn of the catch-up; `isGone` says the page has moved on. */
export function catchUpPhotos(isGone: () => boolean) {
  const due = nextRun();
  if (isGone() || due === null || Date.now() < due) return;
  // Claim the turn first, so a second tab does not run it at the same time.
  setNextRun(Date.now() + SOON);
  void runTeacherPhotoCopy()
    .then((r) => {
      if (r.left && r.copied > 0) {
        // Still going well: carry on in this page while it is open.
        setNextRun(Date.now() + (isGone() ? SOON : AGAIN));
        if (!isGone()) setTimeout(() => catchUpPhotos(isGone), AGAIN);
        return;
      }
      setNextRun(Date.now() + (r.stopped ? HOUR : r.first > 0 && r.copied === 0 ? 24 * HOUR : 6 * HOUR));
    })
    .catch(() => setNextRun(Date.now() + HOUR));
}
