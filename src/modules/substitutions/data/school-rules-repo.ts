import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { CACHE_TAGS, expireTag, sharedCache } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  DEFAULT_BELLS,
  type BellPeriod,
  type BellSchedule,
} from "@/modules/timetable/domain/bells";
import type { TeamSupervisionRule } from "@/modules/substitutions/domain/events";

/**
 * The two school rules cover depends on that the timetable cannot say (P2):
 * when each period happens, and how many of a team must be present.
 *
 * Read through the service role because the cover command reads them on the
 * server for any actor; written only after `substitutions:manage`, by the
 * people who arrange cover.
 */

export async function currentBells(sessionLabel: string): Promise<BellSchedule> {
  return cachedBells(sessionLabel);
}

/**
 * The bells, shared across requests for five minutes (perf fix 5): every
 * teacher Today, the admin board and the cover screens read them, and they
 * change a few times a year. No permission check, as before — the bells are
 * not a secret and the cover command reads them for any actor. `saveBells`
 * expires the tag, and reads its own revision uncached.
 */
const cachedBells = sharedCache((sessionLabel: string) => readBells(sessionLabel), ["vx-bells"], {
  tags: [CACHE_TAGS.bells],
  revalidate: 300,
});

async function readBells(sessionLabel: string): Promise<BellSchedule> {
  const { data, error } = await createAdminClient()
    .from("bell_schedules")
    .select("id, label, periods, revision")
    .eq("session_label", sessionLabel)
    .eq("is_current", true)
    .maybeSingle<{ id: string; label: string; periods: BellPeriod[]; revision: number }>();

  if (error) throw new Error(`Could not read the bells: ${error.message}`);
  if (!data) return DEFAULT_BELLS;
  return { id: data.id, label: data.label, periods: data.periods, revision: data.revision };
}

/**
 * Replace the session's bells, bumping the revision.
 *
 * Every cover plan records the revision it was judged by, so a plan made
 * against the old times is stale the moment this commits (P3).
 */
export async function saveBells(
  sessionLabel: string,
  periods: readonly BellPeriod[],
  actorStaffId: string,
): Promise<void> {
  await assertPermission("substitutions:manage");
  const admin = createAdminClient();
  // Uncached: the update below is conditional on this revision, and a stale
  // one would match no row and save nothing without an error.
  const current = await readBells(sessionLabel);
  const ordered = [...periods].sort((a, b) => a.index - b.index);

  if (current.id) {
    const { error } = await admin
      .from("bell_schedules")
      .update({ periods: ordered, revision: current.revision + 1, updated_by: actorStaffId })
      .eq("id", current.id)
      .eq("revision", current.revision);
    if (error) throw error;
    expireTag(CACHE_TAGS.bells);
    return;
  }

  const { error } = await admin.from("bell_schedules").insert({
    session_label: sessionLabel,
    label: DEFAULT_BELLS.label,
    periods: ordered,
    revision: 1,
    updated_by: actorStaffId,
  });
  if (error) throw error;
  expireTag(CACHE_TAGS.bells);
}

export async function teamRules(sessionLabel: string): Promise<TeamSupervisionRule[]> {
  const { data, error } = await createAdminClient()
    .from("team_supervision_rules")
    .select("subject_code, minimum_present")
    .eq("session_label", sessionLabel)
    .returns<{ subject_code: string; minimum_present: number }[]>();

  if (error) throw new Error(`Could not read the team rules: ${error.message}`);
  return data.map((row) => ({ subjectCode: row.subject_code, minimumPresent: row.minimum_present }));
}

export async function saveTeamRule(
  sessionLabel: string,
  rule: TeamSupervisionRule & { note?: string | null },
  actorStaffId: string,
): Promise<void> {
  await assertPermission("substitutions:manage");
  const { error } = await createAdminClient()
    .from("team_supervision_rules")
    .upsert(
      {
        session_label: sessionLabel,
        subject_code: rule.subjectCode,
        minimum_present: rule.minimumPresent,
        note: rule.note ?? null,
        updated_by: actorStaffId,
      },
      { onConflict: "session_label,subject_code" },
    );
  if (error) throw error;
}

export async function clearTeamRule(sessionLabel: string, subjectCode: string): Promise<void> {
  await assertPermission("substitutions:manage");
  const { error } = await createAdminClient()
    .from("team_supervision_rules")
    .delete()
    .eq("session_label", sessionLabel)
    .eq("subject_code", subjectCode);
  if (error) throw error;
}

export type CoverSwitches = { coverCommand: boolean; staffNoticeDispatch: boolean };

/** The two operator switches (P3/P4). Read for display; written by an admin action. */
export async function coverSwitches(): Promise<CoverSwitches> {
  const { data, error } = await createAdminClient()
    .from("runtime_flags")
    .select("key, enabled")
    .in("key", ["cover_command", "staff_notice_dispatch"])
    .returns<{ key: string; enabled: boolean }[]>();
  if (error) throw new Error(`Could not read the switches: ${error.message}`);
  const on = (key: string) => data.find((row) => row.key === key)?.enabled ?? false;
  return { coverCommand: on("cover_command"), staffNoticeDispatch: on("staff_notice_dispatch") };
}
