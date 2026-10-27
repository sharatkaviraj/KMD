import { describe, expect, it } from "vitest";

import { factRuns, fillFacts, numbersComeFrom, slotsIn, usesOnlyFacts } from "@/modules/assist/domain/facts";
import { ASSIST_TASKS } from "@/modules/assist/domain/tasks";

/* Test data only (rule 6): every name and figure below is invented. */

describe("numbers come from the app", () => {
  const allowed = new Set(["parent", "amount_due", "promise_date"]);

  it("accepts words around offered slots, and nothing else", () => {
    expect(slotsIn("Namaste <<parent>>, <<amount_due>> is due.")).toEqual(["parent", "amount_due"]);
    expect(usesOnlyFacts("Namaste <<parent>>, <<amount_due>> is due.", allowed)).toBe(true);
    expect(usesOnlyFacts("Namaste <<parent>>, <<late_fee>> is due.", allowed)).toBe(false);
  });

  it("refuses any digit the model wrote itself, in either script", () => {
    expect(usesOnlyFacts("Please pay ₹4,500 by Friday.", allowed)).toBe(false);
    expect(usesOnlyFacts("कृपया १५ तारीख़ तक जमा करें।", allowed)).toBe(false);
    expect(usesOnlyFacts("Please pay <<amount_due>> soon.", allowed)).toBe(true);
  });

  it("fills slots with the app's values and drops a slot it has no value for", () => {
    const values = { parent: "QA Parent", amount_due: "₹4,500" };
    expect(fillFacts("Namaste <<parent>>, <<amount_due>> is due by <<promise_date>> .", values)).toBe("Namaste QA Parent, ₹4,500 is due by.");
    expect(factRuns("Pay <<amount_due>> today", values)).toEqual([
      { text: "Pay ", fact: false },
      { text: "₹4,500", fact: true },
      { text: " today", fact: false },
    ]);
  });

  it("lets a summary repeat a number from the notes, never invent one", () => {
    const notes = "Scored 8/10 in the spelling test. Attendance this session: 82%";
    expect(numbersComeFrom("Scored 8/10 in spelling; attendance 82%.", notes)).toBe(true);
    expect(numbersComeFrom("Scored 9/10 in spelling.", notes)).toBe(false);
  });
});

describe("call scripts", () => {
  const spec = ASSIST_TASKS["call.script"];
  const input = spec.input.parse({
    topic: "dues",
    language: "en",
    slots: [
      { key: "parent", label: "parent's name" },
      { key: "amount_due", label: "fees due" },
    ],
    situation: ["the fees have been overdue for more than a week"],
  });

  it("never carries a value, only slot names and phrases", () => {
    expect(JSON.stringify(spec.prompt(input))).not.toContain("₹");
    expect(spec.input.safeParse({ ...input, slots: [{ key: "Parent Name", label: "x" }] }).success).toBe(false);
  });

  it("drops lines with a number of their own and fails without a clean opening", () => {
    const out = spec.finish!({ opening: "Namaste <<parent>>, this is the school.", points: ["<<amount_due>> is due.", "Please pay ₹500 today.", "Can you pay <<late_fee>>?"], close: "Thank you." }, input);
    expect(out).toEqual({ opening: "Namaste <<parent>>, this is the school.", points: ["<<amount_due>> is due."], close: "Thank you." });
    expect(spec.finish!({ opening: "Namaste, you owe 4500.", points: [], close: "" }, input)).toBeNull();
  });
});

describe("the Today brief", () => {
  const spec = ASSIST_TASKS["brief.today"];
  const input = spec.input.parse({
    language: "en",
    facts: [
      { key: "classes_marked", label: "Classes marked", value: "17 of 19" },
      { key: "collected_today", label: "Fees collected today", value: "₹12,500 in 9 receipts" },
    ],
  });

  it("keeps only lines that cite the page's own figures", () => {
    const out = spec.finish!({ headline: "<<classes_marked>> classes are marked.", points: ["Two classes are left.", "Only 2 classes left.", "<<collected_today>> so far."], actions: ["Remind the last teachers."] }, input);
    expect(out?.points).toEqual(["Two classes are left.", "<<collected_today>> so far."]);
    expect(spec.finish!({ headline: "17 classes marked.", points: [], actions: [] }, input)).toBeNull();
  });
});

describe("WhatsApp template drafts", () => {
  const spec = ASSIST_TASKS["template.draft"];
  const input = spec.input.parse({ brief: "fee reminder with amount and date", category: "utility" });

  it("allows only the fields the app can fill and no numbers of its own", () => {
    expect(spec.finish!({ name: "Fee reminder", hi: "प्रिय {parent}, {student} की फीस {amount} है।", en: "Dear {parent}, {student}'s fee is {amount}." }, input)).not.toBeNull();
    expect(spec.finish!({ name: "Fee reminder", hi: "", en: "Dear {parent}, pay {fee}." }, input)).toBeNull();
    expect(spec.finish!({ name: "Fee reminder", hi: "", en: "Dear {parent}, pay by the 15th." }, input)).toBeNull();
  });
});

describe("note summaries", () => {
  it("a child's summary keeps only points whose numbers came from the notes", () => {
    const spec = ASSIST_TASKS["child.summary"];
    const input = spec.input.parse({
      childName: "Qatest Child",
      language: "en",
      notes: [{ when: "14 Oct", tags: ["studies"], text: "Scored 8/10 in the spelling test." }],
      facts: ["Attendance this session: 82%"],
    });
    const out = spec.finish!({ points: ["Spelling is strong (8/10).", "Maths at 45% needs work."], opener: "Thank you for coming." }, input);
    expect(out?.points).toEqual(["Spelling is strong (8/10)."]);
  });

  it("a class digest names children only by the refs it was given", () => {
    const spec = ASSIST_TASKS["class.digest"];
    const input = spec.input.parse({
      classLabel: "QA 6 A",
      language: "en",
      notes: [{ ref: "C1", when: "14 Oct", tags: ["behaviour"], text: "Did not bring homework again." }],
      names: ["Qatest Child"],
    });
    const out = spec.finish!({ themes: ["Homework is being missed."], attention: [{ ref: "C1", line: "Homework missed again." }, { ref: "C7", line: "Invented." }], praise: [] }, input);
    expect(out?.attention).toEqual([{ ref: "C1", line: "Homework missed again." }]);
  });
});
