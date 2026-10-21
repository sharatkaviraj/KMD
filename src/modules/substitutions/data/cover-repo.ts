import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";

/**
 * Reads and the one write for cover duties (P3).
 *
 * The write is `commit_cover_command`, a database function that does
 * everything a cover change needs in one transaction; nothing here writes a
 * duty, an absence or a notice row directly. Reads go through the service
 * role after the caller's permission, because the arranger needs every
 * teacher's duties and history to be fair, not only the rows the reader's own
 * RLS would show.
 */

export type CoverDutyStatus = "assigned" | "needs_help" | "cancelled" | "superseded";

export type CoverDuty = {
  id: string;
  needKey: string;
  period: number;
  eventKind: "ordinary" | "joint" | "parallel_cohort" | "team_block";
  classIds: string[];
  classLabels: string[];
  subjectCode: string;
  absentStaffIds: string[];
  status: CoverDutyStatus;
  coveringStaffId: string | null;
  suggestedStaffId: string | null;
  reason: string | null;
  source: "auto" | "manual";
  pinned: boolean;
  matchTier: string | null;
  warnings: string[];
  revision: number;
  supersedes: string | null;
  dayRevision: number;
  createdAt: string;
  endedAt: string | null;
  acknowledgedAt: string | null;
  cannotCoverAt: string | null;
  cannotCoverNote: string | null;
  day: string;
  sessionLabel: string;
};

type DutyRow = {
  id: string;
  session_label: string;
  day: string;
  need_key: string;
  period: number;
  event_kind: CoverDuty["eventKind"];
  class_ids: string[];
  class_labels: string[];
  subject_code: string;
  absent_staff_ids: string[];
  status: CoverDutyStatus;
  covering_staff_id: string | null;
  suggested_staff_id: string | null;
  reason: string | null;
  source: "auto" | "manual";
  pinned: boolean;
  match_tier: string | null;
  warnings: string[];
  revision: number;
  supersedes: string | null;
  day_revision: number;
  created_at: string;
  ended_at: string | null;
  acknowledged_at: string | null;
  cannot_cover_at: string | null;
  cannot_cover_note: string | null;
};

export const DUTY_COLUMNS =
  "id, session_label, day, need_key, period, event_kind, class_ids, class_labels, subject_code, " +
  "absent_staff_ids, status, covering_staff_id, suggested_staff_id, reason, source, pinned, " +
  "match_tier, warnings, revision, supersedes, day_revision, created_at, ended_at, " +
  "acknowledged_at, cannot_cover_at, cannot_cover_note";

export function toDuty(row: DutyRow): CoverDuty {
  return {
    id: row.id,
    sessionLabel: row.session_label,
    day: row.day,
    needKey: row.need_key,
    period: row.period,
    eventKind: row.event_kind,
    classIds: row.class_ids,
    classLabels: row.class_labels,
    subjectCode: row.subject_code,
    absentStaffIds: row.absent_staff_ids,
    status: row.status,
    coveringStaffId: row.covering_staff_id,
    suggestedStaffId: row.suggested_staff_id,
    reason: row.reason,
    source: row.source,
    pinned: row.pinned,
    matchTier: row.match_tier,
    warnings: row.warnings,
    revision: row.revision,
    supersedes: row.supersedes,
    dayRevision: row.day_revision,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    acknowledgedAt: row.acknowledged_at,
    cannotCoverAt: row.cannot_cover_at,
    cannotCoverNote: row.cannot_cover_note,
  };
}

