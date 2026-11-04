// The guided cover flow's server actions, as synthetic stubs for the phone
// fixture (review C01). Nothing is saved and nothing is sent: every call is
// recorded on `window.qaGuided` for the spec to read.
//
//   ?confirm=stale   the first Confirm is refused as stale (somebody else saved)
//   ?confirm=lost    the first Confirm's answer never arrives and the check
//                    finds nothing; Try again then lands

type Choice = { needKey: string; coveringStaffId: string | null };
type Recorded = { previews: { periods: number[]; choices: Choice[] }[]; confirms: { commandId: string; fingerprint: string; dayRevision: number }[]; checks: string[] };

const T = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
export const QA_ABSENT = T(1);
const TEACHERS: Record<string, string> = { [T(11)]: "Test Teacher Meera", [T(12)]: "Test Teacher Navin", [T(13)]: "Test Teacher Kavita", [T(14)]: "Test Teacher Rohan" };
const LESSONS = [
  { needKey: "qa-L1", period: 0, classLabels: ["Class 6"], subjectCode: "MATHS" },
  { needKey: "qa-L3", period: 2, classLabels: ["Class 7"], subjectCode: "MATHS" },
  { needKey: "qa-L6", period: 5, classLabels: ["Class 9 Science", "Class 9 Arts"], subjectCode: "MATHS" },
];

function recorded(): Recorded {
  const w = window as unknown as { qaGuided?: Recorded };
  w.qaGuided ??= { previews: [], confirms: [], checks: [] };
  return w.qaGuided;
}

let revision = 4;
const mode = () => new URLSearchParams(location.search).get("confirm");

export async function previewGuidedCoverAction(input: { day: string; staffProfileId: string; periods: number[]; choices?: Choice[] }) {
  const choices = input.choices ?? [];
  recorded().previews.push({ periods: input.periods, choices });
  const lessons = LESSONS.filter((lesson) => input.periods.includes(lesson.period)).map((lesson, i) => {
    const chosen = choices.find((choice) => choice.needKey === lesson.needKey);
    const proposedId = i === 2 ? null : T(11 + i);
    const holder = chosen ? chosen.coveringStaffId : proposedId;
    return {
      ...lesson,
      automatic: true,
      status: holder ? ("assigned" as const) : ("needs_help" as const),
      coveringStaffId: holder,
      reason: holder ? null : chosen ? "released" : "no_candidate",
      chosen: Boolean(chosen),
      options: Object.entries(TEACHERS).map(([id, name], j) => ({
        id,
        name,
        tier: j === 0 ? ("class_subject" as const) : ("general" as const),
        warnings: j === 0 ? [] : ["subject_mismatch" as const],
        conflict: j === 3 ? ("teaching" as const) : null,
        autoEligible: j === 0,
        workload: { today: j === 1 ? 1 : 0, week: j + 1 },
        proposed: id === holder,
      })),
    };
  });
  const messages = new Map<string, { staffId: string; name: string; hasPhone: boolean; lessons: { period: number; classLabels: string[]; subjectCode: string; kind: "assigned" }[] }>();
  for (const lesson of lessons) {
    if (!lesson.coveringStaffId) continue;
    const entry = messages.get(lesson.coveringStaffId) ?? { staffId: lesson.coveringStaffId, name: TEACHERS[lesson.coveringStaffId], hasPhone: lesson.coveringStaffId !== T(12), lessons: [] };
    entry.lessons.push({ period: lesson.period, classLabels: lesson.classLabels, subjectCode: lesson.subjectCode, kind: "assigned" });
    messages.set(lesson.coveringStaffId, entry);
  }
  const assigned = lessons.filter((lesson) => lesson.status === "assigned").length;
  return {
    ok: true as const,
    preview: {
      day: input.day,
      dayRevision: revision,
      fingerprint: `${lessons.length}-r${revision}${choices.map((choice) => choice.coveringStaffId?.slice(-2) ?? "x").join("")}`,
      staffProfileId: input.staffProfileId,
      periods: input.periods,
      choices,
      lessons,
      begun: [],
      others: [],
      refused: [],
      tally: { assigned, needsHelp: lessons.length - assigned, total: lessons.length },
      messages: [...messages.values()],
      withdrawn: [],
    },
  };
}

const receipt = (commandId: string, replayed: boolean) => ({
  commandId, dayRevision: revision + 1, assigned: 2, needsHelp: 1, added: 3, changed: 0, cancelled: 0, unchanged: 0, pinned: 0,
  skippedStarted: 0, noticesQueued: 2, noticesWithdrawn: 0, noticeRecipients: 2, recipientsWithoutPhone: 1, replayed,
});
const committed = [
  { period: 0, classLabels: ["Class 6"], subjectCode: "MATHS", status: "assigned" as const, coveringName: "Test Teacher Meera" },
  { period: 2, classLabels: ["Class 7"], subjectCode: "MATHS", status: "assigned" as const, coveringName: "Test Teacher Navin" },
  { period: 5, classLabels: ["Class 9 Science", "Class 9 Arts"], subjectCode: "MATHS", status: "needs_help" as const, coveringName: null },
];

export async function confirmGuidedCoverAction(input: { commandId: string; fingerprint: string; dayRevision: number }) {
  const log = recorded();
  log.confirms.push({ commandId: input.commandId, fingerprint: input.fingerprint, dayRevision: input.dayRevision });
  if (log.confirms.length === 1 && mode() === "stale") {
    revision += 1; // Somebody else saved this day.
    return { status: "stale" as const };
  }
  if (log.confirms.length === 1 && mode() === "lost") throw new TypeError("Synthetic lost response");
  return { status: "saved" as const, receipt: receipt(input.commandId, false), committed };
}

export async function checkGuidedCoverAction(input: { commandId: string }) {
  recorded().checks.push(input.commandId);
  return { status: "not_found" as const };
}
