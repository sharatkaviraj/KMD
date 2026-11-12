import { SCHOOL_WHATSAPP_NUMBER, waDigits } from "@/platform/whatsapp/numbers";

import type { StaffLanguage } from "./helper-handoff";

/**
 * Link my WhatsApp (D-582): a member of staff proves which WhatsApp number is
 * theirs by sending a one-time code from it to the school's number.
 *
 * The rules and the words live here; `data/staff-link.ts` makes the codes and
 * links them, and the helper's turn (`data/helper-turn.ts`) hands it every
 * message that carries one.
 *
 *  - A code is eight characters from 31 that cannot be misread for each other
 *    (no I, L, O, 0 or 1), with at least one letter and one digit, shown as
 *    `ABCD-2345`. 31^8 is about 850 billion, and a code is good for 30 minutes.
 *  - The message WhatsApp opens with names VPPS One and labels the code, so a
 *    parent's message is never taken for one by accident. A code typed by
 *    hand ("ABCD-2345", "code abcd2345") is tried too, and is an ordinary
 *    message again when no such code exists.
 */

export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_MINUTES = 30;

const CODE_CHARS = new Set(LINK_CODE_ALPHABET);

/** Whether eight characters (upper case, no hyphen) are a code One could have made. */
export function isLinkCode(code: string): boolean {
  if (code.length !== LINK_CODE_LENGTH) return false;
  let letters = 0;
  let digits = 0;
  for (const char of code) {
    if (!CODE_CHARS.has(char)) return false;
    if (char >= "2" && char <= "9") digits += 1;
    else letters += 1;
  }
  return letters > 0 && digits > 0;
}

/**
 * A new code. `pick(n)` is a uniformly random whole number below `n`; the
 * server passes `crypto.randomInt`, a test passes a fixed sequence. Drawn again
 * until it has a letter and a digit, so a word such as WHATSAPP is never a code.
 */
export function newLinkCode(pick: (below: number) => number): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let i = 0; i < LINK_CODE_LENGTH; i += 1) code += LINK_CODE_ALPHABET[pick(LINK_CODE_ALPHABET.length)] ?? "";
    if (isLinkCode(code)) return code;
  }
  throw new Error("Could not make a link code.");
}

/** `ABCD-2345`, the way a person reads it out or types it. */
export function showLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The message WhatsApp opens with, ready to send, in the person's language. */
export function linkMessage(code: string, language: StaffLanguage): string {
  return language === "en"
    ? `Hello! Please link my WhatsApp to VPPS One.\nCode: ${showLinkCode(code)}`
    : `नमस्ते! मेरा WhatsApp VPPS One से जोड़ दें।\nकोड: ${showLinkCode(code)}`;
}

/** wa.me to the school's number, the message filled in: a phone opens WhatsApp with it. */
export function linkUrl(code: string, language: StaffLanguage): string {
  return `https://wa.me/${waDigits(SCHOOL_WHATSAPP_NUMBER)}?text=${encodeURIComponent(linkMessage(code, language))}`;
}

/** The school's number as people write it. */
export const SCHOOL_NUMBER_SHOWN = "+91 83022 07823";

const LABELLED = /(?:\bcode|कोड)\s*[:：=\-–]?\s*([a-z0-9]{4})[\s\-–]?([a-z0-9]{4})(?![a-z0-9])/iu;
const BARE = /^\s*([a-z0-9]{4})[\s\-–]?([a-z0-9]{4})\s*$/iu;

export type FoundCode = { code: string; labelled: boolean };

/**
 * The code in a message, or null. `labelled`: the message names VPPS One and
 * labels the code, as the prepared message does, so it is certainly meant as
 * one. Otherwise (a labelled code without VPPS One, or a message that is a
 * code and nothing else) it is only tried: when no such code exists, the
 * message is an ordinary one.
 */
export function linkCodeIn(text: string | null | undefined): FoundCode | null {
  const words = String(text ?? "").slice(0, 400);
  if (!words.trim()) return null;
  const labelled = LABELLED.exec(words);
  if (labelled) {
    const code = `${labelled[1]}${labelled[2]}`.toUpperCase();
    if (isLinkCode(code)) return { code, labelled: /vpps\s*one/i.test(words) };
  }
  const bare = BARE.exec(words);
  if (bare) {
    const code = `${bare[1]}${bare[2]}`.toUpperCase();
    if (isLinkCode(code)) return { code, labelled: false };
  }
  return null;
}

/** What `vppsone.link_staff_whatsapp` said, or `error` when it could not be asked. */
export type LinkOutcome =
  | "linked"
  | "already_linked"
  | "used"
  | "expired"
  | "inactive"
  | "not_test_number"
  | "no_code"
  | "bad_number"
  | "error";

