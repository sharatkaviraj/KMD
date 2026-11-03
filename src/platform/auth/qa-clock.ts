import "server-only";

import { cookies } from "next/headers";

import { isSmokeEmail } from "@/modules/smoke/domain/pool";
import { smokeLabEnabled } from "@/platform/auth/smoke-lab";
import { isQaEmail, qaToolsEnabled } from "@/platform/auth/test-accounts";

/**
 * A pretend "now" for the QA accounts, so Today's time-of-day timetable can be
 * checked on a Sunday or after school (D-269).
 *
 * Read only for a verified TEST `@qa.vpps.local` account, while the QA tools
 * are on, and only from a cookie
 * set by `/login/test/clock` with the key. Everyone else, and every write,
 * uses the real clock: this changes what Today shows, nothing it saves.
 */
export const QA_CLOCK_COOKIE = "vx_qa_now";

/** `2026-10-12T10:15` is school (Asia/Kolkata) time; anything else is refused. */
export function parseQaClock(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const at = new Date(`${value}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function schoolNow(staff: { email: string | null; isTestAccount?: boolean } | null | undefined): Promise<Date> {
  if (!staff || staff.isTestAccount !== true || !isQaEmail(staff.email)) return new Date();
  // A Smoke Lab account's clock is set by its pass (`/lab/enter`, `/lab/clock`).
  if (!qaToolsEnabled() && !(isSmokeEmail(staff.email) && smokeLabEnabled())) return new Date();
  const store = await cookies();
  return parseQaClock(store.get(QA_CLOCK_COOKIE)?.value) ?? new Date();
}
