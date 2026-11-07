import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { subjectNamer, subjectPair, subjectWords } from "@/vx/screens/exams/domain/groups";
import { subjectName } from "@/vx/screens/academics/domain";
import { filledNotSent, linkStanding, marksTileLine, subjectWord } from "@/vx/screens/teach/domain/today";

/*
 * Second pass over the teacher screens on a 360 px phone (polish thread,
 * 7 Nov 2026, D-524 to D-526).
 *
 * One lesson was "कक्षा 1 · ELGA" on Today, "Class 1 ELGA" on My subjects and
 * "कक्षा 1 · अंग्रेज़ी भाषा" on its marks card, because Today read the subject
 * list (which carries an English copy as most subjects' Hindi name) and the
 * marks cards read the word list. Today also said "Mathematics" where Marks
 * said "Maths", and the profile showed the code "MATHS". A paper with every
 * mark in but never sent read "Nothing waiting" on More and "All 5 done ✓" on
 * Today.
 */

const read = (rel: string) => readFileSync(path.resolve(process.cwd(), rel), "utf8");

/** The school's subject list as it stands: one typed Hindi name, the rest English copied across. */
const CODES = [
  "Accountancy", "Biology", "Business Studies", "CCS", "Chemistry", "Economics", "ELGA", "Eng Lit", "English", "EVS",
  "General Studies", "Geography", "Hindi", "MATHS", "NoteBook Checking", "Physics", "Political Science", "Robotics",
  "Sanskrit", "Science", "Self Study", "Sports", "SST",
];
const LIST = CODES.map((code) =>
  code === "MATHS" ? { code, nameEn: "Mathematics", nameHi: "गणित" } : { code, nameEn: code, nameHi: code },
);

describe("one name per subject, the same on every teacher screen (D-524)", () => {
  const named = subjectNamer(LIST);

  it("names every subject on the list exactly as the marks cards do", () => {
    for (const code of CODES) {
      const card = subjectPair(code);
      expect(named(code)).toEqual({ en: card.en, hi: card.hi ?? card.en });
    }
  });

  it("never puts the English copy in the Hindi line when the word list knows the subject", () => {
    expect(named("ELGA")).toEqual({ en: "ELGA", hi: "अंग्रेज़ी भाषा" });
    expect(named("EVS")).toEqual({ en: "EVS", hi: "पर्यावरण" });
    expect(named("SST")).toEqual({ en: "Social Sci.", hi: "सामाजिक विज्ञान" });
    expect(named("NoteBook Checking")).toEqual({ en: "NoteBook Checking", hi: "कॉपी जाँच" });
  });

  it("names the timetable's 'Maths' and the list's 'MATHS' the same way, as Marks does", () => {
    expect(named("Maths")).toEqual({ en: "Maths", hi: "गणित" });
    expect(named("MATHS")).toEqual({ en: "Maths", hi: "गणित" });
    expect(named("maths")).toEqual(named("MATHS"));
  });

  it("says ELGA as letters, never 'Elga'", () => {
    expect(subjectName("ELGA")).toBe("ELGA");
    // The capitals rule still reads a code kept in capitals as a word.
    expect(subjectName("HINDI")).toBe("Hindi");
  });

  it("takes a name typed in Hindi for a subject the word list does not know", () => {
    expect(subjectWords("Music", { en: "Music", hi: "संगीत" })).toEqual({ en: "Music", hi: "संगीत" });
    expect(subjectWords("Music", { en: "Music", hi: "Music" })).toEqual({ en: "Music", hi: "Music" });
  });

  it("uses the school's own English name only where the rule has nothing better than the code", () => {
    // A code the rule leaves as it is, with a real name typed beside it.
    expect(subjectWords("PHE", { en: "Physical Education", hi: "PHE" })).toEqual({ en: "Physical Education", hi: "शारीरिक शिक्षा" });
    // "MATHS" has the rule's "Maths", so the typed "Mathematics" does not split it from the marks screens.
    expect(subjectWords("MATHS", { en: "Mathematics", hi: "गणित" })).toEqual({ en: "Maths", hi: "गणित" });
  });

  it("never names a subject with nothing", () => {
    expect(subjectWords("")).toEqual({ en: "—", hi: "—" });
    expect(named("Unknown thing")).toEqual({ en: "Unknown thing", hi: "Unknown thing" });
  });

  it("More's names match a code without case, and name an unknown code by the same rule", () => {
    const names = new Map(Object.entries(Object.fromEntries(LIST.map((s) => [s.code, subjectWords(s.code, { en: s.nameEn, hi: s.nameHi })]))));
    expect(subjectWord("Maths", names)).toEqual({ en: "Maths", hi: "गणित" });
    expect(subjectWord("ELGA", names)).toEqual({ en: "ELGA", hi: "अंग्रेज़ी भाषा" });
    expect(subjectWord("Sanskrit", new Map())).toEqual({ en: "Sanskrit", hi: "संस्कृत" });
  });

  it("is what the teacher screens read, not the list's own Hindi column", () => {
    const data = read("src/vx/screens/teach/data.ts");
    expect(data).not.toMatch(/nameHi \|\| [a-z.]*nameEn/);
    expect(data).not.toMatch(/nameHi \|\| s\.nameEn/);
    expect(data).toContain("const named = subjectNamer(subjectList);");
    expect(data).toContain("const named = subjectNamer(subjects);");
    expect(data).toContain("subjectWords(s.code, { en: s.nameEn, hi: s.nameHi })");
    const cls = read("src/vx/screens/teach/ui/class.tsx");
    // "Latest marks · average per subject" listed "MATHS".
    expect(cls).toContain("{tx(subjectWords(s.code))}");
    expect(cls).toContain("subj: tx(p(x.subjectName, x.subjectHi))");
    expect(cls).toContain("{tx(classSubject(s.classLabel, p(s.name, s.nameHi)))}");
    // The profile's subject chips showed the codes.
    expect(read("src/vx/screens/teach/ui/more.tsx")).toContain("{subj(s)}</span>)}");
  });
});

