import { describe, expect, it } from "vitest";

import {
  average,
  boardSummary,
  classPercent,
  classState,
  dailySeries,
  feeRibbon,
  feeStanding,
  filterBoard,
  inboxCounts,
  initialMarks,
  installmentState,
  listMoney,
  markCounts,
  mobileOf,
  moneyFromInstallments,
  parseSegment,
  parseTab,
  provisionalLabel,
  recentWeeks,
  remindable,
  runningPeriod,
  sortBoard,
  sortInbox,
  studentsHref,
  tabsFor,
  toCsv,
  vsAverage,
  whenLabel,
  yearPace,
  type ClassBoardRow,
  type InstallmentLike,
} from "@/vx/screens/admin/logic";

const row = (over: Partial<ClassBoardRow>): ClassBoardRow => ({
  classId: "c",
  label: "Class",
  rank: 0,
  teacherId: "t",
  teacherName: "Teacher",
  roll: 20,
  recorded: false,
  savedAt: null,
  present: 0,
  absent: 0,
  halfDay: 0,
  other: 0,
  teacherAway: false,
  remindedAt: null,
  ...over,
});

describe("attendance board", () => {
  const rows = [
    row({ classId: "a", rank: 2, recorded: true, present: 18, absent: 2 }),
    row({ classId: "b", rank: 0, recorded: true, present: 9, halfDay: 2 }),
    row({ classId: "c", rank: 1 }),
    row({ classId: "d", rank: 3, teacherAway: true }),
  ];

  it("counts only marked classes — a class not marked is never all present", () => {
    const s = boardSummary(rows);
    expect(s).toMatchObject({ total: 4, marked: 2, notMarked: 2, present: 27, absent: 2, halfDay: 2 });
    // (27 + 2 × 0.5) / 31
    expect(s.percent).toBe(90);
  });

  it("has no percentage when nothing is marked", () => {
    expect(boardSummary([row({}), row({})]).percent).toBeNull();
  });

  it("applies the school's half-day credit", () => {
    expect(classPercent({ present: 1, absent: 0, halfDay: 1 }, 0.5)).toBe(75);
    expect(classPercent({ present: 1, absent: 0, halfDay: 1 }, 1)).toBe(100);
    expect(classPercent({ present: 0, absent: 0, halfDay: 0 })).toBe(0);
  });

  it("names each class's state", () => {
    expect(classState(rows[0])).toBe("marked");
    expect(classState(rows[2])).toBe("not_marked");
    expect(classState(rows[3])).toBe("teacher_away");
    expect(classState(row({ remindedAt: "2026-10-10T04:00:00Z" }))).toBe("reminded");
  });

  it("reminds only a teacher who is in school, has a class and has not been reminded", () => {
    const list = [...rows, row({ classId: "e", teacherId: null }), row({ classId: "f", remindedAt: "x" })];
    expect(remindable(list).map((r) => r.classId)).toEqual(["c"]);
  });

  it("sorts in school order and filters", () => {
    expect(sortBoard(rows).map((r) => r.classId)).toEqual(["b", "c", "a", "d"]);
    expect(filterBoard(rows, "pending").map((r) => r.classId)).toEqual(["c", "d"]);
    expect(filterBoard(rows, "marked").map((r) => r.classId)).toEqual(["a", "b"]);
    expect(filterBoard(rows, "all")).toHaveLength(4);
  });
});

describe("the mark sheet", () => {
  const roll = [{ studentId: "s1" }, { studentId: "s2" }];

  it("opens a new register with everyone present", () => {
    expect(initialMarks(roll, {})).toEqual({ s1: "present", s2: "present" });
  });

  it("opens a saved register as it was saved, and a newcomer unmarked", () => {
    expect(initialMarks(roll, { s1: "absent" })).toEqual({ s1: "absent", s2: null });
  });

  it("counts what is marked and what is not", () => {
    expect(markCounts({ a: "present", b: "absent", c: "half_day", d: null })).toEqual({ marked: 3, unmarked: 1, present: 1, absent: 1, halfDay: 1 });
  });
});

describe("the running period", () => {
  const bells = [
    { index: 0, starts: "08:30", ends: "09:10" },
    { index: 1, starts: "09:10", ends: "09:50" },
    { index: 2, starts: "10:10", ends: "10:50" },
  ];
  it("finds the period in progress, a break, or none", () => {
    expect(runningPeriod(bells, 8 * 60 + 45)).toEqual({ index: 0, number: 1, state: "running" });
    expect(runningPeriod(bells, 10 * 60)).toEqual({ index: 1, number: 2, state: "break" });
    expect(runningPeriod(bells, 7 * 60)).toBeNull();
    expect(runningPeriod(bells, 11 * 60)).toBeNull();
  });
});

