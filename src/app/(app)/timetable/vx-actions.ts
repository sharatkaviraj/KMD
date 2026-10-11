"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { checkCoverCommandAction, coverCommandAction } from "@/app/(app)/substitutions/actions";
import { assertPermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolToday } from "@/platform/dates";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { coverDayRevision } from "@/modules/substitutions/data/cover-repo";
import { idleCoverState, receiptSentence } from "@/modules/substitutions/domain/cover-state";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { createDraft, getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { publishVersion } from "@/modules/timetable/data/timetable-repo";
import { assertNotPreviewing } from "@/vx/view-as";
import { p, type Pair } from "@/vx/text";
import {
  affectedTeachers,
  applyChanges,
  changeNotice,
  clashFor,
  LEAVE_PROBLEMS,
  leaveProblems,
  PERIODS,
  schoolDays,
  spanPeriods,
  WEEK,
  type LeaveSpan,
  type PendingChange,
  type Slot,
} from "@/vx/screens/timetable/domain/timetable";

/*
 * Timetable & substitutions (design `Timetable`). Every write: permission,
 * then assertNotPreviewing(). Period edits wait in `timetable_changes` until
 * Publish copies the live version with them applied and publishes the copy
 * through the existing publish path; cover goes through the one cover
 * command (`coverCommandAction`), which queues the staff notices.
 */

export type TimetableResult = { ok: boolean; message: Pair };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const fail = (message: Pair): TimetableResult => ({ ok: false, message });
const notSaved = p("Not saved. Try again.", "सहेजा नहीं गया।");

/** Change one period of one class. Nothing reaches teachers until Publish. */
export async function saveChangeAction(input: { day: string; period: number; classId: string; subjectId: string; staffProfileId: string }): Promise<TimetableResult> {
  const actor = await assertPermission("timetable:manage");
  await assertNotPreviewing();
  if (!(WEEK as readonly string[]).includes(input.day) || !(PERIODS as readonly number[]).includes(input.period) || !UUID.test(input.classId) || !UUID.test(input.subjectId) || !UUID.test(input.staffProfileId)) {
    return fail(p("Pick a subject and a teacher.", "विषय और शिक्षक चुनें।"));
  }
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail(p("No session is open.", "कोई सत्र खुला नहीं है।"));
  const published = await getPublishedVersion(sessionLabel);
  if (!published) return fail(p("There is no published timetable to change.", "कोई प्रकाशित समय-सारणी नहीं।"));

  const [slots, subjects, staff, labels] = await Promise.all([listSlots(published.id), listSubjects(), listStaff(), classLabelMap(sessionLabel)]);
  const subject = subjects.find((s) => s.id === input.subjectId && s.isActive);
  const teacher = staff.find((s) => s.id === input.staffProfileId && s.isActive);
  const classLabel = labels.get(input.classId);
  if (!subject || !teacher || !classLabel) return fail(p("Pick a subject and a teacher.", "विषय और शिक्षक चुनें।"));

  const admin = createAdminClient();
  const { data: pendingRows } = await admin
    .from("timetable_changes")
    .select("id, day, period, class_id, class_label, from_subject_code, from_teacher_short_name, subject_id, subject_code, staff_profile_id, teacher_short_name, created_at")
    .eq("session_label", sessionLabel)
    .eq("status", "pending")
    .returns<{ id: string; day: string; period: number; class_id: string; class_label: string; from_subject_code: string | null; from_teacher_short_name: string | null; subject_id: string; subject_code: string; staff_profile_id: string; teacher_short_name: string; created_at: string }[]>();
  const pending: PendingChange[] = (pendingRows ?? [])
    .filter((r) => !(r.class_id === input.classId && r.day === input.day && r.period === input.period))
    .map((r) => ({ id: r.id, day: r.day, period: r.period, classId: r.class_id, classLabel: r.class_label, fromSubjectCode: r.from_subject_code, fromTeacher: r.from_teacher_short_name, subjectId: r.subject_id, subjectCode: r.subject_code, staffProfileId: r.staff_profile_id, teacherShortName: r.teacher_short_name, createdBy: null, createdAt: r.created_at }));

  const planned = applyChanges(slots as Slot[], pending);
  const clash = clashFor(planned, { day: input.day, period: input.period, classId: input.classId, staffProfileId: teacher.id });
  if (clash) return fail(p(`${teacher.displayName} already teaches ${clash.classLabel} then.`, `${teacher.displayName} उस समय ${clash.classLabel} में हैं।`));

  const live = slots.filter((s) => s.classId === input.classId && s.day === input.day && s.period === input.period);
  const same = live.length === 1 && live[0].subjectId === subject.id && live[0].staffProfileId === teacher.id;

  // One pending edit per cell: the previous one for this cell is set aside.
  await admin
    .from("timetable_changes")
    .update({ status: "discarded", decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("session_label", sessionLabel)
    .eq("status", "pending")
    .eq("class_id", input.classId)
    .eq("day", input.day)
    .eq("period", input.period);

  if (same) {
    revalidatePath("/timetable");
    return { ok: true, message: p("Back as it was — nothing to publish for this period", "पहले जैसा") };
  }

  const { error } = await admin.from("timetable_changes").insert({
    session_label: sessionLabel,
    base_version_id: published.id,
    day: input.day,
    period: input.period,
    class_id: input.classId,
    class_label: classLabel,
    from_subject_code: live.map((s) => s.subjectCode).join(" / ") || null,
    from_teacher_short_name: live.map((s) => s.teacherShortName).join(" / ") || null,
    subject_id: subject.id,
    subject_code: subject.code,
    staff_profile_id: teacher.id,
    teacher_short_name: teacher.shortName,
    created_by: actor.id,
  });
  if (error) return fail(notSaved);
  revalidatePath("/timetable");
  return { ok: true, message: p("Change saved · publish to tell teachers", "बदलाव सहेजा · प्रकाशित करें") };
}

/** Set one pending edit aside, or all of them. */
export async function discardChangeAction(changeId: string | null): Promise<TimetableResult> {
  const actor = await assertPermission("timetable:manage");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail(notSaved);
  let query = createAdminClient()
    .from("timetable_changes")
    .update({ status: "discarded", decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("session_label", sessionLabel)
    .eq("status", "pending");
  if (changeId) {
    if (!UUID.test(changeId)) return fail(notSaved);
    query = query.eq("id", changeId);
  }
  const { error } = await query;
  if (error) return fail(notSaved);
  revalidatePath("/timetable");
  return { ok: true, message: changeId ? p("Change removed", "बदलाव हटाया") : p("All changes removed", "सभी बदलाव हटाए") };
}

/**
 * Publish every pending edit: copy the live version, apply them, publish the
 * copy (which archives the old one and regenerates teaching assignments), and
 * queue one WhatsApp notice per affected teacher when asked.
 */
export async function publishChangesAction(input: { notify: boolean }): Promise<TimetableResult> {
  const actor = await assertPermission("timetable:manage");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail(p("No session is open.", "कोई सत्र खुला नहीं है।"));
  const published = await getPublishedVersion(sessionLabel);
  if (!published) return fail(p("There is no published timetable.", "कोई प्रकाशित समय-सारणी नहीं।"));
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("timetable_changes")
    .select("id, base_version_id, day, period, class_id, class_label, from_subject_code, from_teacher_short_name, subject_id, subject_code, staff_profile_id, teacher_short_name, created_at")
    .eq("session_label", sessionLabel)
    .eq("status", "pending")
    .returns<{ id: string; base_version_id: string; day: string; period: number; class_id: string; class_label: string; from_subject_code: string | null; from_teacher_short_name: string | null; subject_id: string; subject_code: string; staff_profile_id: string; teacher_short_name: string; created_at: string }[]>();
  const changes: PendingChange[] = (rows ?? []).map((r) => ({ id: r.id, day: r.day, period: r.period, classId: r.class_id, classLabel: r.class_label, fromSubjectCode: r.from_subject_code, fromTeacher: r.from_teacher_short_name, subjectId: r.subject_id, subjectCode: r.subject_code, staffProfileId: r.staff_profile_id, teacherShortName: r.teacher_short_name, createdBy: null, createdAt: r.created_at }));
  if (changes.length === 0) return fail(p("Nothing to publish.", "प्रकाशित करने को कुछ नहीं।"));

  const live = (await listSlots(published.id)) as Slot[];
  const next = applyChanges(live, changes);
  const clashes = changes.map((c) => clashFor(next, c)).filter(Boolean);
  if (clashes.length) return fail(p("A change double-books a teacher. Fix it before publishing.", "एक बदलाव में शिक्षक दो जगह हैं।"));

  let versionId: string;
  try {
    versionId = await createDraft({
      sessionLabel,
      label: `${published.label} + ${changes.length} ${changes.length === 1 ? "change" : "changes"}`.slice(0, 120),
      notes: `Published from the Timetable screen: ${changes.map((c) => `${c.classLabel} ${c.day} P${periodNumber(c.period)} → ${c.subjectCode}/${c.teacherShortName}`).join("; ")}`.slice(0, 2000),
      sourceText: `Edited copy of version ${published.id}`,
      cellCount: new Set(next.map((s) => `${s.classId}|${s.day}|${s.period}`)).size,
      slots: next.map((s) => ({ day: s.day, period: s.period, classLabel: s.classLabel, classId: s.classId, subjectCode: s.subjectCode, subjectId: s.subjectId, teacherShortName: s.teacherShortName, staffProfileId: s.staffProfileId, parallel: s.parallel, shared: s.shared })),
      createdByUserId: actor.userId,
    });
    await publishVersion(versionId, sessionLabel, actor.userId);
  } catch {
    return fail(p("Not published. The live timetable is unchanged.", "प्रकाशित नहीं हुआ।"));
  }

  await admin
    .from("timetable_changes")
    .update({ status: "published", published_version_id: versionId, decided_by: actor.id, decided_at: new Date().toISOString() })
    .in("id", changes.map((c) => c.id));

  let queued = 0;
  if (input.notify) {
    const [{ data: template }, staff, subjects] = await Promise.all([
      admin.from("message_templates").select("id").eq("code", "vx_staff_notice").maybeSingle<{ id: string }>(),
      listStaff(),
      listSubjects(),
    ]);
    const subjectName = (code: string) => subjects.find((s) => s.code === code)?.nameEn ?? code;
    if (template) {
      const rowsToQueue = [...affectedTeachers(changes, live).entries()].flatMap(([staffId, list]) => {
        const person = staff.find((s) => s.id === staffId);
        const phone = String(person?.whatsappPhone ?? person?.phone ?? "").replace(/\D/g, "").slice(-10);
        if (!person || phone.length !== 10) return [];
        const text = changeNotice(person.displayName, list, subjectName);
        return [{ session_label: sessionLabel, template_id: template.id, to_phone: phone, to_name: person.displayName, staff_profile_id: person.id, variables: [`${text.hi}\n\n${text.en}`], rendered_hi: text.hi, rendered_en: text.en, status: "queued", requested_by: actor.id, category: "general" }];
      });
      if (rowsToQueue.length) {
        const { error } = await admin.from("message_sends").insert(rowsToQueue);
        if (!error) queued = rowsToQueue.length;
      }
    }
  }

  revalidatePath("/timetable");
  revalidatePath("/teach");
  return { ok: true, message: p(`Published · ${changes.length} ${changes.length === 1 ? "change" : "changes"}${queued ? ` · ${queued} teachers told` : ""}`, `प्रकाशित · ${changes.length} बदलाव`) };
}

/* ------------------------------------------------------------------- cover */

export type CoverInput = {
  commandId: string;
  sessionLabel: string;
  day: string;
  dayRevision: number;
  intent: "absence" | "clear_absence" | "assign" | "release" | "refresh";
  staffProfileId?: string;
  periods?: number[];
  needKey?: string;
  coveringStaffId?: string;
};

/** The cover command, from the Timetable screen. Same command, same notices. */
export type CoverActionResult = TimetableResult & { status: 'saved' | 'refused' | 'uncertain' | 'not_found' };

export async function coverAction(input: CoverInput): Promise<CoverActionResult> {
  await assertPermission("substitutions:manage");
  await assertNotPreviewing();
  if (!input.sessionLabel || input.sessionLabel !== await resolveSessionLabel()) return { ok: false, status: 'uncertain', message: p('Select the original academic session to check this save. Its earlier result is still unresolved.', 'इस बदलाव को जाँचने के लिए मूल सत्र चुनें। पुराना परिणाम अभी अनिश्चित है।') };
  const fd = new FormData();
  fd.set("commandId", input.commandId);
  fd.set("day", input.day);
  fd.set("dayRevision", String(input.dayRevision));
  fd.set("intent", input.intent);
  if (input.staffProfileId) fd.set("staffProfileId", input.staffProfileId);
  if (input.needKey) fd.set("needKey", input.needKey);
  if (input.coveringStaffId) fd.set("coveringStaffId", input.coveringStaffId);
  for (const period of input.periods ?? []) fd.append("periods", String(period));
  const state = await coverCommandAction(idleCoverState, fd);
  revalidatePath("/timetable");
  if (state.status === "saved" && state.receipt) {
    const sentence = receiptSentence(state.receipt);
    return { ok: true, status: 'saved', message: { en: sentence.en, hi: sentence.hi } };
  }
  return { ok: false, status: state.status === 'error' ? 'uncertain' : 'refused', message: state.status === 'error' ? p('The save result is uncertain. Check the saved result before trying another change.', 'बदलाव का परिणाम अनिश्चित है। दूसरा बदलाव करने से पहले जाँचें।') : state.message ? { en: state.message.en, hi: state.message.hi } : notSaved };
}

/** Read the original actor-scoped receipt before any uncertain retry. */
export async function checkCoverAction(input: Pick<CoverInput, 'commandId' | 'sessionLabel' | 'day'>): Promise<CoverActionResult> {
  const actor = await assertPermission('substitutions:manage');
  await assertNotPreviewing();
  if (!input.sessionLabel || input.sessionLabel !== await resolveSessionLabel() || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { ok: false, status: 'uncertain', message: p('Select the original academic session to check this save. Its earlier result is still unresolved.', 'इस बदलाव को जाँचने के लिए मूल सत्र चुनें। पुराना परिणाम अभी अनिश्चित है।') };
  const { data: command, error } = await createAdminClient().from('cover_commands').select('id').eq('id', input.commandId).eq('actor_staff_id', actor.id).eq('session_label', input.sessionLabel).eq('day', input.day).maybeSingle();
  if (error) throw new Error('Could not check the saved cover request.');
  if (!command) return { ok: false, status: 'not_found', message: p('No saved receipt found yet. Retry the same save to finish.', 'रसीद अभी नहीं मिली। वही बदलाव फिर आज़माएँ।') };
  const state = await checkCoverCommandAction(input.commandId);
  if (state.status === 'saved' && state.receipt) {
    const sentence = receiptSentence(state.receipt);
    revalidatePath('/timetable');
    return { ok: true, status: 'saved', message: { en: sentence.en, hi: sentence.hi } };
  }
  return { ok: false, status: state.status === 'idle' ? 'not_found' : state.status === 'error' ? 'uncertain' : 'refused', message: p('No saved receipt found yet. Retry the same save to finish.', 'रसीद अभी नहीं मिली। वही बदलाव फिर आज़माएँ।') };
}

/* ------------------------------------------------------------------- leave */

/** Ask for leave: for yourself with cover view, for anyone with cover manage. */
export async function requestLeaveAction(input: { staffId: string; from: string; to: string; span: string; note?: string }): Promise<TimetableResult> {
  const actor = await assertPermission("substitutions:view");
  await assertNotPreviewing();
  if (input.staffId !== actor.id && !can(actor, "substitutions:manage")) return fail(p("You can ask leave only for yourself.", "केवल अपने लिए।"));
  const problems = leaveProblems(input);
  if (problems.length || !UUID.test(input.staffId)) return fail(LEAVE_PROBLEMS[problems[0] ?? "who"]);
  const span: LeaveSpan = input.span === "first_half" || input.span === "second_half" ? input.span : "full";
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return fail(p("No session is open.", "कोई सत्र खुला नहीं है।"));
  const { error } = await createAdminClient().from("teacher_leave").insert({
    session_label: sessionLabel,
    staff_profile_id: input.staffId,
    from_day: input.from,
    to_day: input.to,
    span,
    note: input.note?.trim().slice(0, 200) || null,
    status: "asked",
    requested_by: actor.id,
  });
  if (error) return fail(notSaved);
  revalidatePath("/timetable");
  return { ok: true, message: p("Leave asked · waiting for approval", "छुट्टी माँगी गई") };
}

/**
 * Approve or decline. Approving marks the teacher away for every school day
 * from today to the end of the leave through the cover command, which
 * arranges cover and queues the notices. The leave note never goes in a notice.
 */
export async function decideLeaveAction(input: { id: string; approve: boolean }): Promise<TimetableResult> {
  const actor = await assertPermission("substitutions:manage");
  await assertNotPreviewing();
  if (!UUID.test(input.id)) return fail(notSaved);
  const admin = createAdminClient();
  const { data: leave } = await admin
    .from("teacher_leave")
    .select("id, session_label, staff_profile_id, from_day, to_day, span, status")
    .eq("id", input.id)
    .maybeSingle<{ id: string; session_label: string; staff_profile_id: string; from_day: string; to_day: string; span: LeaveSpan; status: string }>();
  if (!leave || leave.status !== "asked") return fail(p("That leave was already decided.", "यह पहले तय हो चुकी है।"));

  const { error } = await admin
    .from("teacher_leave")
    .update({ status: input.approve ? "approved" : "declined", decided_by: actor.id, decided_at: new Date().toISOString() })
    .eq("id", leave.id)
    .eq("status", "asked");
  if (error) return fail(notSaved);

  let arranged = 0;
  let refused = 0;
  if (input.approve) {
    const today = schoolToday();
    const days = schoolDays(leave.from_day > today ? leave.from_day : today, leave.to_day).filter((d) => DAY.test(d)).slice(0, 14);
    for (const day of days) {
      const revision = await coverDayRevision(leave.session_label, day).catch(() => null);
      if (revision === null) {
        refused += 1;
        continue;
      }
      const fd = new FormData();
      fd.set("commandId", randomUUID());
      fd.set("day", day);
      fd.set("dayRevision", String(revision));
      fd.set("intent", "absence");
      fd.set("staffProfileId", leave.staff_profile_id);
      for (const period of spanPeriods(leave.span)) fd.append("periods", String(period));
      const state = await coverCommandAction(idleCoverState, fd);
      if (state.status === "saved") arranged += 1;
      else refused += 1;
    }
  }

  revalidatePath("/timetable");
  if (!input.approve) return { ok: true, message: p("Leave declined", "छुट्टी अस्वीकार") };
  return {
    ok: true,
    message: p(
      `Leave approved · cover arranged for ${arranged} ${arranged === 1 ? "day" : "days"}${refused ? ` · ${refused} to arrange by hand` : ""}`,
      `छुट्टी स्वीकृत · ${arranged} दिन की व्यवस्था`,
    ),
  };
}
