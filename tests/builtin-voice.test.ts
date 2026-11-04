import { beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  session: vi.fn(), hold: vi.fn(), primary: vi.fn(), classScope: vi.fn(), register: vi.fn(), roll: vi.fn(), marks: vi.fn(),
  visible: vi.fn(), parse: vi.fn(), owned: vi.fn(), update: vi.fn(), attendance: vi.fn(), saveMarks: vi.fn(),
  cover: vi.fn(), guide: vi.fn(), arrange: vi.fn(), published: vi.fn(), slots: vi.fn(), bells: vi.fn(),
  duties: vi.fn(), absences: vi.fn(), leave: vi.fn(), policies: vi.fn(), kinds: vi.fn(), writeNote: vi.fn(), assignments: vi.fn(),
  exams: vi.fn(), papers: vi.fn(), photoContext: vi.fn(), photoRoster: vi.fn(), findMarks: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(app)/teach/actions", () => ({ saveAttendanceAction: scene.attendance }));
vi.mock("@/app/(app)/teach/marks/actions", () => ({ saveTeacherMarksAction: scene.saveMarks }));
vi.mock("@/modules/academics/data/academics-repo", () => ({
  resolveSessionLabel: scene.session,
  classLabelMap: async () => new Map([["class-1", "7B"], ["class-2", "7A"]]),
  listSubjects: async () => [{ id: "science", code: "SCI", nameEn: "Science", nameHi: "विज्ञान" }],
}));
vi.mock("@/modules/assessments/data/assessments-repo", () => ({ findMarksCommand: scene.findMarks }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({
  attendanceCalendar: async () => new Map(), classRoll: scene.roll, rosterOn: scene.roll, findRegister: scene.register, listMarks: scene.marks,
}));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({
  classScopeFor: scene.classScope, heldClassIds: scene.hold,
}));
vi.mock("@/modules/notes/data/notes-repo", () => ({ listNoteKinds: scene.kinds, writeNote: scene.writeNote }));
vi.mock("@/modules/substitutions/data/absences-repo", () => ({ absencesOn: scene.absences }));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({ readCoverDay: scene.cover, arrangeDay: scene.arrange }));
vi.mock("@/modules/substitutions/data/duty-repo", () => ({ myDutiesOn: scene.duties }));
vi.mock("@/modules/substitutions/data/guided", () => ({ approvedLeaveOn: scene.leave, buildGuidedPreview: scene.guide }));
vi.mock("@/modules/substitutions/data/policies-repo", () => ({ listCoverPolicies: scene.policies }));
vi.mock("@/modules/substitutions/data/school-rules-repo", () => ({ currentBells: scene.bells }));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({ getPublishedVersion: scene.published, listSlots: scene.slots }));
vi.mock("@/platform/auth/test-session-access", () => ({ assertSessionWritable: vi.fn(), filterVisibleStudentIds: scene.visible }));
vi.mock("@/vx/screens/exams/data", () => ({
  assignmentsFor: scene.assignments, listExams: scene.exams, papersOf: scene.papers, marksOf: async () => [],
  toCell: () => ({ state: "blank", value: null }),
}));
vi.mock("@/vx/screens/exams/guards", () => ({ classTeacherOf: scene.primary, previewRefusal: async () => null }));
vi.mock("@/lib/ai/marks-context", () => ({ marksPhotoContext: scene.photoContext, loadPhotoRoster: scene.photoRoster }));
vi.mock("@/lib/ai/jobs", () => ({ ownedAiJob: scene.owned, updateAiJob: scene.update }));
vi.mock("@/lib/ai/feature-jobs", () => ({
  makeAiUpload: vi.fn(), readOrParseAiJob: scene.parse,
  aiJson: (body: unknown, status = 200) => Response.json(body, { status }),
  aiProblem: (code: string, status: number) => Response.json({ ok: false, code }, { status }),
}));