describe("money keeps its three numbers apart", () => {
  const inst = (over: Partial<InstallmentLike>): InstallmentLike => ({
    installmentNo: 1,
    installmentLabel: "Jul",
    dueDate: "2026-07-10",
    baseCharge: 5000,
    feeSettledAmount: 0,
    pendingAmount: 5000,
    lateFeePending: 0,
    balanceStatus: "pending",
    ...over,
  });

  it("splits pending today, not due yet and the late fee, and never adds them", () => {
    const m = moneyFromInstallments(
      [
        inst({ feeSettledAmount: 5000, pendingAmount: 0, balanceStatus: "paid" }),
        inst({ installmentLabel: "Sep", dueDate: "2026-09-10", balanceStatus: "overdue", pendingAmount: 4200, lateFeePending: 300 }),
        inst({ installmentLabel: "Nov", dueDate: "2026-11-10", pendingAmount: 5000 }),
      ],
      "2026-10-10",
    );
    expect(m).toEqual({ pendingToday: 4200, notDueYet: 5000, lateFee: 300, paid: 5000, total: 15000, percent: 33 });
  });

  it("treats a part-paid row past its due date as pending today", () => {
    const m = moneyFromInstallments([inst({ balanceStatus: "partial", feeSettledAmount: 1000, pendingAmount: 4000 })], "2026-10-10");
    expect(m.pendingToday).toBe(4000);
    expect(m.notDueYet).toBe(0);
  });

  it("does not count a waived row as owed", () => {
    expect(moneyFromInstallments([inst({ balanceStatus: "waived" })]).notDueYet).toBe(0);
  });

  it("labels each installment", () => {
    expect(installmentState(inst({ balanceStatus: "paid", pendingAmount: 0 }))).toBe("paid");
    expect(installmentState(inst({ balanceStatus: "overdue" }))).toBe("overdue");
    expect(installmentState(inst({ balanceStatus: "partial", feeSettledAmount: 10, dueDate: "2026-12-01" }), "2026-10-10")).toBe("part");
    expect(installmentState(inst({ dueDate: "2026-12-01" }), "2026-10-10")).toBe("upcoming");
    expect(installmentState(inst({ balanceStatus: "waived" }))).toBe("waived");
  });

  it("reads the list row: overdue first, the rest not due, late fee apart", () => {
    const m = listMoney({ overdueAmount: 4200, outstandingAmount: 17700, pendingLateFeeAmount: 300, totalPaid: 4000, totalDue: 20300, lateFeeTotal: 300 });
    expect(m).toEqual({ pendingToday: 4200, notDueYet: 13200, lateFee: 300, percent: 20 });
    expect(feeStanding(m)).toBe("pending");
    expect(feeStanding({ pendingToday: 0, notDueYet: 10 })).toBe("on_track");
    expect(feeStanding({ pendingToday: 0, notDueYet: 0 })).toBe("paid");
  });

  it("fills empty days and compares today with the average", () => {
    const series = dailySeries([{ date: "2026-10-08", amount: 100 }, { date: "2026-10-10", amount: 300 }], "2026-10-10", 3);
    expect(series).toEqual([
      { date: "2026-10-08", amount: 100 },
      { date: "2026-10-09", amount: 0 },
      { date: "2026-10-10", amount: 300 },
    ]);
    expect(vsAverage(series, "2026-10-10")).toEqual({ average: 100, deltaPct: 200, best: 300, emptyDays: 1 });
  });

  it("measures the year's pace against what is due so far", () => {
    expect(yearPace({ expected: 1000, collected: 600, dueSoFar: 700 })).toEqual({ percent: 60, shouldPercent: 70, behind: 100 });
    expect(yearPace({ expected: 0, collected: 0, dueSoFar: 0 })).toEqual({ percent: 0, shouldPercent: 0, behind: 0 });
  });
});

describe("needs you", () => {
  it("puts urgent items first, then newest", () => {
    const items = [
      { id: "a", type: "money" as const, at: "2026-10-10T09:00:00Z" },
      { id: "b", type: "students" as const, at: "2026-10-10T10:00:00Z" },
      { id: "c", type: "timetable" as const, at: "2026-10-09T08:00:00Z", urgent: true },
      { id: "d", type: "attendance" as const, at: "2026-10-09T07:00:00Z", urgent: true },
    ];
    expect(sortInbox(items).map((i) => i.id)).toEqual(["d", "c", "b", "a"]);
    expect(inboxCounts(items)).toEqual({ all: 4, attendance: 1, money: 1, timetable: 1, students: 1, system: 0 });
  });

  it("says when, in the school's day", () => {
    const now = new Date("2026-10-10T06:00:00Z");
    expect(whenLabel("2026-10-10T03:50:00Z", now)).toBe("Today 9:20");
    expect(whenLabel("2026-10-09T06:00:00Z", now)).toBe("Yesterday");
    expect(whenLabel("2026-10-07T06:00:00Z", now)).toBe("3 days ago");
    expect(whenLabel("2026-09-20T06:00:00Z", now)).toBe("20 Sept");
    expect(whenLabel(null, now)).toBe("");
  });
});

