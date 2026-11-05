import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { addDays } from "@/platform/dates";

/**
 * A covered period's report back to the teacher who was away (D-419):
 * `vppsone.cover_reports`, one row per duty, written only by the duty's
 * current holder and read only by the teachers it covered for. Service role,
 * behind those checks.
 */

export const coverOutcomes = ["settled", "work_done", "problem"] as const;
export type CoverOutcome = (typeof coverOutcomes)[number];

export type CoverReport = {
  dutyId: string;
  day: string;
  period: number;
  classLabels: string;
  outcome: CoverOutcome;
  body: string | null;
  byId: string;
  at: string;
};

type DutyRow = { id: string; session_label: string; day: string; period: number; class_labels: string[]; covering_staff_id: string | null; status: string; absent_staff_ids: string[] };
type ReportRow = { duty_id: string; outcome: CoverOutcome; body: string | null; written_by: string; updated_at: string; seen_by: string[] };

export type SaveReportOutcome = { ok: true } | { ok: false; reason: "not_found" | "not_yours" | "not_yet" | "failed" };

/** Save (or change) the report on a duty this person holds, once its day has come. */
export async function saveCoverReport(input: { dutyId: string; staffId: string; outcome: CoverOutcome; body: string; today: string }): Promise<SaveReportOutcome> {
  const admin = createAdminClient();
  const { data: duty, error } = await admin
    .from("cover_duties")
    .select("id, session_label, day, period, class_labels, covering_staff_id, status, absent_staff_ids")
    .eq("id", input.dutyId)
    .maybeSingle<DutyRow>();
  if (error) return { ok: false, reason: "failed" };
  if (!duty || duty.status !== "assigned") return { ok: false, reason: "not_found" };
  if (duty.covering_staff_id !== input.staffId) return { ok: false, reason: "not_yours" };
  if (duty.day > input.today) return { ok: false, reason: "not_yet" };
  const body = input.body.trim().slice(0, 600);
  const { error: saveError } = await admin.from("cover_reports").upsert(
    {
      duty_id: duty.id,
      session_label: duty.session_label,
      written_by: input.staffId,
      outcome: input.outcome,
      body: body || null,
      updated_at: new Date().toISOString(),
      // A changed report is news again for the teacher who was away.
      seen_by: [],
    },
    { onConflict: "duty_id" },
  );
  return saveError ? { ok: false, reason: "failed" } : { ok: true };
}

/** The reports already written on these duties (the covering teacher's own view). */
export async function reportsOnDuties(dutyIds: readonly string[]): Promise<Map<string, { outcome: CoverOutcome; body: string | null }>> {
  if (!dutyIds.length) return new Map();
  const { data } = await createAdminClient().from("cover_reports").select("duty_id, outcome, body").in("duty_id", [...dutyIds].slice(0, 100));
  return new Map(((data ?? []) as { duty_id: string; outcome: CoverOutcome; body: string | null }[]).map((r) => [r.duty_id, { outcome: r.outcome, body: r.body }]));
}

/** Reports on the periods covered for this person in the last ten days that they have not yet marked as read. */
export async function reportsForAbsent(staffId: string, sessionLabel: string, today: string): Promise<CoverReport[]> {
  const admin = createAdminClient();
  const { data: duties, error } = await admin
    .from("cover_duties")
    .select("id, session_label, day, period, class_labels, covering_staff_id, status, absent_staff_ids")
    .eq("session_label", sessionLabel)
    .contains("absent_staff_ids", [staffId])
    .gte("day", addDays(today, -10))
    .lte("day", today)
    .eq("status", "assigned")
    .limit(80)
    .returns<DutyRow[]>();
  if (error || !duties?.length) return [];
  const byId = new Map(duties.map((d) => [d.id, d]));
  const { data: reports } = await admin
    .from("cover_reports")
    .select("duty_id, outcome, body, written_by, updated_at, seen_by")
    .in("duty_id", [...byId.keys()])
    .returns<ReportRow[]>();
  return (reports ?? [])
    .filter((r) => !r.seen_by.includes(staffId))
    .map((r) => {
      const d = byId.get(r.duty_id) as DutyRow;
      return { dutyId: r.duty_id, day: d.day, period: d.period, classLabels: d.class_labels.join(", "), outcome: r.outcome, body: r.body, byId: r.written_by, at: r.updated_at };
    })
    .sort((a, b) => b.day.localeCompare(a.day) || a.period - b.period);
}

/** Mark reports read by one of the teachers they were written for. */
export async function markReportsSeen(staffId: string, dutyIds: readonly string[]): Promise<boolean> {
  if (!dutyIds.length) return true;
  const admin = createAdminClient();
  const { data: duties } = await admin.from("cover_duties").select("id, absent_staff_ids").in("id", [...dutyIds].slice(0, 50)).returns<{ id: string; absent_staff_ids: string[] }[]>();
  const mine = (duties ?? []).filter((d) => d.absent_staff_ids.includes(staffId)).map((d) => d.id);
  if (!mine.length) return true;
  const { data: reports } = await admin.from("cover_reports").select("duty_id, seen_by").in("duty_id", mine).returns<{ duty_id: string; seen_by: string[] }[]>();
  for (const r of reports ?? []) {
    if (r.seen_by.includes(staffId)) continue;
    const { error } = await admin.from("cover_reports").update({ seen_by: [...r.seen_by, staffId] }).eq("duty_id", r.duty_id);
    if (error) return false;
  }
  return true;
}
