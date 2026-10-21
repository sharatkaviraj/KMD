import { describe, expect, it } from "vitest";

import { closedWhy, dayRuns, lastOpenDay, openOn, unmarkedDays, type CalendarNote } from "@/modules/attendance/domain/register-day";
import {
  absentAlert,
  alertsDefault,
  childMatches,
  classLabelP,
  dayLongP,
  dayShortP,
  devToLatin,
  draftChanges,
  halfDaySwap,
  monthTitleP,
  nameKey,
  nextTap,
  shownSr,
  tellApart,
  timeP,
} from "@/vx/screens/teach/domain/teach";

/*
 * The register's rules behind the 20 Oct 2026 smoke run's attendance
 * findings. Synthetic names only.
 */

describe("taps: a second tap undoes the first", () => {
  it("toggles present and absent, and half-day is its own choice", () => {
    expect(nextTap(nextTap("present"))).toBe("present");
    expect(halfDaySwap("absent")).toBe("half_day");
    expect(halfDaySwap("half_day")).toBe("absent");
    expect(halfDaySwap("leave")).toBe("absent");
    expect(nextTap("half_day")).toBe("present");
  });
});

describe("finding a child on the register", () => {
  const kid = (name: string, rollNo: string | null = null, serial: number | null = null, admissionNo: string | null = null) => ({ name, rollNo, serial, admissionNo });

  it("finds the number on the card when the class has no roll numbers", () => {
    expect(childMatches(kid("Ishaan Namuna", null, 13), "13")).toBe(true);
    expect(childMatches(kid("Ishaan Namuna", null, 12), "13")).toBe(false);
    expect(childMatches(kid("Ishaan Namuna", "13", 2), "13")).toBe(true);
    // A real roll number wins over the place in the list.
    expect(childMatches(kid("Ishaan Namuna", "7", 13), "13")).toBe(false);
  });

  it("forgives a small spelling slip", () => {
    expect(childMatches(kid("Ishaan Namuna"), "Ishan")).toBe(true);
    expect(childMatches(kid("Ishaan Namoona"), "namuna")).toBe(true);
    expect(childMatches(kid("Kabir Jaanch"), "kabeer")).toBe(true);
    expect(childMatches(kid("Tanmay Devdas"), "tanmy")).toBe(true);
  });

  it("finds a name typed in Hindi letters", () => {
    expect(childMatches(kid("Ishaan Namuna"), "ईशान")).toBe(true);
    expect(childMatches(kid("Dhruv Anumaan"), "ध्रुव")).toBe(true);
    expect(childMatches(kid("Ansh Praroop"), "अंश")).toBe(true);
    expect(childMatches(kid("Raghav Jaanch"), "राघव")).toBe(true);
  });

  it("still tells different names apart", () => {
    expect(childMatches(kid("Ansh Namoona"), "rudra")).toBe(false);
    expect(childMatches(kid("Sai Prayog"), "ishaan")).toBe(false);
    expect(childMatches(kid("Ansh Namoona"), "namoona ansh")).toBe(true);
  });

  it("writes Hindi letters as the English a school would store", () => {
    expect(devToLatin("ईशान")).toBe("eeshaan");
    expect(devToLatin("ध्रुव")).toBe("dhruv");
    expect(nameKey("Ishaan")).toBe(nameKey("ईशान"));
  });
});

describe("placeholder SR numbers are never shown", () => {
  it("hides the office's PENDING placeholder", () => {
    expect(shownSr("PENDING-SR-4312")).toBeNull();
    expect(shownSr("1201")).toBe("1201");
    const apart = tellApart([
      { id: "a", name: "Ansh Test", admissionNo: "PENDING-SR-1", fatherName: "Father One" },
      { id: "b", name: "Ansh Test", admissionNo: "4401", fatherName: null },
    ]);
    expect(apart.get("a")?.en).toBe("father Father One");
    expect(apart.get("b")?.en).toBe("SR 4401");
  });
});

describe("the parent message says the right day", () => {
  it("says today only for today", () => {
    const text = absentAlert({ childName: "Test Child", classLabel: "Class 4", school: "VPPS", day: "2026-10-20", today: "2026-10-20" });
    expect(text.en).toContain("is absent from school today, Tuesday 20 October");
    expect(text.hi).toContain("आज मंगलवार 20 अक्टूबर");
    expect(text.hi).toContain("कक्षा 4");
  });

  it("says 'was absent on' for a past day, never 'today'", () => {
    const text = absentAlert({ childName: "Test Child", classLabel: "Class 4", school: "VPPS", day: "2026-10-19", today: "2026-10-20" });
    expect(text.en).toContain("was absent from school on Monday 19 October");
    expect(text.en).not.toContain("today");
    expect(text.hi).toContain("सोमवार 19 अक्टूबर को स्कूल नहीं आए थे");
    expect(text.hi).not.toContain("आज");
  });
});

