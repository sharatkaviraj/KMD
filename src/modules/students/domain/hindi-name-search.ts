/**
 * Finding a child by a name typed in Hindi (smoke test A-10, 6 Nov 2026).
 *
 * Names are stored in Latin letters only ("Aarav"), and Hindi-first staff type
 * "आरव". Nothing in the database can match those two, so a Devanagari search
 * is answered here: the query is transliterated, and both sides are reduced
 * to a loose sound key, because the same name is spelt many ways in English
 * ("Aarav" / "Arav", "Ishaan" / "Ishan", "Kailash" / "Kelash").
 *
 * The key is deliberately forgiving: it drops the short "a" (Hindi's inherent
 * vowel, which Latin spellings keep or drop at will), the "h" of aspirated
 * consonants, and doubled letters. To keep that from matching half the
 * school, each word of the query must match the START of a word in the name.
 */

const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e",
};

const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
};

const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "ळ": "l",
};

/** A consonant followed by the nukta dot reads differently. */
const NUKTA: Record<string, string> = { "क": "q", "ख": "kh", "ग": "g", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f" };

const HALANT = "्";
const NUKTA_SIGN = "़";
const NASAL = new Set(["ं", "ँ"]);
const VISARGA = "ः";

export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/** Devanagari to plain Latin letters, the way the office would spell it. */
export function devanagariToLatin(text: string): string {
  const out: string[] = [];
  const chars = [...text.normalize("NFC")];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (VOWELS[ch]) {
      out.push(VOWELS[ch]);
      continue;
    }
    // Precomposed nukta letters (क़ ज़ ड़ ...) decompose to letter + nukta.
    const decomposed = [...ch.normalize("NFD")];
    const base = decomposed[0];
    if (CONSONANTS[base]) {
      let sound = decomposed[1] === NUKTA_SIGN ? (NUKTA[base] ?? CONSONANTS[base]) : CONSONANTS[base];
      if (chars[i + 1] === NUKTA_SIGN) {
        sound = NUKTA[base] ?? sound;
        i += 1;
      }
      const next = chars[i + 1];
      if (next === HALANT) {
        out.push(sound);
        i += 1;
      } else if (next && MATRAS[next]) {
        out.push(sound + MATRAS[next]);
        i += 1;
      } else {
        // The inherent vowel; the sound key drops it again, so its exact
        // place (राम is "ram", not "rama") does not matter for matching.
        out.push(sound + "a");
      }
      continue;
    }
    if (NASAL.has(ch)) {
      out.push("n");
      continue;
    }
    if (ch === VISARGA) {
      out.push("h");
      continue;
    }
    if (MATRAS[ch]) {
      out.push(MATRAS[ch]);
      continue;
    }
    if (ch === HALANT || ch === NUKTA_SIGN) continue;
    out.push(ch);
  }
  return out.join("");
}

/** The loose sound of one Latin word: lower case, letters only. */
export function soundKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/chh/g, "c")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/x/g, "ks")
    .replace(/([bcdgjkpt])h/g, "$1")
    .replace(/ee|ii|ie/g, "i")
    .replace(/oo|uu|ou/g, "u")
    .replace(/ai|ay|ei/g, "e")
    .replace(/au|aw/g, "o")
    .replace(/a/g, "")
    .replace(/(.)\1+/g, "$1");
}

function keysOf(text: string): string[] {
  return text.split(/[\s.\-']+/).map(soundKey).filter(Boolean);
}

/**
 * Whether a Devanagari query names this child (or their father, the other
 * name the office searches by). Each query word must begin a word of one of
 * the names; the words of one name need not be consecutive.
 */
export function matchesHindiName(query: string, names: ReadonlyArray<string | null | undefined>): boolean {
  const wanted = keysOf(devanagariToLatin(query));
  if (wanted.length === 0) return false;
  return names.some((name) => {
    if (!name) return false;
    const words = keysOf(name);
    return wanted.every((w) => words.some((word) => word.startsWith(w)));
  });
}
