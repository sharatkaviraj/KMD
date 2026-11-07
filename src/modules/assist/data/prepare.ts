import "server-only";

import { classLabelsForJob } from "@/modules/academics/data/academics-repo";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { createAdminClient } from "@/platform/supabase/admin";
import { childBasics } from "@/vx/screens/teach/students";

import { classDigestTitle, coverPlanTitle, endOfSchoolDay } from "../domain/drafts";
import { draftedRefs, saveDraft } from "./drafts";
import { prepareAssistDraft } from "./run";

/**
 * Drafts the app writes before anyone asks (D-418). Each run is idempotent:
 * a (person, thing) that already has a draft is skipped, so a cron that fires
 * twice, or a cover confirmed after the morning run, spends nothing twice.
 * Every draft goes through `prepareAssistDraft`, so the admin's switch, the
 * feature switches and the month's budget hold exactly as for a tap.
 *
 * Nothing here writes school data and nothing is sent to anyone.
 */

export type PrepareSummary = { prepared: number; skipped: number; failed: number };

type DutyRow = {
  id: string;
  session_label: string;
  day: string;
  period: number;
  class_labels: string[];
  subject_code: string;
  covering_staff_id: string;
};

const LANGUAGES = new Set(["hi", "en", "both"]);

function minutesBetween(starts: string | undefined, ends: string | undefined): number {
  const at = (v?: string) => {
    const m = v ? /^(\d{1,2}):(\d{2})/.exec(v) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const from = at(starts);
  const to = at(ends);
  return from !== null && to !== null && to > from ? Math.min(120, Math.max(10, to - from)) : 40;
}

async function languagesOf(ids: readonly string[]): Promise<Map<string, "hi" | "en" | "both">> {
  if (!ids.length) return new Map();
  const { data } = await createAdminClient().from("staff_profiles").select("id, preferred_language").in("id", [...ids]);
  return new Map(((data ?? []) as { id: string; preferred_language: string | null }[])
    .map((r) => [r.id, (LANGUAGES.has(r.preferred_language ?? "") ? r.preferred_language : "hi") as "hi" | "en" | "both"]));
}

/**
 * A plan for every assigned cover duty on `day` (or only `dutyIds`), for the
 * teacher who covers it: waiting on their Today when they open the duty, with
 * no button to press. Only the class label, the subject and the period length
 * go to the AI; no child, no name.
 */
export async function prepareCoverPlans(opts: { day: string; dutyIds?: readonly string[]; max?: number; testOnly?: boolean }): Promise<PrepareSummary> {
  const summary: PrepareSummary = { prepared: 0, skipped: 0, failed: 0 };
  let query = createAdminClient()
    .from("cover_duties")
    .select("id, session_label, day, period, class_labels, subject_code, covering_staff_id")
    .eq("day", opts.day)
    .eq("status", "assigned")
    .not("covering_staff_id", "is", null)
    .order("period")
    .limit(opts.max ?? 60);
  if (opts.dutyIds?.length) query = query.in("id", [...opts.dutyIds].slice(0, 60));
  const { data, error } = await query.returns<DutyRow[]>();
  if (error) throw new Error(`Could not read the day's cover: ${error.message}`);
  // A confined deployment shares the database: it may prepare only for TEST sessions.
  const duties = (data ?? []).filter((d) => !opts.testOnly || isTestSessionLabel(d.session_label));
  if (!duties.length) return summary;

  const done = await draftedRefs("cover_plan", duties.map((d) => d.id));
  const todo = duties.filter((d) => !done.has(`${d.covering_staff_id}:${d.id}`));
  summary.skipped = duties.length - todo.length;
  if (!todo.length) return summary;

  const sessions = [...new Set(todo.map((d) => d.session_label))];
  const bells = new Map(await Promise.all(sessions.map(async (s) => [s, await currentBells(s).catch(() => null)] as const)));
  const { data: subjects } = await createAdminClient().from("subjects").select("code, name_en").returns<{ code: string; name_en: string | null }[]>();
  const subjectName = new Map((subjects ?? []).map((s) => [s.code, s.name_en || s.code]));
  const language = await languagesOf([...new Set(todo.map((d) => d.covering_staff_id))]);

  for (const duty of todo) {
    const bell = bells.get(duty.session_label)?.periods.find((b) => b.index === duty.period);
    const classLabels = duty.class_labels.join(", ").slice(0, 80) || "—";
    const result = await prepareAssistDraft(duty.covering_staff_id, "cover.plan", {
      classLabel: classLabels,
      subject: duty.subject_code ? (subjectName.get(duty.subject_code) ?? duty.subject_code).slice(0, 80) : null,
      minutes: minutesBetween(bell?.starts, bell?.ends),
      language: language.get(duty.covering_staff_id) ?? "hi",
    }, { testMaterial: isTestSessionLabel(duty.session_label) }).catch(() => null);
    if (!result?.ok) {
      summary.failed += 1;
      // Switched off or out of budget: the rest would be refused the same way.
      if (result && (result.problem === "off" || result.problem === "budget")) break;
      continue;
    }
    await saveDraft({
      staffProfileId: duty.covering_staff_id,
      kind: "cover_plan",
      ref: duty.id,
      sessionLabel: duty.session_label,
      title: coverPlanTitle(classLabels, periodNumber(duty.period), duty.day),
      href: `/teach?sheet=subs&cover=${duty.id}`,
      payload: result.value,
      logId: result.logId,
      expiresAt: endOfSchoolDay(duty.day),
    });
    summary.prepared += 1;
  }
  return summary;
}

type NoteRow = { id: string; student_id: string | null; class_id: string | null; body: string; tags: string[]; created_at: string };

/** Health and family notes stay out of every summary, as on the screens. */
const SENSITIVE = new Set(["health", "family"]);

/**
 * Each class teacher's week of shared notes about their class, turned into a
 * short digest (themes, who needs a follow-up, who deserves praise) and left
 * on their Today on Saturday. Private ("only me") notes, health and family
 * notes are never read. Children travel as C1, C2…; their names are masked
 * before the AI sees anything and restored only for the teacher.
 */
export async function prepareClassDigests(opts: { sessionLabel: string; day: string; max?: number }): Promise<PrepareSummary> {
  const summary: PrepareSummary = { prepared: 0, skipped: 0, failed: 0 };
  const admin = createAdminClient();
  const { data: teachers, error } = await admin
    .from("class_teachers")
    .select("class_id, staff_profile_id, effective_from, effective_to")
    .eq("session_label", opts.sessionLabel)
    .returns<{ class_id: string; staff_profile_id: string; effective_from: string | null; effective_to: string | null }[]>();
  if (error) throw new Error(`Could not read class teachers: ${error.message}`);
  const current = (teachers ?? []).filter((t) => (!t.effective_from || t.effective_from <= opts.day) && (!t.effective_to || t.effective_to >= opts.day));
  if (!current.length) return summary;

  const since = new Date(endOfSchoolDay(opts.day).valueOf() - 7 * 86_400_000).toISOString();
  const ref = (classId: string) => `${classId}:${opts.day}`;
  const done = await draftedRefs("class_digest", current.map((t) => ref(t.class_id)));
  const labels = await classLabelsForJob(opts.sessionLabel).catch(() => new Map<string, string>());
  const language = await languagesOf([...new Set(current.map((t) => t.staff_profile_id))]);

  for (const teacher of current.slice(0, opts.max ?? 80)) {
    if (done.has(`${teacher.staff_profile_id}:${ref(teacher.class_id)}`)) {
      summary.skipped += 1;
      continue;
    }
    const { data: rows } = await admin
      .from("notes")
      .select("id, student_id, class_id, body, tags, created_at")
      .eq("session_label", opts.sessionLabel)
      .eq("class_id", teacher.class_id)
      .eq("visibility", "team")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<NoteRow[]>();
    const week = (rows ?? []).filter((n) => n.student_id && n.body.trim() && !n.tags.some((t) => SENSITIVE.has(t)));
    // A quiet week needs no digest.
    if (week.length < 3) {
      summary.skipped += 1;
      continue;
    }
    const ids = [...new Set(week.map((n) => n.student_id as string))];
    const refOf = new Map(ids.map((id, i) => [id, `C${i + 1}`]));
    const names = await childBasics(ids).catch(() => new Map());
    const classLabel = (labels.get(teacher.class_id) ?? "").slice(0, 80) || "—";
    const result = await prepareAssistDraft(teacher.staff_profile_id, "class.digest", {
      classLabel,
      language: language.get(teacher.staff_profile_id) ?? "hi",
      notes: week.map((n) => ({
        ref: refOf.get(n.student_id as string) as string,
        when: n.created_at.slice(0, 10),
        tags: n.tags.slice(0, 6).map((t) => t.slice(0, 30)),
        text: n.body.trim().slice(0, 2000),
      })),
      names: [...new Set([...names.values()].map((c) => String(c.fullName ?? "").slice(0, 120)).filter(Boolean))].slice(0, 60),
    }, { testMaterial: isTestSessionLabel(opts.sessionLabel) }).catch(() => null);
    if (!result?.ok) {
      summary.failed += 1;
      if (result && (result.problem === "off" || result.problem === "budget")) break;
      continue;
    }
    const idOf = new Map(ids.map((id, i) => [`C${i + 1}`, id]));
    const withId = (rows: { ref: string; line: string }[]) => rows.map((r) => ({ ...r, studentId: idOf.get(r.ref) ?? null }));
    await saveDraft({
      staffProfileId: teacher.staff_profile_id,
      kind: "class_digest",
      ref: ref(teacher.class_id),
      sessionLabel: opts.sessionLabel,
      title: classDigestTitle(classLabel),
      href: "/teach/notes",
      payload: { classLabel, themes: result.value.themes, attention: withId(result.value.attention), praise: withId(result.value.praise), notes: week.length },
      logId: result.logId,
      expiresAt: endOfSchoolDay(opts.day, 6),
    });
    summary.prepared += 1;
  }
  return summary;
}
