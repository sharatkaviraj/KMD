import { describe, expect, it } from "vitest";

import { arrange, broughtBack, canBringBack, mergeDone, needSignature, ownItem, planFits, ruleReason, wakeDue, withReminders } from "@/modules/needs-you/domain/lanes";
import { remindChoices } from "@/modules/needs-you/domain/choices";
import { adminNeeds, counterNeeds, examNeeds, promiseNeeds } from "@/modules/needs-you/domain/office";
import { planFacts, planFromAnswer, planLine } from "@/modules/needs-you/domain/plan";
import { teacherNeeds, type TeacherFacts } from "@/modules/needs-you/domain/teacher";
import type { NeedItem, NeedReminder } from "@/modules/needs-you/domain/types";
import { parseWhen } from "@/modules/needs-you/domain/when";
import { whenP } from "@/modules/needs-you/domain/format";

// Sunday 15 Nov 2026, 10:30 in the morning at the school.
const NOW = new Date("2026-11-15T10:30:00+05:30");
const ist = (s: string) => new Date(`${s}+05:30`).toISOString();

describe("reading a time out of a to-do (Hindi, Hinglish, English)", () => {
  it("reads kal subah 9 baje and keeps the rest as the to-do", () => {
    const r = parseWhen("kal subah 9 baje Ramesh ke papa ko phone karna", NOW);
    expect(r?.at).toBe(ist("2026-11-16T09:00:00"));
    expect(r?.rest).toBe("Ramesh ke papa ko phone karna");
    expect(r?.heard).toBe("kal subah 9 baje");
  });

  it("reads times from now", () => {
    expect(parseWhen("in 2 hours", NOW)?.at).toBe(ist("2026-11-15T12:30:00"));
    expect(parseWhen("in half an hour check copies", NOW)?.rest).toBe("check copies");
    const hindi = parseWhen("आधे घंटे बाद कॉपी जाँचनी है", NOW);
    expect(hindi?.at).toBe(ist("2026-11-15T11:00:00"));
    expect(hindi?.rest).toBe("कॉपी जाँचनी है");
    expect(parseWhen("do ghante baad", NOW)?.at).toBe(ist("2026-11-15T12:30:00"));
    expect(parseWhen("30 minute mein", NOW)?.at).toBe(ist("2026-11-15T11:00:00"));
  });

  it("reads Devanagari words and digits", () => {
    expect(parseWhen("शाम 5 बजे मीटिंग", NOW)?.at).toBe(ist("2026-11-15T17:00:00"));
    expect(parseWhen("शाम 5 बजे मीटिंग", NOW)?.rest).toBe("मीटिंग");
    expect(parseWhen("कल ९ बजे", NOW)?.at).toBe(ist("2026-11-16T09:00:00"));
    expect(parseWhen("नौ बजे", NOW)?.at).toBe(ist("2026-11-16T09:00:00"));
  });

  it("keeps the school's hours: 3 baje is the afternoon, a gone time is tomorrow", () => {
    expect(parseWhen("3 baje", NOW)?.at).toBe(ist("2026-11-15T15:00:00"));
    expect(parseWhen("9 baje", NOW)?.at).toBe(ist("2026-11-16T09:00:00"));
    expect(parseWhen("12 baje", NOW)?.at).toBe(ist("2026-11-15T12:00:00"));
    expect(parseWhen("9:30 pm", NOW)?.at).toBe(ist("2026-11-15T21:30:00"));
    expect(parseWhen("10am tomorrow", NOW)?.at).toBe(ist("2026-11-16T10:00:00"));
    expect(parseWhen("after school", NOW)?.at).toBe(ist("2026-11-15T15:00:00"));
  });

  it("reads the way a time is said aloud", () => {
    expect(parseWhen("saade 11 baje", NOW)?.at).toBe(ist("2026-11-15T11:30:00"));
    expect(parseWhen("dedh baje", NOW)?.at).toBe(ist("2026-11-15T13:30:00"));
    expect(parseWhen("paune ek baje", NOW)?.at).toBe(ist("2026-11-15T12:45:00"));
    expect(parseWhen("sava 12", NOW)?.at).toBe(ist("2026-11-15T12:15:00"));
  });

  it("reads days of the week and dates", () => {
    // 15 Nov 2026 is a Sunday.
    expect(parseWhen("somvar ko register", NOW)).toEqual({ at: ist("2026-11-16T08:00:00"), heard: "somvar ko", rest: "register" });
    expect(parseWhen("on Friday at 4 pm", NOW)?.at).toBe(ist("2026-11-20T16:00:00"));
    expect(parseWhen("next sunday", NOW)?.at).toBe(ist("2026-11-22T08:00:00"));
    expect(parseWhen("17 Nov fees list", NOW)?.at).toBe(ist("2026-11-17T08:00:00"));
    expect(parseWhen("17 नवंबर", NOW)?.at).toBe(ist("2026-11-17T08:00:00"));
    expect(parseWhen("17/11", NOW)?.at).toBe(ist("2026-11-17T08:00:00"));
    expect(parseWhen("1/1 se pehle", NOW)?.at).toBe(ist("2027-01-01T08:00:00"));
    expect(parseWhen("20 tarikh", NOW)?.at).toBe(ist("2026-11-20T08:00:00"));
    expect(parseWhen("10 tarikh", NOW)?.at).toBe(ist("2026-12-10T08:00:00"));
    expect(parseWhen("parso shaam", NOW)?.at).toBe(ist("2026-11-17T17:00:00"));
    expect(parseWhen("kal ko", NOW)?.rest).toBe("");
  });

  it("says nothing when there is no time in the words", () => {
    expect(parseWhen("Ramesh ko phone", NOW)).toBeNull();
    expect(parseWhen("aaj", NOW)).toBeNull();
    // "sun" is "listen", never Sunday; a class number is not a time.
    expect(parseWhen("sun lo Ramesh ki baat", NOW)).toBeNull();
    expect(parseWhen("class 9 ki copy", NOW)).toBeNull();
    expect(parseWhen("31 Nov", NOW)).toBeNull();
    expect(parseWhen("45 baje", NOW)).toBeNull();
  });

  it("reads tonight late in the evening as later tonight", () => {
    const late = new Date("2026-11-15T21:00:00+05:30");
    expect(parseWhen("tonight", late)?.at).toBe(ist("2026-11-15T22:00:00"));
    expect(parseWhen("tonight", NOW)?.at).toBe(ist("2026-11-15T20:00:00"));
  });

  it("says a reminder time back in both languages", () => {
    expect(whenP(ist("2026-11-16T09:00:00"), NOW)).toEqual({ en: "Tomorrow, 9:00 am", hi: "कल सुबह 9:00" });
    expect(whenP(ist("2026-11-15T15:00:00"), NOW)).toEqual({ en: "Today, 3:00 pm", hi: "आज दोपहर 3:00" });
    expect(whenP(ist("2026-11-17T08:00:00"), NOW).en).toBe("Tue 17 Nov, 8:00 am");
  });
});

