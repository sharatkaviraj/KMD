import { describe, expect, it } from "vitest";

import { studentsHref } from "@/vx/screens/admin/logic";
import {
  attendanceDays,
  attendanceFigure,
  classFromQuery,
  MAX_BADGES,
  moneyStatus,
  nextSort,
  parseStudentSort,
  parseStudentView,
  sortMode,
  sortStudentRows,
  readStudentViewCookie,
  resolveStudentView,
  savedScroll,
  SCROLL_TTL_MS,
  scrollToRestore,
  studentBadges,
  studentViewCookieValue,
  type StudentFacts,
} from "@/vx/screens/admin/students-logic";

const STAFF = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const facts = (over: Partial<StudentFacts> = {}): StudentFacts => ({
  attendance: null,
  siblings: 0,
  isNew: false,
  route: null,
  yearClear: false,
  emi: null,
  concessions: [],
  ...over,
});

const kinds = (list: { kind: string }[]) => list.map((b) => b.kind);

describe("student list views", () => {
  it("parses only the two views", () => {
    expect(parseStudentView("fees")).toBe("fees");
    expect(parseStudentView("school")).toBe("school");
    expect(parseStudentView("money")).toBeNull();
    expect(parseStudentView(undefined)).toBeNull();
  });

  it("is always School for a reader without fees:view, whatever the URL or cookie says", () => {
    expect(resolveStudentView({ param: "fees", seg: "pending", remembered: "fees", seesMoney: false })).toBe("school");
  });

  it("opens a fee reader who never chose in Fees, the list the design draws (UI-85)", () => {
    expect(resolveStudentView({ param: undefined, seg: "all", remembered: null, seesMoney: true })).toBe("fees");
    expect(resolveStudentView({ param: undefined, seg: "all", remembered: "school", seesMoney: true })).toBe("school");
    expect(resolveStudentView({ param: undefined, seg: "all", remembered: null, seesMoney: false })).toBe("school");
  });

  it("opens the remembered view when the URL does not say", () => {
    expect(resolveStudentView({ param: undefined, seg: "all", remembered: "fees", seesMoney: true })).toBe("fees");
  });

  it("lets a fee chip in an old link imply the Fees view", () => {
    expect(resolveStudentView({ param: undefined, seg: "pending", remembered: "school", seesMoney: true })).toBe("fees");
    expect(resolveStudentView({ param: undefined, seg: "pending", remembered: null, seesMoney: true })).toBe("fees");
  });

  it("lets an explicit ?view= win over the chip and the cookie", () => {
    expect(resolveStudentView({ param: "school", seg: "pending", remembered: "fees", seesMoney: true })).toBe("school");
    expect(resolveStudentView({ param: "fees", seg: "all", remembered: "school", seesMoney: true })).toBe("fees");
    expect(resolveStudentView({ param: "nonsense", seg: "all", remembered: "fees", seesMoney: true })).toBe("fees");
  });

  it("keys the remembered view to the person who chose it", () => {
    const value = studentViewCookieValue(STAFF, "fees");
    expect(readStudentViewCookie(value, STAFF)).toBe("fees");
    expect(readStudentViewCookie(value, OTHER)).toBeNull();
    expect(readStudentViewCookie("fees", STAFF)).toBeNull();
    expect(readStudentViewCookie(`${STAFF}.money`, STAFF)).toBeNull();
    expect(readStudentViewCookie(undefined, STAFF)).toBeNull();
  });

  it("writes the view into the list URL when given", () => {
    expect(studentsHref({ view: "fees" })).toBe("/students?view=fees");
    expect(studentsHref({ q: "test", classId: "c1", view: "school", page: 3 })).toBe("/students?q=test&class=c1&view=school&page=3");
    expect(studentsHref({ view: "fees", seg: "pending" })).toBe("/students?view=fees&seg=pending");
  });
});

