import "server-only";

import { classLabelMap, listSubjects } from "@/modules/academics/data/academics-repo";
import { isSchoolOpen, timetableRuns } from "@/modules/academics/domain/calendar";
import { attendanceCalendar, classRoll, findRegister, listMarks, rosterOn } from "@/modules/attendance/data/attendance-repo";
import { classScopeFor, heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { compareRoll, registerAuthority, tally, type AttendanceStatus, type RollStudent, type SaveRegisterInput } from "@/modules/attendance/domain/attendance";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { listNoteKinds } from "@/modules/notes/data/notes-repo";
import { writeNoteSchema, type WriteNoteInput } from "@/modules/notes/domain/notes";
import { absencesOn } from "@/modules/substitutions/data/absences-repo";
import { readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { myDutiesOn } from "@/modules/substitutions/data/duty-repo";
import { approvedLeaveOn, buildGuidedPreview } from "@/modules/substitutions/data/guided";
import { listCoverPolicies } from "@/modules/substitutions/data/policies-repo";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { distinctNames } from "@/modules/substitutions/domain/cover-view";
import { absencePeriods, GUIDED_PERIOD_COUNT, type GuidedChoice } from "@/modules/substitutions/domain/guided";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { periodIndex, periodNumber } from "@/modules/timetable/domain/periods";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { filterVisibleStudentIds } from "@/platform/auth/test-session-access";
import { schoolToday } from "@/platform/dates";
import { assignmentsFor, listExams, marksOf, papersOf, toCell } from "@/vx/screens/exams/data";
import { classTeacherOf } from "@/vx/screens/exams/guards";
import type { SavePayload } from "@/vx/screens/exams/save-types";
import { p } from "@/vx/text";

import { loadPhotoRoster, marksPhotoContext } from "./marks-context";
import { readPhotoMark } from "./marks-review";
import { asksForAbsentNames, explicitWholeRegister, spokenAttendanceClass, supportedSpeech, voiceClassLabel, voiceDay, voiceMatch, voiceStudent, voiceTeacher, voiceTools, wholeRegisterStatusAgrees } from "./voice-intents";
import type { VoiceResult } from "./voice-review";
import type { VoiceExtraction } from "./voice-schema";

/** The guided cover command Bolo saves: the absence's periods and the reviewed plan's fingerprint. */
type CoverCommand = { day: string; staffId: string; substituteId?: string; classId?: string; periods: number[]; choices: GuidedChoice[]; dayRevision: number; fingerprint: string };
export type VoiceCommand =
  | { kind: "attendance_mark"; payload: Omit<SaveRegisterInput, "commandId"> }
  | { kind: "single_mark"; payload: Omit<SavePayload, "commandId"> }
  | { kind: "student_note"; payload: WriteNoteInput & { classId: null; studentId: string }; classId: string }
  | { kind: "substitution"; payload: CoverCommand }
  | { kind: "teacher_absence"; payload: CoverCommand };

type Resolution = { result: VoiceResult; command?: VoiceCommand };
type Clarify = Extract<VoiceResult, { kind: "clarify" }>["reason"];
const clarify = (reason: Clarify): Resolution => ({ result: { kind: "clarify", reason } });
const identify = (row: RollStudent) => ({ name: row.fullName, roll: row.rollNo });
const byId = (a: RollStudent, b: RollStudent) => a.studentId.localeCompare(b.studentId);

export async function loadVoiceTools(staff: CurrentStaff, session: string) {
  const held = await heldClassIds(staff.id, session);
  const tools = voiceTools(staff, held.length > 0);
  if (!tools.some(({ name }) => name === "student_note")) return tools;
  const primary = await classTeacherOf(staff.id, session);
  return primary.some((classId) => held.includes(classId)) ? tools : tools.filter(({ name }) => name !== "student_note");
}

export async function primaryVoiceClass(staff: CurrentStaff, session: string, classId: string) {
  const [held, primary] = await Promise.all([heldClassIds(staff.id, session), classTeacherOf(staff.id, session)]);
  return held.includes(classId) && primary.includes(classId);
}

async function testRoll(staff: CurrentStaff, roll: RollStudent[]) {
  const ids = roll.map(({ studentId }) => studentId);
  return roll.every(({ fullName }) => fullName && fullName !== "—") && (await filterVisibleStudentIds(staff, ids)).length === ids.length;
}

type TargetClass = { id: string; label: string };

async function attendance(staff: CurrentStaff, session: string, spoken: VoiceExtraction, target: TargetClass, day: string, today: string): Promise<Resolution> {
  const { id: classId, label: classLabel } = target;
  const query = spoken.intent === "attendance_query";
  if (day > today) return clarify("register");
  let authority: ReturnType<typeof registerAuthority> | null = null;
  if (query) {
    if (!scopeIncludes(await classScopeFor(staff, session), classId)) return clarify("target");
  } else {
    const [calendar, held] = await Promise.all([attendanceCalendar(session), heldClassIds(staff.id, session)]);
    if (!isSchoolOpen(day, calendar)) return clarify("register");
    authority = registerAuthority({
      isOwner: held.includes(classId), hasMarkPermission: can(staff, "attendance:mark"),
      hasMarkOnBehalfPermission: can(staff, "attendance:mark_on_behalf"), hasCorrectPermission: can(staff, "attendance:correct"),
    });
    if (!authority.save && !authority.correct) return clarify("target");
  }
  const [register, roll] = await Promise.all([findRegister(classId, session, day, null), rosterOn({ classId, sessionLabel: session, day })]);
  if (!await testRoll(staff, roll)) return clarify("target");
  const saved = Boolean(register && (register.revision > 0 || register.status === "submitted"));
  const existing = saved && register ? await listMarks(register.id) : new Map<string, { status: AttendanceStatus }>();
  const previous = new Map([...existing].map(([id, { status }]) => [id, status]));
  if (query) {
    const person = voiceStudent(roll, spoken, identify);
    if ((spoken.studentName || spoken.roll) && !person) return clarify("target");
    const absent = saved && asksForAbsentNames(spoken)
      ? roll.filter((row) => previous.get(row.studentId) === "absent").sort(compareRoll).map(identify)
      : null;
    return { result: { kind: "attendance_answer", classLabel, day, saved, student: person?.fullName ?? null,
      status: person ? previous.get(person.studentId) ?? null : null, tally: saved ? tally(roll, previous) : null, absent } };
  }

  if (!roll.length || !(saved ? authority?.correct && spoken.reason : authority?.save)) return clarify("register");

  const marks = new Map(previous);
  if (spoken.allPresent === true) {
    if (!explicitWholeRegister(spoken.transcript) || spoken.studentName || spoken.roll || !wholeRegisterStatusAgrees(spoken)) return clarify("register");
    if (!spoken.exceptions?.length && /\bexcept\b|सिवाय|छोड़कर/u.test(spoken.transcript.toLowerCase())) return clarify("register");
    for (const person of roll) marks.set(person.studentId, "present");
    const changed = new Set<string>();
    for (const exception of spoken.exceptions ?? []) {
      const person = voiceStudent(roll, exception, identify);
      if (!person || changed.has(person.studentId)) return clarify("target");
      changed.add(person.studentId);
      marks.set(person.studentId, exception.status);
    }
  } else {
    const person = voiceStudent(roll, spoken, identify);
    if (!person) return clarify("target");
    if (!saved || !spoken.attendanceStatus || spoken.exceptions?.length) return clarify("register");
    marks.set(person.studentId, spoken.attendanceStatus);
  }
  const sorted = [...roll].sort(byId);
  const totals = tally(roll, marks);
  if (!totals.complete) return clarify("register");
  const changes = sorted.flatMap(({ studentId, fullName, rollNo }) => {
    const status = marks.get(studentId)!;
    return (saved ? previous.get(studentId) !== status : status !== "present") ? [{ name: fullName, roll: rollNo, status }] : [];
  });
  if (saved && !changes.length) return clarify("register");
  const reason = saved ? spoken.reason ?? null : null;
  return {
    result: { kind: "attendance_mark", classLabel, day, tally: totals, changes, reason, correction: saved },
    command: { kind: "attendance_mark", payload: { classId, day, kind: saved ? "correction" : "save", expectedRevision: register?.revision ?? 0,
      reason, marks: sorted.map(({ studentId }) => ({ studentId, status: marks.get(studentId)! })) } },
  };
}

async function freePeriods(staff: CurrentStaff, session: string, spoken: VoiceExtraction, day: string): Promise<Resolution> {
  if (spoken.teacher || spoken.classLabel || spoken.studentName || spoken.roll) return clarify("target");
  const [calendar, published] = await Promise.all([attendanceCalendar(session), getPublishedVersion(session)]);
  if (!published || !timetableRuns(day, calendar)) return clarify("schedule");
  const [slots, bells, duties, absences, leave] = await Promise.all([
    listSlots(published.id), currentBells(session), myDutiesOn(staff.id, session, day), absencesOn(session, day), approvedLeaveOn(session, day),
  ]);
  const header = matchDayHeader([...new Set(slots.map((slot) => slot.day))], day);
  if (!header || !bells.periods.length) return clarify("schedule");
  const busy = new Set([
    ...slots.filter((slot) => slot.day === header && slot.staffProfileId === staff.id).map(({ period }) => period),
    ...duties.map(({ period }) => period), ...absences.filter((row) => row.staffProfileId === staff.id).flatMap((row) => row.periods),
    ...leave[staff.id] ?? [],
  ]);
  if (spoken.period !== undefined && !bells.periods.some(({ index }) => periodNumber(index) === spoken.period)) return clarify("schedule");
  return { result: { kind: "period_answer", day, requested: spoken.period ?? null,
    periods: bells.periods.filter(({ index }) => !busy.has(index)).map(({ index }) => periodNumber(index)).sort((a, b) => a - b) } };
}

async function availableTeachers(session: string, spoken: VoiceExtraction, day: string): Promise<Resolution> {
  if (!spoken.period || spoken.teacher || spoken.classLabel || spoken.studentName || spoken.roll) return clarify("target");
  if (!timetableRuns(day, await attendanceCalendar(session))) return clarify("schedule");
  const period = periodIndex(spoken.period);
  const [cover, policies, leave] = await Promise.all([readCoverDay(session, day), listCoverPolicies(session), approvedLeaveOn(session, day)]);
  if (!cover.versionId || !cover.header || !cover.bells.periods.some(({ index }) => index === period)) return clarify("schedule");

  // The staff directory is shared. Only active teaching staff linked by this
  // session's published timetable may appear in this answer.
  const scheduled = new Set(cover.slots.map(({ staffProfileId }) => staffProfileId));
  const staff = cover.staff.filter((row) => row.isTeaching && scheduled.has(row.id));
  const names = distinctNames(staff);
  const hours = new Map(policies.map(({ staffProfileId, allowedPeriods }) => [staffProfileId, allowedPeriods]));
  const busy = new Set([
    ...cover.slots.filter((slot) => slot.day === cover.header && slot.period === period).map(({ staffProfileId }) => staffProfileId),
    ...cover.live.flatMap((duty) => duty.period === period && duty.status === "assigned" && duty.coveringStaffId ? [duty.coveringStaffId] : []),
  ]);
  const teachers = staff.filter(({ id }) => !busy.has(id) && !cover.absenceIndex[id]?.includes(period) && !leave[id]?.includes(period) &&
    (hours.get(id)?.includes(period) ?? true)).map(({ id, displayName }) => names.get(id) ?? displayName).sort((a, b) => a.localeCompare(b, "en"));
  return { result: { kind: "available_teachers", day, period: spoken.period, teachers } };
}

async function singleMark(staff: CurrentStaff, session: string, spoken: VoiceExtraction, target: TargetClass): Promise<Resolution> {
  if (!spoken.exam || !spoken.subject || !spoken.mark) return clarify("target");
  const [exams, subjects, assignments] = await Promise.all([listExams(session), listSubjects(), assignmentsFor(session, staff.id)]);
  const subjectIds = new Set(assignments.filter((row) => row.classId === target.id).map(({ subjectId }) => subjectId));
  const exam = voiceMatch(exams, spoken.exam, (row) => [row.code, row.labelEn, row.labelHi]);
  const subject = voiceMatch(subjects.filter((row) => subjectIds.has(row.id)), spoken.subject, (row) => [row.code, row.nameEn, row.nameHi]);
  if (!exam || exam.status !== "open" || !subject) return clarify("target");
  const papers = (await papersOf([exam.id])).filter((paper) => paper.class_id === target.id && paper.subject_id === subject.id);
  if (papers.length !== 1) return clarify("target");
  const ctx = await marksPhotoContext(staff, papers[0].id);
  if (!ctx || ctx.session !== session) return clarify("target");
  const roster = await loadPhotoRoster(ctx);
  const student = voiceStudent(roster?.students ?? [], spoken, (row) => row);
  if (!student) return clarify("target");
  const mark = readPhotoMark(spoken.mark, ctx.rule);
  if (!mark || (mark.state === "absent" && !/\bab(?:sent)?\b|अनुपस्थित|ग़ैरहाज़िर|गैरहाजिर/iu.test(spoken.transcript))) return clarify("mark");
  const old = toCell((await marksOf([ctx.paper.id])).find((row) => row.student_id === student.id));
  const previous = old.state === "value" ? String(old.value) : old.state === "absent" ? "AB" : old.state === "exempt" ? "EX" : null;
  return {
    result: { kind: "single_mark", classLabel: target.label, student: student.name, roll: student.roll, exam: p(exam.labelEn, exam.labelHi),
      subject: p(subject.nameEn, subject.nameHi), mark: mark.value, max: ctx.rule.max, previous },
    command: { kind: "single_mark", payload: { paperId: ctx.paper.id, kind: "draft", expectedRevision: ctx.paper.entry_revision, reason: null,
      entries: [{ studentId: student.id, ...mark }] } },
  };
}

async function studentNote(staff: CurrentStaff, session: string, spoken: VoiceExtraction, target: TargetClass): Promise<Resolution> {
  if (!spoken.note || !await primaryVoiceClass(staff, session, target.id)) return clarify("target");
  const [roll, kinds] = await Promise.all([classRoll({ classId: target.id, sessionLabel: session }), listNoteKinds()]);
  const student = voiceStudent(roll, spoken, identify);
  const category = voiceMatch(kinds.filter((row) => row.isActive), spoken.noteKind ?? "other", (row) => [row.code, row.labelEn, row.labelHi]);
  if (!student || !category || !await testRoll(staff, [student])) return clarify("target");
  const payload = { classId: null, studentId: student.studentId, kindId: category.id, body: spoken.note };
  if (!writeNoteSchema.safeParse(payload).success) return clarify("target");
  return { result: { kind: "student_note", classLabel: target.label, student: student.fullName, roll: student.rollNo,
    category: p(category.labelEn, category.labelHi), note: payload.body }, command: { kind: "student_note", payload, classId: target.id } };
}

type CoverDay = Awaited<ReturnType<typeof readCoverDay>>;

/** Teaching staff on this session's published timetable: the only people Bolo may name for cover. */
function coverStaff(cover: CoverDay) {
  const scheduled = new Set(cover.slots.map(({ staffProfileId }) => staffProfileId));
  return cover.staff.filter((row) => row.isTeaching && scheduled.has(row.id));
}
const staffLabels = (row: CoverDay["staff"][number]) => [row.displayName, row.shortName ?? ""];

const HALF = GUIDED_PERIOD_COUNT / 2;
function spanPeriods(span: "whole" | "first_half" | "second_half") {
  const all = absencePeriods("whole", []);
  return span === "first_half" ? all.filter((period) => period < HALF) : span === "second_half" ? all.filter((period) => period >= HALF) : all;
}

/**
 * Read the cover plan for an absence and keep it only when it changes nothing
 * but this teacher's lessons, on the day as it was read.
 */
async function absencePlan(session: string, day: string, cover: CoverDay, teacherId: string, periods: number[], choices: GuidedChoice[]) {
  const preview = await buildGuidedPreview({ sessionLabel: session, day, staffProfileId: teacherId, periods, choices });
  if (!preview.ok) return null;
  const plan = preview.preview;
  if (plan.dayRevision !== cover.dayRevision || plan.refused.length || plan.others.length) return null;
  return plan;
}

async function substitution(session: string, spoken: VoiceExtraction, target: TargetClass | null, day: string, today: string): Promise<Resolution> {
  if (!spoken.period || day < today) return clarify("cover");
  const period = periodIndex(spoken.period);
  if (!timetableRuns(day, await attendanceCalendar(session))) return clarify("schedule");
  const cover = await readCoverDay(session, day);
  if (!cover.header || !cover.openPeriods.has(period)) return clarify("cover");
  const staff = coverStaff(cover);
  const teacher = voiceTeacher(staff, spoken.teacher, staffLabels);
  const named = spoken.substitute ? voiceTeacher(staff, spoken.substitute, staffLabels) : null;
  if (!teacher || (spoken.substitute && (!named || named.id === teacher.id))) return clarify("teacher");
  // Without a spoken class, the teacher's one lesson in that period is the lesson.
  const own = cover.slots.filter((slot) => slot.day === cover.header && slot.period === period && slot.staffProfileId === teacher.id);
  const classIds = [...new Set(own.map((slot) => slot.classId))];
  const classId = target?.id ?? (classIds.length === 1 ? classIds[0] : null);
  if (!classId || !own.some((slot) => slot.classId === classId)) return clarify(own.length ? "target" : "no_lessons");

  // The native absence intent replaces the person's periods. Preserve existing
  // periods and refuse plans with wider side effects than the one spoken lesson.
  const periods = absencePeriods("periods", [period, ...cover.absences.find((row) => row.staffProfileId === teacher.id)?.periods ?? []]);
  const draft = await absencePlan(session, day, cover, teacher.id, periods, []);
  if (!draft) return clarify("cover");
  const label = target?.label ?? own.find((slot) => slot.classId === classId)?.classLabel ?? "";
  const matching = draft.lessons.filter((lesson) => lesson.period === period &&
    lesson.classLabels.some((one) => voiceClassLabel(one) === voiceClassLabel(label)));
  if (matching.length !== 1 || matching[0].classLabels.length !== 1) return clarify("cover");
  const lesson = matching[0];
  // A named substitute must be free then; otherwise the timetable's best free teacher covers.
  const substituteId = named ? named.id : lesson.status === "assigned" ? lesson.coveringStaffId : null;
  if (!substituteId || !lesson.options.some((row) => row.id === substituteId && row.conflict === null)) return clarify("cover");
  const choices = [{ needKey: lesson.needKey, coveringStaffId: substituteId }];
  const reviewed = await absencePlan(session, day, cover, teacher.id, periods, choices);
  if (!reviewed || !reviewed.lessons.some((row) => row.needKey === lesson.needKey && row.coveringStaffId === substituteId)) return clarify("cover");
  const live = new Map(cover.live.map((row) => [row.needKey, row]));
  if (reviewed.lessons.some((row) => row.needKey !== lesson.needKey &&
      (live.get(row.needKey)?.coveringStaffId !== row.coveringStaffId || live.get(row.needKey)?.status !== row.status))) return clarify("cover");
  const substitute = cover.staff.find((row) => row.id === substituteId);
  return { result: { kind: "substitution", classLabel: label, day, period: spoken.period,
    teacher: teacher.displayName, substitute: substitute?.displayName ?? "—", subject: lesson.subjectCode },
  command: { kind: "substitution", payload: { day, staffId: teacher.id, substituteId, classId,
    periods, choices, dayRevision: reviewed.dayRevision, fingerprint: reviewed.fingerprint } } };
}

/**
 * "Maya mam is absent today, arrange her cover": the teacher is away for the
 * spoken part of the day, and each of their lessons gets the spoken substitute
 * or the timetable's best free teacher (the guided planner's own choice). The
 * card lists every lesson; nothing is saved until the speaker taps Save.
 */
async function teacherAbsence(session: string, spoken: VoiceExtraction, day: string, today: string): Promise<Resolution> {
  if (day < today) return clarify("cover");
  if (!timetableRuns(day, await attendanceCalendar(session))) return clarify("schedule");
  const cover = await readCoverDay(session, day);
  if (!cover.header || !cover.versionId) return clarify("schedule");
  const staff = coverStaff(cover);
  const teacher = voiceTeacher(staff, spoken.teacher, staffLabels);
  const named = spoken.substitute ? voiceTeacher(staff, spoken.substitute, staffLabels) : null;
  if (!teacher || (spoken.substitute && (!named || named.id === teacher.id))) return clarify("teacher");

  const asked = spoken.periods?.length ? absencePeriods("periods", spoken.periods.map(periodIndex))
    : spoken.period ? [periodIndex(spoken.period)] : spanPeriods(spoken.span ?? "whole");
  const periods = absencePeriods("periods", [...asked, ...cover.absences.find((row) => row.staffProfileId === teacher.id)?.periods ?? []]);
  let plan = await absencePlan(session, day, cover, teacher.id, periods, []);
  if (!plan) return clarify("cover");
  let choices: GuidedChoice[] = [];
  if (named) {
    const wanted = plan.lessons.filter((lesson) => asked.includes(lesson.period));
    if (!wanted.length || wanted.some((lesson) => !lesson.options.some((row) => row.id === named.id && row.conflict === null))) return clarify("cover");
    choices = wanted.map((lesson) => ({ needKey: lesson.needKey, coveringStaffId: named.id }));
    plan = await absencePlan(session, day, cover, teacher.id, periods, choices);
    if (!plan) return clarify("cover");
  }
  if (!plan.lessons.length) return clarify("no_lessons");
  const names = distinctNames(cover.staff);
  const span = spoken.periods?.length || spoken.period ? "periods" : spoken.span ?? "whole";
  return {
    result: { kind: "teacher_absence", teacher: names.get(teacher.id) ?? teacher.displayName, day, span, begun: plan.begun.length,
      lessons: plan.lessons.map((lesson) => ({
        period: periodNumber(lesson.period), classLabel: lesson.classLabels.join(", "), subject: lesson.subjectCode,
        substitute: lesson.status === "assigned" && lesson.coveringStaffId ? names.get(lesson.coveringStaffId) ?? "—" : null,
      })) },
    command: { kind: "teacher_absence", payload: { day, staffId: teacher.id, substituteId: named?.id, periods, choices,
      dayRevision: plan.dayRevision, fingerprint: plan.fingerprint } },
  };
}

/**
 * Names Bolo's listener should spell as the school does: this session's
 * teachers (for people who arrange cover) and class labels. Pupils' names are
 * never sent.
 */
export async function voiceVocabulary(staff: CurrentStaff, session: string, today: string) {
  const tools = await loadVoiceTools(staff, session);
  const classes = [...new Set((await classLabelMap(session)).values())].sort((a, b) => a.localeCompare(b, "en")).slice(0, 80);
  if (!tools.some(({ name }) => name === "teacher_absence" || name === "substitution" || name === "who_is_free")) return { classes };
  const cover = await readCoverDay(session, today).catch(() => null);
  const teachers = cover ? [...new Set(coverStaff(cover).flatMap((row) => [row.displayName, row.shortName ?? ""]).filter(Boolean))].slice(0, 120) : [];
  return { classes, teachers };
}

export async function resolveVoice(staff: CurrentStaff, session: string, spoken: VoiceExtraction, createdAt: string): Promise<Resolution> {
  if (!supportedSpeech(spoken) || !(await loadVoiceTools(staff, session)).some(({ name }) => name === spoken.intent)) return clarify("unsupported");
  const today = schoolToday(new Date(createdAt));
  const day = voiceDay(spoken.day, today);
  if (!day) return clarify("schedule");
  if (spoken.intent === "free_periods") return freePeriods(staff, session, spoken, day);
  if (spoken.intent === "who_is_free") return availableTeachers(session, spoken, day);
  if (spoken.intent === "teacher_absence") return teacherAbsence(session, spoken, day, today);
  const classLabel = spoken.classLabel ?? (spoken.intent === "attendance_mark" ? spokenAttendanceClass(spoken.transcript) : undefined);
  // A single-period cover may leave out the class: the teacher's one lesson then is the class.
  if (spoken.intent === "substitution" && !classLabel) return substitution(session, spoken, null, day, today);
  if (!classLabel && !asksForAbsentNames(spoken)) return clarify("target");
  const labels = await classLabelMap(session);
  const match = classLabel
    ? voiceMatch([...labels], voiceClassLabel(classLabel), ([, label]) => [voiceClassLabel(label)])
    : await soleHeldVoiceClass(staff, session, labels);
  if (!match) return clarify("target");
  const target = { id: match[0], label: match[1] };
  switch (spoken.intent) {
    case "attendance_query":
    case "attendance_mark": return attendance(staff, session, spoken, target, day, today);
    case "single_mark": return singleMark(staff, session, spoken, target);
    case "student_note": return studentNote(staff, session, spoken, target);
    case "substitution": return substitution(session, spoken, target, day, today);
    default: return clarify("unsupported");
  }
}

async function soleHeldVoiceClass(staff: CurrentStaff, session: string, labels: Map<string, string>): Promise<[string, string] | null> {
  const ids = await heldClassIds(staff.id, session);
  if (ids.length !== 1) return null;
  const label = labels.get(ids[0]);
  return label ? [ids[0], label] : null;
}
