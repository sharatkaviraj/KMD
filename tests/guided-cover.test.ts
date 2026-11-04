import { describe, expect, it } from "vitest";

import { arrangeCover, type DesiredDuty } from "@/modules/substitutions/domain/arrange";
import { buildTeacherProfiles, rankCandidates } from "@/modules/substitutions/domain/engine";
import { coverNeedsFor, teachingEventsFor } from "@/modules/substitutions/domain/events";
import {
  absencePeriods,
  affectedDuties,
  begunLessonPeriods,
  choicesFor,
  conflictOf,
  isWholeDay,
  messagesByPerson,
  normalizeChoices,
  noticePlan,
  optionsFor,
  otherChanges,
  planFingerprint,
  reviewTally,
  withChoice,
  workloadFor,
  type DutyLike,
} from "@/modules/substitutions/domain/guided";
import { canConfirm, commandIdFor, guidedSave, initialSave, isBusy, type SaveState } from "@/modules/substitutions/domain/guided-flow";
import { teacherDetailsFrom, type PlanSlot } from "@/modules/substitutions/domain/plan";

/*
 * Review C01: the guided cover flow's rules, on synthetic days. Teachers are
 * letters, classes "Class N"; nothing here is the school's roster.
 */

const ALL = new Set([0, 1, 2, 3, 4, 5, 6, 7]);

function slot(over: Partial<PlanSlot>): PlanSlot {
  return { day: "Monday", period: 0, classId: "c6", classLabel: "Class 6", subjectCode: "MATHS", staffProfileId: "A", teacherShortName: "A", parallel: false, shared: false, ...over };
}

function plan(slots: PlanSlot[], absences: Record<string, number[]>, extra: Partial<Parameters<typeof arrangeCover>[0]> = {}) {
  const { events } = teachingEventsFor(slots, "Monday");
  const needs = coverNeedsFor(events, absences);
  const staff = [...new Set(slots.map((entry) => entry.staffProfileId))];
  const teacherProfiles = buildTeacherProfiles({ teacherDetails: teacherDetailsFrom(slots, ["Monday"]), roster: staff });
  return { needs, teacherProfiles, result: arrangeCover({ needs, openPeriods: ALL, live: [], day: "Monday", teacherProfiles, absenceIndex: absences, ...extra }) };
}

function duty(over: Partial<DesiredDuty>): DesiredDuty {
  return {
    need_key: "k", period: 0, event_kind: "ordinary", class_ids: ["c6"], class_labels: ["Class 6"], subject_code: "MATHS",
    absent_staff_ids: ["A"], status: "assigned", covering_staff_id: "M", suggested_staff_id: null, reason: null,
    source: "auto", pinned: false, match_tier: "exact", warnings: [], ...over,
  };
}

// A teaches Class 6 in P1, P3 and P5 (indexes 0, 2, 4); M and N teach maths elsewhere and are free then.
const DAY = [
  slot({ period: 0 }),
  slot({ period: 2 }),
  slot({ period: 4 }),
  slot({ period: 1, classId: "c7", classLabel: "Class 7", staffProfileId: "M" }),
  slot({ period: 3, classId: "c8", classLabel: "Class 8", staffProfileId: "N" }),
];

