import "server-only";

import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { addDays, schoolToday } from "@/platform/dates";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { candidatesFor, profilesFor, readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { coverCountsBetween, noticesOn, type DutyNotice } from "@/modules/substitutions/data/cover-repo";
import { blockLabels, tierLabels } from "@/modules/substitutions/domain/labels";
import { needsHelpReasons } from "@/modules/substitutions/domain/cover-state";
import { coverEligibleIds, distinctNames, missedPeriods } from "@/modules/substitutions/domain/cover-view";
import { getPublishedVersion, listSlots, listVersions, type TimetableVersion } from "@/modules/timetable/data/timetable-repo";
import { DEFAULT_BELLS } from "@/modules/timetable/domain/bells";
import type { Pair } from "@/vx/text";

import { weekDates, type LeaveSpan, type PendingChange, type Slot } from "./domain/timetable";

/*
 * Everything the Timetable screen reads, once. The week grids come from the
 * published version with pending edits laid over them on the client; the
 * Substitutions tab is the same cover day `/substitutions` reads, so what is
 * shown here is what the cover command will act on.
 */

export type CoverDutyView = {
  id: string;
  needKey: string;
  period: number;
  classLabels: string[];
  subjectCode: string;
  status: "assigned" | "needs_help" | "cancelled" | "superseded";
  coveringStaffId: string | null;
  coveringName: string | null;
  suggestedStaffId: string | null;
  absentNames: string[];
  /** The staff ids behind `absentNames`, so a teacher's own week can mark the periods they leave. */
  absentIds?: string[];
  reason: Pair | null;
  /** Why the duty needs a person (`needsHelpReasons` key); the default one is not repeated on screen. */
  reasonKey?: string | null;
  notice: DutyNotice["status"] | null;
  candidates: { id: string; name: string; detail: string; detailHi?: string | null; blocked: boolean; subsThisWeek: number }[];
};

export type CoverView = {
  day: string;
  dayRevision: number;
  canCommand: boolean;
  hasTimetable: boolean;
  absences: { id: string; staffId: string; name: string; periods: number[]; reason: string | null }[];
  duties: CoverDutyView[];
  /**
   * Lessons an absence leaves whose period had begun before cover could be
   * arranged — shown as missed, never silently dropped (school-day run B1).
   */
  missed?: { key: string; period: number; classLabels: string[]; subjectCode: string; absentIds: string[]; absentNames: string[] }[];
  staff: { id: string; name: string }[];
};

export type LeaveView = {
  id: string;
  staffId: string;
  name: string;
  from: string;
  to: string;
  span: LeaveSpan;
  note: string | null;
  status: "asked" | "approved" | "declined" | "cancelled";
  createdAt: string;
  /** Who approved it, and when (approved leave only). */
  decidedBy?: string | null;
  decidedAt?: string | null;
};

export type TimetableData = {
  sessionLabel: string | null;
  today: string;
  week: string[];
  version: { id: string; label: string } | null;
  /** Published versions, newest first (editors only): the publish screen's history. */
  versions?: { id: string; label: string; publishedAt: string | null }[];
  slots: Slot[];
  classes: { id: string; label: string; classTeacher: string | null }[];
  teachers: { id: string; name: string; shortName: string }[];
  subjects: { id: string; code: string; name: string; nameHi?: string | null }[];
  bells: { index: number; starts: string; ends: string }[];
  /**
   * School-clock "HH:MM" that marks the running period. Absent, the browser's
   * clock is read (the screen's normal case); a fixture pins it.
   */
  clock?: string | null;
  changes: PendingChange[];
  leave: LeaveView[];
  cover: CoverView | null;
  subsThisWeek: Record<string, number>;
  me: { id: string; mayEdit: boolean; mayCover: boolean; mayViewCover: boolean };
};

export async function loadTimetableScreen(coverDayParam: string | null): Promise<TimetableData> {
  const me = await requirePermission("timetable:view", "/timetable");
  const mayEdit = can(me, "timetable:manage");
  const mayCover = can(me, "substitutions:manage");
  const mayViewCover = can(me, "substitutions:view");
  const today = schoolToday();
  const week = weekDates(today);
  const sessionLabel = await resolveSessionLabel();
  const empty: TimetableData = {
    sessionLabel,
    today,
    week,
    version: null,
    slots: [],
    classes: [],
    teachers: [],
    subjects: [],
    bells: DEFAULT_BELLS.periods.map((p) => ({ ...p })),
    changes: [],
    leave: [],
    cover: null,
    subsThisWeek: {},
    me: { id: me.id, mayEdit, mayCover, mayViewCover },
  };
  if (!sessionLabel) return empty;

  const admin = createAdminClient();
  const coverDay = coverDayParam && /^\d{4}-\d{2}-\d{2}$/.test(coverDayParam) ? coverDayParam : today;

  const [published, labels, staff, subjects, changeRows, leaveRows, classTeacherRows, subsWeek, versionRows] = await Promise.all([
    getPublishedVersion(sessionLabel),
    classLabelMap(sessionLabel),
    listStaff(),
    listSubjects(),
    mayEdit ? admin
      .from("timetable_changes")
      .select("id, day, period, class_id, class_label, from_subject_code, from_teacher_short_name, subject_id, subject_code, staff_profile_id, teacher_short_name, created_by, created_at")
      .eq("session_label", sessionLabel)
      .eq("status", "pending")
      .order("created_at")
      .returns<{ id: string; day: string; period: number; class_id: string; class_label: string; from_subject_code: string | null; from_teacher_short_name: string | null; subject_id: string; subject_code: string; staff_profile_id: string; teacher_short_name: string; created_by: string; created_at: string }[]>() : Promise.resolve({ data: [] }),
    admin
      .from("teacher_leave")
      .select("id, staff_profile_id, from_day, to_day, span, note, status, created_at, decided_by, decided_at")
      .eq("session_label", sessionLabel)
      .gte("to_day", addDays(today, -7))
      .in("status", ["asked", "approved"])
      .order("from_day")
      .limit(200)
      .returns<{ id: string; staff_profile_id: string; from_day: string; to_day: string; span: LeaveSpan; note: string | null; status: LeaveView["status"]; created_at: string; decided_by: string | null; decided_at: string | null }[]>(),
    admin
      .from("class_teachers")
      .select("class_id, staff_profile_id, effective_to")
      .eq("session_label", sessionLabel)
      .is("effective_to", null)
      .returns<{ class_id: string; staff_profile_id: string }[]>(),
    mayViewCover ? coverCountsBetween(sessionLabel, week[0], week[5]).catch(() => ({}) as Record<string, number>) : Promise.resolve({} as Record<string, number>),
    // The publish screen's history; a failure leaves it out rather than the screen.
    mayEdit ? Promise.resolve().then(() => listVersions(sessionLabel)).catch(() => [] as TimetableVersion[]) : Promise.resolve([] as TimetableVersion[]),
  ]);

  const slots: Slot[] = published
    ? (await listSlots(published.id)).map((s) => ({
        day: s.day,
        period: s.period,
        classId: s.classId,
        classLabel: labels.get(s.classId) ?? s.classLabel,
        subjectId: s.subjectId,
        subjectCode: s.subjectCode,
        staffProfileId: s.staffProfileId,
        teacherShortName: s.teacherShortName,
        parallel: s.parallel,
        shared: s.shared,
      }))
    : [];

  const nameOf = new Map(staff.map((s) => [s.id, s.displayName]));
  const classTeacher = new Map((classTeacherRows.data ?? []).map((r) => [r.class_id, nameOf.get(r.staff_profile_id) ?? null]));
  const inTimetable = new Set(slots.map((s) => s.classId));
  // `classLabelMap` is built in school order (Nursery before Class 1), and a Map keeps it.
  const classes = [...labels.entries()].filter(([id]) => inTimetable.has(id) || slots.length === 0).map(([id, label]) => ({ id, label, classTeacher: classTeacher.get(id) ?? null }));
  const teaching = new Set(slots.map((s) => s.staffProfileId));
  const teachers = staff
    .filter((s) => s.isActive && (s.isTeaching || teaching.has(s.id)))
    .map((s) => ({ id: s.id, name: s.displayName, shortName: s.shortName }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  let cover: CoverView | null = null;
  if (mayViewCover) {
    const day = await readCoverDay(sessionLabel, coverDay);
    const [notices, profiles] = await Promise.all([noticesOn(sessionLabel, coverDay).catch(() => [] as DutyNotice[]), mayCover ? profilesFor(day) : Promise.resolve(null)]);
    const latest = new Map<string, DutyNotice>();
    for (const n of notices) {
      if (n.kind !== "cover_assigned" && n.kind !== "cover_changed") continue;
      const seen = latest.get(n.dutyId);
      if (!seen || seen.createdAt <= n.createdAt) latest.set(n.dutyId, n);
    }
    // Two profiles called "QA Teacher" must not look like one person in a picker.
    const names = distinctNames(day.staff);
    for (const a of day.absences) if (!names.has(a.staffProfileId)) names.set(a.staffProfileId, a.staffName);
    // Office, admin and view-only logins are never offered as cover (D-213).
    const eligible = coverEligibleIds(day.staff, day.slots);
    cover = {
      day: coverDay,
      dayRevision: day.dayRevision,
      canCommand: mayCover && Boolean(day.versionId && day.header),
      hasTimetable: Boolean(day.versionId && day.header),
      absences: day.absences.map((a) => ({ id: a.id, staffId: a.staffProfileId, name: names.get(a.staffProfileId) ?? a.staffName, periods: a.periods, reason: mayCover ? a.reason : null })),
      staff: day.staff.filter((s) => eligible.has(s.id)).map((s) => ({ id: s.id, name: names.get(s.id) ?? s.displayName })),
      missed: missedPeriods(day.needs, day.live, day.openPeriods).map((m) => ({
        key: m.key,
        period: m.period,
        classLabels: m.classLabels,
        subjectCode: m.subjectCode,
        absentIds: m.absentStaffIds,
        absentNames: m.absentStaffIds.map((id) => names.get(id) ?? "—"),
      })),
      duties: day.live
        .map((duty) => {
          const reasonKey = duty.status === "needs_help" ? (duty.reason ?? "no_candidate") : null;
          const reason = reasonKey ? (needsHelpReasons[reasonKey] ?? needsHelpReasons.no_candidate) : null;
          return {
            id: duty.id,
            needKey: duty.needKey,
            period: duty.period,
            classLabels: duty.classLabels,
            subjectCode: duty.subjectCode,
            status: duty.status,
            coveringStaffId: duty.coveringStaffId,
            coveringName: duty.coveringStaffId ? (names.get(duty.coveringStaffId) ?? null) : null,
            suggestedStaffId: duty.suggestedStaffId,
            absentNames: duty.absentStaffIds.map((id) => names.get(id) ?? "—"),
            absentIds: duty.absentStaffIds,
            reason: reason ? { en: reason.en, hi: reason.hi } : null,
            reasonKey,
            notice: latest.get(duty.id)?.status ?? null,
            candidates: profiles
              ? candidatesFor(day, profiles.everyone, profiles.history, duty)
                  .filter((c) => eligible.has(c.teacher))
                  .slice(0, 25)
                  .map((c) => {
                    const label = c.blocked.length ? blockLabels[c.blocked[0]] : tierLabels[c.matchTier];
                    return {
                      id: c.teacher,
                      name: names.get(c.teacher) ?? "—",
                      detail: label?.en ?? (c.blocked.length ? c.blocked[0] : c.matchTier),
                      detailHi: label?.hi ?? null,
                      blocked: c.blocked.length > 0,
                      subsThisWeek: subsWeek[c.teacher] ?? 0,
                    };
                  })
              : [],
          };
        })
        .sort((a, b) => a.period - b.period),
    };
  }

  return {
    ...empty,
    version: published ? { id: published.id, label: published.label } : null,
    versions: versionRows
      .filter((v) => v.status !== "draft")
      .slice(0, 4)
      .map((v) => ({ id: v.id, label: v.label, publishedAt: v.publishedAt })),
    slots,
    classes,
    teachers,
    subjects: subjects.filter((s) => s.isActive).map((s) => ({ id: s.id, code: s.code, name: s.nameEn || s.code, nameHi: s.nameHi || null })),
    changes: (changeRows.data ?? []).map((c) => ({
      id: c.id,
      day: c.day,
      period: c.period,
      classId: c.class_id,
      classLabel: labels.get(c.class_id) ?? c.class_label,
      fromSubjectCode: c.from_subject_code,
      fromTeacher: c.from_teacher_short_name,
      subjectId: c.subject_id,
      subjectCode: c.subject_code,
      staffProfileId: c.staff_profile_id,
      teacherShortName: c.teacher_short_name,
      createdBy: nameOf.get(c.created_by) ?? null,
      createdAt: c.created_at,
    })),
    leave: (leaveRows.data ?? []).map((l) => ({
      id: l.id,
      staffId: l.staff_profile_id,
      name: nameOf.get(l.staff_profile_id) ?? "—",
      from: l.from_day,
      to: l.to_day,
      span: l.span,
      note: mayCover ? l.note : null,
      status: l.status,
      createdAt: l.created_at,
      decidedBy: l.status === "approved" && l.decided_by ? (nameOf.get(l.decided_by) ?? null) : null,
      decidedAt: l.status === "approved" ? l.decided_at : null,
    })),
    cover,
    subsThisWeek: subsWeek,
  };
}
