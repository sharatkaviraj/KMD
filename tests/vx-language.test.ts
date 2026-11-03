import { describe, expect, it } from "vitest";

import {
  agoP,
  atTimeP,
  countOfP,
  dateLabelP,
  dayMonthP,
  longDayP,
  monthP,
  shortDayP,
  timeHi,
  timeP,
  weekdayLetterP,
} from "@/vx/format";
import { ampmP, dShortP, whenSent } from "@/vx/screens/teach/ui/fmt";
import { LANGUAGE_CHOICES, lead, outOf, p, under } from "@/vx/text";

/* Smoke 20 Oct, dev.groups[10]: the vx words for a Hindi reader. */

describe("under(): the second line", () => {
  const pair = p("Attendance", "हाज़िरी");

  it("gives a Hindi-only reader no English line", () => {
    expect(lead(pair, "hi")).toBe("हाज़िरी");
    expect(under(pair, "hi")).toBeNull();
  });

  it("keeps the Hindi under the English for a reader of both", () => {
    expect(lead(pair, "both")).toBe("Attendance");
    expect(under(pair, "both")).toBe("हाज़िरी");
  });

  it("gives an English reader one line", () => {
    expect(under(pair, "en")).toBeNull();
  });
});

describe("the language control", () => {
  it("offers all three stored values, so trying it never loses 'both'", () => {
    expect(LANGUAGE_CHOICES.map((c) => c.value)).toEqual(["en", "hi", "both"]);
  });
});

describe("X of Y in Hindi word order", () => {
  it("puts the whole first", () => {
    expect(outOf(12, 27)).toEqual({ en: "12 of 27", hi: "27 में से 12" });
    expect(outOf(12, 27, p("children", "बच्चों"))).toEqual({ en: "12 of 27 children", hi: "27 बच्चों में से 12" });
    expect(countOfP(3, 14)).toEqual({ en: "3 of 14", hi: "14 में से 3" });
  });
});

describe("Hindi dates", () => {
  it("writes day, weekday and month names in Hindi", () => {
    expect(shortDayP("2026-10-19")).toEqual({ en: "Mon 19 Oct", hi: "सोम 19 अक्टूबर" });
    expect(longDayP("2026-10-19").hi).toBe("सोमवार, 19 अक्टूबर");
    expect(dayMonthP("2026-10-19").hi).toBe("19 अक्टूबर");
    expect(dateLabelP("2026-02-01").hi).toBe("1 फ़रवरी 2026");
    expect(monthP("2026-10")).toEqual({ en: "October", hi: "अक्टूबर" });
    expect(weekdayLetterP("2026-10-19")).toEqual({ en: "M", hi: "सो" });
    expect(dShortP("2026-10-18").hi).toBe("रवि 18 अक्टूबर");
  });

  it("keeps a bare date on its own day in the school's time zone", () => {
    expect(shortDayP("2026-10-20").hi).toBe("मंगल 20 अक्टूबर");
    expect(dayMonthP(null).hi).toBe("—");
  });

  it("says an old date in Hindi when it is 'ago'", () => {
    const now = new Date("2026-10-20T12:00:00+05:30");
    expect(agoP("2026-10-08T09:00:00+05:30", now).hi).toBe("8 अक्टूबर");
  });
});

describe("Hindi times", () => {
  it("puts the part of the day first and never says am or pm", () => {
    expect(timeHi("2026-10-19T22:59:00+05:30")).toBe("रात 10:59");
    expect(timeHi("2026-10-19T08:52:00+05:30")).toBe("सुबह 8:52");
    expect(timeHi("13:30")).toBe("दोपहर 1:30");
    expect(timeHi("17:15")).toBe("शाम 5:15");
    expect(timeHi("00:30")).toBe("रात 12:30");
    expect(timeHi("12:05")).toBe("दोपहर 12:05");
    expect(timeP("2026-10-19T22:59:00+05:30")).toEqual({ en: "10:59 pm", hi: "रात 10:59" });
  });

  it("puts बजे after the time, never after pm", () => {
    const at = atTimeP("2026-10-19T22:59:00+05:30");
    expect(at).toEqual({ en: "at 10:59 pm", hi: "रात 10:59 बजे" });
    expect(at.hi).not.toMatch(/am|pm/);
    expect(ampmP("2026-10-19T08:10:00+05:30")).toEqual({ en: "8:10 am", hi: "सुबह 8:10" });
  });

  it("says when a notice was sent in Hindi", () => {
    expect(whenSent("2026-10-20T08:10:00+05:30", "2026-10-20")).toEqual({ en: "Today · 8:10 am", hi: "आज · सुबह 8:10" });
    expect(whenSent("2026-10-19T16:30:00+05:30", "2026-10-20").hi).toBe("कल · शाम 4:30");
    expect(whenSent("2026-10-12T16:30:00+05:30", "2026-10-20")).toEqual({ en: "Mon 12 Oct", hi: "सोम 12 अक्टूबर" });
  });
});
