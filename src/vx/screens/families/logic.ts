import { matchScore, queryShape, spellingKey, type SearchableStudent } from "@/modules/collect/domain/search";
import type { FamilyPreview } from "@/platform/fees-bridge/family-command-contracts";
import type { BridgeFamilyChild, BridgeFamilyGroup } from "@/platform/fees-bridge/screen-read-contracts";

/*
 * Families (owner, 8 Nov 2026): what the Families list and the family page
 * draw, from the families Fees sends (or One's TEST copy in the same shape).
 * Pure; tested in tests/vx-families.test.ts.
 *
 * Money rules kept from Fees: fees and the late fee are never added, a family
 * whose only debt is a late fee has its fees paid, and a child whose money was
 * not read makes the family's total "not read", never a smaller number.
 */

export type FamiliesData = {
  sessionLabel: string;
  /** Read from Fees just now (`asOf`), or from One's copy (null). */
  asOf: string | null;
  test: boolean;
  families: BridgeFamilyGroup[];
  canCollect: boolean;
  /** The reader may open a child's own page (`students:view`). */
  canOpenChildren: boolean;
  /** May link children and take one out: through Fees on a real year, One's copy on a TEST year. */
  canChange: boolean;
};

export type FamilyKid = {
  id: string;
  name: string;
  sr: string;
  classLabel: string;
  status: string;
  father: string | null;
  mother: string | null;
  phone: string | null;
  village: string | null;
  /** Null: Fees had no money row for this child. */
  money: BridgeFamilyChild["money"];
  thirdChild: boolean;
  /** Fees keeps a photo for this child; when false the face shows initials without asking. */
  hasPhoto: boolean;
};

export type FamilyCard = {
  id: string;
  /** The family's own label, else the guardian, else the father, else the eldest child. */
  name: string;
  father: string | null;
  mother: string | null;
  phone: string | null;
  village: string | null;
  kids: FamilyKid[];
  /** Null when any child's money was not read. */
  feesPending: number | null;
  lateFee: number | null;
  paid: number | null;
  yearFees: number | null;
  overdue: boolean;
  /** Every child has left or is not on the roll any more. */
  allLeft: boolean;
};

export type FamilyFilter = "all" | "owing" | "late" | "three" | "paid";
export const FAMILY_FILTERS: readonly FamilyFilter[] = ["all", "owing", "late", "three", "paid"];
export type FamilySort = "name" | "owing";

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function sum(kids: readonly FamilyKid[], pick: (m: NonNullable<FamilyKid["money"]>) => number): number | null {
  let total = 0;
  for (const k of kids) {
    if (!k.money) return null;
    total += pick(k.money);
  }
  return total;
}

export function toFamilyCard(g: BridgeFamilyGroup): FamilyCard {
  const kids: FamilyKid[] = g.children.map((c) => ({
    id: c.studentId,
    name: c.fullName,
    sr: c.admissionNo,
    classLabel: c.classLabel,
    status: c.status,
    father: c.fatherName,
    mother: c.motherName,
    phone: c.fatherPhone ?? c.motherPhone ?? null,
    village: c.villageCity,
    money: c.money,
    thirdChild: c.thirdChildCandidate,
    hasPhoto: c.hasPhoto,
  }));
  const father = kids.find((k) => k.father)?.father ?? blank(g.guardianName);
  const mother = kids.find((k) => k.mother)?.mother ?? null;
  return {
    id: g.groupId,
    name: blank(g.label) ?? blank(g.guardianName) ?? father ?? kids[0]?.name ?? "—",
    father,
    mother,
    phone: blank(g.guardianPhone) ?? kids.find((k) => k.phone)?.phone ?? null,
    village: kids.find((k) => k.village)?.village ?? null,
    kids,
    feesPending: sum(kids, (m) => m.feesPending),
    lateFee: sum(kids, (m) => m.lateFeePending),
    paid: sum(kids, (m) => m.paid),
    yearFees: sum(kids, (m) => m.yearFees),
    overdue: kids.some((k) => k.money?.overdue === true),
    allLeft: kids.length > 0 && kids.every((k) => k.status !== "active"),
  };
}