const OUTCOMES: ReadonlySet<string> = new Set([
  "linked",
  "already_linked",
  "used",
  "expired",
  "inactive",
  "not_test_number",
  "no_code",
  "bad_number",
]);

export function linkOutcome(value: unknown): LinkOutcome {
  return typeof value === "string" && OUTCOMES.has(value) ? (value as LinkOutcome) : "error";
}

type Pair = { hi: string; en: string };

/**
 * The answer on WhatsApp, when the helper may answer. `name` only for a link
 * that worked: a code someone else used is answered without saying whose it was.
 */
export function linkReplyText(outcome: LinkOutcome, language: StaffLanguage, name: string | null, helperName: string): string {
  const who = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const words: Record<LinkOutcome, Pair> = {
    linked: {
      hi: [
        `✅ *जुड़ गया${who ? `, ${who} जी` : ""}!* आपका WhatsApp अब VPPS One से जुड़ा है।`,
        "",
        `अभिभावकों के जो सवाल आपके लिए होंगे, ${helperName} उन्हें यहीं भेजेगा, सुबह 6 से रात 9 बजे के बीच। जवाब देने के लिए उस संदेश को दाईं ओर स्वाइप करें और लिखें: जवाब स्कूल के नंबर से अभिभावक को जाएगा।`,
        "",
        "कभी भी यहाँ एक शब्द लिखें: *आज* (आपके पीरियड और कवर), *सवाल* (आपके जवाब का इंतज़ार कर रहे अभिभावक), *अनुपस्थित* (आपकी कक्षा में आज कौन नहीं आया)।",
        "",
        "बंद करना हो तो VPPS One में 'मेरी प्रोफ़ाइल' खोलें।",
      ].join("\n"),
      en: [
        `✅ *Linked${who ? `, ${who}` : ""}!* Your WhatsApp is now joined to VPPS One.`,
        "",
        `${helperName} will pass you parents' questions that are for you, here, between 6 am and 9 pm. To answer, swipe right on the message and type: your answer goes to the parent from the school's number.`,
        "",
        "Write one word here at any time: *today* (your periods and cover), *questions* (parents waiting for your answer), *absent* (who is away in your class today).",
        "",
        "To stop, open My profile in VPPS One.",
      ].join("\n"),
    },
    already_linked: {
      hi: "✅ यह नंबर पहले से जुड़ा है। कुछ और करने की ज़रूरत नहीं। कभी भी यहाँ *आज*, *सवाल* या *अनुपस्थित* लिखें।",
      en: "✅ This number is already linked. Nothing more to do. Write *today*, *questions* or *absent* here at any time.",
    },
    used: {
      hi: "⚠️ यह कोड पहले ही इस्तेमाल हो चुका है। VPPS One में 'मेरी प्रोफ़ाइल' खोलकर फिर से 'मेरा WhatsApp जोड़ें' दबाएँ।",
      en: "⚠️ This code has already been used. Open My profile in VPPS One and tap Link my WhatsApp again.",
    },
    expired: {
      hi: "⌛ यह कोड पुराना हो गया (30 मिनट तक चलता है)। VPPS One में 'मेरी प्रोफ़ाइल' खोलकर फिर से 'मेरा WhatsApp जोड़ें' दबाएँ।",
      en: "⌛ This code has run out (it lasts 30 minutes). Open My profile in VPPS One and tap Link my WhatsApp again.",
    },
    inactive: {
      hi: "⚠️ यह खाता VPPS One में चालू नहीं है, इसलिए नंबर नहीं जोड़ा गया। ऑफ़िस से बात करें।",
      en: "⚠️ This account is not active in VPPS One, so the number was not linked. Please speak to the office.",
    },
    not_test_number: {
      hi: "🧪 यह जाँच खाता है: इससे केवल जाँच की सूची वाला नंबर जुड़ सकता है। नंबर नहीं जोड़ा गया।",
      en: "🧪 This is a test account: only a number on the test list can be linked to it. The number was not linked.",
    },
    no_code: {
      hi: "⚠️ यह कोड नहीं मिला। VPPS One में 'मेरी प्रोफ़ाइल' खोलकर 'मेरा WhatsApp जोड़ें' दबाएँ और वहाँ से संदेश भेजें।",
      en: "⚠️ That code was not found. Open My profile in VPPS One, tap Link my WhatsApp and send the message from there.",
    },
    bad_number: {
      hi: "⚠️ केवल भारत का (+91) WhatsApp नंबर जोड़ा जा सकता है।",
      en: "⚠️ Only an Indian (+91) WhatsApp number can be linked.",
    },
    error: {
      hi: "⚠️ माफ़ कीजिए, अभी नंबर नहीं जुड़ सका। थोड़ी देर बाद यही संदेश फिर भेजें।",
      en: "⚠️ Sorry, the number could not be linked just now. Please send the same message again in a little while.",
    },
  };
  return words[outcome][language];
}
