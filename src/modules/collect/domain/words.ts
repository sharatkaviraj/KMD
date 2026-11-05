/**
 * An amount in words, the Indian way (lakh and crore), in English and Hindi,
 * for the amount card and the printed slip. Whole rupees only — the desk takes
 * no paise. Ported from the approved prototype.
 */

const EN1 = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN10 = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0–99 in Hindi: each number has its own word. */
const HI = (
  "शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस " +
  "इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस " +
  "इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ " +
  "इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी " +
  "इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे"
).split(" ");

function parts(n: number) {
  return {
    crore: Math.floor(n / 1e7),
    lakh: Math.floor(n / 1e5) % 100,
    thousand: Math.floor(n / 1e3) % 100,
    hundred: Math.floor(n / 100) % 10,
    rest: n % 100,
  };
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function enTwo(x: number): string {
  return x < 20 ? EN1[x] : EN10[Math.floor(x / 10)] + (x % 10 ? `-${EN1[x % 10]}` : "");
}

/** "Six thousand two hundred rupees only". Empty for zero. Crores above 99 are spelled in crores. */
export function amountInWordsEn(amount: number): string {
  const n = whole(amount);
  if (!n) return "";
  const p = parts(n);
  const out: string[] = [];
  if (p.crore) out.push(`${p.crore < 100 ? enTwo(p.crore) : amountInWordsEn(p.crore).replace(/ rupees only$/i, "").toLowerCase()} crore`);
  if (p.lakh) out.push(`${enTwo(p.lakh)} lakh`);
  if (p.thousand) out.push(`${enTwo(p.thousand)} thousand`);
  if (p.hundred) out.push(`${EN1[p.hundred]} hundred`);
  if (p.rest) out.push(enTwo(p.rest));
  const text = `${out.join(" ")} rupees only`;
  return text[0].toUpperCase() + text.slice(1);
}

/** "छह हज़ार दो सौ रुपये". Empty for zero. */
export function amountInWordsHi(amount: number): string {
  const n = whole(amount);
  if (!n) return "";
  const p = parts(n);
  const out: string[] = [];
  if (p.crore) out.push(`${p.crore < 100 ? HI[p.crore] : amountInWordsHi(p.crore).replace(/ रुपये$/, "")} करोड़`);
  if (p.lakh) out.push(`${HI[p.lakh]} लाख`);
  if (p.thousand) out.push(`${HI[p.thousand]} हज़ार`);
  if (p.hundred) out.push(`${HI[p.hundred]} सौ`);
  if (p.rest) out.push(HI[p.rest]);
  return `${out.join(" ")} रुपये`;
}

/** Both, as a pair the message helpers render. */
export function amountInWords(amount: number): { hi: string; en: string } {
  return { hi: amountInWordsHi(amount), en: amountInWordsEn(amount) };
}