describe("returning to the list", () => {
  const url = "/students?q=test&page=2";
  const now = 1_000_000_000;

  it("restores the same list's scroll", () => {
    expect(scrollToRestore(savedScroll(url, 812.4, now - 1000), url, now)).toBe(812);
  });

  it("ignores another list, a stale visit, the top and anything malformed", () => {
    expect(scrollToRestore(savedScroll("/students?page=3", 800, now), url, now)).toBeNull();
    expect(scrollToRestore(savedScroll(url, 800, now - SCROLL_TTL_MS - 1), url, now)).toBeNull();
    expect(scrollToRestore(savedScroll(url, 0, now), url, now)).toBeNull();
    expect(scrollToRestore("{not json", url, now)).toBeNull();
    expect(scrollToRestore(JSON.stringify({ url, y: "800", at: now }), url, now)).toBeNull();
    expect(scrollToRestore(null, url, now)).toBeNull();
  });
});

describe("attendance figure", () => {
  it("shows half days as .5 and whole days without a decimal", () => {
    expect(attendanceDays(18)).toBe("18");
    expect(attendanceDays(17.5)).toBe("17.5");
    expect(attendanceDays(17.499999)).toBe("17.5");
  });

  it("is null for a child with no submitted register", () => {
    expect(attendanceFigure(null)).toBeNull();
    expect(attendanceFigure({ credit: 0, counted: 0, pct: null })).toBeNull();
  });

  it("carries days and a rounded percentage", () => {
    expect(attendanceFigure({ credit: 18, counted: 20, pct: 90.0 })).toEqual({ present: "18", counted: 20, pct: 90 });
    expect(attendanceFigure({ credit: 17.5, counted: 20, pct: 87.5 })).toEqual({ present: "17.5", counted: 20, pct: 88 });
  });
});

describe("student badges", () => {
  const everything = facts({
    attendance: { credit: 18, counted: 20, pct: 90 },
    siblings: 2,
    isNew: true,
    route: "Route A",
    yearClear: true,
    emi: { status: "on_track", monthly: 1500, nextDue: "2026-11-05" },
    concessions: ["RTE"],
  });

  it("shows at most three, the rest behind details, nothing lost", () => {
    const school = studentBadges(everything, { view: "school", seesMoney: true });
    expect(school.shown).toHaveLength(MAX_BADGES);
    expect(kinds(school.shown)).toEqual(["siblings", "new", "route"]);
    expect(kinds(school.more)).toEqual(["yearClear", "emi", "concession"]);
  });

  it("orders the Fees view by what the desk acts on, and leaves the route to its column", () => {
    const fees = studentBadges(everything, { view: "fees", seesMoney: true });
    expect(kinds(fees.shown)).toEqual(["emi", "yearClear", "concession"]);
    expect(kinds(fees.more)).toEqual(["siblings", "new", "attendance"]);
    expect(kinds([...fees.shown, ...fees.more])).not.toContain("route");
  });

  it("never makes a concession a School headline, even with room to spare", () => {
    const school = studentBadges(facts({ concessions: ["Staff Child"] }), { view: "school", seesMoney: true });
    expect(school.shown).toEqual([]);
    expect(school.more).toEqual([{ kind: "concession", tone: "mut", label: "Staff Child" }]);
  });

  it("gives a reader without fees:view no money badge at all, not even in details", () => {
    const plain = studentBadges(everything, { view: "fees", seesMoney: false });
    const all = kinds([...plain.shown, ...plain.more]);
    expect(all).not.toContain("yearClear");
    expect(all).not.toContain("emi");
    expect(all).not.toContain("concession");
    expect(all).toEqual(["siblings", "new", "route"]);
  });

  it("leaves attendance to the School view's own column", () => {
    const school = studentBadges(facts({ attendance: { credit: 5, counted: 6, pct: 83.3 } }), { view: "school", seesMoney: true });
    expect([...school.shown, ...school.more]).toEqual([]);
  });

  it("colours by meaning: green for clear, amber for due, red only for a missed EMI", () => {
    const tone = (status: "upcoming" | "on_track" | "due" | "behind" | "completed") =>
      studentBadges(facts({ emi: { status, monthly: 1000, nextDue: null } }), { view: "fees", seesMoney: true }).shown[0].tone;
    expect(tone("behind")).toBe("bad");
    expect(tone("due")).toBe("warn");
    expect(tone("completed")).toBe("ok");
    expect(tone("on_track")).toBe("mut");
    expect(tone("upcoming")).toBe("mut");
    expect(studentBadges(facts({ yearClear: true }), { view: "school", seesMoney: true }).shown[0].tone).toBe("ok");
    expect(studentBadges(facts({ siblings: 1 }), { view: "school", seesMoney: true }).shown[0].tone).toBe("mut");
  });

  it("says nothing it was not told: no facts, no badges", () => {
    expect(studentBadges(facts(), { view: "school", seesMoney: true })).toEqual({ shown: [], more: [] });
    expect(studentBadges(facts({ concessions: ["  "] }), { view: "fees", seesMoney: true })).toEqual({ shown: [], more: [] });
  });

  it("is predictable: the same facts give the same order every time", () => {
    const a = studentBadges(everything, { view: "school", seesMoney: true });
    const b = studentBadges({ ...everything }, { view: "school", seesMoney: true });
    expect(a).toEqual(b);
  });
});

