/**
 * Numbers come from the app, words come from the AI (D-328).
 *
 * The call scripts and the weekly brief talk about money, dates and
 * attendance — exactly what must never be made up. So the model is given
 * the names of the facts it may use (and, for school-wide figures, their
 * values to reason from) and has to write each one as `<<key>>`. The app
 * fills the slots with its own figures. An answer with a slot that is not
 * on the list, or with a digit of its own, is not a draft at all.
 *
 * For a call about one family, only the slot names travel: the parent's
 * name, the child's name and the amount stay in the browser and are put in
 * after the words come back.
 */

export const FACT_KEY = /^[a-z][a-z_]{1,29}$/;
const SLOT = /<<([a-z][a-z_]{1,29})>>/g;

/** Digits in Latin or Devanagari script. */
const DIGIT = /[0-9०-९]/;

export const FACT_RULES = `Facts and numbers:
- You must not write any digit, in any script. Every amount, date, time, count or percentage, and every person's or class's name, is written as its slot from the facts list, exactly like <<amount>>. The app fills each slot with the real value.
- Use only slots from the list. If a fact you would like to mention is not on the list, leave it out.
- Words about size or direction ("a little", "more than last week") are fine; numbers are not.`;

export function slotsIn(text: string): string[] {
  return [...text.matchAll(SLOT)].map((m) => m[1]);
}

/**
 * True when every slot is one the app offered and no digit was written by
 * the model itself. Spelt-out numbers ("five") are not caught; the prompt
 * forbids them and the slots make them unnecessary.
 */
export function usesOnlyFacts(text: string, allowed: ReadonlySet<string>): boolean {
  if (slotsIn(text).some((key) => !allowed.has(key))) return false;
  return !DIGIT.test(text.replace(SLOT, ""));
}

/** Put the app's values into the slots. A slot without a value is removed rather than shown raw. */
export function fillFacts(text: string, values: Readonly<Record<string, string>>): string {
  return text
    .replace(SLOT, (_match, key: string) => values[key] ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.।!?])/g, "$1")
    .trim();
}

/** Split filled text into plain and filled runs, so a screen can show which words are the app's figures. */
export function factRuns(text: string, values: Readonly<Record<string, string>>): { text: string; fact: boolean }[] {
  const out: { text: string; fact: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(SLOT)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), fact: false });
    const value = values[m[1]];
    if (value) out.push({ text: value, fact: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), fact: false });
  return out;
}

const NUMBER = /[0-9०-९]+(?:[.,:/][0-9०-९]+)*/g;

/**
 * For summaries of what teachers wrote: a number may be repeated from the
 * notes ("8 out of 10 in the test"), never made up. Every number in the
 * answer must appear somewhere in the material it was given.
 */
export function numbersComeFrom(text: string, source: string): boolean {
  const known = new Set(source.match(NUMBER) ?? []);
  return (text.match(NUMBER) ?? []).every((n) => known.has(n));
}