/** Every duty row on a day, history included, oldest revision first. */
export async function dutiesOn(sessionLabel: string, day: string): Promise<CoverDuty[]> {
  await assertPermission("substitutions:view");
  const { data, error } = await createAdminClient()
    .from("cover_duties")
    .select(DUTY_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .order("period")
    .order("need_key")
    .order("revision")
    .returns<DutyRow[]>();
  if (error) throw new Error(`Could not read the cover duties: ${error.message}`);
  return data.map(toDuty);
}

export function liveOnly(duties: readonly CoverDuty[]): CoverDuty[] {
  return duties.filter((duty) => duty.status === "assigned" || duty.status === "needs_help");
}

/** The day's revision — what a command has to name to be accepted. */
export async function coverDayRevision(sessionLabel: string, day: string): Promise<number> {
  const { data, error } = await createAdminClient()
    .from("cover_days")
    .select("revision")
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .maybeSingle<{ revision: number }>();
  if (error) throw new Error(`Could not read the cover day: ${error.message}`);
  return data?.revision ?? 0;
}

export { currentBells, teamRules } from "@/modules/substitutions/data/school-rules-repo";

/** How many covers each teacher held over a window — the fairness history. */
export async function coverCountsBetween(
  sessionLabel: string,
  from: string,
  to: string,
): Promise<Record<string, number>> {
  const { data, error } = await createAdminClient()
    .from("cover_duties")
    .select("covering_staff_id")
    .eq("session_label", sessionLabel)
    .eq("status", "assigned")
    .gte("day", from)
    .lte("day", to)
    .not("covering_staff_id", "is", null)
    .limit(5000)
    .returns<{ covering_staff_id: string }[]>();
  if (error) throw new Error(`Could not read the cover history: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.covering_staff_id] = (counts[row.covering_staff_id] ?? 0) + 1;
  return counts;
}

/* ------------------------------------------------------------ the command */

export type CommandReceipt = {
  ok: true;
  command_id: string;
  kind: string;
  day: string;
  day_revision: number;
  assigned: number;
  needs_help: number;
  new: number;
  changed: number;
  cancelled: number;
  unchanged: number;
  /** Absent from receipts committed before the pin fix (20261004044226). */
  pinned?: number;
  skipped_started: number;
  notices_queued: number;
  notices_withdrawn: number;
  notice_recipients: number;
  recipients_without_phone: number;
  replayed: boolean;
};

export type CommandRefusal =
  | { ok: false; reason: "bad_request" | "not_permitted" | "id_reused" | "disabled" | "no_timetable" }
  | {
      ok: false;
      reason: "stale";
      current: { day_revision: number; timetable_version_id: string | null; bells_revision: number };
    }
  | { ok: false; reason: "invalid"; problems: { need_key: string; problem: string }[] }
  | { ok: false; reason: "failed"; message: string };

export type CommandOutcome = CommandReceipt | CommandRefusal;

/**
 * Hand the day's desired state to the database and get one answer back.
 *
 * A raised `invalid` is how the function rolls back an absence it already
 * wrote when a cover turns out not to hold; it arrives here as an error and is
 * turned back into a refusal the screen can name. Anything else unexpected is
 * `failed` — and is *not* a statement that nothing was saved: the caller asks
 * `findCommand()` before it says so (P3: a lost response is not a failure).
 */
export async function commitCoverCommand(payload: Record<string, unknown>): Promise<CommandOutcome> {
  const { data, error } = await createAdminClient().rpc("commit_cover_command", { p_command: payload });

  if (error) {
    const invalid = /cover_command:invalid:([\s\S]*)$/.exec(error.message);
    if (invalid) {
      try {
        return { ok: false, reason: "invalid", problems: JSON.parse(invalid[1]) };
      } catch {
        return { ok: false, reason: "invalid", problems: [] };
      }
    }
    return { ok: false, reason: "failed", message: error.message };
  }

  return data as CommandOutcome;
}

/** A committed command's receipt, for its own actor or a cover manager only. */
export async function findCommand(id: string, actorStaffId: string): Promise<CommandReceipt | null> {
  const { data, error } = await createAdminClient()
    .from("cover_commands")
    .select("receipt, actor_staff_id")
    .eq("id", id)
    .maybeSingle<{ receipt: CommandReceipt; actor_staff_id: string }>();
  if (error) throw new Error(`Could not read that command: ${error.message}`);
  if (!data || data.actor_staff_id !== actorStaffId) return null;
  return { ...data.receipt, replayed: true };
}

/** The duties a teacher has declined, so the arranger never asks them again. */
export function exclusionsFrom(duties: readonly CoverDuty[]): Map<string, Set<string>> {
  const excluded = new Map<string, Set<string>>();
  for (const duty of duties) {
    if (!duty.cannotCoverAt || !duty.coveringStaffId) continue;
    const set = excluded.get(duty.needKey) ?? new Set<string>();
    set.add(duty.coveringStaffId);
    excluded.set(duty.needKey, set);
  }
  return excluded;
}

/* ------------------------------------------------------------- notices */

export type DutyNotice = {
  id: string;
  dutyId: string;
  kind: "cover_assigned" | "cover_changed" | "cover_cancelled" | "cover_escalation";
  staffProfileId: string;
  status:
    | "pending"
    | "cancelled"
    | "suppressed"
    | "dispatching"
    | "accepted"
    | "failed"
    | "unknown"
    | "delivered"
    | "read";
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Every notice intent for a day — the operator's view of who has been told what. */
export async function noticesOn(sessionLabel: string, day: string): Promise<DutyNotice[]> {
  await assertPermission("substitutions:view");
  const { data, error } = await createAdminClient()
    .from("staff_notices")
    .select("id, duty_id, kind, staff_profile_id, status, status_reason, created_at, updated_at")
    .eq("session_label", sessionLabel)
    .eq("day", day)
    // Cover notices only: an attendance reminder shares the outbox and names
    // a class, not a duty (P6).
    .not("duty_id", "is", null)
    .order("created_at")
    .returns<
      {
        id: string;
        duty_id: string;
        kind: DutyNotice["kind"];
        staff_profile_id: string;
        status: DutyNotice["status"];
        status_reason: string | null;
        created_at: string;
        updated_at: string;
      }[]
    >();
  if (error) throw new Error(`Could not read the notices: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    dutyId: row.duty_id,
    kind: row.kind,
    staffProfileId: row.staff_profile_id,
    status: row.status,
    statusReason: row.status_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Put a teacher into a lesson running now with nobody in it
 * (`vppsone.assign_late_cover`, migration `late_cover_assign`). Until that
 * migration is on the database the function is missing, and the caller is
 * told so plainly rather than shown a failure.
 */
export type LateCoverOutcome =
  | CommandReceipt
  | { ok: false; reason: "bad_request" | "not_permitted" | "id_reused" | "disabled" | "not_running" | "stale" | "refused_override" | "unavailable" | "no_lesson" }
  | { ok: false; reason: "failed"; message: string };

export async function commitLateCover(payload: Record<string, unknown>): Promise<LateCoverOutcome> {
  const { data, error } = await createAdminClient().rpc("assign_late_cover", { p_command: payload });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "failed", message: error.message };
  }
  return data as LateCoverOutcome;
}
