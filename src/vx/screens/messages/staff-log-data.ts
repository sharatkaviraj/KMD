import "server-only";

import { getCurrentStaff } from "@/platform/auth/current-staff";
import { isRealAdmin, isTestSessionLabel } from "@/platform/auth/test-session-policy";
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
  const viewer = await getCurrentStaff();
  const admin = createAdminClient();
  const seeAll = viewer ? isRealAdmin({ role: viewer.role, isTestAccount: viewer.isTestAccount === true }) : false;
  const testOnly = viewer?.isTestAccount === true;

  const [notices, month, cap, consented] = await Promise.all([
    admin
      .from("staff_notices")
      .select("id, kind, status, status_reason, created_at, session_label, staff_profile_id")
      .order("created_at", { ascending: false })
      .limit(150),
    admin.rpc("staff_whatsapp_month_sent"),
    admin.from("runtime_flags").select("enabled, value").eq("key", "staff_whatsapp_month_cap").maybeSingle(),
    admin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .not("whatsapp_opt_in_at", "is", null)
      .is("whatsapp_opt_out_at", null)
      .eq("is_active", true),
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
    const test = isTestSessionLabel(row.session_label);
    if (seeAll) return true;
    return testOnly ? test : !test;
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
      ? admin.from("staff_profiles").select("id, display_name").in("id", staffIds)
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
  const names = new Map(((people.data ?? []) as Array<{ id: string; display_name: string }>).map((row) => [row.id, row.display_name]));

  const capRow = cap.data as { enabled: boolean; value: unknown } | null;
  const monthSent = typeof month.data === "number" ? month.data : 0;
  return {
    rows: visible.map((row) => {
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
