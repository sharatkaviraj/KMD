/**
 * Dates written out in words, as a Scholar's Register and a TC print them.
 * Deterministic and table-driven: a date of birth is an official fact, so no
 * model, locale library or guess decides how it reads.
 */

const EN_ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const EN_ORDINAL_ONES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const EN_ORDINAL_TENS = ["", "", "twentieth", "thirtieth"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** 0–99 in Hindi are irregular words, so they are a table, not a rule. */
const HI_NUMBERS = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पंचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];
const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];

function title(words: string): string {
  return words.split(" ").map((word) => word.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join("-")).join(" ");
}

function enUnder100(n: number): string {
  if (n < 20) return EN_ONES[n];
  const tens = EN_TENS[Math.floor(n / 10)];
  return n % 10 ? `${tens}-${EN_ONES[n % 10]}` : tens;
}

function enOrdinal(day: number): string {
  if (day < 20) return EN_ORDINAL_ONES[day];
  if (day % 10 === 0) return EN_ORDINAL_TENS[day / 10];
  return `${EN_TENS[Math.floor(day / 10)]}-${EN_ORDINAL_ONES[day % 10]}`;
}

function enYear(year: number): string {
  const century = Math.floor(year / 100), rest = year % 100;
  if (century === 20 && rest < 10) return rest ? `two thousand ${EN_ONES[rest]}` : "two thousand";
  if (century === 20) return `two thousand ${enUnder100(rest)}`;
  return rest ? `${enUnder100(century)} ${rest < 10 ? `hundred ${EN_ONES[rest]}` : enUnder100(rest)}` : `${enUnder100(century)} hundred`;
}

function hiYear(year: number): string {
  const century = Math.floor(year / 100), rest = year % 100;
  if (century === 20) return rest ? `दो हज़ार ${HI_NUMBERS[rest]}` : "दो हज़ार";
  return rest ? `${HI_NUMBERS[century]} सौ ${HI_NUMBERS[rest]}` : `${HI_NUMBERS[century]} सौ`;
}

function parts(iso: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  if (year < 1900 || year > 2099) return null;
  return [year, month, day];
}

/** "Fourteenth March Two Thousand Eleven" / "चौदह मार्च दो हज़ार ग्यारह"; null for an impossible date. */
export function dateInWords(iso: string | null | undefined, language: "en" | "hi"): string | null {
  const value = iso ? parts(iso) : null;
  if (!value) return null;
  const [year, month, day] = value;
  if (language === "hi") return `${HI_NUMBERS[day]} ${HI_MONTHS[month - 1]} ${hiYear(year)}`;
  return title(`${enOrdinal(day)} ${EN_MONTHS[month - 1].toLowerCase()} ${enYear(year)}`);
}

/** 14/03/2011 — the figure form printed beside the words. */
export function dateFigures(iso: string | null | undefined): string | null {
  const value = iso ? parts(iso) : null;
  if (!value) return null;
  const [year, month, day] = value;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/** 14 March 2011 / 14 मार्च 2011 — the issue date on the page. */
export function dateLong(iso: string | null | undefined, language: "en" | "hi"): string | null {
  const value = iso ? parts(iso) : null;
  if (!value) return null;
  const [year, month, day] = value;
  return `${day} ${(language === "hi" ? HI_MONTHS : EN_MONTHS)[month - 1]} ${year}`;
}
