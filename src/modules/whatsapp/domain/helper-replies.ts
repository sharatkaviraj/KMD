import { formatInr } from "@/platform/helpers/currency";

import type { AbsenceNote } from "./helper-absence";
import { FIELD_LABELS, type ChangeRequest } from "./parent-suggestions";
import { receiptKey, sendableReceipts, type AttendanceStatus, type ChildFacts, type ReceiptFact } from "./helper-facts";
import type { HelperButton, HelperMessage, HelperRow } from "./helper-messages";
import { helperId, type HelperLanguage } from "./helper-text";

/**
 * Everything Veer Patta AI says that is not Claude's own words (D-574): the
 * cards, the menu, the prompts and the acknowledgements, in Hindi, Hinglish
 * (Hindi in Roman letters) and English.
 *
 * Every number on a card comes from the family's own records, through
 * `helper-facts.ts`. Claude never writes a fee figure: when a parent asks for
 * one, Claude names the card and the card says it.
 *
 * The Hindi is neutral about the reader. The helper speaks as the school
 * ("हम") or in forms that do not change with gender, and addresses the parent
 * as "आप".
 */

export type Family = {
  children: ChildFacts[];
  /** The owner's test number standing in for a family: every card says so. */
  practice: boolean;
};

export type ReplyContext = {
  language: HelperLanguage;
  helperName: string;
  family: Family;
  /** The first message the helper ever answers on this number. */
  firstContact?: boolean;
};

export type HandoffTarget = "class_teacher" | "accounts" | "office" | "principal";

export const OFFICE_PHONE = "9352205884";

export type Words = { hi: string; hx: string; en: string };

export function say(language: HelperLanguage, words: Words): string {
  return words[language];
}

const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2027-01-20" -> "20 Jan 2027", or "20 Jan" when it is this year. */
export function dateText(iso: string, language: HelperLanguage, today: string): string {
  const [year, month, dayOfMonth] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !dayOfMonth) return iso;
  const name = language === "hi" ? HI_MONTHS[month - 1] : EN_MONTHS[month - 1];
  const sameYear = today.slice(0, 4) === String(year);
  return sameYear ? `${dayOfMonth} ${name}` : `${dayOfMonth} ${name} ${year}`;
}

/** "Class 6" -> "कक्षा 6" in Hindi; the school's own words otherwise. */
export function classText(className: string, language: HelperLanguage): string {
  if (!className) return "";
  return language === "hi" ? className.replace(/^class\b/i, "कक्षा") : className;
}

function money(value: number): string {
  return formatInr(Math.round(value));
}

function percentText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** "*Rudra* · कक्षा 1": the child as every card heads it. */
function childHeading(child: ChildFacts, language: HelperLanguage): string {
  const klass = classText(child.className, language);
  return klass ? `*${child.firstName}* · ${klass}` : `*${child.firstName}*`;
}

