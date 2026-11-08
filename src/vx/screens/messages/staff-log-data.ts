import "server-only";

import { viewingTestSession } from "@/platform/auth/staff-scope";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { createAdminClient } from "@/platform/supabase/admin";
import { readMonthCap } from "@/modules/staff-notices/domain/gates";
import { KINDS, isStaffMessageKind } from "@/modules/staff-notices/domain/kinds";
import type { Pair } from "@/vx/text";
import { p } from "@/vx/text";

import { PAISE_PER_MESSAGE } from "./domain/messages";

/**
 * Messages → Staff (go-live Phase F, plan §8.3): what the school app sent to
 * staff on WhatsApp, or held back and why, and this month's AiSensy count and
 * cost against the cap. Service-role reads after the page's `messages:send`
 * check, fenced like every other list: a test account sees TEST-session
 * notices only, real staff no TEST ones, a real administrator both. No number
 * is shown beyond its last four digits. The month's count is the one the cap
 * is held against (`vppsone.staff_whatsapp_month_sent()`): the outbox's
 * AiSensy sends and the teacher-task link's.
 */

export type StaffLogRow = {
  id: string;
  kind: Pair;
  to: string;
  status: string;
  reason: string | null;
  createdAt: string;
  lastTry: { state: string; transport: string; at: string | null; to: string } | null;
  test: boolean;
};

export type StaffLogData = {
  rows: StaffLogRow[];
  monthSent: number;
  monthCostPaise: number;
  monthCap: number | null;
  consented: number;
  transport: string;
};

const pairOf = (label: { hi: string; en: string }): Pair => p(label.en, label.hi);

export async function loadStaffLog(transport: string): Promise<StaffLogData> {
  const admin = createAdminClient();
  // The session being looked at decides, for everybody (owner, 8 Nov 2026):
  // the real year's log shows real staff's notices only, the test session's
  // the test accounts' — a real admin no longer sees the two mixed.
  const testOnly = await viewingTestSession();

  const noticesQuery = admin
    .from("staff_notices")
    .select("id, kind, status, status_reason, created_at, session_label, staff_profile_id");
  // Filtered before the limit, so a busy test session cannot push the real
  // year's notices off the page (and the other way round).
  const sessionNotices = testOnly
    ? noticesQuery.or("session_label.ilike.TEST-*,session_label.ilike.UAT-*,session_label.ilike.DEMO-*")
    : noticesQuery.not("session_label", "ilike", "TEST-*").not("session_label", "ilike", "UAT-*").not("session_label", "ilike", "DEMO-*");
  const [notices, month, cap, consented] = await Promise.all([
    sessionNotices.order("created_at", { ascending: false }).limit(150),
    admin.rpc("staff_whatsapp_month_sent"),
    admin.from("runtime_flags").select("enabled, value").eq("key", "staff_whatsapp_month_cap").maybeSingle(),
    admin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .not("whatsapp_opt_in_at", "is", null)
      .is("whatsapp_opt_out_at", null)
      .eq("is_active", true)
      .eq("is_test_account", testOnly),
  ]);

  const visible = ((notices.data ?? []) as Array<{
    id: string;
    kind: string;
    status: string;
    status_reason: string | null;
    created_at: string;
    session_label: string;
    staff_profile_id: string;
  }>).filter((row) => {
    return isTestSessionLabel(row.session_label) === testOnly;
  });

  // At most 150 ids: under the URL limit (rule 3b).
  const ids = visible.map((row) => row.id);
  const staffIds = [...new Set(visible.map((row) => row.staff_profile_id))];
  const [attempts, people] = await Promise.all([
    ids.length
      ? admin
          .from("staff_notice_attempts")
          .select("notice_id, state, transport, destination, finished_at, started_at, attempt_no")
          .in("notice_id", ids)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? admin.from("staff_profiles").select("id, display_name, is_test_account").in("id", staffIds)
      : Promise.resolve({ data: [] }),
  ]);
  const latest = new Map<string, { state: string; transport: string; destination: string; finished_at: string | null; started_at: string; attempt_no: number }>();
  for (const row of (attempts.data ?? []) as Array<{
    notice_id: string;
    state: string;
    transport: string;
    destination: string;
    finished_at: string | null;
    started_at: string;
    attempt_no: number;
  }>) {
    const held = latest.get(row.notice_id);
    if (!held || row.attempt_no > held.attempt_no) latest.set(row.notice_id, row);
  }
  const peopleRows = (people.data ?? []) as Array<{ id: string; display_name: string; is_test_account: boolean | null }>;
  const names = new Map(peopleRows.map((row) => [row.id, row.display_name]));
  // Nobody of the other kind, even on a notice written before the database
  // refused it (queue_staff_notice, 20261108170533).
  const otherKind = new Set(peopleRows.filter((row) => (row.is_test_account === true) !== testOnly).map((row) => row.id));

  const capRow = cap.data as { enabled: boolean; value: unknown } | null;
  const monthSent = typeof month.data === "number" ? month.data : 0;
  return {
    rows: visible.filter((row) => !otherKind.has(row.staff_profile_id)).map((row) => {
      const attempt = latest.get(row.id);
      return {
        id: row.id,
        kind: isStaffMessageKind(row.kind) ? pairOf(KINDS[row.kind].label) : p(row.kind, row.kind),
        to: names.get(row.staff_profile_id) ?? "—",
        status: row.status,
        reason: row.status_reason,
        createdAt: row.created_at,
        lastTry: attempt
          ? {
              state: attempt.state,
              transport: attempt.transport,
              at: attempt.finished_at ?? attempt.started_at,
              to: attempt.destination ? `…${attempt.destination.slice(-4)}` : "—",
            }
          : null,
        test: isTestSessionLabel(row.session_label),
      };
    }),
    monthSent,
    monthCostPaise: monthSent * PAISE_PER_MESSAGE,
    monthCap: capRow?.enabled ? readMonthCap(capRow.value) : null,
    consented: consented.count ?? 0,
    transport,
  };
}
