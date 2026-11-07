import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { assistChain, OPEN_TASKS, TASK_TIER } from "@/modules/assist/domain/routes";
import { ASSIST_TASKS } from "@/modules/assist/domain/tasks";
import {
  chipNames,
  childrenNamedIn,
  localSort,
  mergeSort,
  nameWordsIn,
  otherChildNamed,
  sameTags,
  searchKids,
  spellingKey,
  suggestFollow,
  tidyWorthOffering,
} from "@/vx/screens/notes/domain/cards";
import { suggestTags } from "@/vx/screens/notes/domain/notes";

/* Test data only (rule 6): every name below is invented. */

const kid = (id: string, name: string, classId = "c6", rollNo: string | null = null) => ({ id, name, classId, rollNo });
const KIDS = [
  kid("a", "Aarav Qatest", "c6", "1"),
  kid("b", "Riya Qatest", "c6", "2"),
  kid("c", "Kabir Qatest", "c6", "3"),
  kid("d", "Riya Testwal", "c6", "4"),
  kid("e", "Aarav Testwal", "c7", "1"),
  kid("f", "Om Qatest", "c6", "5"),
  kid("g", "Diya Qatest", "c6", "6"),
];
const ids = (list: readonly { id: string }[]) => list.map((k) => k.id);

describe("picking the child (D-486)", () => {
  it("finds a child typed in English, in Hindi or by roll number, this class first", () => {
    expect(ids(searchKids(KIDS, "c6", "aarav").here)).toEqual(["a"]);
    expect(ids(searchKids(KIDS, "c6", "aarav").elsewhere)).toEqual(["e"]);
    expect(ids(searchKids(KIDS, "c6", "आरव").here)).toEqual(["a"]);
    expect(ids(searchKids(KIDS, "c6", "आरव").elsewhere)).toEqual(["e"]);
    expect(ids(searchKids(KIDS, "c6", "रिया").here)).toEqual(["b", "d"]);
    expect(ids(searchKids(KIDS, "c6", "3").here)).toEqual(["c"]);
    expect(ids(searchKids(KIDS, "c6", "").here)).toEqual(ids(KIDS.filter((k) => k.classId === "c6")));
  });

  it("names a chip by the first name, and adds the surname's initial only for two of the same name", () => {
    const names = chipNames(KIDS);
    expect(names.get("c")).toBe("Kabir");
    expect(names.get("b")).toBe("Riya Q.");
    expect(names.get("d")).toBe("Riya T.");
    // An Aarav in another class is not a twin on this class's chips.
    expect(names.get("a")).toBe("Aarav");
  });

  it("writes the whole name when even the initial is shared", () => {
    const names = chipNames([kid("x", "Riya Qatest"), kid("y", "Riya Quill"), kid("z", "Riya")]);
    expect(names.get("x")).toBe("Riya Qatest");
    expect(names.get("y")).toBe("Riya Quill");
    expect(names.get("z")).toBe("Riya");
  });
});