const item = (over: Partial<NeedItem> & { key: string }): NeedItem => ({
  kind: "task",
  title: { en: over.key },
  why: null,
  lane: "today",
  dueAt: null,
  lateMinutes: 0,
  startsInMinutes: null,
  peopleWaiting: 0,
  count: 1,
  effort: "medium",
  href: "/x",
  act: { en: "Open" },
  canSnooze: true,
  ...over,
});

describe("lanes and order", () => {
  it("puts a period about to begin first, then late work, then people waiting", () => {
    const board = arrange([
      item({ key: "late", lane: "now", lateMinutes: 40 }),
      item({ key: "waiting", lane: "now", peopleWaiting: 3 }),
      item({ key: "cover", lane: "now", startsInMinutes: 10 }),
      item({ key: "t2", dueAt: ist("2026-11-15T15:00:00") }),
      item({ key: "t1", dueAt: ist("2026-11-15T12:00:00") }),
      item({ key: "l", lane: "later" }),
    ]);
    expect(board.now.map((i) => i.key)).toEqual(["cover", "late", "waiting"]);
    expect(board.today.map((i) => i.key)).toEqual(["t1", "t2"]);
    expect(board.next?.key).toBe("cover");
    expect(board.left).toBe(5);
    expect(board.plan.source).toBe("rules");
    expect(board.plan.reasons).toMatchObject({ cover: "starts_soon", late: "late", waiting: "someone_waiting" });
  });

  it("uses an AI order inside the lanes, but never ahead of a period about to begin", () => {
    const items = [
      item({ key: "cover", lane: "now", startsInMinutes: 5 }),
      item({ key: "late", lane: "now", lateMinutes: 40 }),
      item({ key: "a", effort: "long" }),
      item({ key: "b", effort: "quick" }),
    ];
    const board = arrange(items, { order: ["late", "b", "cover", "a"], reasons: { b: "quick_first" }, source: "ai" });
    expect(board.now.map((i) => i.key)).toEqual(["cover", "late"]);
    expect(board.today.map((i) => i.key)).toEqual(["b", "a"]);
    expect(board.plan.source).toBe("ai");
    expect(board.plan.reasons.b).toBe("quick_first");
    expect(board.plan.reasons.a).toBe("big_job_early");
  });

  it("drops an AI order that does not name a new job, and keeps one that only lost a finished job", () => {
    const plan = { order: ["a", "b"], reasons: {}, source: "ai" as const };
    expect(planFits(plan, [item({ key: "a" })])).toBe(true);
    expect(planFits(plan, [item({ key: "a" }), item({ key: "c" })])).toBe(false);
    expect(arrange([item({ key: "a" }), item({ key: "c" })], plan).plan.source).toBe("rules");
    expect(needSignature([item({ key: "a" }), item({ key: "b", lane: "later" })])).toBe(needSignature([item({ key: "a" })]));
  });

  it("keeps the AI's order when a person writes down a to-do of their own, and puts it after the planned jobs", () => {
    const plan = { order: ["b", "a"], reasons: {}, source: "ai" as const };
    const own = item({ key: "own:1", kind: "own", effort: "quick" });
    expect(planFits(plan, [item({ key: "a" }), item({ key: "b" }), own])).toBe(true);
    const board = arrange([item({ key: "a" }), own, item({ key: "b" })], plan);
    expect(board.plan.source).toBe("ai");
    expect(board.today.map((i) => i.key)).toEqual(["b", "a", "own:1"]);
    // Nothing the AI ordered is left: the order no longer says anything.
    expect(planFits(plan, [own])).toBe(false);
  });

  it("brings a put-off job back to Do now once its time comes, and never one that waits on others", () => {
    const later = item({ key: "a", lane: "later", remindAt: ist("2026-11-15T10:00:00") });
    const notYet = item({ key: "b", lane: "later", remindAt: ist("2026-11-15T12:00:00") });
    const waiting = item({ key: "c", lane: "waiting", remindAt: ist("2026-11-15T09:00:00"), canSnooze: false });
    const { items, woke } = wakeDue([later, notYet, waiting], NOW);
    expect(woke.map((i) => i.key)).toEqual(["a"]);
    expect(items.find((i) => i.key === "a")).toMatchObject({ lane: "now", reminded: true });
    expect(items.find((i) => i.key === "b")?.lane).toBe("later");
    expect(items.find((i) => i.key === "c")?.lane).toBe("waiting");
    // Already back: not woken twice.
    expect(wakeDue(items, NOW).woke).toEqual([]);
  });

  it("lists today's done jobs once each, the latest first", () => {
    const a = { key: "a", kind: "task" as const, title: { en: "A" }, at: null };
    const a2 = { ...a, at: ist("2026-11-15T09:00:00") };
    const b = { key: "b", kind: "task" as const, title: { en: "B" }, at: ist("2026-11-15T10:00:00") };
    expect(mergeDone([a], [a2, b]).map((d) => [d.key, d.at])).toEqual([
      ["b", b.at],
      ["a", a2.at],
    ]);
  });

  it("moves a put-off job to Later until its time, then back to Do now", () => {
    const snooze: NeedReminder = { id: "s1", kind: "snooze", itemKey: "a", title: null, heard: null, remindAt: ist("2026-11-15T13:00:00"), doneAt: null, createdAt: ist("2026-11-15T10:00:00") };
    const before = withReminders([item({ key: "a" })], [snooze], NOW);
    expect(before[0]).toMatchObject({ lane: "later", reminded: false });
    const after = withReminders([item({ key: "a" })], [snooze], new Date("2026-11-15T13:05:00+05:30"));
    expect(after[0]).toMatchObject({ lane: "now", reminded: true });
    expect(ruleReason(after[0])).toBe("reminded");
    // The waiting lane is not hers to do, so it is never put off.
    expect(withReminders([item({ key: "a", lane: "waiting", canSnooze: false })], [snooze], NOW)[0].lane).toBe("waiting");
  });

  it("files a person's own to-do by its time", () => {
    const own = (remindAt: string | null): NeedReminder => ({ id: "o1", kind: "own", itemKey: null, title: "Call Ramesh's father", heard: null, remindAt, doneAt: null, createdAt: NOW.toISOString() });
    expect(ownItem(own(null), NOW).lane).toBe("today");
    expect(ownItem(own(ist("2026-11-15T15:00:00")), NOW).lane).toBe("today");
    expect(ownItem(own(ist("2026-11-15T09:00:00")), NOW)).toMatchObject({ lane: "now", reminded: true, quick: "own-done" });
    expect(ownItem(own(ist("2026-11-16T09:00:00")), NOW).lane).toBe("later");
    expect(withReminders([], [{ ...own(null), doneAt: NOW.toISOString() }], NOW)).toEqual([]);
  });
});