describe("Students list: sorting, class search and money words (D01/F05)", () => {
  const row = (name: string, classLabel: string, pendingToday: number, notDueYet: number, percent: number, classOrder?: number) => ({
    name,
    classLabel,
    classOrder,
    money: { pendingToday, notDueYet, percent },
  });
  const rows = [row("Riya Singh", "Class 6", 6150, 12300, 25, 6), row("Aarav Sharma", "Class 7", 4200, 13200, 34, 7), row("Aarti Kumawat", "Class 10", 0, 0, 100, 10)];

  it("reads the sort from the URL, names A→Z and money largest first by default", () => {
    expect(parseStudentSort(undefined, undefined)).toEqual({ key: "name", dir: 1 });
    expect(parseStudentSort("pending", undefined)).toEqual({ key: "pending", dir: -1 });
    expect(parseStudentSort("class", "desc")).toEqual({ key: "class", dir: -1 });
    expect(parseStudentSort("nonsense", "asc")).toEqual({ key: "name", dir: 1 });
  });

  it("flips the same column and starts another in its own direction", () => {
    expect(nextSort({ key: "name", dir: 1 }, "name")).toEqual({ key: "name", dir: -1 });
    expect(nextSort({ key: "name", dir: 1 }, "pending")).toEqual({ key: "pending", dir: -1 });
  });

  it("sorts money only when the whole list is on the page", () => {
    expect(sortMode("pending", true)).toBe("page");
    expect(sortMode("pending", false)).toBeNull();
    expect(sortMode("class", false)).toBe("server");
    expect(sortMode("name", false)).toBe("server");
  });

  it("orders rows by the chosen column, keeping ties in the server's order", () => {
    expect(sortStudentRows(rows, { key: "name", dir: 1 }).map((r) => r.name)).toEqual(["Aarav Sharma", "Aarti Kumawat", "Riya Singh"]);
    expect(sortStudentRows(rows, { key: "pending", dir: -1 }).map((r) => r.name)).toEqual(["Riya Singh", "Aarav Sharma", "Aarti Kumawat"]);
    // School order, not the alphabet: Class 10 comes after Class 7.
    expect(sortStudentRows(rows, { key: "class", dir: 1 }).map((r) => r.classLabel)).toEqual(["Class 6", "Class 7", "Class 10"]);
    expect(sortStudentRows(rows, { key: "paid", dir: -1 })[0].name).toBe("Aarti Kumawat");
  });

  it("finds a class typed into the search box, and nothing else", () => {
    const classes = [
      { id: "c7", label: "Class 7" },
      { id: "c11s", label: "Class 11 Science" },
      { id: "ukg", label: "UKG" },
    ];
    expect(classFromQuery("Class 7", classes)?.id).toBe("c7");
    expect(classFromQuery("7", classes)?.id).toBe("c7");
    expect(classFromQuery("ukg", classes)?.id).toBe("ukg");
    expect(classFromQuery("11 science", classes)?.id).toBe("c11s");
    expect(classFromQuery("Aarav", classes)).toBeNull();
    expect(classFromQuery("1234", classes)).toBeNull();
    expect(classFromQuery("", classes)).toBeNull();
  });

  it("says pending today, on track or paid up, and never adds the late fee", () => {
    expect(moneyStatus({ pendingToday: 4200, notDueYet: 13200 })).toEqual({ kind: "pending", amount: 4200 });
    expect(moneyStatus({ pendingToday: 0, notDueYet: 9300 })).toEqual({ kind: "track", amount: 9300 });
    expect(moneyStatus({ pendingToday: 0, notDueYet: 0 })).toEqual({ kind: "paid" });
  });
});