describe("a note that names another child (D-486)", () => {
  it("spells a name the same in either script and with long or short vowels", () => {
    expect(spellingKey("Aarav")).toBe("arav");
    expect(spellingKey("Arav")).toBe("arav");
    expect(spellingKey("आरव")).toBe("arav");
    expect(spellingKey("Kabeer")).toBe(spellingKey("Kabir"));
  });

  it("asks when the words name a classmate and not the child picked", () => {
    const riya = KIDS[1];
    expect(ids(otherChildNamed("Aarav pushed Kabir in the line", riya, KIDS))).toEqual(["a", "c"]);
    expect(ids(otherChildNamed("आरव ने आज होमवर्क नहीं किया", riya, KIDS))).toEqual(["a"]);
  });

  it("does not ask when the picked child is named too, or when nobody is", () => {
    const riya = KIDS[1];
    expect(otherChildNamed("Riya and Aarav fought over a seat", riya, KIDS)).toEqual([]);
    expect(otherChildNamed("Finds fractions hard, needs practice", riya, KIDS)).toEqual([]);
    // Riya Testwal shares the picked child's first name: not "another" child.
    expect(otherChildNamed("Riya was quiet today", KIDS[3], KIDS)).toEqual([]);
  });

  it("reads only the picked child's own class", () => {
    const kabir = KIDS[2];
    // The only other Aarav is in c7; the c6 Aarav is found, the c7 one never.
    expect(ids(otherChildNamed("Aarav took his pencil", kabir, KIDS))).toEqual(["a"]);
  });

  it("never takes an everyday word or a short name for a child", () => {
    const riya = KIDS[1];
    // "दिया" is "gave", not Diya; "Om" is too short to tell from a word.
    expect(otherChildNamed("उसने आज होमवर्क दिया", riya, KIDS)).toEqual([]);
    expect(otherChildNamed("Om shanti, a calm day", riya, KIDS)).toEqual([]);
    expect(childrenNamedIn("happy and sunny all day", [kid("h", "Happy Qatest"), kid("s", "Sunny Qatest")])).toEqual([]);
  });

  it("gives back every name word as written, in both scripts, for the AI to mask (D-326)", () => {
    expect(nameWordsIn("आरव and Kabir and Aarav", KIDS).sort()).toEqual(["Aarav", "Kabir", "आरव"].sort());
    expect(nameWordsIn("रिया was quiet", KIDS)).toEqual(["रिया"]);
    // Masking spends a word rather than risk a name: a classmate called Diya hides "दिया" too.
    expect(nameWordsIn("उसने दिया", KIDS)).toEqual(["दिया"]);
    expect(nameWordsIn("Finds fractions hard", KIDS)).toEqual([]);
  });
});

describe("sorting the words before any AI (D-487)", () => {
  it("reads what the note is about in Hindi and English", () => {
    expect(suggestTags("Homework not done again")).toEqual(["studies"]);
    expect(suggestTags("गृहकार्य नहीं किया")).toEqual(["studies"]);
    expect(suggestTags("Fought with a classmate at lunch")).toEqual(["behaviour"]);
    expect(suggestTags("बुखार है, घर भेजा")).toEqual(["health"]);
    expect(suggestTags("Won the drawing competition")).toEqual(["talent"]);
    expect(suggestTags("Came late three days this week")).toEqual(["attendance"]);
  });

  it("matches English whole words, so missing is not sing and support is not sport", () => {
    expect(suggestTags("Missing her notebook")).toEqual(["studies"]);
    expect(suggestTags("Needs support")).toEqual([]);
  });

  it("does not file a note as family because it says to talk to the parents", () => {
    expect(suggestTags("Talk to the parents about the marks")).toEqual(["studies"]);
    expect(suggestTags("माता-पिता से बात करें")).toEqual([]);
    expect(suggestTags("Father passed away last week")).toEqual(["family"]);
  });

  it("turns a note into a follow-up only for words that ask for one", () => {
    expect(suggestFollow("Call the parents about this")).toBe("next_monday");
    expect(suggestFollow("माता-पिता से बात करें")).toBe("next_monday");
    expect(suggestFollow("Hurt his knee, check again tomorrow")).toBe("tomorrow");
    expect(suggestFollow("Keep an eye on her this week")).toBe("one_week");
    expect(suggestFollow("Did very well in the test")).toBeNull();
    // "कल" is yesterday as often as tomorrow: never a follow-up on its own.
    expect(suggestFollow("कल स्कूल नहीं आया")).toBeNull();
    expect(localSort("Seems unwell, call the mother")).toEqual({ tags: ["health"], follow: "next_monday" });
  });
});

describe("the AI's sort laid over the words' (D-487)", () => {
  const words = { tags: ["health" as const], follow: null };

  it("takes the AI's known tags, at most two, and its follow-up", () => {
    expect(mergeSort({ tags: ["studies"], follow: null }, { tags: ["behaviour", "made-up", "talent", "studies"], followUp: "one_week" })).toEqual({ tags: ["behaviour", "talent"], follow: "one_week" });
    expect(mergeSort({ tags: ["studies"], follow: "next_monday" }, { tags: ["studies"], followUp: "none" })).toEqual({ tags: ["studies"], follow: null });
  });

  it("keeps the words' tags when the AI found none it knows", () => {
    expect(mergeSort({ tags: ["studies"], follow: null }, { tags: ["made-up"], followUp: "none" }).tags).toEqual(["studies"]);
    expect(mergeSort({ tags: ["studies"], follow: "tomorrow" }, null)).toEqual({ tags: ["studies"], follow: "tomorrow" });
  });

  it("never drops a health or family tag the words found, so the readers never widen", () => {
    expect(mergeSort(words, { tags: ["behaviour"], followUp: "tomorrow" }).tags).toEqual(["behaviour", "health"]);
  });

  it("offers clearer wording only when it says something different", () => {
    expect(tidyWorthOffering("homework not done", "Homework not done.")).toBe(false);
    expect(tidyWorthOffering("homwork not don", "Homework not done.")).toBe(true);
    expect(tidyWorthOffering("homework not done", "")).toBe(false);
    expect(sameTags(["studies", "health"], ["health", "studies"])).toBe(true);
    expect(sameTags(["studies"], ["studies", "health"])).toBe(false);
  });
});