describe("what the AI is shown, and what comes back", () => {
  const board = arrange([
    item({ key: "att:c1:2026-11-15", kind: "attendance", lane: "now", lateMinutes: 30, title: { en: "Mark attendance · Class 5", hi: "हाज़िरी लगाएँ · कक्षा 5" } }),
    item({ key: "notices", kind: "notice", effort: "quick", title: { en: "Read 2 new notices", hi: "2 नई सूचना पढ़ें" } }),
    item({ key: "marks:p1", kind: "marks", effort: "long", title: { en: "Science marks · Class 6" } }),
  ]);

  it("shows kinds and numbers only, never a title", () => {
    const facts = planFacts(board, "teacher", NOW);
    expect(facts?.input.time).toBe("10:30");
    expect(facts?.input.items).toEqual([
      { id: "i1", kind: "attendance", lane: "now", late_minutes: 30, starts_in_minutes: null, people_waiting: 0, how_many: 1, effort: "medium" },
      { id: "i2", kind: "notice", lane: "today", late_minutes: 0, starts_in_minutes: null, people_waiting: 0, how_many: 1, effort: "quick" },
      { id: "i3", kind: "marks", lane: "today", late_minutes: 0, starts_in_minutes: null, people_waiting: 0, how_many: 1, effort: "long" },
    ]);
    expect(JSON.stringify(facts?.input)).not.toMatch(/Class|Science|notice[s ]/);
  });

  it("maps the answer back, dropping unknown ids and keeping One's order for missing ones", () => {
    const facts = planFacts(board, "teacher", NOW)!;
    const plan = planFromAnswer({ order: ["i3", "i9", "i3", "i1"], reasons: [{ id: "i3", reason: "big_job_early" }, { id: "i1", reason: "nonsense" }] }, facts);
    expect(plan.order).toEqual(["marks:p1", "att:c1:2026-11-15", "notices"]);
    expect(plan.reasons).toEqual({ "marks:p1": "big_job_early" });
    expect(planFacts(arrange([item({ key: "only" })]), "teacher", NOW)).toBeNull();
  });

  it("says the first job and why, in both languages", () => {
    expect(planLine(board)).toEqual({
      en: "First, Mark attendance · Class 5 — it is late. Then Read 2 new notices.",
      hi: "पहले: हाज़िरी लगाएँ · कक्षा 5 — देर हो रही है। फिर: 2 नई सूचना पढ़ें।",
    });
  });
});

