/**
 * Collect's one search box (plan §3.3 card 1): it reads the shape of what was
 * typed and searches by that, so the cashier never picks a field first.
 *
 *  - 10+ digits            → a father's phone: the whole family
 *  - 6–9 digits            → part of a phone
 *  - 1–5 digits            → an SR number (leading zeros ignored)
 *  - "TEST-D-0366", "PENDING-SR-0003" → a whole SR with letters in it
 *  - Devanagari            → a Hindi name
 *  - "7B aarav", "lkg", "12 sci"  → class, then a name inside it
 *  - anything else         → names (child or father), with spelling variants
 *
 * Pure: the local adapter ranks its in-memory roll with `searchLocal`; the
 * bridge adapter sends `bridgeQuery(shape)` to Fees and filters the class here.
 */

export type QueryShape =
  | { kind: "empty" }
  | { kind: "phone"; digits: string }
  | { kind: "phonepart"; digits: string }
  /** `text` is set for an SR typed whole with its letters, lower-cased and without separators. */
  | { kind: "sr"; digits: string; text?: string }
  | { kind: "hindi"; text: string }
  | { kind: "class"; grade: string; section: string; words: string[] }
  | { kind: "name"; words: string[] };

const DEVANAGARI = /[ऀ-ॿ]/;
const CLASS = /^(lkg|ukg|jkg|skg|nur|nursery|\d{1,2})\s*(a|b|c|d|e|sci|science|com|commerce|arts|art|hum)?(?:\s+(.*))?$/i;

export function queryShape(raw: string): QueryShape {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return { kind: "empty" };
  if (/^[\d\s+()-]+$/.test(text)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 10) return { kind: "phone", digits: digits.slice(-10) };
    if (digits.length >= 6) return { kind: "phonepart", digits };
    return { kind: "sr", digits };
  }
  if (DEVANAGARI.test(text)) return { kind: "hindi", text };
  const cls = CLASS.exec(text);
  // A bare number with a name ("7 aarav"), a section ("7b"), or LKG/UKG alone is a class.
  if (cls && (cls[2] || cls[3] || /^(lkg|ukg|jkg|skg|nur|nursery)$/i.test(cls[1]))) {
    return { kind: "class", grade: normalGrade(cls[1]), section: normalSection(cls[2] ?? ""), words: words(cls[3] ?? "") };
  }
  // One word with letters and digits in it is an SR typed whole. Names carry
  // no digits, so this never hides a name search. Before this, "TEST-D-0366"
  // went to the name search and found nobody (TEST school day, 6 Nov 2026,
  // accountant B11); live has PENDING-SR-* numbers of the same shape.
  if (!text.includes(" ") && /\d/.test(text) && /[a-z]/i.test(text)) {
    return { kind: "sr", digits: text.replace(/\D/g, ""), text: srKey(text) };
  }
  return { kind: "name", words: words(text) };
}

function normalGrade(grade: string): string {
  const g = grade.toLowerCase();
  if (g === "nursery") return "nur";
  return /^\d+$/.test(g) ? String(Number(g)) : g;
}
function normalSection(section: string): string {
  const s = section.toLowerCase();
  if (s.startsWith("sci")) return "sci";
  if (s.startsWith("com")) return "com";
  if (s.startsWith("art") || s === "hum") return "arts";
  return s;
}
function srKey(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function words(text: string): string[] {
  return text.split(" ").map(spellingKey).filter(Boolean);
}

/**
 * A spelling-tolerant key: the ways one name is written in Latin script come
 * out the same. Kumawat/Kumavat, Choudhary/Chaudhari, Saanvi/Sanvi,
 * Vihaan/Vihan, Ishita/Isita, Shekhawat/Sekhavat. Ported from the prototype.
 */
export function spellingKey(word: string): string {
  return String(word ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/ou/g, "au")
    .replace(/sh/g, "s")
    .replace(/ch/g, "c")
    .replace(/kh/g, "k")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/ph/g, "f")
    .replace(/aa/g, "a")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/y\b/g, "i")
    .replace(/(.)\1/g, "$1");
}