describe("which periods an absence covers", () => {
  it("is every period for a whole day, and exactly the picked ones otherwise", () => {
    expect(absencePeriods("whole", [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(absencePeriods("periods", [4, 2, 2, 9, -1, 1.5])).toEqual([2, 4]);
    expect(absencePeriods("periods", [])).toEqual([]);
    expect(isWholeDay([7, 6, 5, 4, 3, 2, 1, 0])).toBe(true);
    expect(isWholeDay([0, 1, 2, 3])).toBe(false);
  });

  it("a partial-day absence leaves only the lessons in the chosen periods", () => {
    const { result } = plan(DAY, { A: [0, 1] });
    expect(result.duties.map((entry) => entry.period)).toEqual([0]);
    expect(affectedDuties(result.duties, "A", [0, 1]).map((entry) => entry.period)).toEqual([0]);

    const whole = plan(DAY, { A: [0, 1, 2, 3, 4, 5, 6, 7] }).result;
    expect(affectedDuties(whole.duties, "A", [0, 1, 2, 3, 4, 5, 6, 7]).map((entry) => entry.period)).toEqual([0, 2, 4]);
    // Asked for periods 2–3 of a whole-day plan, only those are this absence's to show.
    expect(affectedDuties(whole.duties, "A", [2, 3]).map((entry) => entry.period)).toEqual([2]);
    expect(affectedDuties(whole.duties, "B", [0, 2, 4])).toEqual([]);
  });

  it("names the chosen lessons whose period has begun", () => {
    expect(begunLessonPeriods([0, 2, 4], [0, 1, 2], new Set([2, 3, 4, 5, 6, 7]))).toEqual([0]);
    expect(begunLessonPeriods([0, 2, 4], [4], new Set([2, 3, 4]))).toEqual([]);
  });
});

describe("the coordinator's choices", () => {
  it("normalises to one per lesson, last wins, sorted; refuses anything malformed whole", () => {
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    expect(normalizeChoices([{ needKey: "z", coveringStaffId: a }, { needKey: "y", coveringStaffId: null }, { needKey: "z", coveringStaffId: b }])).toEqual([
      { needKey: "y", coveringStaffId: null },
      { needKey: "z", coveringStaffId: b },
    ]);
    expect(normalizeChoices(undefined)).toEqual([]);
    expect(normalizeChoices([{ needKey: "z", coveringStaffId: "not-an-id" }])).toBeNull();
    expect(normalizeChoices([{ needKey: "", coveringStaffId: null }])).toBeNull();
    expect(normalizeChoices("z")).toBeNull();
    expect(choicesFor([{ needKey: "y", coveringStaffId: null }, { needKey: "q", coveringStaffId: null }], new Set(["y"]))).toEqual([{ needKey: "y", coveringStaffId: null }]);
    expect(withChoice([{ needKey: "y", coveringStaffId: a }], "y", undefined)).toEqual([]);
    expect(withChoice([], "y", null)).toEqual([{ needKey: "y", coveringStaffId: null }]);
  });

  it("applies several choices at once, each judged against the ones before it", () => {
    // A and B are both away in P1; both choices name M for P1: the second is refused.
    const slots = [...DAY, slot({ period: 0, classId: "c9", classLabel: "Class 9", staffProfileId: "B" })];
    const { needs, result: base } = plan(slots, { A: [0], B: [0] });
    const [first, second] = needs.map((need) => need.key);
    const { result } = plan(slots, { A: [0], B: [0] }, {
      overrides: [{ needKey: first, coveringStaffId: "M" }, { needKey: second, coveringStaffId: "M" }],
    });
    expect(base.refusedOverrides).toEqual([]);
    expect(result.duties.find((entry) => entry.need_key === first)).toMatchObject({ covering_staff_id: "M", source: "manual", pinned: true });
    expect(result.refusedOverrides).toEqual([{ needKey: second, blocked: ["double_booked"] }]);
    expect(result.refusedOverride).toEqual(result.refusedOverrides[0]);
  });

  it("\"nobody yet\" leaves the lesson needing a person, released by hand", () => {
    const { needs } = plan(DAY, { A: [0] });
    const { result } = plan(DAY, { A: [0] }, { overrides: [{ needKey: needs[0].key, coveringStaffId: null }] });
    expect(result.duties[0]).toMatchObject({ status: "needs_help", reason: "released", covering_staff_id: null });
  });
});

describe("who can take a period", () => {
  it("names the conflict plainly, leave first", () => {
    expect(conflictOf([], false)).toBeNull();
    expect(conflictOf(["regular_class"], false)).toBe("teaching");
    expect(conflictOf(["double_booked"], false)).toBe("covering");
    expect(conflictOf(["absent", "regular_class"], false)).toBe("away");
    expect(conflictOf(["absent"], true)).toBe("on_leave");
    expect(conflictOf([], true)).toBe("on_leave");
    expect(conflictOf(["unavailable"], false)).toBe("unavailable");
  });

  it("lists the free first in engine order, then everyone who cannot, and never offers office staff or the absent teacher", () => {
    const slots = [...DAY, slot({ period: 0, classId: "c7", classLabel: "Class 7", staffProfileId: "N" })];
    const { teacherProfiles } = plan(slots, { A: [0] });
    const ranked = rankCandidates({
      day: "Monday",
      teacherProfiles: { ...teacherProfiles, OFFICE: { ...teacherProfiles.M, teacher: "OFFICE" } },
      absenceIndex: { A: [0] },
      vacancy: { slotId: "v", periodIndex: 0, className: "Class 6", subject: "MATHS" },
    });
    const options = optionsFor(ranked, {
      eligible: new Set(["A", "M", "N"]),
      onLeave: new Set(),
      workload: () => ({ today: 0, week: 0 }),
      proposedId: "M",
      absentId: "A",
    });
    expect(options.map((option) => [option.id, option.conflict, option.proposed])).toEqual([
      ["M", null, true],
      ["N", "teaching", false],
    ]);

    const onLeave = optionsFor(ranked, { eligible: new Set(["M", "N"]), onLeave: new Set(["M"]), workload: () => ({ today: 0, week: 0 }), proposedId: null, absentId: "A" });
    expect(onLeave.find((option) => option.id === "M")).toMatchObject({ conflict: "on_leave", autoEligible: false });
  });

  it("counts covers today without the lesson being decided, and over the week with the day as planned", () => {
    const duties = [duty({ need_key: "x", covering_staff_id: "M" }), duty({ need_key: "y", covering_staff_id: "M" }), duty({ need_key: "z", covering_staff_id: "N", status: "needs_help" })];
    const load = { duties, weekAssigned: { M: 5, N: 1 }, dayAssigned: { M: 1 } };
    expect(workloadFor(load, "M", "x")).toEqual({ today: 1, week: 5 });
    expect(workloadFor(load, "M")).toEqual({ today: 2, week: 6 });
    expect(workloadFor(load, "N")).toEqual({ today: 0, week: 1 });
    expect(workloadFor(load, "Q")).toEqual({ today: 0, week: 0 });
  });
});

describe("the review hides nothing", () => {
  const live = (over: Partial<DutyLike>): DutyLike => ({ needKey: "k", period: 1, status: "assigned", coveringStaffId: "M", classLabels: ["Class 7"], subjectCode: "SCI", reason: null, absentStaffIds: ["B"], ...over });

  it("lists every other duty the change moves, and leaves begun periods alone", () => {
    const changes = otherChanges(
      [live({ needKey: "moved" }), live({ needKey: "released" }), live({ needKey: "gone" }), live({ needKey: "same" }), live({ needKey: "begun", period: 0 }), live({ needKey: "mine" })],
      [
        duty({ need_key: "moved", period: 1, covering_staff_id: "N" }),
        duty({ need_key: "released", period: 1, status: "needs_help", covering_staff_id: null }),
        duty({ need_key: "same", period: 1, covering_staff_id: "M" }),
        duty({ need_key: "mine", period: 1, covering_staff_id: "Q" }),
        duty({ need_key: "fresh", period: 3, covering_staff_id: "N" }),
      ],
      new Set(["mine"]),
      new Set([1, 2, 3]),
    );
    expect(changes.map((change) => [change.needKey, change.kind, change.from, change.to])).toEqual([
      ["gone", "cancelled", "M", null],
      ["moved", "moved", "M", "N"],
      ["released", "released", "M", null],
      ["fresh", "assigned", null, "N"],
    ]);
  });

  it("says who will be messaged on WhatsApp before Confirm — the database's own rule", () => {
    const notices = noticePlan(
      [live({ needKey: "kept" }), live({ needKey: "swapped" }), live({ needKey: "dropped" }), live({ needKey: "facts", absentStaffIds: ["B"] }), live({ needKey: "begun", period: 0 }), live({ needKey: "waiting", status: "needs_help", coveringStaffId: null })],
      [
        duty({ need_key: "kept", period: 1, covering_staff_id: "M", absent_staff_ids: ["B"] }),
        duty({ need_key: "swapped", period: 1, covering_staff_id: "N", absent_staff_ids: ["B"] }),
        duty({ need_key: "facts", period: 1, covering_staff_id: "M", absent_staff_ids: ["A", "B"] }),
        duty({ need_key: "begun", period: 0, covering_staff_id: "Q" }),
        duty({ need_key: "waiting", period: 1, covering_staff_id: "Q" }),
        duty({ need_key: "new", period: 2, covering_staff_id: "Q" }),
        duty({ need_key: "nobody", period: 2, status: "needs_help", covering_staff_id: null }),
      ],
      new Set([1, 2]),
    );
    expect(notices.messages.map((m) => [m.needKey, m.staffId, m.kind])).toEqual([
      ["facts", "M", "updated"],
      ["swapped", "N", "assigned"],
      ["waiting", "Q", "assigned"],
      ["new", "Q", "assigned"],
    ]);
    expect(notices.withdrawn.map((w) => [w.needKey, w.staffId])).toEqual([
      ["dropped", "M"],
      ["swapped", "M"],
    ]);
    expect(messagesByPerson(notices.messages).map((group) => [group.staffId, group.lessons.length])).toEqual([["M", 1], ["N", 1], ["Q", 2]]);
  });

  it("tallies the lessons reviewed", () => {
    expect(reviewTally([duty({}), duty({ status: "needs_help" }), duty({})])).toEqual({ assigned: 2, needsHelp: 1, total: 3 });
  });

  it("fingerprints the whole plan: order does not matter, any change in who covers does", () => {
    const a = [duty({ need_key: "x", covering_staff_id: "M" }), duty({ need_key: "y", covering_staff_id: "N" })];
    const b = [...a].reverse();
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    expect(planFingerprint(a)).toMatch(/^2-[0-9a-z]+$/);
    expect(planFingerprint([duty({ need_key: "x", covering_staff_id: "N" }), a[1]])).not.toBe(planFingerprint(a));
    expect(planFingerprint([duty({ need_key: "x", status: "needs_help", covering_staff_id: null }), a[1]])).not.toBe(planFingerprint(a));
    expect(planFingerprint([a[0]])).not.toBe(planFingerprint(a));
  });
});

describe("Confirm, as a state machine", () => {
  type R = { n: number };
  const step = (state: SaveState<R>, ...events: Parameters<typeof guidedSave<R>>[1][]) => events.reduce((s, e) => guidedSave(s, e), state);
  let counter = 0;
  const mint = () => `id-${++counter}`;

  it("is saved only on the server's word", () => {
    const saving = step(initialSave<R>(), { type: "confirm", commandId: "c1" });
    expect(saving).toEqual({ status: "saving", commandId: "c1" });
    expect(canConfirm(saving)).toBe(false);
    expect(isBusy(saving)).toBe(true);
    // Nothing a person does while it is on its way changes that.
    expect(step(saving, { type: "edited" }, { type: "confirm", commandId: "c2" }, { type: "check_missing" })).toEqual(saving);
    expect(step(saving, { type: "server_saved", receipt: { n: 1 } })).toEqual({ status: "saved", receipt: { n: 1 } });
    // A receipt with no request out is ignored.
    expect(step(initialSave<R>(), { type: "server_saved", receipt: { n: 1 } }).status).toBe("editing");
  });

  it("a lost answer is checked, and a retry sends the same command id", () => {
    const lost = step(initialSave<R>(), { type: "confirm", commandId: "c1" }, { type: "server_unknown" });
    expect(lost).toEqual({ status: "checking", commandId: "c1" });
    const missing = guidedSave(lost, { type: "check_missing" });
    expect(missing).toEqual({ status: "not_saved", commandId: "c1" });
    expect(commandIdFor(missing, mint)).toBe("c1");
    // Not another id under an open outcome.
    expect(guidedSave(missing, { type: "confirm", commandId: "other" })).toEqual(missing);
    expect(guidedSave(missing, { type: "confirm", commandId: "c1" })).toEqual({ status: "saving", commandId: "c1" });

    const offline = guidedSave(lost, { type: "check_failed" });
    expect(offline).toEqual({ status: "unknown", commandId: "c1" });
    expect(commandIdFor(offline, mint)).toBe("c1");
    expect(guidedSave(offline, { type: "check_start" })).toEqual({ status: "checking", commandId: "c1" });
    expect(guidedSave(lost, { type: "check_saved", receipt: { n: 2 } })).toEqual({ status: "saved", receipt: { n: 2 } });
  });

  it("a moved day is reloaded and said plainly; the next Confirm is a new command", () => {
    const moved = step(initialSave<R>(), { type: "confirm", commandId: "c1" }, { type: "server_moved", why: "stale" });
    expect(moved).toEqual({ status: "reloading", why: "stale" });
    expect(canConfirm(moved)).toBe(false);
    const reloaded = guidedSave(moved, { type: "proposal_loaded" });
    expect(reloaded).toEqual({ status: "editing", notice: "stale" });
    expect(commandIdFor(reloaded, () => "fresh")).toBe("fresh");
    expect(guidedSave(reloaded, { type: "edited" })).toEqual({ status: "editing", notice: null });
  });

  it("a refusal stays on screen until the next attempt; after a save only Start again moves on", () => {
    const refused = step(initialSave<R>(), { type: "confirm", commandId: "c1" }, { type: "server_refused", reason: "disabled" });
    expect(refused).toEqual({ status: "refused", reason: "disabled" });
    expect(canConfirm(refused)).toBe(true);
    const saved = step(initialSave<R>(), { type: "confirm", commandId: "c1" }, { type: "server_saved", receipt: { n: 1 } });
    expect(guidedSave(saved, { type: "edited" })).toEqual(saved);
    expect(guidedSave(saved, { type: "reset" })).toEqual({ status: "editing", notice: null });
  });
});