describe("students", () => {
  it("never offers money tabs without fees:view", () => {
    const none = tabsFor({ fees: false, documents: false, notes: false, history: false, marks: false });
    expect(none).toEqual(["overview", "attendance", "info"]);
    const all = tabsFor({ fees: true, documents: true, notes: true, history: true, marks: true });
    expect(all).toEqual(["overview", "fees", "attendance", "marks", "family", "documents", "notes", "history", "info"]);
    expect(parseTab("fees", none)).toBe("overview");
    expect(parseTab("fees", all)).toBe("fees");
  });

  it("calls a term provisional while any paper is blank, in both languages", () => {
    expect(provisionalLabel(0, 6)).toBeNull();
    expect(provisionalLabel(1, 6)).toEqual({ en: "Provisional · 1 paper not entered", hi: "अस्थायी · 1 पेपर के अंक बाकी" });
    expect(provisionalLabel(2, 6)?.en).toBe("Provisional · 2 papers not entered");
    expect(provisionalLabel(6, 6)?.en).toBe("Provisional · no papers entered yet");
    // No paper count known: still provisional, never final.
    expect(provisionalLabel(3, 0)?.en).toBe("Provisional · 3 papers not entered");
  });

  it("reads the chip and builds the URL with empty values left out", () => {
    expect(parseSegment("bus")).toBe("bus");
    expect(parseSegment("nope")).toBe("all");
    expect(studentsHref({})).toBe("/students");
    expect(studentsHref({ q: " asha ", classId: "c1", seg: "pending", page: 2 })).toBe("/students?q=asha&class=c1&seg=pending&page=2");
    expect(studentsHref({ seg: "all", page: 1 })).toBe("/students");
  });

  it("finds a mobile number to ring", () => {
    expect(mobileOf("98290 12345")).toBe("9829012345");
    expect(mobileOf("+91 9829012345")).toBe("9829012345");
    expect(mobileOf("12345")).toBeNull();
    expect(mobileOf(null)).toBeNull();
  });

  it("lays out the last four school weeks, Monday to Saturday", () => {
    const cells = recentWeeks([{ day: "2026-10-06", status: "absent" }], "2026-10-08", 4, (d) => d === "2026-10-02");
    expect(cells).toHaveLength(24);
    expect(cells[0].day).toBe("2026-09-14");
    expect(cells.find((c) => c.day === "2026-10-06")?.state).toBe("absent");
    expect(cells.find((c) => c.day === "2026-10-02")?.state).toBe("closed");
    expect(cells.find((c) => c.day === "2026-10-08")?.state).toBe("today");
    expect(cells.find((c) => c.day === "2026-10-09")?.state).toBe("future");
    expect(cells.find((c) => c.day === "2026-10-05")?.state).toBe("none");
  });

  it("averages and exports", () => {
    expect(average([70, 81])).toBe(76);
    expect(average([])).toBeNull();
    expect(toCsv(["a", "b"], [["x\"y", 2], [null, "z"]])).toBe('"a","b"\r\n"x""y","2"\r\n"","z"');
  });
});

describe("the fee ribbon picks one sentence, as the fee app does", () => {
  const base = { overdue: 0, lateFeePending: 0, creditBalance: 0, outstanding: 0, nextDue: null };

  it("overdue fees win, with the late fee alongside rather than inside", () => {
    expect(feeRibbon({ ...base, overdue: 4000, lateFeePending: 1000, creditBalance: 500, outstanding: 9000 })).toEqual({ kind: "overdue", overdue: 4000, lateFee: 1000 });
  });

  it("a late fee alone never reads as overdue", () => {
    expect(feeRibbon({ ...base, lateFeePending: 1000 }).kind).toBe("clear");
  });

  it("a credit comes before year clear", () => {
    expect(feeRibbon({ ...base, creditBalance: 300 })).toEqual({ kind: "credit", credit: 300 });
  });

  it("names the next installment when nothing is overdue", () => {
    const nextDue = { label: "Installment 3", amount: 5000, dueDate: "2026-10-20" };
    expect(feeRibbon({ ...base, outstanding: 10000, nextDue })).toEqual({ kind: "next", ...nextDue });
  });
});