/** "7B" → {grade:"7",section:"b"}; "12 Science" → {12, sci}; "LKG" → {lkg, ""}. */
export function classParts(label: string): { grade: string; section: string } {
  const t = String(label ?? "").trim().replace(/^class\s+/i, "");
  const m = /^(lkg|ukg|jkg|skg|nur|nursery|\d{1,2})\s*[-\s]?\s*([a-z]+)?/i.exec(t);
  if (!m) return { grade: t.toLowerCase(), section: "" };
  return { grade: normalGrade(m[1]), section: normalSection(m[2] ?? "") };
}

export function inClass(label: string, shape: { grade: string; section: string }): boolean {
  const p = classParts(label);
  return p.grade === shape.grade && (!shape.section || p.section.startsWith(shape.section));
}

export type SearchableStudent = {
  id: string;
  name: string;
  sr: string;
  classLabel: string;
  father: string | null;
  phone: string | null;
};

/**
 * Lower is better, null is no match. A word at the start of the child's name
 * beats one inside it, which beats one only in the father's name.
 */
export function matchScore(student: SearchableStudent, shape: QueryShape): number | null {
  switch (shape.kind) {
    case "empty":
      return null;
    case "phone": {
      const phone = digitsOf(student.phone);
      return phone.slice(-10) === shape.digits ? 0 : null;
    }
    case "phonepart":
      return digitsOf(student.phone).includes(shape.digits) ? 0 : null;
    case "sr": {
      if (shape.text) {
        const sr = srKey(student.sr);
        return sr === shape.text ? 0 : sr.startsWith(shape.text) ? 1 : null;
      }
      const want = shape.digits.replace(/^0+/, "");
      const sr = String(student.sr ?? "").replace(/\D/g, "").replace(/^0+/, "");
      if (!want) return null;
      return sr === want ? 0 : sr.startsWith(want) ? 1 : null;
    }
    case "hindi":
      return `${student.name} ${student.father ?? ""}`.includes(shape.text) ? 0 : null;
    case "class":
      if (!inClass(student.classLabel, shape)) return null;
      return shape.words.length ? nameScore(student, shape.words) : 0;
    case "name":
      return nameScore(student, shape.words);
  }
}

function nameScore(student: SearchableStudent, keys: readonly string[]): number | null {
  if (!keys.length) return null;
  const name = student.name.split(/\s+/).map(spellingKey).join(" ");
  const hay = `${name} ${(student.father ?? "").split(/\s+/).map(spellingKey).join(" ")}`;
  let score = 0;
  for (const key of keys) {
    const at = hay.indexOf(key);
    if (at < 0) return null;
    const wordStart = at === 0 || hay[at - 1] === " ";
    score += at === 0 ? 0 : at < name.length ? (wordStart ? 1 : 2) : 3;
    score += at / 100;
  }
  return score;
}

function digitsOf(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** The local roll, ranked. Ties break on the name so the list is stable. */
export function searchLocal<T extends SearchableStudent>(students: readonly T[], raw: string): T[] {
  const shape = queryShape(raw);
  return students
    .map((student) => ({ student, score: matchScore(student, shape) }))
    .filter((hit): hit is { student: T; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.student.name.localeCompare(b.student.name))
    .map((hit) => hit.student);
}

/**
 * What to ask Fees' directory for. Fees matches names, SR numbers and phones
 * itself; a class prefix is not something it understands, so only the name
 * part goes and the class is filtered here. Null: nothing worth sending yet
 * (Fees wants two characters).
 */
export function bridgeQuery(shape: QueryShape, raw: string): string | null {
  switch (shape.kind) {
    case "empty":
      return null;
    case "phone":
    case "phonepart":
      return shape.digits;
    case "sr":
      if (shape.text) return String(raw).trim();
      return shape.digits.length >= 2 ? shape.digits : null;
    case "hindi":
      return shape.text.length >= 2 ? shape.text : null;
    case "class": {
      const words = (CLASS.exec(String(raw).trim().replace(/\s+/g, " "))?.[3] ?? "").trim();
      return words.length >= 2 ? words : null;
    }
    case "name": {
      const text = String(raw).trim().replace(/\s+/g, " ");
      return text.length >= 2 ? text : null;
    }
  }
}

/** Does this result list look like one family (a phone search that found 2+ children)? */
export function isHouseholdSearch(shape: QueryShape, found: number): boolean {
  return shape.kind === "phone" && found > 1;
}
