import type { Pair } from "@/vx/text";

/*
 * Lines a report card prints. A card is a bilingual document: both languages
 * print on every copy, whatever the reader's own setting, so these return one
 * string with both halves rather than a pair.
 */

/**
 * The result line when a child has not passed: which subjects, so a parent
 * reads "Needs support in Maths", not a bare "Needs support" beside a card
 * that otherwise looks fine (smoke 20 Oct).
 */
export function supportLine(subjects: Pair[]): string {
  if (subjects.length === 0) return "Needs support · पूरक कक्षाएँ";
  const en = subjects.map((s) => s.en).join(", ");
  const hi = subjects.map((s) => s.hi ?? s.en).join(", ");
  return `Needs support in ${en} · ${hi} में सहायता चाहिए`;
}

/**
 * Why the percentage is not the total divided by the maximum: each exam's
 * weight, printed under it so a parent with a calculator can check it
 * (smoke 20 Oct: 262.5/380 is 69.1%, the card said 70.8% "weighted by exam").
 * Empty when every exam counts the same.
 */
export function weightsLine(weights: { name: Pair; weight: number }[]): string {
  if (new Set(weights.map((w) => w.weight)).size < 2) return "";
  const en = weights.map((w) => `${w.name.en} ×${w.weight}`).join(", ");
  const hi = weights.map((w) => `${w.name.hi ?? w.name.en} ×${w.weight}`).join(", ");
  return `Each exam's marks count: ${en} · हर परीक्षा के अंकों का भार: ${hi}`;
}

/**
 * Why a child's days differ from a classmate's: "1 day on leave · 1 day not
 * marked". Empty when neither applies. Printed beside the attendance so two
 * cards from one class can be read side by side (smoke 20 Oct: 24/24 and 21/25).
 */
export function attendanceNote(leave = 0, unmarked = 0): string {
  const en: string[] = [];
  const hi: string[] = [];
  if (leave > 0) {
    en.push(`${leave} ${leave === 1 ? "day" : "days"} on leave`);
    hi.push(`${leave} दिन छुट्टी पर`);
  }
  if (unmarked > 0) {
    en.push(`${unmarked} ${unmarked === 1 ? "day" : "days"} not marked`);
    hi.push(`${unmarked} दिन हाज़िरी नहीं लगी`);
  }
  return en.length ? `${en.join(" · ")} · ${hi.join(" · ")}` : "";
}

/* ------------------------------------------------- the class group's rule */

export type RuledCard = {
  rule: { key: string; verdict: boolean } | null | undefined;
  status: "complete" | "pending" | "absent" | null | undefined;
  passed: boolean | null;
  shortIn: Pair[];
  pendingIn: Pair[];
  division?: { en: string; hi: string } | null;
};

/**
 * The result line a card prints under its class group's rule (D-611), or
 * null when the class has no rule (the line is then worked out as before) or
 * nothing is to be said (Nursery to SKG, whose grade is the result).
 *
 *  - missed every paper: "Absent";
 *  - a paper still to come or missed: "Result pending", naming the subjects,
 *    as the register prints it;
 *  - the board classes never print Pass: "Board class: the board declares the
 *    result", or the subjects needing support;
 *  - otherwise Pass (with the division for 9–12) or the subjects needing support.
 */
export function ruledResult(card: RuledCard): { text: string; en: string; hi: string; tone: "ok" | "bad" | "warn" | "plain" } | null {
  const say = (en: string, hi: string, tone: "ok" | "bad" | "warn" | "plain") => ({ text: `${en} · ${hi}`, en, hi, tone });
  const list = (subjects: Pair[]) => ({ en: subjects.map((s) => s.en).join(", "), hi: subjects.map((s) => s.hi ?? s.en).join(", ") });
  if (!card.rule) return null;
  if (card.status === "absent") return say("Absent", "अनुपस्थित", "bad");
  if (card.status === "pending") {
    if (card.pendingIn.length === 0) return say("Result pending", "परिणाम लंबित", "warn");
    const named = list(card.pendingIn);
    return say(`Result pending: ${named.en}`, `परिणाम लंबित: ${named.hi}`, "warn");
  }
  if (card.rule.key === "pre_primary") return null;
  const support = () => {
    const named = list(card.shortIn);
    return say(`Needs support in ${named.en}`, `${named.hi} में सहायता चाहिए`, "bad");
  };
  if (!card.rule.verdict) {
    if (card.shortIn.length) return support();
    return say("Board class: the board declares the result", "बोर्ड कक्षा: परिणाम बोर्ड घोषित करेगा", "plain");
  }
  if (card.passed === false) return card.shortIn.length ? support() : say("Needs support", "पूरक कक्षाएँ", "bad");
  if (card.passed === true) {
    return card.division ? say(`Pass · ${card.division.en}`, `उत्तीर्ण · ${card.division.hi}`, "ok") : say("Pass", "उत्तीर्ण", "ok");
  }
  return null;
}

/** "3rd of 32" / "कक्षा में 3वाँ स्थान (32 में)", or null with no place. */
export function rankWords(rank: number | null | undefined, of: number | null | undefined): { en: string; hi: string } | null {
  if (!rank || !of) return null;
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th");
  return { en: `${rank}${suffix} of ${of}`, hi: `कक्षा में ${rank}वाँ स्थान (${of} में)` };
}

/** Both halves of `rankWords` on one line, or "" with no place. */
export function rankLine(rank: number | null | undefined, of: number | null | undefined): string {
  const words = rankWords(rank, of);
  return words ? `${words.en} · ${words.hi}` : "";
}

/** The percentage at the decimals its rule prints, "—" when there is none. */
export function percentText(percent: number | null | undefined, decimals = 1): string {
  return percent === null || percent === undefined ? "—" : `${percent.toFixed(decimals)}%`;
}
