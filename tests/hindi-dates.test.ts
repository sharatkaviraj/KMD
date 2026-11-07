import { describe, expect, it } from "vitest";

import { hindiDates } from "@/platform/i18n/hindi-dates";
import { primary } from "@/platform/i18n/language";
import { dateLabel, dayMonth, longDay, shortDay, shortDayHi } from "@/vx/format";
import { lead, p, under } from "@/vx/text";

/**
 * A Hindi-only reader saw English dates on the office's screens (BrowserStack
 * check, 7 Nov 2026): "Sat 7 Nov · पीरियड 4 चल रहा है", "सबसे पुराना 10 Oct",
 * "Thu 15 Oct, 1:40 am". The Hindi line now says them in Hindi wherever they
 * were built.
 */
describe("hindiDates", () => {
  it("says the app's own English date shapes in Hindi", () => {
    expect(hindiDates("Sat 7 Nov · पीरियड 4 चल रहा है")).toBe("शनि 7 नवंबर · पीरियड 4 चल रहा है");
    expect(hindiDates("सबसे पुराना 10 Oct")).toBe("सबसे पुराना 10 अक्टूबर");
    expect(hindiDates("Thu 15 Oct, 1:40 am")).toBe("गुरु 15 अक्टूबर, रात 1:40");
    expect(hindiDates("Sat 10 Oct, 3:18 pm")).toBe("शनि 10 अक्टूबर, दोपहर 3:18");
    expect(hindiDates("आखिरी बैकअप 7 Nov 2026")).toBe("आखिरी बैकअप 7 नवंबर 2026");
    expect(hindiDates("प्रथम सतत मूल्यांकन 13–17 Aug")).toBe("प्रथम सतत मूल्यांकन 13–17 अगस्त");
    expect(hindiDates("23 Sept – 3 Oct")).toBe("23 सितंबर – 3 अक्टूबर");
    expect(hindiDates("Wed 7 – Thu 8 Oct")).toBe("बुध 7 – गुरु 8 अक्टूबर");
    expect(hindiDates("Thursday, 8 October")).toBe("गुरुवार, 8 अक्टूबर");
    expect(hindiDates("अक्टूबर 2026 · October 2026")).toBe("अक्टूबर 2026 · अक्टूबर 2026");
    expect(hindiDates("20 Apr से बकाया")).toBe("20 अप्रैल से बकाया");
    expect(hindiDates("7th November")).toBe("7 नवंबर");
    expect(hindiDates("वार्षिक परीक्षा · Mar 2027")).toBe("वार्षिक परीक्षा · मार्च 2027");
  });

  it("puts the part of the day before a clock time", () => {
    expect(hindiDates("8:52 am")).toBe("सुबह 8:52");
    expect(hindiDates("12:05 am")).toBe("रात 12:05");
    expect(hindiDates("12:30 pm")).toBe("दोपहर 12:30");
    expect(hindiDates("5:30 PM")).toBe("शाम 5:30");
    expect(hindiDates("10:59 pm")).toBe("रात 10:59");
  });

  it("matches what the English helpers print", () => {
    const day = "2026-11-07";
    expect(hindiDates(shortDay(day))).toBe(shortDayHi(day));
    expect(hindiDates(dayMonth(day))).toBe("7 नवंबर");
    expect(hindiDates(dateLabel(day))).toBe("7 नवंबर 2026");
    expect(hindiDates(longDay(day))).toBe("शनिवार, 7 नवंबर");
  });

  it("leaves everything that is not a date alone", () => {
    for (const text of [
      "Class 8 A · 21 में से 21",
      "Maya Sharma · TEST-2026-27",
      "May the best class win",
      "Marks 12 · Saturday club",
      "Period 4 · P4 · 09:20",
      "₹4,05,399 · 24 दिन",
      "Mon",
      "Sun Public School",
      "Inst 4: ₹4,000",
      "",
    ]) {
      expect(hindiDates(text)).toBe(text);
    }
  });

  it("is idempotent", () => {
    const once = hindiDates("Sat 7 Nov, 10:38 am · 23 Sept – 3 Oct");
    expect(hindiDates(once)).toBe(once);
  });
});

describe("the line a reader leads with", () => {
  const pair = p(`Last changed ${shortDay("2026-11-07")}`, `आखिरी बदलाव ${shortDay("2026-11-07")}`);

  it("says a Hindi reader's dates in Hindi", () => {
    expect(lead(pair, "hi")).toBe("आखिरी बदलाव शनि 7 नवंबर");
    expect(lead(dayMonth("2026-10-10"), "hi")).toBe("10 अक्टूबर");
    expect(primary({ en: "Fri 6 Nov", hi: "Fri 6 Nov" }, "hi")).toBe("शुक्र 6 नवंबर");
  });

  it("leaves English readers' dates in English", () => {
    expect(lead(pair, "en")).toBe("Last changed Sat 7 Nov");
    expect(lead(pair, "both")).toBe("Last changed Sat 7 Nov");
    expect(primary({ en: "Fri 6 Nov", hi: "Fri 6 Nov" }, "en")).toBe("Fri 6 Nov");
  });

  it("gives a reader of both the Hindi line in Hindi", () => {
    expect(under(pair, "both")).toBe("आखिरी बदलाव शनि 7 नवंबर");
    expect(primary({ en: "Fri 6 Nov", hi: "शुक्रवार Fri 6 Nov" }, "both")).toBe("शुक्रवार शुक्र 6 नवंबर");
  });
});