describe("a filled paper is not sent (D-525)", () => {
  it("tells the five states of a marks link apart", () => {
    expect(linkStanding({ entered: 5, total: 5, submitted: true })).toBe("sent");
    expect(linkStanding({ entered: 0, total: 0, submitted: true })).toBe("sent");
    expect(linkStanding({ entered: 3, total: 5, submitted: true })).toBe("sentBlank");
    expect(linkStanding({ entered: 5, total: 5, submitted: false })).toBe("filled");
    expect(linkStanding({ entered: 2, total: 5, submitted: false })).toBe("started");
    expect(linkStanding({ entered: 0, total: 5, submitted: false })).toBe("none");
    expect(linkStanding({ entered: 0, total: 0, submitted: false })).toBe("none");
  });

  it("the Marks tile counts papers filled and not sent, never 'Nothing waiting' over them", () => {
    expect(marksTileLine(null, 0, 1)).toEqual({ en: "1 paper filled, not sent", hi: "1 पेपर भरा, भेजा नहीं" });
    expect(marksTileLine(null, 0, 2)).toEqual({ en: "2 papers filled, not sent", hi: "2 पेपर भरे, भेजे नहीं" });
    expect(marksTileLine({ classLabel: "Class 7", entered: 3, total: 20 }, 1, 1).en).toBe("Class 7 · 3 of 20 entered · 1 paper filled, not sent · 1 report-card remark to write");
    expect(marksTileLine(null, 0).en).toBe("Nothing waiting");
    expect(filledNotSent(3).hi).toBe("3 पेपर भरे, भेजे नहीं");
  });

  it("Today's link card, the subject cards and More's links all ask for the send", () => {
    const home = read("src/vx/screens/teach/ui/home.tsx");
    expect(home).toContain('case "filled": return [V("warn"), tx(p("Filled · not sent", "भरे · भेजे नहीं")), V("warnfg")];');
    expect(home).not.toContain("All ${total} done ✓");
    expect(home).toContain('tx(p("Open, check and send", "खोलें, जाँचें और भेजें"))');
    expect(read("src/vx/screens/teach/ui/class.tsx")).toContain('tx(p("All entered · not sent", "सब भरे · भेजे नहीं"))');
    const more = read("src/vx/screens/teach/ui/more.tsx");
    expect(more).toContain("marksTileLine(firstOpen, data.remarks, unsent)");
    expect(more).toContain('standing === "filled" ? [p("Filled · not sent", "भरे · भेजे नहीं")');
  });
});

describe("words that fit a 360 px phone (D-526)", () => {
  it("lets the centre tab's word use its neighbours' empty space", () => {
    const bar = read("src/vx/shell/bottom-bar.tsx");
    expect(bar).toContain('const CENTER_LABEL = { maxWidth: "calc(100% + 24px)"');
    expect(bar.match(/style=\{CENTER_LABEL\}/g)).toHaveLength(2);
  });

  it("gives the top bar's line and a child's name two lines before cutting them", () => {
    expect(read("src/vx/screens/teach/ui/tch.css")).toContain(".tc-el2{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2");
    expect(read("src/vx/screens/teach/ui/shared.tsx")).toContain('<span className="tc-s tc-el2">{mSub}</span>');
    expect(read("src/vx/screens/teach/ui/attend.tsx")).toContain('<span className="tc-el2" style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>{r.name}</span>');
  });

  it("says how many subjects and classes under 'My subjects', and lists them on the page", () => {
    const cls = read("src/vx/screens/teach/ui/class.tsx");
    expect(cls).toContain("`${subjects} विषय · ${classes} ${classes === 1 ? \"कक्षा\" : \"कक्षाएँ\"}`");
    expect(cls).toContain("mSub={tx(subjectsLine(data.mySubjects))}");
  });
});