describe("days and times in each reader's language", () => {
  it("writes the day, month and time in Hindi for a Hindi reader", () => {
    expect(dayShortP("2026-10-19")).toEqual({ en: "Mon 19 Oct", hi: "सोम 19 अक्टूबर" });
    expect(dayLongP("2026-10-20")).toEqual({ en: "Tuesday 20 October", hi: "मंगलवार 20 अक्टूबर" });
    expect(monthTitleP("2026-10")).toEqual({ en: "October 2026", hi: "अक्टूबर 2026" });
    expect(classLabelP("Class 2").hi).toBe("कक्षा 2");
  });

  it("keeps am/pm, and says the part of the day in Hindi", () => {
    // 17:32 UTC is 11:02 pm in the school's timezone.
    expect(timeP("2026-10-20T17:32:00Z")).toEqual({ en: "11:02 pm", hi: "रात 11:02" });
    expect(timeP("2026-10-20T03:22:00Z")).toEqual({ en: "8:52 am", hi: "सुबह 8:52" });
  });
});

describe("the parent WhatsApp switch", () => {
  it("starts on only for the first save of today's register", () => {
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0 })).toBe(true);
    expect(alertsDefault({ mode: "mark", isToday: false, queued: 0 })).toBe(false);
  });

  it("does not come back on for a correction the teacher sent no messages for", () => {
    expect(alertsDefault({ mode: "change", isToday: true, queued: 0 })).toBe(false);
    // Messages still waiting stay waiting unless she turns them off.
    expect(alertsDefault({ mode: "change", isToday: true, queued: 2 })).toBe(true);
  });

  it("keeps whatever the teacher chose", () => {
    expect(alertsDefault({ mode: "mark", isToday: true, queued: 0, chosen: false })).toBe(false);
    expect(alertsDefault({ mode: "change", isToday: false, queued: 0, chosen: true })).toBe(true);
  });
});

describe("a kept draft", () => {
  it("is offered back only where it differs from the register", () => {
    expect(draftChanges(["a", "b", "c"], { a: "present", b: "absent" }, { a: "absent", b: "absent", c: "present" })).toEqual(["a"]);
    expect(draftChanges(["a"], { a: "present" }, { a: "present" })).toEqual([]);
  });
});

describe("why a day has no register", () => {
  const notes = new Map<string, CalendarNote>([
    ["2026-10-20", { kind: "holiday", en: "Dussehra", hi: "दशहरा" }],
    ["2026-10-02", { kind: "holiday", en: null, hi: null }],
    ["2026-10-24", { kind: "exam", en: "Unit test", hi: null }],
  ]);

  it("names the holiday, Sunday or a day to come", () => {
    expect(closedWhy("2026-10-20", "2026-10-20", notes)).toEqual({ kind: "holiday", en: "Dussehra", hi: "दशहरा" });
    expect(closedWhy("2026-10-18", "2026-10-20", notes)).toEqual({ kind: "sunday" });
    expect(closedWhy("2026-10-22", "2026-10-20", notes)).toEqual({ kind: "future" });
    expect(closedWhy("2026-10-19", "2026-10-20", notes)).toBeNull();
    expect(openOn("2026-10-24", notes)).toBe(true);
  });

  it("finds the last open day to offer instead", () => {
    expect(lastOpenDay("2026-10-20", notes)).toBe("2026-10-19");
    expect(lastOpenDay("2026-10-19", notes)).toBe("2026-10-19");
    // Sunday 18 → Saturday 17.
    expect(lastOpenDay("2026-10-18", notes)).toBe("2026-10-17");
  });

  it("lists the school days not yet marked, and reads them as runs", () => {
    const marked = new Set(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-19"]);
    const owed = unmarkedDays({ month: "2026-10", today: "2026-10-19", notes, marked, since: "2026-10-05" });
    expect(owed).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(dayRuns(owed, notes)).toEqual([{ from: "2026-10-12", to: "2026-10-17", count: 6 }]);
    // Sunday inside a run does not split it.
    expect(dayRuns(["2026-10-17", "2026-10-19"], notes)).toEqual([{ from: "2026-10-17", to: "2026-10-19", count: 2 }]);
  });
});