export function toFamilyCards(groups: readonly BridgeFamilyGroup[]): FamilyCard[] {
  return groups.map(toFamilyCard).filter((f) => f.kids.length > 0);
}

export function inFilter(f: FamilyCard, filter: FamilyFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "owing":
      return (f.feesPending ?? 0) > 0;
    case "late":
      return (f.lateFee ?? 0) > 0;
    case "three":
      return f.kids.length >= 3;
    case "paid":
      return f.feesPending === 0;
  }
}

export type FamilyCounts = Record<FamilyFilter, number> & { children: number; feesPending: number; lateFee: number; unread: number };

export function familyCounts(cards: readonly FamilyCard[]): FamilyCounts {
  const out: FamilyCounts = { all: 0, owing: 0, late: 0, three: 0, paid: 0, children: 0, feesPending: 0, lateFee: 0, unread: 0 };
  for (const f of cards) {
    for (const key of FAMILY_FILTERS) if (inFilter(f, key)) out[key] += 1;
    out.children += f.kids.length;
    out.feesPending += f.feesPending ?? 0;
    out.lateFee += f.lateFee ?? 0;
    if (f.feesPending === null) out.unread += 1;
  }
  return out;
}

/* ---------------------------------------------------------------- search */

const VOWELS: Record<string, string> = { "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऋ": "ri" };
const SIGNS: Record<string, string> = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ृ": "ri", "ॅ": "e", "ॉ": "o" };
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
  "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
};
const NUKTA: Record<string, string> = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f" };

/**
 * Hindi typed into the search box, written the way the roll writes names
 * (owner rule: Hindi search must find Latin names). "आरव" → "aarav",
 * "कुमावत" → "kumaavat"; the final silent "a" is dropped. Close enough for
 * `spellingKey`, which already folds aa/a, sh/s, w/v.
 */
export function devanagariToLatin(text: string): string {
  const chars = [...text.normalize("NFC")];
  let out = "";
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    let cons = CONSONANTS[ch];
    if (cons !== undefined) {
      if (chars[i + 1] === "़") {
        cons = NUKTA[ch] ?? cons;
        i += 1;
      }
      const next = chars[i + 1];
      if (next === "्") {
        out += cons;
        i += 1;
      } else if (next !== undefined && SIGNS[next] !== undefined) {
        out += cons + SIGNS[next];
        i += 1;
      } else {
        // The inherent vowel, silent at the end of a word.
        const wordEnds = next === undefined || /\s/.test(next);
        out += wordEnds ? cons : `${cons}a`;
      }
      continue;
    }
    if (VOWELS[ch] !== undefined) out += VOWELS[ch];
    else if (SIGNS[ch] !== undefined) out += SIGNS[ch];
    else if (ch === "ं" || ch === "ँ") out += "n";
    else if (ch === "ः") out += "h";
    else if (ch === "़" || ch === "्") continue;
    else out += ch;
  }
  return out;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const consonantKey = (word: string) => spellingKey(word).replace(/[aeiou]/g, "");

function hindiScore(f: FamilyCard, raw: string): number | null {
  const want = devanagariToLatin(raw).split(/\s+/).filter(Boolean);
  if (!want.length) return null;
  const people = [...f.kids.map((k) => k.name), f.father ?? "", f.mother ?? "", f.name];
  const words = people.join(" ").split(/\s+/).filter(Boolean);
  const exact = words.map(spellingKey);
  const loose = words.map(consonantKey);
  let score = 0;
  for (const w of want) {
    const key = spellingKey(w);
    const skeleton = consonantKey(w);
    if (exact.some((x) => x.startsWith(key))) continue;
    if (skeleton && loose.some((x) => x.startsWith(skeleton))) {
      score += 2;
      continue;
    }
    return null;
  }
  return score;
}

