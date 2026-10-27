/**
 * Small text judgements the AI helper's buttons make before asking anything
 * (D-324). Pure, so they are tested without a browser.
 */

const DEVANAGARI = /[ऀ-ॿ]/g;

/** Mostly Hindi letters → offer English; otherwise offer Hindi. */
export function translateTarget(text: string): "hi" | "en" {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  const hindi = (text.match(DEVANAGARI) ?? []).length;
  return letters > 0 && hindi / letters > 0.4 ? "en" : "hi";
}

/**
 * A question rather than a name typed into search: a question mark, a
 * question word in English, Hindi or Hinglish, or four words or more. A name,
 * an SR number or a receipt number is none of these, so the ordinary search
 * keeps the box to itself for them.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length < 6) return false;
  if (t.includes("?")) return true;
  if (/^(how|where|what|why|can|which|who|when|kaise|kahan|kya|kyon|kaun)\b/.test(t)) return true;
  if (/(कैसे|कहाँ|कहां|क्या|क्यों|कौन|कब)/.test(t)) return true;
  return t.split(/\s+/).length >= 4;
}