import type { AiPilotConfig } from "@/lib/ai/config";
import { supportedSpeech, teacherInTranscript, voiceStudent, voiceTeacher, withSpokenDay } from "@/lib/ai/voice-intents";
import type { VoiceReview } from "@/lib/ai/voice-review";
import { voiceSpec, type VoiceExtraction } from "@/lib/ai/voice-schema";
import { runVoiceRoute } from "@/lib/ai/voice-service";
import type { CurrentStaff } from "@/platform/auth/current-staff";

const session = "TEST-2026-27";
const jobId = "00000000-0000-4000-8000-000000000001";
const person = { id: "staff-1", role: "teacher", isTestAccount: true, isTeaching: true } as CurrentStaff;
const config = {} as AiPilotConfig;
const roster = [
  { studentId: "id-1", fullName: "Sample One", rollNo: "1" },
  { studentId: "id-2", fullName: "Sample Two", rollNo: "2" },
];
const attendance: VoiceExtraction = {
  transcript: "7B में सभी बच्चे उपस्थित हैं, roll २ absent है।", intent: "attendance_mark", classLabel: "7B",
  allPresent: true, exceptions: [{ roll: "२", status: "absent" }], unclear: false,
};
type Job = { created_at: string; parsed_at: string; status: string; raw_output: VoiceExtraction; reviewed_data: unknown };
let job: Job;

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VPPSONE_ENV", "");
  vi.stubEnv("VPPSONE_BUILTIN_AI", "");
  vi.stubEnv("VPPSONE_BUILTIN_AI_TEST", "1");
  job = { created_at: "2026-11-04T03:00:00Z", parsed_at: new Date().toISOString(), status: "draft", raw_output: attendance, reviewed_data: null };
  scene.session.mockResolvedValue(session);
  scene.hold.mockResolvedValue(["class-1"]);
  scene.primary.mockResolvedValue(["class-1"]);
  scene.classScope.mockResolvedValue({ everyClass: false, classIds: ["class-1"] });
  scene.register.mockResolvedValue(null);
  scene.roll.mockResolvedValue(roster);
  scene.visible.mockImplementation(async (_staff, ids) => ids);
  scene.parse.mockImplementation(async () => ({ ok: true, value: job.raw_output, job }));
  scene.owned.mockImplementation(async () => job);
  scene.update.mockImplementation(async (_scope, changes) => ({ ...Object.assign(job, changes) }));
  scene.attendance.mockResolvedValue({ status: "saved" });
});

async function review(raw: VoiceExtraction, staff = person): Promise<VoiceReview> {
  job.raw_output = raw;
  const res = await runVoiceRoute(staff, config, "parse", { jobId });
  expect(res.status).toBe(200);
  return res.json();
}