/** Lower is better, null is no match: a child, the father or mother, a phone, an SR, a class or the village. */
export function familyScore(f: FamilyCard, raw: string): number | null {
  const text = raw.trim();
  if (!text) return 0;
  if (DEVANAGARI.test(text)) return hindiScore(f, text);
  const shape = queryShape(text);
  let best: number | null = null;
  const people: SearchableStudent[] = f.kids.map((k) => ({ id: k.id, name: k.name, sr: k.sr, classLabel: k.classLabel, father: [k.father, k.mother].filter(Boolean).join(" ") || null, phone: k.phone }));
  // The family's own phone and name count as well as each child's.
  people.push({ id: f.id, name: f.name, sr: "", classLabel: "", father: [f.father, f.mother].filter(Boolean).join(" ") || null, phone: f.phone });
  for (const kid of f.kids) {
    const other = kid.phone && f.phone && kid.phone !== f.phone ? kid.phone : null;
    if (other) people.push({ id: kid.id, name: kid.name, sr: "", classLabel: "", father: null, phone: other });
  }
  for (const person of people) {
    const s = matchScore(person, shape);
    if (s !== null && (best === null || s < best)) best = s;
  }
  if (best === null && f.village && shape.kind === "name") {
    const village = spellingKey(f.village);
    if (shape.words.every((w) => village.includes(w))) best = 5;
  }
  return best;
}

export function searchFamilies(cards: readonly FamilyCard[], raw: string, filter: FamilyFilter, sort: FamilySort): FamilyCard[] {
  const hits = cards
    .filter((f) => inFilter(f, filter))
    .map((f) => ({ f, score: familyScore(f, raw) }))
    .filter((h): h is { f: FamilyCard; score: number } => h.score !== null);
  const searching = raw.trim().length > 0;
  return hits
    .sort((a, b) => {
      if (searching && a.score !== b.score) return a.score - b.score;
      if (sort === "owing") {
        const d = (b.f.feesPending ?? -1) - (a.f.feesPending ?? -1);
        if (d) return d;
      }
      return a.f.name.localeCompare(b.f.name);
    })
    .map((h) => h.f);
}

/* ---------------------------------------------------------------- phones */

/** A ten-digit Indian mobile for tel:/wa.me links, or null. */
export function mobile(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** "98290 ••512": enough to recognise a family, not a number to copy off the screen. */
export function maskedPhone(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "").slice(-10);
  return d.length >= 8 ? `${d.slice(0, 5)} ••${d.slice(-3)}` : null;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The child the Collect fee button opens: the first with fees left, else the first child. */
export function collectChild(f: FamilyCard): string | null {
  return (f.kids.find((k) => (k.money?.feesPending ?? 0) > 0) ?? f.kids.find((k) => k.status === "active") ?? f.kids[0])?.id ?? null;
}

/* ---------------------------------------------------------- link / unlink */

/**
 * What the preview should say about the 3rd Child Policy, in order (8 Nov
 * 2026). Pure, so each case is tested; the sheet words them. A child who
 * loses the policy is always said, because their fees go up.
 */
export type ThirdChildNote =
  | { kind: "off" }
  | { kind: "needThree"; count: number }
  | { kind: "gets"; studentId: string; tuition: number | null; base: number | null }
  | { kind: "keeps"; studentId: string }
  | { kind: "staff"; studentId: string }
  | { kind: "loses"; studentId: string }
  | { kind: "same" };

export function thirdChildNotes(preview: FamilyPreview): ThirdChildNote[] {
  const t = preview.thirdChild;
  const notes: ThirdChildNote[] = [];
  if (!t.policyConfigured) notes.push({ kind: "off" });
  else if (t.outrankedByStaffChildStudentId) notes.push({ kind: "staff", studentId: t.outrankedByStaffChildStudentId });
  else if (t.recipientAfter && t.gains.includes(t.recipientAfter)) {
    const child = preview.children.find((c) => c.studentId === t.recipientAfter);
    notes.push({ kind: "gets", studentId: t.recipientAfter, tuition: t.recipientTuition, base: child?.baseTuition ?? null });
  } else if (t.recipientAfter) notes.push({ kind: "keeps", studentId: t.recipientAfter });
  else if (preview.after.family.length > 0) notes.push({ kind: "needThree", count: t.eligibleCount });
  for (const id of t.loses) notes.push({ kind: "loses", studentId: id });
  if (notes.length === 0) notes.push({ kind: "same" });
  return notes;
}

/** A fresh id for one change; the same id is sent again on a retry. */
export function newCommandId(): string {
  return globalThis.crypto.randomUUID();
}
