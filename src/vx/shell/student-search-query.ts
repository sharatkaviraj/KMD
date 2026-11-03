/**
 * What the search box sends, and why a student came back (S01).
 *
 * The Fees directory matches a lowercased substring of the child's name, SR,
 * class, both phones and both parents' names. A phone pasted from WhatsApp
 * arrives as "+91 98290 12345" and would match nothing, so a query that is a
 * phone number in any of its usual shapes is reduced to its ten digits before
 * it travels. Everything else only has its whitespace collapsed.
 */
export function searchTerm(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const compact = text.replace(/[\s().-]/g, "");
  const phone = /^(?:\+?91|0)?(\d{10})$/.exec(compact);
  return phone ? phone[1] : text;
}

export type MatchWhy = { kind: "father" | "mother" | "phone"; text: string };

type Matchable = {
  name: string;
  sr: string;
  father: string | null;
  mother: string | null;
  phones: readonly (string | null)[];
};

const digitsOf = (value: string | null) => (value ?? "").replace(/\D/g, "");

/**
 * Why a row matched, when it was not the child's own name or SR — so a
 * search for a parent shows "Father: …" instead of an unexplained child.
 * Null when the name/SR explains it, or nothing visible does.
 */
export function matchWhy(term: string, row: Matchable): MatchWhy | null {
  const t = term.trim().toLowerCase();
  if (!t) return null;
  if (row.name.toLowerCase().includes(t) || row.sr.toLowerCase().includes(t)) return null;
  if (row.father && row.father.toLowerCase().includes(t)) return { kind: "father", text: row.father };
  if (row.mother && row.mother.toLowerCase().includes(t)) return { kind: "mother", text: row.mother };
  const digits = digitsOf(t);
  if (digits.length >= 4 && digits === t.replace(/\s/g, "")) {
    const hit = row.phones.map(digitsOf).find((phone) => phone.includes(digits));
    if (hit) return { kind: "phone", text: `••••${hit.slice(-4)}` };
  }
  return null;
}
