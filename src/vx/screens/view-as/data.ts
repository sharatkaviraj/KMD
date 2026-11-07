import "server-only";

import { classLabelMap } from "@/modules/academics/data/academics-repo";
import { staffPhotosFor } from "@/modules/collection/data/approved-photos";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { resolveStaffRole, type StaffRole } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { mayViewAs } from "@/platform/auth/view-as-subject";
import { resolveLanguage } from "@/platform/i18n/language";
import { createAdminClient } from "@/platform/supabase/admin";

import type { ViewAsChoices, ViewAsPerson, ViewAsRecent } from "./types";

export type { ViewAsChoices, ViewAsPerson, ViewAsRecent } from "./types";

type ProfileRow = {
  id: string;
  user_id: string | null;
  display_name: string;
  role: string | null;
  is_active: boolean;
  is_test_account: boolean | null;
  preferred_language: string | null;
};

type LogRow = { subject_staff_id: string; started_at: string; ended_at: string | null; expires_at: string };
type ClassRow = { staff_profile_id: string; class_id: string; session_label: string; effective_from: string };

/** How many earlier looks the picker offers again. */
const RECENT_LIMIT = 4;

/** The order the picker lists roles in: the people an administrator most often checks first. */
export const ROLE_ORDER: readonly StaffRole[] = [
  "teacher",
  "academic_coordinator",
  "exam_coordinator",
  "accountant",
  "fee_collector",
  "office",
  "view_only",
];

/**
 * Everybody `actor` may see One as, with what tells two teachers apart (their
 * photo and the class they teach), and the actor's last few looks.
 *
 * Read with the service role, after the page has checked that `actor` — the
 * person actually signed in — is an active administrator. The same rule
 * (`mayViewAs`) decides the list here, the switch in the action, and the
 * database's own `view_as_begin()`.
 */
export async function loadViewAsChoices(actor: CurrentStaff): Promise<ViewAsChoices> {
  const db = createAdminClient();
  const [profiles, log, classes] = await Promise.all([
    db
      .from("staff_profiles")
      .select("id, user_id, display_name, role, is_active, is_test_account, preferred_language")
      .eq("is_active", true)
      .order("display_name")
      .returns<ProfileRow[]>(),
    db
      .from("view_as_log")
      .select("subject_staff_id, started_at, ended_at, expires_at")
      .eq("actor_user_id", actor.userId)
      .order("started_at", { ascending: false })
      .limit(24)
      .returns<LogRow[]>(),
    db
      .from("class_teachers")
      .select("staff_profile_id, class_id, session_label, effective_from")
      .eq("role", "class_teacher")
      .is("effective_to", null)
      .returns<ClassRow[]>(),
  ]);
  if (profiles.error || !Array.isArray(profiles.data)) throw new Error("Could not read the staff list.");

  const rows = profiles.data.filter((row) => mayViewAs(actor, row));
  const [photos, classNames] = await Promise.all([
    staffPhotosFor(actor, rows.map((row) => row.id)).catch(() => new Map<string, string>()),
    classesTaught(rows, classes.error ? [] : (classes.data ?? [])).catch(() => new Map<string, string[]>()),
  ]);

  const people: ViewAsPerson[] = rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    role: resolveStaffRole(row.role),
    photo: photos.get(row.id) ?? null,
    hasSignIn: Boolean(row.user_id),
    practice: row.is_test_account === true,
    classes: classNames.get(row.id) ?? [],
    language: resolveLanguage(row.preferred_language),
  }));
  people.sort((a, b) => Number(a.practice) - Number(b.practice) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name));

  // The last few people looked at, each once, newest first. Only people the
  // actor may still see One as: somebody made an administrator since is gone.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();
  const seen = new Set<string>();
  const latest = (log.error ? [] : (log.data ?? [])).filter((entry) => {
    if (seen.has(entry.subject_staff_id) || !byId.has(entry.subject_staff_id)) return false;
    seen.add(entry.subject_staff_id);
    return true;
  });
  const recent: ViewAsRecent[] = latest.slice(0, RECENT_LIMIT).flatMap((entry) => {
    const who = byId.get(entry.subject_staff_id);
    if (!who) return [];
    const started = Date.parse(entry.started_at);
    const open = entry.ended_at === null && Date.parse(entry.expires_at) > now;
    const until = entry.ended_at ? Date.parse(entry.ended_at) : Math.min(Date.parse(entry.expires_at), now);
    return [{
      subjectId: who.id,
      name: who.display_name,
      role: resolveStaffRole(who.role),
      startedAt: entry.started_at,
      minutes: open ? null : Math.max(1, Math.round((until - started) / 60_000)),
    }];
  });

  return { people, recent };
}

/**
 * "Class teacher of 6 A" for each person, in the session their own screens
 * open in: a TEST session for a practice account, a real one for everybody
 * else. A failed class read only drops the line; the picker still works.
 */
async function classesTaught(people: ProfileRow[], assignments: ClassRow[]): Promise<Map<string, string[]>> {
  const practice = new Map(people.map((row) => [row.id, row.is_test_account === true]));
  const wanted = assignments.filter((row) => practice.has(row.staff_profile_id) && isTestSessionLabel(row.session_label) === practice.get(row.staff_profile_id));
  // One session per person, the one their newest open assignment is in: a
  // class from a year that has not been closed off is not theirs now. By the
  // assignment's own date, never by sorting session labels (rule 3a).
  const newest = new Map<string, ClassRow>();
  for (const row of wanted) {
    const seen = newest.get(row.staff_profile_id);
    if (!seen || row.effective_from > seen.effective_from) newest.set(row.staff_profile_id, row);
  }
  const current = wanted.filter((row) => newest.get(row.staff_profile_id)?.session_label === row.session_label);
  const sessions = [...new Set(current.map((row) => row.session_label))];
  const labels = new Map<string, Map<string, string>>();
  await Promise.all(sessions.map(async (session) => labels.set(session, await classLabelMap(session).catch(() => new Map<string, string>()))));

  const out = new Map<string, string[]>();
  for (const row of current) {
    const label = labels.get(row.session_label)?.get(row.class_id);
    if (!label) continue;
    const list = out.get(row.staff_profile_id) ?? [];
    if (!list.includes(label)) list.push(label);
    out.set(row.staff_profile_id, list);
  }
  return out;
}