describe("the note.sort task (D-487)", () => {
  const spec = ASSIST_TASKS["note.sort"];
  const base = { text: "aaj homework nahi laya, mummy se baat karni hai", tags: [{ code: "studies", label: "Studies" }, { code: "family", label: "Family" }], childName: "Riya Qatest", names: ["आरव"], language: "en" as const };

  it("keeps only the screen's own tags, two at most, and clips the wording", () => {
    const input = spec.input.parse(base);
    const out = spec.finish!({ tags: ["studies", "made-up", "studies", "family", "health"], followUp: "next_monday", tidy: `  ${"x".repeat(2100)}  ` }, input);
    expect(out).toMatchObject({ tags: ["studies", "family"], followUp: "next_monday" });
    expect(out?.tidy.length).toBe(2000);
    expect(out?.tidy.endsWith("…")).toBe(true);
  });

  it("writes a Hindi reader's wording in Hindi, and masks every name it was given", () => {
    expect(spec.prompt(spec.input.parse({ ...base, language: "hi" }))).toContain("Hindi");
    expect(spec.prompt(spec.input.parse(base))).toContain("the teacher's own language");
    expect(spec.names!(spec.input.parse(base))).toEqual(["Riya Qatest", "आरव"]);
  });

  it("refuses input the screen should never send", () => {
    expect(spec.input.safeParse({ ...base, text: "x".repeat(2001) }).success).toBe(false);
    expect(spec.input.safeParse({ ...base, names: Array.from({ length: 13 }, (_, i) => `n${i}`) }).success).toBe(false);
  });

  it("is a quick task that never goes to the free key, because a note carries a child (D-401)", () => {
    expect(TASK_TIER["note.sort"]).toBe("quick");
    expect(OPEN_TASKS.has("note.sort")).toBe(false);
    const all = { anthropic: true, openai: true, geminiPaidModel: "gemini-3.5-flash-lite", geminiFreeModel: "gemini-3.5-flash-lite" };
    expect(assistChain("note.sort", all).some((s) => s.provider === "gemini-free")).toBe(false);
  });
});

describe("the card screens keep what the old form promised", () => {
  const cards = readFileSync("src/vx/screens/notes/ui/cards.tsx", "utf8");

  it("never turns Tell parents on by itself, and says nothing goes out from the screen", () => {
    expect(cards).not.toMatch(/setTellParents\(true\)/);
    expect(cards).toContain("Nothing goes out from here.");
  });

  it("counts each AI answer once: the sort at Save, a translation when kept or dropped (D-324)", () => {
    expect(cards.match(/reportDecision\(/g)?.length).toBe(3);
  });
});

describe("a parent to call is not family news", () => {
  it("does not keep a note to the admin because it says to call the mother", () => {
    expect(suggestTags("Finds fractions hard, call the mother on Monday")).toEqual(["studies"]);
    expect(suggestTags("Told his father about the homework")).toEqual(["studies"]);
    expect(suggestTags("पापा से बात करें, होमवर्क नहीं किया")).toEqual(["studies"]);
    expect(suggestTags("मम्मी को फ़ोन करें")).toEqual([]);
  });

  it("still files the family's own news as family", () => {
    expect(suggestTags("Mother is in hospital, she is upset")).toEqual(expect.arrayContaining(["family", "health", "behaviour"]));
    expect(suggestTags("पिता का निधन हो गया")).toEqual(["family"]);
  });
});
