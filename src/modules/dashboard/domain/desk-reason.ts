import { p, type Pair } from "@/vx/text";

/**
 * Why a fee desk request was made, in words, for the admin's Needs you: never
 * the stored code ("wrong_amount"), always with the note and who asked
 * (money stream handoff, smoke run 20 Oct). Pure, tested in
 * `tests/smoke-admin-needs-you.test.ts`.
 */
const REASONS: Record<string, Pair> = {
  wrong_amount: p("Wrong amount typed", "ग़लत राशि लिखी"),
  wrong_student: p("Wrong student", "ग़लत विद्यार्थी"),
  cheque_bounced: p("Cheque bounced", "चेक बाउंस हुआ"),
  duplicate: p("Entered twice", "दो बार दर्ज"),
  left_school: p("Left the school", "स्कूल छोड़ दिया"),
  hardship: p("Family cannot pay", "परिवार भर नहीं सकता"),
};

/** A code nobody has words for yet still reads as words: "fee_waived" → "Fee waived". */
function humanise(code: string): string {
  const text = code.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function deskReason(code: string | null, note: string | null, askedBy: string | null): Pair {
  const reason = code ? (REASONS[code] ?? p(humanise(code))) : null;
  const trimmed = note?.trim() || null;
  const en = [reason?.en, trimmed, askedBy ? `asked by ${askedBy}` : null].filter(Boolean).join(" · ");
  const hi = [reason ? (reason.hi ?? reason.en) : null, trimmed, askedBy ? `${askedBy} ने माँगा` : null].filter(Boolean).join(" · ");
  return { en: en || "—", hi: hi || "—" };
}