/** "Rudra (Class 1) and Aarav (Class 6)". */
function childrenNames(children: readonly ChildFacts[], language: HelperLanguage): string {
  const names = children.map((child) => {
    const klass = classText(child.className, language);
    return klass ? `*${child.firstName}* (${klass})` : `*${child.firstName}*`;
  });
  if (names.length <= 1) return names[0] ?? "";
  const and = say(language, { hi: "और", hx: "aur", en: "and" });
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

export function footer(context: ReplyContext): string {
  if (context.family.practice) {
    return say(context.language, { hi: "🧪 अभ्यास: परीक्षण रिकॉर्ड", hx: "🧪 Practice: test records", en: "🧪 Practice: test records" });
  }
  return say(context.language, { hi: "श्री वीर पत्ता सी. सै. स्कूल", hx: "Shri Veer Patta Sr. Sec. School", en: "Shri Veer Patta Sr. Sec. School" });
}

/** One short line to open the very first answer on a number. */
export function intro(context: ReplyContext): string {
  if (!context.firstContact) return "";
  return say(context.language, {
    hi: `नमस्ते 🙏 मैं *${context.helperName}* हूँ, स्कूल का सहायक।\n\n`,
    hx: `Namaste 🙏 Main *${context.helperName}* hoon, school ka sahayak.\n\n`,
    en: `Namaste 🙏 I'm *${context.helperName}*, the school's helper.\n\n`,
  });
}

/* ------------------------------------------------------------------ menu */

export function menuRows(language: HelperLanguage): HelperRow[] {
  const row = (intent: Parameters<typeof helperId>[0], title: Words, description: Words): HelperRow => ({
    id: helperId(intent),
    title: say(language, title),
    description: say(language, description),
  });
  return [
    row("fees", { hi: "💰 फ़ीस", hx: "💰 Fees", en: "💰 Fees" }, { hi: "कितनी बाकी है, अगली किस्त कब", hx: "Kitni baki hai, agli kisht kab", en: "What is due, and the next instalment" }),
    row("receipts", { hi: "🧾 रसीदें", hx: "🧾 Receipt", en: "🧾 Receipts" }, { hi: "जमा की गई फ़ीस", hx: "Jama ki gayi fees", en: "Fees paid so far" }),
    row("attendance", { hi: "📅 हाज़िरी", hx: "📅 Hazri", en: "📅 Attendance" }, { hi: "आज की और इस साल की", hx: "Aaj ki aur is saal ki", en: "Today and this year" }),
    row("results", { hi: "📝 परिणाम", hx: "📝 Result", en: "📝 Results" }, { hi: "जारी हुए अंक", hx: "Jari hue marks", en: "Marks the school has released" }),
    row("teacher", { hi: "🧑‍🏫 कक्षा अध्यापक", hx: "🧑‍🏫 Class teacher", en: "🧑‍🏫 Class teacher" }, { hi: "नाम, और उन्हें संदेश भेजें", hx: "Naam, aur unhe sandesh bhejiye", en: "Their name, and send them a message" }),
    // A school visit for a new child (D-592): a brother or sister, or a family the school does not know yet.
    row("visit", { hi: "🎒 दाख़िला: स्कूल देखें", hx: "🎒 Admission visit", en: "🎒 Admission visit" }, { hi: "स्कूल देखने आने का दिन चुनें", hx: "School dekhne aane ka din chuniye", en: "Book a day to come and see the school" }),
    row("office", { hi: "🏫 ऑफ़िस से बात", hx: "🏫 Office se baat", en: "🏫 Talk to the office" }, { hi: "स्कूल ऑफ़िस को संदेश", hx: "School office ko sandesh", en: "A message for the school office" }),
  ];
}

function menuMessage(body: string, context: ReplyContext): HelperMessage {
  return {
    kind: "list",
    body,
    button: say(context.language, { hi: "मेनू खोलें", hx: "Menu kholiye", en: "Open menu" }),
    rows: menuRows(context.language),
    footer: footer(context),
  };
}

export const MENU_BUTTON = (language: HelperLanguage): HelperButton => ({ id: helperId("menu"), title: say(language, { hi: "📋 मेनू", hx: "📋 Menu", en: "📋 Menu" }) });

/** The first hello on a number. */
export function welcomeCard(context: ReplyContext): HelperMessage {
  const { language, helperName } = context;
  const kids = childrenNames(context.family.children, language);
  const body = say(language, {
    hi: `नमस्ते 🙏 मैं *${helperName}* हूँ, श्री वीर पत्ता सी. सै. स्कूल का सहायक।\n\n${kids} की फ़ीस, रसीद, हाज़िरी और परिणाम यहाँ तुरंत देखें। मेनू खोलें या अपना सवाल लिखें।\n\n_You can also write in English._`,
    hx: `Namaste 🙏 Main *${helperName}* hoon, Shri Veer Patta Sr. Sec. School ka sahayak.\n\n${kids} ki fees, receipt, hazri aur result yahan turant dekhiye. Menu kholiye ya apna sawal likhiye.`,
    en: `Namaste 🙏 I'm *${helperName}*, the helper of Shri Veer Patta Sr. Sec. School.\n\nFor ${kids}: fees, receipts, attendance and results, here and instantly. Open the menu or type your question.\n\n_आप हिंदी में भी लिख सकते हैं।_`,
  });
  return menuMessage(body, context);
}

/** A hello from somebody the helper has already greeted, or "menu". */
export function menuCard(context: ReplyContext, greeting: boolean): HelperMessage {
  const body = greeting
    ? say(context.language, {
        hi: "नमस्ते 🙏 क्या देखना चाहेंगे? मेनू खोलें या अपना सवाल लिखें।",
        hx: "Namaste 🙏 Kya dekhna chahenge? Menu kholiye ya apna sawal likhiye.",
        en: "Namaste 🙏 What would you like to see? Open the menu or type your question.",
      })
    : say(context.language, {
        hi: "यह रहा मेनू 👇 जो देखना हो, चुनें।",
        hx: "Yeh raha menu 👇 Jo dekhna ho, chuniye.",
        en: "Here is the menu 👇 Pick what you would like to see.",
      });
  return menuMessage(body, context);
}

/* ------------------------------------------------------------------ fees */

function feesBlock(child: ChildFacts, language: HelperLanguage): string {
  const head = childHeading(child, language);
  const fees = child.fees;
  if (!fees) {
    return `${head}\n${say(language, { hi: "फ़ीस की जानकारी अभी नहीं मिली। कृपया ऑफ़िस से पूछें।", hx: "Fees ki jankari abhi nahi mili. Kripya office se puchhiye.", en: "The fee details are not available yet. Please ask the office." })}`;
  }
  const lines = [head];
  if (fees.feesPending <= 0) {
    lines.push(say(language, { hi: "✅ इस साल की पूरी फ़ीस जमा है।", hx: "✅ Is saal ki puri fees jama hai.", en: "✅ This year's fees are fully paid." }));
  } else {
    lines.push(say(language, { hi: `बाकी फ़ीस: *${money(fees.feesPending)}*`, hx: `Baki fees: *${money(fees.feesPending)}*`, en: `Fees still to pay: *${money(fees.feesPending)}*` }));
    if (fees.lastYear > 0) {
      lines.push(say(language, {
        hi: `• इसमें पिछले साल का बकाया: ${money(fees.lastYear)}`,
        hx: `• Isme pichhle saal ka bakaya: ${money(fees.lastYear)}`,
        en: `• Of this, from last year: ${money(fees.lastYear)}`,
      }));
    }
    if (fees.overdue.count > 0 && fees.overdue.since) {
      const since = dateText(fees.overdue.since, language, child.today);
      const count = fees.overdue.count;
      lines.push(say(language, {
        hi: `• तारीख निकल चुकी: ${money(fees.overdue.amount)} (${count} ${count === 1 ? "किस्त" : "किस्तें"}, ${since} से)`,
        hx: `• Tareekh nikal chuki: ${money(fees.overdue.amount)} (${count} kisht, ${since} se)`,
        en: `• Overdue: ${money(fees.overdue.amount)} (${count} ${count === 1 ? "instalment" : "instalments"}, since ${since})`,
      }));
    }
    if (fees.next) {
      const due = dateText(fees.next.dueDate, language, child.today);
      const isToday = fees.next.dueDate === child.today;
      lines.push(say(language, {
        hi: `• अगली किस्त: ${money(fees.next.amount)}, ${isToday ? "आज" : due}`,
        hx: `• Agli kisht: ${money(fees.next.amount)}, ${isToday ? "aaj" : due}`,
        en: `• Next instalment: ${money(fees.next.amount)}, ${isToday ? "due today" : `due ${due}`}`,
      }));
    }
  }
  if (fees.lateFeePending > 0) {
    lines.push(say(language, {
      hi: `लेट फ़ीस (अलग से): ${money(fees.lateFeePending)}`,
      hx: `Late fee (alag se): ${money(fees.lateFeePending)}`,
      en: `Late fee (separate): ${money(fees.lateFeePending)}`,
    }));
  }
  lines.push(say(language, { hi: `इस साल जमा: ${money(fees.paid)}`, hx: `Is saal jama: ${money(fees.paid)}`, en: `Paid this year: ${money(fees.paid)}` }));
  return lines.join("\n");
}

function sessionOf(children: readonly ChildFacts[]): string {
  const labels = [...new Set(children.map((child) => child.sessionLabel))];
  return labels.length === 1 ? ` ${labels[0]}` : "";
}

export function feesCard(context: ReplyContext, children: readonly ChildFacts[] = context.family.children): HelperMessage {
  const { language } = context;
  const title = say(language, { hi: "💰 *फ़ीस", hx: "💰 *Fees", en: "💰 *Fees" }) + `${sessionOf(children)}*`;
  const close = say(language, {
    hi: "फ़ीस स्कूल ऑफ़िस में जमा की जा सकती है।",
    hx: "Fees school office mein jama ki ja sakti hai.",
    en: "Fees can be paid at the school office.",
  });
  const body = `${intro(context)}${title}\n\n${children.map((child) => feesBlock(child, language)).join("\n\n")}\n\n${close}`;
  return {
    kind: "buttons",
    body,
    buttons: [{ id: helperId("receipts"), title: say(language, { hi: "🧾 रसीदें", hx: "🧾 Receipt", en: "🧾 Receipts" }) }, MENU_BUTTON(language)],
    footer: footer(context),
  };
}

/* -------------------------------------------------------------- receipts */

export function modeText(mode: string, language: HelperLanguage): string {
  switch (mode) {
    case "cash":
      return say(language, { hi: "नकद", hx: "Cash", en: "Cash" });
    case "upi":
      return "UPI";
    case "bank_transfer":
      return say(language, { hi: "बैंक ट्रांसफ़र", hx: "Bank transfer", en: "Bank transfer" });
    case "cheque":
      return say(language, { hi: "चेक", hx: "Cheque", en: "Cheque" });
    // A Pay now payment. Never "Cash" (the Fees app's rule).
    case "online":
      return "UPI (Razorpay)";
    default:
      return mode;
  }
}

function receiptLine(receipt: ReceiptFact, language: HelperLanguage, today: string): string {
  const parts = [receipt.number, dateText(receipt.date, language, today), money(receipt.amount), modeText(receipt.mode, language)];
  const reversed = receipt.reversed ? ` ↩️ ${say(language, { hi: "रद्द", hx: "radd", en: "reversed" })}` : "";
  return `• ${parts.join(" · ")}${reversed}`;
}

/** The card's button that sends a receipt itself, as a PDF in the chat (D-597). */
export const SEND_RECEIPT_BUTTON = (language: HelperLanguage): HelperButton => ({
  id: helperId("receipt_send"),
  title: say(language, { hi: "📄 रसीद भेजें", hx: "📄 Receipt bhejiye", en: "📄 Send receipt" }),
});

export function receiptsCard(context: ReplyContext, children: readonly ChildFacts[] = context.family.children): HelperMessage {
  const { language } = context;
  const blocks = children.map((child) => {
    const head = childHeading(child, language);
    if (child.receipts.length === 0) {
      return `${head}\n${say(language, { hi: "अभी कोई रसीद नहीं।", hx: "Abhi koi receipt nahi.", en: "No receipts yet." })}`;
    }
    return [head, ...child.receipts.map((receipt) => receiptLine(receipt, language, child.today))].join("\n");
  });
  // A receipt that can be sent gets the button that sends it (D-597); a
  // reversed one was cancelled, so there is nothing to keep.
  const canSend = sendableReceipts(children).length > 0;
  const close = canSend
    ? say(language, {
        hi: "📄 रसीद की PDF यहीं चाहिए तो *रसीद भेजें* दबाएँ।",
        hx: "📄 Receipt ki PDF yahin chahiye to *Receipt bhejiye* dabaiye.",
        en: "📄 Tap *Send receipt* and the receipt comes here as a PDF.",
      })
    : say(language, {
        hi: "रसीद के बारे में कुछ पूछना हो तो ऑफ़िस से कहें।",
        hx: "Receipt ke baare mein kuch poochhna ho to office se kahiye.",
        en: "For anything about a receipt, ask the office.",
      });
  const title = say(language, { hi: "🧾 *रसीदें*", hx: "🧾 *Receipts*", en: "🧾 *Receipts*" });
  const fees: HelperButton = { id: helperId("fees"), title: say(language, { hi: "💰 फ़ीस", hx: "💰 Fees", en: "💰 Fees" }) };
  return {
    kind: "buttons",
    body: `${intro(context)}${title}\n\n${blocks.join("\n\n")}\n\n${close}`,
    buttons: canSend ? [SEND_RECEIPT_BUTTON(language), fees, MENU_BUTTON(language)] : [fees, MENU_BUTTON(language)],
    footer: footer(context),
  };
}

/**
 * Which receipt to send, when there is more than one (D-597): a list, latest
 * first, each row its amount and date, with the child and the number under
 * it. `gone` is a tap on a receipt no longer on the list (reversed since, or
 * no longer among the latest): the list again, saying so.
 */
export function receiptPickList(context: ReplyContext, children: readonly ChildFacts[] = context.family.children, gone = false): HelperMessage {
  const { language } = context;
  const rows: HelperRow[] = sendableReceipts(children)
    .slice(0, 10)
    .map(({ child, receipt }) => ({
      id: helperId("receipt_pdf", receiptKey(child, receipt)),
      title: `${money(receipt.amount)} · ${dateText(receipt.date, language, child.today)}`,
      description: `${child.firstName} · ${receipt.number} · ${modeText(receipt.mode, language)}`,
    }));
  const note = gone
    ? say(language, {
        hi: "वह रसीद अब इस सूची में नहीं है।\n\n",
        hx: "Woh receipt ab is list mein nahi hai.\n\n",
        en: "That receipt is no longer on the list.\n\n",
      })
    : "";
  const ask = say(language, {
    hi: "कौन-सी रसीद चाहिए? 👇 चुनें, उसकी PDF यहीं आ जाएगी।",
    hx: "Kaunsi receipt chahiye? 👇 Chuniye, uski PDF yahin aa jayegi.",
    en: "Which receipt would you like? 👇 Pick one and its PDF comes right here.",
  });
  return {
    kind: "list",
    body: `${intro(context)}${note}${ask}`,
    button: say(language, { hi: "रसीद चुनें", hx: "Receipt chuniye", en: "Choose receipt" }),
    rows,
    section: say(language, { hi: "रसीदें", hx: "Receipts", en: "Receipts" }),
    footer: footer(context),
  };
}

/** The words under a receipt's PDF in the chat (D-597). */
export function receiptCaption(context: ReplyContext, child: ChildFacts, receipt: ReceiptFact): string {
  const { language } = context;
  const title = say(language, { hi: `🧾 *रसीद ${receipt.number}*`, hx: `🧾 *Receipt ${receipt.number}*`, en: `🧾 *Receipt ${receipt.number}*` });
  const paid = [money(receipt.amount), dateText(receipt.date, language, child.today), modeText(receipt.mode, language)].join(" · ");
  return `${intro(context)}${title}\n${childHeading(child, language)}\n${paid}\n\n_${footer(context)}_`;
}

/**
 * The receipt could not be attached (D-597): the PDF could not be made, or
 * Meta would not take it. Says so, gives the receipt's line and the office's
 * number, and offers to try again.
 */
export function receiptUnsentReply(context: ReplyContext, child: ChildFacts, receipt: ReceiptFact): HelperMessage {
  const { language } = context;
  const sorry = say(language, {
    hi: `माफ़ कीजिए 🙏 रसीद की PDF अभी नहीं भेजी जा सकी। थोड़ी देर में *फिर से भेजें* दबाएँ, या ऑफ़िस से कॉपी लें: ${OFFICE_PHONE}`,
    hx: `Maaf kijiye 🙏 Receipt ki PDF abhi nahi bheji ja saki. Thodi der mein *Phir se bhejiye* dabaiye, ya office se copy lijiye: ${OFFICE_PHONE}`,
    en: `Sorry 🙏 the receipt's PDF could not be sent just now. Tap *Try again* in a little while, or ask the office for a copy: ${OFFICE_PHONE}`,
  });
  return {
    kind: "buttons",
    body: `${intro(context)}${sorry}\n\n${childHeading(child, language)}\n${receiptLine(receipt, language, child.today)}`,
    buttons: [
      { id: helperId("receipt_pdf", receiptKey(child, receipt)), title: say(language, { hi: "🔁 फिर से भेजें", hx: "🔁 Phir se bhejiye", en: "🔁 Try again" }) },
      MENU_BUTTON(language),
    ],
    footer: footer(context),
  };
}

/* ------------------------------------------------------------ attendance */

export function statusText(status: AttendanceStatus, language: HelperLanguage): string {
  switch (status) {
    case "present":
      return say(language, { hi: "✅ उपस्थित", hx: "✅ Present", en: "✅ Present" });
    case "absent":
      return say(language, { hi: "❌ अनुपस्थित", hx: "❌ Absent", en: "❌ Absent" });
    case "late":
      return say(language, { hi: "⏰ देरी से", hx: "⏰ Late", en: "⏰ Late" });
    case "half_day":
      return say(language, { hi: "🌓 आधा दिन", hx: "🌓 Half day", en: "🌓 Half day" });
    case "leave":
      return say(language, { hi: "📝 छुट्टी", hx: "📝 Leave", en: "📝 On leave" });
  }
}

function attendanceBlock(child: ChildFacts, language: HelperLanguage): string {
  const head = childHeading(child, language);
  const facts = child.attendance;
  if (!facts) {
    return `${head}\n${say(language, { hi: "हाज़िरी की जानकारी अभी नहीं है।", hx: "Hazri ki jankari abhi nahi hai.", en: "No attendance has been recorded yet." })}`;
  }
  const lines = [head];
  lines.push(
    facts.today
      ? say(language, { hi: `आज: ${statusText(facts.today, language)}`, hx: `Aaj: ${statusText(facts.today, language)}`, en: `Today: ${statusText(facts.today, language)}` })
      : say(language, { hi: "आज: रजिस्टर अभी नहीं भरा गया", hx: "Aaj: register abhi nahi bhara gaya", en: "Today: the register is not in yet" }),
  );
  if (facts.percent !== null && facts.daysCounted > 0) {
    const pct = percentText(facts.percent);
    lines.push(say(language, {
      hi: `इस साल: *${pct}* (${facts.daysCounted} दिन)`,
      hx: `Is saal: *${pct}* (${facts.daysCounted} din)`,
      en: `This year: *${pct}* (${facts.daysCounted} days)`,
    }));
    lines.push(say(language, {
      hi: `अनुपस्थित: ${facts.absentDays} दिन · देर से: ${facts.lateDays} दिन`,
      hx: `Absent: ${facts.absentDays} din · Late: ${facts.lateDays} din`,
      en: `Absent: ${facts.absentDays} days · Late: ${facts.lateDays} days`,
    }));
  }
  if (facts.recentAbsences.length > 0) {
    const days = facts.recentAbsences.map((date) => dateText(date, language, child.today)).join(", ");
    lines.push(say(language, { hi: `हाल की अनुपस्थिति: ${days}`, hx: `Haal ki absent: ${days}`, en: `Recent absences: ${days}` }));
  }
  return lines.join("\n");
}

export function attendanceCard(context: ReplyContext, children: readonly ChildFacts[] = context.family.children): HelperMessage {
  const { language } = context;
  const title = say(language, { hi: "📅 *हाज़िरी*", hx: "📅 *Hazri*", en: "📅 *Attendance*" });
  return {
    kind: "buttons",
    body: `${intro(context)}${title}\n\n${children.map((child) => attendanceBlock(child, language)).join("\n\n")}`,
    buttons: [{ id: helperId("results"), title: say(language, { hi: "📝 परिणाम", hx: "📝 Result", en: "📝 Results" }) }, MENU_BUTTON(language)],
    footer: footer(context),
  };
}

/* --------------------------------------------------------------- results */

function resultsBlock(child: ChildFacts, language: HelperLanguage): string {
  const head = childHeading(child, language);
  const latest = child.results[0];
  if (!latest) {
    return `${head}\n${say(language, { hi: "अभी कोई परिणाम जारी नहीं हुआ।", hx: "Abhi koi result jari nahi hua.", en: "No results have been released yet." })}`;
  }
  const exam = language === "hi" ? latest.examHi ?? latest.exam : latest.exam;
  const marks = latest.subjects.map((subject) => {
    const name = language === "hi" ? subject.nameHi ?? subject.name : subject.name;
    if (subject.exempt) return `${name} ${say(language, { hi: "छूट", hx: "chhoot", en: "exempt" })}`;
    if (subject.absent) return `${name} ${say(language, { hi: "अनुपस्थित", hx: "absent", en: "absent" })}`;
    if (subject.got === null) return `${name} —`;
    return `${name} ${trimNumber(subject.got)}/${trimNumber(subject.max)}`;
  });
  const lines = [`${head} · ${exam}`, marks.join(" · ")];
  if (latest.max > 0) {
    const pct = percentText((latest.got / latest.max) * 100);
    lines.push(say(language, {
      hi: `कुल: *${trimNumber(latest.got)}/${trimNumber(latest.max)}* (${pct})`,
      hx: `Kul: *${trimNumber(latest.got)}/${trimNumber(latest.max)}* (${pct})`,
      en: `Total: *${trimNumber(latest.got)}/${trimNumber(latest.max)}* (${pct})`,
    }));
  }
  return lines.join("\n");
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function resultsCard(context: ReplyContext, children: readonly ChildFacts[] = context.family.children): HelperMessage {
  const { language } = context;
  const title = say(language, { hi: "📝 *परिणाम*", hx: "📝 *Result*", en: "📝 *Results*" });
  return {
    kind: "buttons",
    body: `${intro(context)}${title}\n\n${children.map((child) => resultsBlock(child, language)).join("\n\n")}`,
    buttons: [{ id: helperId("attendance"), title: say(language, { hi: "📅 हाज़िरी", hx: "📅 Hazri", en: "📅 Attendance" }) }, MENU_BUTTON(language)],
    footer: footer(context),
  };
}

/* --------------------------------------------------------------- teacher */

export function teacherCard(context: ReplyContext, children: readonly ChildFacts[] = context.family.children): HelperMessage {
  const { language } = context;
  const title = say(language, { hi: "🧑‍🏫 *कक्षा अध्यापक*", hx: "🧑‍🏫 *Class teacher*", en: "🧑‍🏫 *Class teacher*" });
  const lines = children.map((child) => {
    const name = child.classTeacher?.name ?? say(language, { hi: "अभी तय नहीं", hx: "abhi tay nahi", en: "not assigned yet" });
    return `${childHeading(child, language)}: ${name}`;
  });
  const close = say(language, {
    hi: "अध्यापक को संदेश भेजना हो तो नीचे दबाएँ और अपना संदेश लिखें। हम उन तक पहुँचा देंगे।",
    hx: "Teacher ko sandesh bhejna ho to neeche dabaiye aur apna sandesh likhiye. Hum unhe pahuncha denge.",
    en: "To send the teacher a message, tap below and type it. We will pass it on.",
  });
  const buttons: HelperButton[] = children.slice(0, 3).map((child) => ({
    id: helperId("message_teacher", child.key),
    title: say(language, { hi: `✉️ संदेश: ${child.firstName}`, hx: `✉️ Sandesh: ${child.firstName}`, en: `✉️ Message: ${child.firstName}` }),
  }));
  return { kind: "buttons", body: `${intro(context)}${title}\n\n${lines.join("\n")}\n\n${close}`, buttons, footer: footer(context) };
}

export const CANCEL_BUTTON = (language: HelperLanguage): HelperButton => ({ id: helperId("menu"), title: say(language, { hi: "❌ रहने दें", hx: "❌ Rehne dijiye", en: "❌ Cancel" }) });

/** After "Message: Rudra": the next thing the parent types goes to the teacher. */
export function teacherPrompt(context: ReplyContext, child: ChildFacts): HelperMessage {
  const { language } = context;
  const klass = classText(child.className, language);
  const body = say(language, {
    hi: `✍️ *${child.firstName}* (${klass}) के कक्षा अध्यापक के लिए अपना संदेश अब लिखें। हम उन तक पहुँचा देंगे।`,
    hx: `✍️ *${child.firstName}* (${klass}) ke class teacher ke liye apna sandesh ab likhiye. Hum unhe pahuncha denge.`,
    en: `✍️ Type your message for *${child.firstName}*'s class teacher (${klass}) now. We will pass it on.`,
  });
  return { kind: "buttons", body, buttons: [CANCEL_BUTTON(language)], footer: footer(context) };
}

/** "Talk to the office": the next thing the parent types goes to the office. */
export function officePrompt(context: ReplyContext): HelperMessage {
  const body = say(context.language, {
    hi: `✍️ स्कूल ऑफ़िस के लिए अपना संदेश अब लिखें, हम पहुँचा देंगे।\nया ऑफ़िस को फ़ोन करें: ${OFFICE_PHONE}`,
    hx: `✍️ School office ke liye apna sandesh ab likhiye, hum pahuncha denge.\nYa office ko phone kariye: ${OFFICE_PHONE}`,
    en: `✍️ Type your message for the school office now and we will pass it on.\nOr call the office: ${OFFICE_PHONE}`,
  });
  return { kind: "buttons", body, buttons: [CANCEL_BUTTON(context.language)], footer: footer(context) };
}

/* -------------------------------------------------------------- hand-off */

/**
 * What a parent is told once a child's absence is in front of the school
 * (D-588): which day's register shows it once the class teacher (or, for a
 * class with none, the school) has checked it, and, for an illness, a kind
 * word. Nothing reaches the register before a person applies it (D-598), so
 * the line never says it already has. Only said after it is kept.
 */
export function absenceLines(child: ChildFacts, note: AbsenceNote, language: HelperLanguage, target: HandoffTarget = "class_teacher"): string {
  const day = (iso: string) => dateText(iso, language, child.today);
  const first = note.days[0] ?? child.today;
  const last = note.days[note.days.length - 1] ?? first;
  const teacher = target === "class_teacher";
  const checked = say(language, {
    hi: teacher ? "कक्षा अध्यापक के जाँचने के बाद" : "स्कूल के जाँचने के बाद",
    hx: teacher ? "Class teacher ke check karne ke baad" : "School ke check karne ke baad",
    en: teacher ? "When the class teacher has checked it" : "When the school has checked it",
  });
  const register =
    first === last
      ? first === child.today
        ? say(language, {
            hi: `📋 ${checked}, आज की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।`,
            hx: `📋 ${checked}, aaj ki hazri mein likha rahega ki aapne school ko bata diya tha.`,
            en: `📋 ${checked}, today's register will show that you told the school.`,
          })
        : say(language, {
            hi: `📋 ${checked}, ${day(first)} की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।`,
            hx: `📋 ${checked}, ${day(first)} ki hazri mein likha rahega ki aapne school ko bata diya tha.`,
            en: `📋 ${checked}, the register for ${day(first)} will show that you told the school.`,
          })
      : say(language, {
          hi: `📋 ${checked}, ${day(first)} से ${day(last)} तक की हाज़िरी में लिखा रहेगा कि आपने स्कूल को बता दिया था।`,
          hx: `📋 ${checked}, ${day(first)} se ${day(last)} tak ki hazri mein likha rahega ki aapne school ko bata diya tha.`,
          en: `📋 ${checked}, the register from ${day(first)} to ${day(last)} will show that you told the school.`,
        });
  if (note.reason !== "sick") return register;
  const wish = say(language, {
    hi: `🌼 *${child.firstName}* जल्दी ठीक हो जाए, यही कामना है।`,
    hx: `🌼 *${child.firstName}* jaldi theek ho jaye, yahi kaamna hai.`,
    en: `🌼 We hope *${child.firstName}* feels better soon.`,
  });
  return `${register}\n${wish}`;
}

/**
 * What a parent is told once a detail they asked to change is in front of
 * the office (D-598): that the office checks it before the record changes.
 * Never that it has changed, or that it will.
 */
export function changeLine(child: ChildFacts, change: ChangeRequest, language: HelperLanguage): string {
  const label = FIELD_LABELS[change.field];
  return say(language, {
    hi: `📝 *${child.firstName}* के रिकॉर्ड में ${label.hi ?? label.en} बदलने से पहले ऑफ़िस इसे जाँचेगा।`,
    hx: `📝 *${child.firstName}* ke record mein badlav se pehle office ise check karega.`,
    en: `📝 The office will check it before *${child.firstName}*'s ${label.en.toLowerCase()} is changed in the school's records.`,
  });
}

/** The words after a message has been put in front of the school. */
export function handoffAck(
  context: ReplyContext,
  target: HandoffTarget,
  detail: {
    child: ChildFacts | null;
    teacherName: string | null;
    lateHour: boolean;
    aiReply?: string | null;
    absence?: AbsenceNote | null;
    change?: ChangeRequest | null;
  },
): HelperMessage {
  const { language } = context;
  const child = detail.child;
  let line: string;
  if (target === "class_teacher" && child) {
    const teacher = detail.teacherName ? ` (${detail.teacherName})` : "";
    line = say(language, {
      hi: `✅ आपका संदेश *${child.firstName}* के कक्षा अध्यापक${teacher} तक पहुँचा दिया गया है।`,
      hx: `✅ Aapka sandesh *${child.firstName}* ke class teacher${teacher} tak pahuncha diya gaya hai.`,
      en: `✅ Your message has been passed to *${child.firstName}*'s class teacher${teacher}.`,
    });
  } else if (target === "accounts") {
    line = say(language, {
      hi: "✅ आपकी बात स्कूल के अकाउंट्स विभाग तक पहुँचा दी गई है।",
      hx: "✅ Aapki baat school ke accounts vibhag tak pahuncha di gayi hai.",
      en: "✅ Your message has been passed to the school's accounts team.",
    });
  } else if (target === "principal") {
    line = say(language, {
      hi: "✅ आपकी बात प्रधानाचार्य कार्यालय तक पहुँचा दी गई है।",
      hx: "✅ Aapki baat principal office tak pahuncha di gayi hai.",
      en: "✅ Your message has been passed to the principal's office.",
    });
  } else {
    line = say(language, {
      hi: "✅ आपका संदेश स्कूल ऑफ़िस तक पहुँचा दिया गया है।",
      hx: "✅ Aapka sandesh school office tak pahuncha diya gaya hai.",
      en: "✅ Your message has been passed to the school office.",
    });
  }
  // A note of absence needs no answer: the register line says what happens to it instead.
  // A changed detail says who checks it first.
  const next =
    detail.absence && child
      ? `\n${absenceLines(child, detail.absence, language, target)}`
      : detail.change && child
        ? `\n${changeLine(child, detail.change, language)}`
        : ` ${say(language, { hi: "स्कूल आपसे संपर्क करेगा।", hx: "School aapse sampark karega.", en: "The school will get back to you." })}`;
  const late = detail.lateHour
    ? `\n${say(language, {
        hi: "🌙 अभी देर हो चुकी है, इसलिए इसे सुबह 6 बजे के बाद देखा जाएगा।",
        hx: "🌙 Abhi der ho chuki hai, isliye ise subah 6 baje ke baad dekha jayega.",
        en: "🌙 It is late now, so it will be seen after 6 am.",
      })}`
    : "";
  const before = detail.aiReply ? `${detail.aiReply}\n\n` : "";
  return { kind: "buttons", body: `${before}${line}${next}${late}`, buttons: [MENU_BUTTON(language)], footer: footer(context) };
}

/** The hand-off could not be written: say so, and give the office's number. Never claim it was passed on. */
export function handoffFailedReply(context: ReplyContext): HelperMessage {
  return {
    kind: "buttons",
    body: say(context.language, {
      hi: `माफ़ कीजिए, अभी आपका संदेश आगे नहीं भेजा जा सका 🙏 कृपया थोड़ी देर बाद फिर लिखें, या ऑफ़िस को फ़ोन करें: ${OFFICE_PHONE}`,
      hx: `Maaf kijiye, abhi aapka sandesh aage nahi bheja ja saka 🙏 Kripya thodi der baad phir likhiye, ya office ko phone kariye: ${OFFICE_PHONE}`,
      en: `Sorry, your message could not be passed on just now 🙏 Please write again in a little while, or call the office: ${OFFICE_PHONE}`,
    }),
    buttons: [MENU_BUTTON(context.language)],
    footer: footer(context),
  };
}

/* --------------------------------------------- did this help (D-584) */

/**
 * Asked once, right after a staff answer reaches the parent. Two buttons, and
 * the body says what "No" does, so nobody has to guess.
 */
export function ratingQuestion(context: ReplyContext, key: string): HelperMessage {
  const { language } = context;
  return {
    kind: "buttons",
    body: say(language, {
      hi: "क्या इस जवाब से आपकी मदद हुई?\nअगर नहीं, तो *नहीं* दबाएँ: स्कूल ऑफ़िस इसे देखेगा।",
      hx: "Kya is jawab se aapki madad hui?\nAgar nahi, to *Nahi* dabaiye: school office ise dekhega.",
      en: "Did this answer help?\nIf not, tap *No* and the school office will look at it.",
    }),
    buttons: [
      { id: helperId("helped", key), title: say(language, { hi: "👍 हाँ, मदद हुई", hx: "👍 Haan, madad hui", en: "👍 Yes, it helped" }) },
      { id: helperId("not_helped", key), title: say(language, { hi: "👎 नहीं", hx: "👎 Nahi", en: "👎 No" }) },
    ],
    footer: footer(context),
  };
}

/**
 * What became of a parent's tap on "Did this answer help?":
 *  - `helped`: a yes, kept (or a yes to a question too old to find: thanked all the same).
 *  - `already`: they had answered this one before.
 *  - `passed_on`: a no, now with the school office.
 *  - `already_passed_on`: a no the office already has.
 *  - `not_passed_on`: a no that could not be written down: never claimed as passed on.
 *  - `ask_office`: a no to a question too old to find: they are shown the way to the office.
 */
export type RatingOutcome = "helped" | "already" | "passed_on" | "already_passed_on" | "not_passed_on" | "ask_office";

export const OFFICE_BUTTON = (language: HelperLanguage): HelperButton => ({
  id: helperId("office"),
  title: say(language, { hi: "🏫 ऑफ़िस से बात", hx: "🏫 Office se baat", en: "🏫 Talk to office" }),
});

/** The helper's answer to the tap, with the menu under it. */
export function ratingReply(context: ReplyContext, outcome: RatingOutcome, lateHour: boolean): HelperMessage {
  const { language } = context;
  const late = lateHour
    ? `\n${say(language, {
        hi: "🌙 अभी देर हो चुकी है, इसलिए इसे सुबह 6 बजे के बाद देखा जाएगा।",
        hx: "🌙 Abhi der ho chuki hai, isliye ise subah 6 baje ke baad dekha jayega.",
        en: "🌙 It is late now, so it will be seen after 6 am.",
      })}`
    : "";
  const words: Record<RatingOutcome, Words> = {
    helped: {
      hi: "🙏 बताने के लिए धन्यवाद! हमें ख़ुशी है कि इससे मदद हुई। कभी भी लिखें।",
      hx: "🙏 Batane ke liye dhanyavad! Humein khushi hai ki isse madad hui. Kabhi bhi likhiye.",
      en: "🙏 Thank you for telling us! We're glad it helped. Write any time.",
    },
    already: {
      hi: "🙏 धन्यवाद, यह पहले ही दर्ज हो चुका है।",
      hx: "🙏 Dhanyavad, yeh pehle hi darj ho chuka hai.",
      en: "🙏 Thank you, that is already noted.",
    },
    passed_on: {
      hi: "🙏 माफ़ कीजिए कि इससे मदद नहीं हुई। आपका सवाल और यह जवाब स्कूल ऑफ़िस तक पहुँचा दिया गया है, वहाँ से आपको यहीं जवाब मिलेगा।",
      hx: "🙏 Maaf kijiye ki isse madad nahi hui. Aapka sawal aur yeh jawab school office tak pahuncha diya gaya hai, wahan se aapko yahin jawab milega.",
      en: "🙏 Sorry that did not help. Your question and this answer have been passed to the school office, and they will answer you here.",
    },
    already_passed_on: {
      hi: "🙏 आपका सवाल स्कूल ऑफ़िस के पास पहले से है, वहाँ से आपको यहीं जवाब मिलेगा।",
      hx: "🙏 Aapka sawal school office ke paas pehle se hai, wahan se aapko yahin jawab milega.",
      en: "🙏 The school office already has your question, and will answer you here.",
    },
    not_passed_on: {
      hi: `माफ़ कीजिए कि इससे मदद नहीं हुई 🙏 अभी इसे आगे नहीं भेजा जा सका। कृपया ऑफ़िस को फ़ोन करें: ${OFFICE_PHONE}`,
      hx: `Maaf kijiye ki isse madad nahi hui 🙏 Abhi ise aage nahi bheja ja saka. Kripya office ko phone kariye: ${OFFICE_PHONE}`,
      en: `Sorry that did not help 🙏 It could not be passed on just now. Please call the office: ${OFFICE_PHONE}`,
    },
    ask_office: {
      hi: "माफ़ कीजिए 🙏 नीचे *ऑफ़िस से बात* दबाएँ और बताएँ कि आपको और क्या जानना है।",
      hx: "Maaf kijiye 🙏 Neeche *Office se baat* dabaiye aur bataiye ki aapko aur kya jaanna hai.",
      en: "Sorry about that 🙏 Tap *Talk to office* below and tell us what you still need.",
    },
  };
  const body = `${say(language, words[outcome])}${outcome === "passed_on" ? late : ""}`;
  const buttons = outcome === "ask_office" ? [OFFICE_BUTTON(language), MENU_BUTTON(language)] : [MENU_BUTTON(language)];
  return { kind: "buttons", body, buttons, footer: footer(context) };
}

/* ------------------------------------------------------- everything else */

export function voiceReply(context: ReplyContext): HelperMessage {
  return menuMessage(
    say(context.language, {
      hi: "🎙️ माफ़ कीजिए, आवाज़ वाला संदेश अभी यहाँ नहीं सुना जा सकता। कृपया अपना सवाल लिखकर भेजें, या मेनू खोलें।",
      hx: "🎙️ Maaf kijiye, voice message abhi yahan nahi suna ja sakta. Kripya apna sawal likhkar bhejiye, ya menu kholiye.",
      en: "🎙️ Sorry, voice notes cannot be heard here yet. Please type your question, or open the menu.",
    }),
    context,
  );
}

export function mediaReply(context: ReplyContext): HelperMessage {
  return menuMessage(
    say(context.language, {
      hi: "📎 धन्यवाद। फ़ोटो या फ़ाइल यहाँ नहीं खुलती, पर स्कूल ऑफ़िस इसे देख सकता है। कोई सवाल हो तो लिखकर भेजें।",
      hx: "📎 Dhanyavad. Photo ya file yahan nahi khulti, par school office ise dekh sakta hai. Koi sawal ho to likhkar bhejiye.",
      en: "📎 Thank you. Photos and files cannot be opened here, but the school office can see them. If you have a question, please type it.",
    }),
    context,
  );
}

export function thanksReply(context: ReplyContext): HelperMessage {
  return {
    kind: "text",
    text: say(context.language, {
      hi: "🙏 आपका भी धन्यवाद! कभी भी लिखें।",
      hx: "🙏 Aapka bhi dhanyavad! Kabhi bhi likhiye.",
      en: "🙏 You're welcome! Write any time.",
    }),
  };
}

/** The helper did not understand, or could not ask Claude: the menu, and the office. */
export function fallbackReply(context: ReplyContext): HelperMessage {
  return menuMessage(
    say(context.language, {
      hi: "माफ़ कीजिए, यह समझ नहीं आया 🙏 मेनू से चुनें, या *ऑफ़िस* लिखें और हम आपका सवाल स्कूल ऑफ़िस तक पहुँचा देंगे।",
      hx: "Maaf kijiye, yeh samajh nahi aaya 🙏 Menu se chuniye, ya *office* likhiye aur hum aapka sawal school office tak pahuncha denge.",
      en: "Sorry, I did not understand that 🙏 Pick from the menu, or type *office* and we will pass your question to the school office.",
    }),
    context,
  );
}

/** Claude's own words, with the card it asked for under them when both fit in one message. */
export function aiAnswer(context: ReplyContext, reply: string, card: HelperMessage | null): HelperMessage {
  const words = reply.trim();
  if (!card) {
    return { kind: "buttons", body: words, buttons: [MENU_BUTTON(context.language)], footer: footer(context) };
  }
  if (card.kind === "text") return { kind: "text", text: `${words}\n\n${card.text}` };
  // A card is never a file; a document keeps its own words.
  if (card.kind === "document") return card;
  // Too long for one interactive message, it goes as plain text, nothing cut (`fitMessage`).
  return { ...card, body: `${words}\n\n${card.body}` };
}

/** The card for an intent, or null for an intent that has none. */
export function cardFor(
  intent: "fees" | "receipts" | "attendance" | "results" | "teacher" | "menu",
  context: ReplyContext,
  children: readonly ChildFacts[] = context.family.children,
): HelperMessage {
  switch (intent) {
    case "fees":
      return feesCard(context, children);
    case "receipts":
      return receiptsCard(context, children);
    case "attendance":
      return attendanceCard(context, children);
    case "results":
      return resultsCard(context, children);
    case "teacher":
      return teacherCard(context, children);
    case "menu":
      return menuCard(context, false);
  }
}