const teacher = (over: Partial<TeacherFacts> = {}): TeacherFacts => ({
  today: "2026-11-16",
  nowMinutes: 9 * 60 + 10,
  schoolOpen: true,
  canMark: true,
  myClasses: [{ classId: "c5", classLabel: "Class 5", total: 32, saved: false, savedAt: null }],
  lastOpen: null,
  bells: [{ starts: "08:00", ends: "08:40" }, { starts: "08:40", ends: "09:20" }],
  covers: [],
  upcomingCovers: [],
  notices: [],
  links: [],
  subjects: [{ code: "SCI", name: "Science", nameHi: "विज्ञान" }],
  tasks: [],
  reviews: [],
  birthdays: [],
  birthdayWishes: true,
  leave: [],
  ...over,
});

describe("a teacher's list", () => {
  it("asks for the register, late once the first period is over", () => {
    const { items } = teacherNeeds(teacher());
    expect(items[0]).toMatchObject({
      key: "att:c5:2026-11-16",
      kind: "attendance",
      lane: "now",
      lateMinutes: 30,
      href: "/teach/attendance?class=c5&day=2026-11-16",
      title: { en: "Mark attendance · Class 5", hi: "हाज़िरी लगाएँ · कक्षा 5" },
    });
    expect(teacherNeeds(teacher({ nowMinutes: 7 * 60 + 50 })).items[0].lane).toBe("today");
    const saved = teacherNeeds(teacher({ myClasses: [{ classId: "c5", classLabel: "Class 5", total: 32, saved: true, savedAt: "2026-11-16T02:50:00Z" }] }));
    expect(saved.items).toEqual([]);
    expect(saved.done[0]).toMatchObject({ key: "att:c5:2026-11-16", at: "2026-11-16T02:50:00Z" });
    expect(teacherNeeds(teacher({ schoolOpen: false })).items).toEqual([]);
  });

  it("asks about a cover, Do now within the hour, and drops one that is over", () => {
    const cover = { id: "d1", day: "2026-11-16", number: 4, starts: "10:00", ends: "10:40", classLabels: "Class 6", subjectName: "Science", subjectHi: "विज्ञान", forName: "Asha", acknowledged: false };
    const { items } = teacherNeeds(teacher({ myClasses: [], covers: [cover] }));
    expect(items[0]).toMatchObject({ key: "cover:d1", lane: "now", startsInMinutes: 50, quick: "cover-yes" });
    expect(items[0].title.hi).toBe("पीरियड 4 लेना है · कक्षा 6");
    expect(teacherNeeds(teacher({ myClasses: [], covers: [cover], nowMinutes: 11 * 60 })).items).toEqual([]);
    expect(teacherNeeds(teacher({ myClasses: [], upcomingCovers: [{ ...cover, day: "2026-11-17" }] })).items[0].lane).toBe("later");
  });

  it("files marks by the exam office's due day", () => {
    const link = { paperId: "p1", classLabel: "Class 6", subjectCode: "SCI", exam: "Test I", examHi: "टेस्ट I", entered: 10, total: 40, submitted: false, examId: "e1" };
    const lane = (due: string | null) => teacherNeeds(teacher({ myClasses: [], links: [link] }), { marksDue: { e1: due } }).items[0];
    expect(lane("2026-11-14")).toMatchObject({ lane: "now", effort: "long", count: 30 });
    expect(lane("2026-11-17").lane).toBe("today");
    expect(lane("2026-11-25").lane).toBe("later");
    expect(lane(null).lane).toBe("later");
    const filled = teacherNeeds(teacher({ myClasses: [], links: [{ ...link, entered: 40 }] })).items[0];
    expect(filled).toMatchObject({ lane: "today", effort: "quick", act: { en: "Send marks", hi: "अंक भेजें" } });
  });

  it("puts her leave request in Waiting, never to be put off", () => {
    const { items } = teacherNeeds(teacher({ myClasses: [], leave: [{ id: "l1", from_day: "2026-11-20", to_day: "2026-11-21", status: "asked" }] }));
    expect(items[0]).toMatchObject({ lane: "waiting", canSnooze: false, kind: "leave" });
  });

  it("groups unread notices into one job", () => {
    const { items } = teacherNeeds(teacher({ myClasses: [], notices: [{ id: "n1", title: "Sports day", seen: false }, { id: "n2", title: "PTM", seen: false }, { id: "n3", title: "Old", seen: true }] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "notices", count: 2, effort: "quick", href: "/teach/more?view=news" });
  });
});

describe("the fee office's and the exam office's lists", () => {
  const counter = {
    today: "2026-11-16",
    nowMinutes: 11 * 60,
    now: new Date("2026-11-16T11:00:00+05:30"),
    canCollect: true,
    canAccounts: true,
    queue: [{ id: "q1", arrivedAt: "2026-11-16T05:20:00Z" }],
    followUpsToday: { count: 5, kept: 2 },
    chequesToDeposit: { count: 0 },
    upiOpen: { count: 2 },
    requests: [{ id: "r1", title: "Waive late fee", mine: true, status: "waiting", requestedAt: "2026-11-15T05:00:00Z" }],
    closure: null,
  };

  it("puts families at the counter first and the day's close later", () => {
    const { items } = counterNeeds(counter);
    const board = arrange(items);
    expect(board.next).toMatchObject({ kind: "counter", peopleWaiting: 1 });
    expect(board.next?.why?.en).toBe("The first has waited 10 min");
    expect(board.today.map((i) => i.kind)).toEqual(["calls", "close", "upi"]);
    expect(board.waiting.map((i) => i.kind)).toEqual(["request"]);
    expect(counterNeeds({ ...counter, nowMinutes: 16 * 60 + 45 }).items.find((i) => i.kind === "close")?.lane).toBe("now");
    expect(counterNeeds({ ...counter, closure: { status: "closed", closedAt: "x" } }).done[0].kind).toBe("close");
    expect(promiseNeeds("2026-11-16", 0)).toEqual([]);
    expect(promiseNeeds("2026-11-16", 3)[0]).toMatchObject({ href: "/dues?tab=prom", count: 3 });
  });

  it("asks the coordinator to remind late teachers and to publish when all marks are in", () => {
    const exam = (over: Partial<NonNullable<Parameters<typeof examNeeds>[0]["results"]>> = {}) =>
      examNeeds({
        today: "2026-11-16",
        nowMinutes: 600,
        results: { id: "e1", name: { en: "Half Yearly", hi: "अर्धवार्षिक" }, lateCount: 3, entered: 300, total: 390, marksDueOn: "2026-11-14", resultsOn: "2026-11-20", published: false, ...over },
        next: {
          id: "e2",
          name: { en: "Test II", hi: "टेस्ट II" },
          steps: [
            { key: "created", state: "done", dueOn: null, owner: "you", progress: null },
            { key: "datesheet", state: "todo", dueOn: "2026-11-15", owner: "you", progress: null },
            { key: "papers", state: "doing", dueOn: "2026-12-01", owner: "teachers", progress: "4/38" },
          ],
        },
      }).items;
    const items = exam();
    expect(items.find((i) => i.kind === "exam_marks")).toMatchObject({ lane: "now", count: 3, href: "/exam-office?view=remind" });
    expect(items.find((i) => i.key === "exam-step:e2:datesheet")?.lane).toBe("now");
    expect(items.find((i) => i.key === "exam-step:e2:papers")).toMatchObject({ lane: "waiting", waitingOn: { en: "Teachers", hi: "शिक्षक" } });
    expect(items.some((i) => i.kind === "results")).toBe(false);
    expect(exam({ lateCount: 0, entered: 390 }).find((i) => i.kind === "results")?.lane).toBe("later");
  });
});

describe("remind me later", () => {
  it("offers only the times still ahead in the school's day", () => {
    expect(remindChoices(NOW).map((c) => c.key)).toEqual(["hour", "lunch", "evening", "morning"]);
    expect(remindChoices(NOW)[0].at).toBe(ist("2026-11-15T11:30:00"));
    expect(remindChoices(NOW).find((c) => c.key === "morning")?.at).toBe(ist("2026-11-16T08:00:00"));
    const afternoon = new Date("2026-11-15T14:00:00+05:30");
    expect(remindChoices(afternoon).map((c) => c.key)).toEqual(["hour", "evening", "morning"]);
    const evening = new Date("2026-11-15T18:00:00+05:30");
    expect(remindChoices(evening).map((c) => c.key)).toEqual(["hour", "morning"]);
  });

  it("brings a job put off by mistake back to where it was (D-636)", () => {
    const snooze: NeedReminder = { id: "s1", kind: "snooze", itemKey: "a", title: null, heard: null, remindAt: ist("2026-11-16T08:00:00"), doneAt: null, createdAt: ist("2026-11-15T10:00:00") };
    const [put] = withReminders([item({ key: "a", lane: "now", lateMinutes: 30 })], [snooze], NOW);
    expect(put).toMatchObject({ lane: "later", baseLane: "now" });
    expect(canBringBack(put)).toBe(true);
    const back = broughtBack(put);
    expect(back).toMatchObject({ lane: "now", remindAt: null, reminded: false, lateMinutes: 30 });
    expect("baseLane" in back).toBe(false);
    expect(canBringBack(back)).toBe(false);
    // In Later by its own date, with no time of theirs: nothing to bring back.
    expect(canBringBack(item({ key: "b", lane: "later" }))).toBe(false);
    // Waiting on somebody else is never theirs to put off or bring back.
    expect(canBringBack(item({ key: "c", lane: "later", remindAt: ist("2026-11-16T08:00:00"), canSnooze: false }))).toBe(false);
  });

  it("puts an own to-do for another day on today's list, without a time (D-636)", () => {
    const mine = ownItem({ id: "o1", kind: "own", itemKey: null, title: "Call the bus driver", heard: "kal subah 9 baje", remindAt: ist("2026-11-16T09:00:00"), doneAt: null, createdAt: NOW.toISOString() }, NOW);
    expect(canBringBack(mine)).toBe(true);
    const back = broughtBack(mine);
    expect(back).toMatchObject({ lane: "today", remindAt: null, dueAt: null, reminded: false });
    // The same as the server's next read of the to-do once its time is cleared.
    expect(back).toEqual(ownItem({ id: "o1", kind: "own", itemKey: null, title: "Call the bus driver", heard: null, remindAt: null, doneAt: null, createdAt: NOW.toISOString() }, NOW));
  });
});

describe("the admin's queue", () => {
  it("is ordered as jobs: urgent is Do now, a class with no register by the first bell is late", () => {
    const items = adminNeeds(
      [
        { id: "att", kind: "not_marked", at: null, urgent: true, title: { en: "3 classes not marked" }, classIds: ["c1", "c2", "c3"] },
        { id: "leave1", kind: "leave", at: ist("2026-11-15T09:00:00"), urgent: false, title: { en: "Leave request" } },
      ],
      NOW,
      10 * 60 + 30,
      [{ starts: "08:30" }, { starts: "09:10" }],
    );
    expect(items[0]).toMatchObject({ key: "inbox:att", kind: "attendance", lane: "now", lateMinutes: 120, count: 3, canSnooze: false });
    expect(items[1]).toMatchObject({ key: "inbox:leave1", kind: "leave", lane: "today", peopleWaiting: 1, href: "/inbox?item=leave1" });
  });
});