describe("Bolo", () => {
  it("rejects IDs in provider output and ambiguous or conflicting spoken identifiers", () => {
    expect(voiceSpec.validate.safeParse({ ...attendance, classId: "some-id" }).success).toBe(false);
    const rows = [{ name: "One", roll: "1" }, { name: "Two", roll: "2" }];
    expect(voiceStudent(rows, { studentName: "one", roll: "२" }, (row) => row)).toBeNull();
    expect(voiceStudent([...rows, { name: "one", roll: "3" }], { studentName: "One" }, (row) => row)).toBeNull();
    expect(voiceStudent(rows, { studentName: "O" }, (row) => row)).toBeNull();
    expect(voiceStudent(rows, { roll: "०१" }, (row) => row)).toEqual(rows[0]);
  });

  it("shows a mixed-language transcript, restricts the provider to permitted actions and applies only after confirmation", async () => {
    const draft = await review(attendance);
    expect(draft.transcript).toBe(attendance.transcript);
    expect(draft.result).toMatchObject({ kind: "attendance_mark", tally: { present: 1, absent: 1 }, changes: [{ name: "Sample Two", status: "absent" }] });
    const scope = { staffId: person.id, action: "voice", session, targetId: person.id, revision: 0 };
    expect(scene.parse).toHaveBeenCalledWith(scope, config, jobId, expect.objectContaining({ task: "voice" }));
    const spec = scene.parse.mock.calls[0][3];
    expect(spec.context.actions.map(({ name }: { name: string }) => name)).not.toContain("substitution");
    expect(spec.responseSchema.properties.intent.enum).not.toContain("substitution");
    expect(JSON.stringify(spec.context)).not.toContain("Sample Two");
    expect(scene.attendance).not.toHaveBeenCalled();
    expect((await runVoiceRoute(person, config, "apply", { jobId })).status).toBe(400);
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation: draft.confirmation })).status).toBe(200);
    expect(JSON.parse(String(scene.attendance.mock.calls[0][1].get("payload")))).toEqual({
      commandId: jobId, classId: "class-1", day: "2026-11-04", kind: "save", expectedRevision: 0, reason: null,
      marks: [{ studentId: "id-1", status: "present" }, { studentId: "id-2", status: "absent" }],
    });
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation: draft.confirmation })).status).toBe(200);
    expect(scene.attendance).toHaveBeenCalledTimes(1);
  });

  it("blocks real-session jobs and any save after the reviewed roster changes", async () => {
    const draft = await review(attendance);
    scene.session.mockResolvedValueOnce("2026-27");
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation: draft.confirmation })).status).toBe(404);
    scene.roll.mockResolvedValue([...roster, { studentId: "id-3", fullName: "Sample Three", rollNo: "3" }]);
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation: draft.confirmation })).status).toBe(409);
    expect(scene.attendance).not.toHaveBeenCalled();
  });

  it("works in the real session for real staff once live, and never puts a test account there", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VPPSONE_BUILTIN_AI_TEST", "");
    vi.stubEnv("VPPSONE_BUILTIN_AI", "live");
    scene.session.mockResolvedValue("2026-27");
    expect((await runVoiceRoute(person, config, "parse", { jobId })).status).toBe(404);
    const teacher = { ...person, isTestAccount: false } as CurrentStaff;
    const draft = await review(attendance, teacher);
    expect(scene.parse).toHaveBeenCalledWith(expect.objectContaining({ session: "2026-27" }), config, jobId, expect.anything());
    expect(scene.roll).toHaveBeenCalledWith(expect.objectContaining({ sessionLabel: "2026-27" }));
    expect((await runVoiceRoute(teacher, config, "apply", { jobId, confirmation: draft.confirmation })).status).toBe(200);
    expect(scene.attendance).toHaveBeenCalledOnce();
  });

  it("recovers an explicit class omitted by extraction and verifies a repeated exception status", async () => {
    const spoken: VoiceExtraction = {
      transcript: "In class 7 B today, mark everyone present except roll number 2, who is absent.",
      intent: "attendance_mark", unclear: false, allPresent: true,
      exceptions: [{ roll: "2", status: "absent" }], attendanceStatus: "absent",
    };
    expect(await review(spoken)).toMatchObject({
      result: { kind: "attendance_mark", classLabel: "7B", tally: { present: 1, absent: 1 } },
      confirmation: expect.any(String),
    });
    expect(await review({ ...spoken, attendanceStatus: "late" })).toMatchObject({ confirmation: null, result: { kind: "clarify", reason: "register" } });
    expect(await review({ ...spoken, transcript: spoken.transcript.replace("class 7 B", "class 7 B or class 7 A") })).toMatchObject({
      confirmation: null, result: { kind: "clarify", reason: "target" },
    });
    expect(scene.attendance).not.toHaveBeenCalled();
  });

  it("uses the same command after an uncertain save and refuses a different confirmation", async () => {
    const { confirmation } = await review(attendance);
    scene.attendance.mockResolvedValueOnce({ status: "error" });
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation })).status).toBe(503);
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation: "a".repeat(64) })).status).toBe(409);
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation })).status).toBe(200);
    const payloads = scene.attendance.mock.calls.map((call) => call[1].get("payload"));
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toBe(payloads[1]);
  });

  it("answers only from the scoped saved register and keeps the transcript for an unsupported request", async () => {
    scene.register.mockResolvedValue({ id: "reg", revision: 2, status: "submitted" });
    scene.marks.mockResolvedValue(new Map([["id-1", { status: "present" }], ["id-2", { status: "absent" }]]));
    const query = { transcript: "7B roll 2 की हाज़िरी?", intent: "attendance_query", classLabel: "7B", roll: "2", unclear: false } as const;
    expect(await review(query)).toMatchObject({ confirmation: null, result: { kind: "attendance_answer", student: "Sample Two", status: "absent" } });
    expect(await review({ ...query, transcript: "7A roll 2 की हाज़िरी?", classLabel: "7A" })).toMatchObject({
      confirmation: null, result: { kind: "clarify", reason: "target" },
    });
    expect(await review({ transcript: "Send a fee reminder", intent: "unsupported", unclear: false })).toMatchObject({
      transcript: "Send a fee reminder", confirmation: null, result: { kind: "clarify", reason: "unsupported" },
    });
    expect(scene.attendance).not.toHaveBeenCalled();
  });

  it("names only pupils marked absent and requires an exact or sole held class", async () => {
    scene.register.mockResolvedValue({ id: "reg", revision: 2, status: "submitted" });
    scene.marks.mockResolvedValue(new Map([["id-1", { status: "leave" }], ["id-2", { status: "absent" }], ["out-of-roster", { status: "absent" }]]));
    const raw = { transcript: "आज कौन absent है?", intent: "attendance_query", attendanceStatus: "absent", unclear: false } as const;
    expect(await review(raw)).toMatchObject({ confirmation: null, result: { kind: "attendance_answer", classLabel: "7B",
      absent: [{ name: "Sample Two", roll: "2" }] } });
    expect(await review({ ...raw, classLabel: "7B", transcript: "How many are absent in 7B?" })).toMatchObject({
      result: { kind: "attendance_answer", absent: null, tally: { absent: 1 } },
    });
    scene.hold.mockResolvedValue(["class-1", "class-2"]);
    expect(await review(raw)).toMatchObject({ result: { kind: "clarify", reason: "target" } });
    expect(await review({ ...raw, classLabel: "7A", transcript: "Who is absent in 7A?" })).toMatchObject({ result: { kind: "clarify", reason: "target" } });
    expect(scene.attendance).not.toHaveBeenCalled();
  });

  it("excludes scheduled, cover and approved leave periods from a personal free-period answer", async () => {
    scene.published.mockResolvedValue({ id: "published" });
    scene.slots.mockResolvedValue([{ day: "Wednesday", staffProfileId: person.id, period: 0 }]);
    scene.bells.mockResolvedValue({ periods: [0, 1, 2, 3].map((index) => ({ index })) });
    scene.duties.mockResolvedValue([{ period: 1 }]);
    scene.leave.mockResolvedValue({ [person.id]: [2] });
    scene.absences.mockResolvedValue([]);
    expect(await review({ transcript: "मेरे free periods कौन से हैं?", intent: "free_periods", unclear: false })).toMatchObject({
      confirmation: null, result: { kind: "period_answer", periods: [4] },
    });
  });

  it("answers who is free only for cover coordinators, from eligible TEST timetable teachers", async () => {
    const coordinator = { ...person, role: "academic_coordinator" } as const;
    const ids = ["Free", "Teaching", "Cover", "Away", "Leave", "Off shift", "Outside test"];
    scene.cover.mockResolvedValue({
      versionId: "test-published", header: "Wednesday", bells: { periods: [{ index: 2 }] },
      staff: ids.map((id) => ({ id, displayName: id, shortName: id, isTeaching: true })),
      slots: ids.slice(0, -1).map((staffProfileId) => ({ day: "Wednesday", period: staffProfileId === "Teaching" ? 2 : 4, staffProfileId })),
      live: [{ period: 2, status: "assigned", coveringStaffId: "Cover" }], absenceIndex: { Away: [2] },
    });
    scene.policies.mockResolvedValue([{ staffProfileId: "Off shift", allowedPeriods: [1, 3] }]);
    scene.leave.mockResolvedValue({ Leave: [2] });
    const raw = { transcript: "Period 3 में कौन free है?", intent: "who_is_free", period: 3, unclear: false } as const;
    expect(await review(raw)).toMatchObject({ result: { kind: "clarify", reason: "unsupported" } });
    expect(scene.cover).not.toHaveBeenCalled();
    expect(await review(raw, coordinator)).toMatchObject({ confirmation: null, result: { kind: "available_teachers", period: 3, teachers: ["Free"] } });
    expect(scene.cover).toHaveBeenCalledWith(session, "2026-11-04");
    expect(scene.arrange).not.toHaveBeenCalled();
  });

  it("resolves one assigned paper and commits one student mark as a draft", async () => {
    scene.assignments.mockResolvedValue([{ classId: "class-1", subjectId: "science" }]);
    scene.exams.mockResolvedValue([{ id: "exam", status: "open", labelEn: "Term 1", labelHi: "सत्र 1", code: "TERM1" }]);
    scene.papers.mockResolvedValue([{ id: "paper", class_id: "class-1", subject_id: "science" }]);
    scene.photoContext.mockResolvedValue({ paper: { id: "paper", entry_revision: 7 }, rule: { max: 40, step: 0.5 }, session });
    scene.photoRoster.mockResolvedValue({ students: [{ id: "id-2", name: "Sample Two", roll: "2" }] });
    scene.findMarks.mockResolvedValue(null);
    scene.saveMarks.mockResolvedValue({ ok: true });
    const { confirmation } = await review({ transcript: "7B विज्ञान Term 1 roll 2 को 24.5", intent: "single_mark", unclear: false,
      classLabel: "7B", exam: "Term 1", subject: "विज्ञान", roll: "2", mark: "24.5" });
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation })).status).toBe(200);
    expect(scene.saveMarks).toHaveBeenCalledWith({ commandId: jobId, paperId: "paper", kind: "draft", expectedRevision: 7, reason: null,
      entries: [{ studentId: "id-2", state: "value", value: 24.5 }] });
  });

  it("keeps a student note verbatim and rechecks the class-teacher role", async () => {
    scene.kinds.mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000002", isActive: true, code: "other", labelEn: "Other", labelHi: "अन्य" }]);
    const raw = { transcript: "7B roll 2 के लिए note: अच्छी प्रगति।", intent: "student_note", unclear: false,
      classLabel: "7B", roll: "2", note: "अच्छी प्रगति।" } as const;
    const { confirmation } = await review(raw);
    expect(confirmation).toBeTruthy();
    scene.primary.mockResolvedValue([]);
    expect((await runVoiceRoute(person, config, "apply", { jobId, confirmation })).status).toBe(409);
    expect(scene.writeNote).not.toHaveBeenCalled();
  });

  it("lets a coordinator confirm a checked substitution through the native cover command", async () => {
    const coordinator = { ...person, role: "academic_coordinator" } as const;
    const slot = { day: "Wednesday", period: 2, classId: "class-1", staffProfileId: "absent-id" };
    scene.cover.mockResolvedValue({ header: "Wednesday", dayRevision: 4, openPeriods: new Set([2]), absences: [], live: [],
      slots: [slot, { ...slot, period: 4, staffProfileId: "cover-id" }],
      staff: [{ id: "absent-id", displayName: "Sample Teacher", shortName: "ST", isTeaching: true },
        { id: "cover-id", displayName: "Cover Teacher", shortName: "CT", isTeaching: true }],
    });
    const lesson = { needKey: "need", period: 2, classLabels: ["7B"], subjectCode: "SCI", options: [{ id: "cover-id", conflict: null }] };
    scene.guide.mockImplementation(async ({ choices }) => ({ ok: true, preview: { dayRevision: 4, fingerprint: "plan", others: [], refused: [],
      lessons: [{ ...lesson, coveringStaffId: choices[0]?.coveringStaffId ?? null }],
    } }));
    scene.leave.mockResolvedValue({});
    scene.arrange.mockResolvedValue({ ok: true });
    const raw = { transcript: "7B period 3 में ST की जगह CT", intent: "substitution", unclear: false, classLabel: "7B", period: 3,
      teacher: "ST", substitute: "CT" } as const;
    expect(await review(raw)).toMatchObject({ result: { kind: "clarify", reason: "unsupported" } });
    const { confirmation, result } = await review(raw, coordinator);
    expect(result).toMatchObject({ kind: "substitution", teacher: "Sample Teacher", substitute: "Cover Teacher" });
    expect(scene.arrange).not.toHaveBeenCalled();
    expect((await runVoiceRoute(coordinator, config, "apply", { jobId, confirmation })).status).toBe(200);
    expect(scene.arrange).toHaveBeenCalledWith({ actorStaffId: person.id, sessionLabel: session, commandId: jobId,
      day: "2026-11-04", expectedDayRevision: 4, expectedPlan: "plan", onLeave: {},
      intent: { kind: "absence", staffProfileId: "absent-id", periods: [2], choices: [{ needKey: "need", coveringStaffId: "cover-id" }] },
    });
  });

  it("matches a teacher the way staff say the name, and refuses a name that fits two people", () => {
    const staff = [{ name: "Test teacher Maya", short: "T-Maya" }, { name: "Verma", short: "VR" }, { name: "Maya", short: "MY" }, { name: "Maya Sharma", short: "MS" }];
    const labels = (row: (typeof staff)[number]) => [row.name, row.short];
    expect(voiceTeacher(staff, "Maya test mam", labels)?.name).toBe("Test teacher Maya");
    expect(voiceTeacher(staff, "Maya mam", labels)?.name).toBe("Maya");
    expect(voiceTeacher(staff, "Verma ji", labels)?.name).toBe("Verma");
    expect(voiceTeacher(staff, "Sharma ma'am", labels)?.name).toBe("Maya Sharma");
    expect(voiceTeacher(staff, "VR sir", labels)?.name).toBe("Verma");
    expect(voiceTeacher(staff, "mam", labels)).toBeNull();
    expect(voiceTeacher(staff, "Meena madam", labels)).toBeNull();
    expect(voiceTeacher([{ name: "Asha Rao", short: "AR" }, { name: "Asha Jain", short: "AJ" }], "Asha mam", (row) => [row.name, row.short])).toBeNull();
  });

  it("reads a left-out teacher or day from the transcript only when it is beyond doubt", () => {
    const staff = [{ name: "Test teacher Maya", short: "T-Maya" }, { name: "Verma", short: "VR" }, { name: "Asha Rao", short: "AR" }];
    const labels = (row: (typeof staff)[number]) => [row.name, row.short];
    expect(teacherInTranscript(staff, "Maya test madam will be absent tomorrow", labels)?.name).toBe("Test teacher Maya");
    expect(teacherInTranscript(staff, "Maya test madam absent, Verma will take", labels)).toBeNull();
    expect(teacherInTranscript(staff, "Maya test madam absent, Verma will take", labels, staff[1])?.name).toBe("Test teacher Maya");
    expect(teacherInTranscript(staff, "Asha mam is absent", labels)).toBeNull();
    expect(teacherInTranscript(staff, "VR and AR are busy", labels)).toBeNull();
    const base = { intent: "teacher_absence", unclear: false } as const;
    expect(withSpokenDay({ ...base, transcript: "Maya will be absent tomorrow" }).day).toBe("tomorrow");
    expect(withSpokenDay({ ...base, transcript: "Aaj Maya mam absent hai" }).day).toBe("today");
    expect(withSpokenDay({ ...base, transcript: "Maya mam kal absent rahengi" }).day).toBeUndefined();
    expect(withSpokenDay({ ...base, transcript: "absent today and tomorrow" }).day).toBeUndefined();
    expect(withSpokenDay({ ...base, transcript: "absent tomorrow", day: "2026-11-09" }).day).toBe("2026-11-09");
  });

  it("accepts a spoken \"aaj\" as today and still rejects values the speaker did not say", () => {
    const base = { intent: "teacher_absence", unclear: false, teacher: "Maya mam" } as const;
    expect(supportedSpeech({ ...base, transcript: "Aaj Maya mam absent hai, substitute laga do", day: "today" })).toBe(true);
    expect(supportedSpeech({ ...base, transcript: "Maya mam absent hai", day: "aaj" })).toBe(true);
    expect(supportedSpeech({ ...base, transcript: "Mr. Sharma is absent today", teacher: "Maya mam" })).toBe(false);
    expect(supportedSpeech({ ...base, transcript: "Maya mam kal chhutti par rahengi", day: "tomorrow" })).toBe(true);
    expect(supportedSpeech({ ...base, transcript: "Maya mam absent rahengi", day: "tomorrow" })).toBe(false);
    expect(supportedSpeech({ ...base, transcript: "Maya mam kal absent rahengi" })).toBe(false);
  });

  describe("teacher absence by voice", () => {
    const coordinator = { ...person, role: "academic_coordinator" } as CurrentStaff;
    const slot = (period: number, classId: string, classLabel: string, staffProfileId = "maya") => ({ day: "Wednesday", period, classId, classLabel, staffProfileId });
    beforeEach(() => {
      scene.cover.mockResolvedValue({ header: "Wednesday", versionId: "tt", dayRevision: 6, openPeriods: new Set([1, 2, 3, 4, 5, 6, 7]), absences: [], live: [],
        slots: [slot(2, "c7", "7B"), slot(5, "c8", "8A"), slot(0, "c9", "9A", "verma")],
        staff: [{ id: "maya", displayName: "Test teacher Maya", shortName: "T-Maya", isTeaching: true },
          { id: "verma", displayName: "Verma", shortName: "VR", isTeaching: true }],
      });
      const lessons = [
        { needKey: "n1", period: 2, classLabels: ["7B"], subjectCode: "SCI", engine: "verma" },
        { needKey: "n2", period: 5, classLabels: ["8A"], subjectCode: "MAT", engine: null },
      ];
      scene.guide.mockImplementation(async ({ periods, choices }: { periods: number[]; choices: { needKey: string; coveringStaffId: string }[] }) => ({
        ok: true, preview: { dayRevision: 6, fingerprint: `plan-${periods.join("")}-${choices.length}`, others: [], refused: [], begun: [],
          lessons: lessons.filter((lesson) => periods.includes(lesson.period)).map(({ engine, ...lesson }) => {
            const covering = choices.find((choice) => choice.needKey === lesson.needKey)?.coveringStaffId ?? engine;
            return { ...lesson, status: covering ? "assigned" : "needs_help", coveringStaffId: covering, options: [{ id: "verma", conflict: null }] };
          }) } }));
      scene.leave.mockResolvedValue({});
      scene.arrange.mockResolvedValue({ ok: true });
    });

    it("plans the whole day from \"Maya test mam is absent today, unka substitute laga do\" and saves it on Save", async () => {
      const raw = { transcript: "Maya test mam is absent today, unka substitute laga do", intent: "teacher_absence", unclear: false,
        teacher: "Maya test mam", day: "today" } as const;
      const { confirmation, result } = await review(raw, coordinator);
      expect(result).toEqual({ kind: "teacher_absence", teacher: "Test teacher Maya", day: "2026-11-04", span: "whole", begun: 0, lessons: [
        { period: 3, classLabel: "7B", subject: "SCI", substitute: "Verma" },
        { period: 6, classLabel: "8A", subject: "MAT", substitute: null },
      ] });
      expect(confirmation).toMatch(/^[a-f\d]{64}$/u);
      expect(scene.arrange).not.toHaveBeenCalled();
      expect((await runVoiceRoute(coordinator, config, "apply", { jobId, confirmation })).status).toBe(200);
      expect(scene.arrange).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-11-04", expectedDayRevision: 6, expectedPlan: "plan-01234567-0",
        intent: { kind: "absence", staffProfileId: "maya", periods: [0, 1, 2, 3, 4, 5, 6, 7], choices: [] } }));
    });

    it("recovers the teacher and the day a model left out (production, 4 Nov)", async () => {
      // What Gemini returned for the clip: the intent, but no teacher and no day.
      const raw: VoiceExtraction = { transcript: "Maya test madam will be absent tomorrow. Please arrange her substitute.", intent: "teacher_absence",
        unclear: false, span: "whole", attendanceStatus: "absent", exceptions: [] };
      expect((await review(raw, coordinator)).result).toMatchObject({ kind: "teacher_absence", teacher: "Test teacher Maya", day: "2026-11-05", span: "whole" });
      const two = { ...raw, transcript: "Maya test madam and Verma will be absent tomorrow" };
      expect((await review(two, coordinator)).result).toEqual({ kind: "clarify", reason: "teacher" });
    });

    it("plans tomorrow from a future-tense \"kal\"", async () => {
      const raw = { transcript: "Maya mam kal chhutti par rahengi, unka arrangement kar do", intent: "teacher_absence", unclear: false,
        teacher: "Maya mam", day: "tomorrow" } as const;
      expect((await review(raw, coordinator)).result).toMatchObject({ kind: "teacher_absence", day: "2026-11-05", teacher: "Test teacher Maya" });
      expect(scene.cover).toHaveBeenLastCalledWith(session, "2026-11-05");
    });

    it("uses a named substitute for a spoken half day", async () => {
      const raw = { transcript: "Aaj Maya mam lunch ke baad chhutti par hain, Verma ji unke periods le lenge", intent: "teacher_absence", unclear: false,
        teacher: "Maya mam", substitute: "Verma ji", span: "second_half", day: "today" } as const;
      const { result } = await review(raw, coordinator);
      expect(result).toMatchObject({ kind: "teacher_absence", span: "second_half", lessons: [{ period: 6, classLabel: "8A", substitute: "Verma" }] });
      expect(scene.guide).toHaveBeenLastCalledWith(expect.objectContaining({ periods: [4, 5, 6, 7], choices: [{ needKey: "n2", coveringStaffId: "verma" }] }));
    });

    it("covers one spoken period without a spoken class or substitute, and says so when the name matches nobody", async () => {
      const single = { transcript: "Period 3 mein Maya mam ki jagah kisi ko laga do", intent: "substitution", unclear: false, period: 3, teacher: "Maya mam" } as const;
      expect((await review(single, coordinator)).result).toMatchObject({ kind: "substitution", classLabel: "7B", period: 3, teacher: "Test teacher Maya", substitute: "Verma" });
      const unknown = { transcript: "Meena mam absent hai, substitute laga do", intent: "teacher_absence", unclear: false, teacher: "Meena mam" } as const;
      expect((await review(unknown, coordinator)).result).toEqual({ kind: "clarify", reason: "teacher" });
      expect((await review({ ...unknown, intent: "teacher_absence" }, person)).result).toEqual({ kind: "clarify", reason: "unsupported" });
    });
  });
});
