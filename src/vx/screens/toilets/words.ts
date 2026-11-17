import type { ChartState, Problem, Slot, UsedBy } from "@/modules/toilets/domain/checks";
import { p, type Pair } from "@/vx/text";

/*
 * Every word on the Toilet checks screen (D-652), in English and Hindi. Plain
 * words for office staff: "toilet", "chart", "photo", "check", never a
 * database name.
 */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन॰", "फ़र॰", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अग॰", "सित॰", "अक्टू॰", "नव॰", "दिस॰"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HI = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];

const parts = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return { date: d.getUTCDate(), month: d.getUTCMonth(), dow: d.getUTCDay(), year: d.getUTCFullYear() };
};

/** "Mon 17 Nov" / "सोम 17 नव॰" */
export function dayLabel(day: string): Pair {
  const x = parts(day);
  return p(`${DAYS_EN[x.dow]} ${x.date} ${MONTHS_EN[x.month]}`, `${DAYS_HI[x.dow]} ${x.date} ${MONTHS_HI[x.month]}`);
}

/** "Mon" / "सोम" */
export function weekdayLabel(day: string): Pair {
  const x = parts(day);
  return p(DAYS_EN[x.dow], DAYS_HI[x.dow]);
}

/** "17 – 22 Nov" (or "29 Dec – 3 Jan") */
export function weekRange(weekStart: string, saturday: string): Pair {
  const a = parts(weekStart);
  const b = parts(saturday);
  if (a.month === b.month) return p(`${a.date} – ${b.date} ${MONTHS_EN[b.month]}`, `${a.date} – ${b.date} ${MONTHS_HI[b.month]}`);
  return p(`${a.date} ${MONTHS_EN[a.month]} – ${b.date} ${MONTHS_EN[b.month]}`, `${a.date} ${MONTHS_HI[a.month]} – ${b.date} ${MONTHS_HI[b.month]}`);
}

/** "9:00 am" / "सुबह 9:00" */
export function clock(hhmm: string): Pair {
  const [h, m] = hhmm.split(":").map(Number);
  const twelve = ((h + 11) % 12) + 1;
  const en = `${twelve}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  const hiPart = h < 12 ? "सुबह" : h < 16 ? "दोपहर" : "शाम";
  return p(en, `${hiPart} ${twelve}:${String(m).padStart(2, "0")}`);
}

export const W = {
  title: p("Toilet checks", "शौचालय जाँच"),
  crumb: p("Children & staff · Toilet checks", "बच्चे व स्टाफ़ · शौचालय जाँच"),
  lead: p(
    "Each toilet is checked twice a day on a printed chart. After the week, photograph the chart and upload it here.",
    "हर शौचालय दिन में दो बार छपे चार्ट पर जाँचा जाता है। हफ़्ते के बाद चार्ट की फ़ोटो लेकर यहाँ अपलोड करें।",
  ),
  how: [
    { icon: "printer", text: p("Print each toilet's chart on Monday", "सोमवार को हर शौचालय का चार्ट छापें") },
    { icon: "check", text: p("The checker ticks it morning and afternoon", "जाँचने वाला सुबह और दोपहर टिक करे") },
    { icon: "camera", text: p("After Saturday, photograph it and upload", "शनिवार के बाद फ़ोटो लेकर अपलोड करें") },
  ] as const,

  thisWeek: p("This week", "इस हफ़्ते"),
  lastWeek: p("Last week", "पिछले हफ़्ते"),
  weeksLabel: p("Which week", "कौन-सा हफ़्ता"),

  slot: { morning: p("Morning", "सुबह"), afternoon: p("Afternoon", "दोपहर") } satisfies Record<Slot, Pair>,
  usedBy: {
    boys: p("Boys", "लड़के"),
    girls: p("Girls", "लड़कियाँ"),
    staff: p("Staff", "स्टाफ़"),
    all: p("Everyone", "सभी"),
  } satisfies Record<UsedBy, Pair>,

  state: {
    done: p("Uploaded", "अपलोड हो गया"),
    this_week: p("Checks going on", "जाँच चल रही है"),
    due_today: p("Upload today", "आज अपलोड करें"),
    late: p("Not uploaded", "अपलोड नहीं हुआ"),
    closed: p("School closed", "स्कूल बंद"),
    not_needed: p("Not on the list", "सूची में नहीं"),
  } satisfies Record<ChartState, Pair>,

  kpi: {
    uploaded: p("Charts uploaded", "चार्ट अपलोड"),
    uploadedOf: (n: number, of: number) => p(`${n} of ${of}`, `${of} में से ${n}`),
    missed: p("Checks missed", "छूटी जाँच"),
    missedSub: (checks: number) => p(`of ${checks} checks`, `${checks} जाँच में से`),
    late: p("Charts not uploaded", "अपलोड नहीं हुए चार्ट"),
    lateSub: p("In the last 8 weeks", "पिछले 8 हफ़्तों में"),
    toilets: p("Toilets", "शौचालय"),
  },

  uploadedBy: (name: string | null, when: Pair) =>
    name ? p(`By ${name} · ${when.en}`, `${name} ने · ${when.hi}`) : p(`Uploaded ${when.en}`, `अपलोड ${when.hi}`),
  missedLine: (n: number) => (n === 0 ? p("Every check done", "हर जाँच पूरी") : p(`${n} ${n === 1 ? "check" : "checks"} missed`, `${n} जाँच छूटी`)),
  pages: (n: number) => p(`${n} ${n === 1 ? "page" : "pages"}`, `${n} पन्ने`),
  dueBy: (day: Pair) => p(`Upload after Saturday, by ${day.en}`, `शनिवार के बाद, ${day.hi} तक अपलोड करें`),
  checksSoFar: (n: number) => p(`${n} checks this week`, `इस हफ़्ते ${n} जाँच`),

  printChart: p("Print chart", "चार्ट छापें"),
  printAll: p("Print all charts", "सारे चार्ट छापें"),
  printAllHint: p("One page for each toilet, for this week", "हर शौचालय का एक पन्ना, इस हफ़्ते के लिए"),
  upload: p("Upload photo", "फ़ोटो अपलोड करें"),
  uploadAgain: p("Upload again", "फिर से अपलोड करें"),
  seePhoto: p("See photo", "फ़ोटो देखें"),
  close: p("Close", "बंद करें"),

  /* what's missing */
  gapsTitle: p("Waiting for you", "आपके लिए बाकी"),
  gapLate: (toilet: string, week: Pair) => p(`${toilet}: chart for ${week.en} not uploaded`, `${toilet}: ${week.hi} का चार्ट अपलोड नहीं हुआ`),
  gapDue: (toilet: string, week: Pair) => p(`${toilet}: upload the chart for ${week.en} today`, `${toilet}: ${week.hi} का चार्ट आज अपलोड करें`),
  gapMissed: (toilet: string, n: number) => p(`${toilet}: ${n} ${n === 1 ? "check" : "checks"} missed last week`, `${toilet}: पिछले हफ़्ते ${n} जाँच छूटी`),
  allGood: p("Every chart is in. Nothing is waiting.", "हर चार्ट आ गया है। कुछ बाकी नहीं।"),

  /* nothing yet */
  noToilets: p("No toilets added yet", "अभी कोई शौचालय नहीं जोड़ा"),
  noToiletsBody: p("Add each toilet once, for example “Boys, ground floor”. Then print its chart.", "हर शौचालय एक बार जोड़ें, जैसे “लड़के, भूतल”। फिर उसका चार्ट छापें।"),
  noToiletsAsk: p("The office or the admin adds the toilets.", "शौचालय कार्यालय या प्रशासक जोड़ते हैं।"),
  notSetUp: p("Toilet checks is being set up. Try again in a little while.", "शौचालय जाँच तैयार हो रही है। थोड़ी देर बाद देखें।"),
  couldNotLoad: p("Could not load the toilet checks. Check the internet and open this page again.", "शौचालय जाँच खुल नहीं पाई। इंटरनेट देखकर पेज फिर खोलें।"),
  noSession: p("No school year is open", "कोई सत्र खुला नहीं है"),
  noSessionBody: p("Choose the school year at the top first.", "पहले ऊपर से सत्र चुनें।"),
  testYear: p("Practice year: these toilets and photos are for testing only.", "अभ्यास सत्र: ये शौचालय और फ़ोटो सिर्फ़ जाँच के लिए हैं।"),

  /* upload sheet */
  uploadTitle: (toilet: string) => p(`Upload chart · ${toilet}`, `चार्ट अपलोड · ${toilet}`),
  step1: p("1. Photograph the filled chart", "1. भरे हुए चार्ट की फ़ोटो लें"),
  step1Hint: p("Hold the phone straight over the sheet so every box can be read. Two pages if needed.", "फ़ोन को चार्ट के ठीक ऊपर रखें ताकि हर खाना पढ़ा जा सके। ज़रूरत हो तो दो पन्ने।"),
  step2: p("2. Tap any check left empty on the paper", "2. काग़ज़ पर जो जाँच ख़ाली रह गई, उस पर टैप करें"),
  step2Hint: p("All are marked done. Tap only the ones nobody ticked or signed.", "सब पूरी मानी गई हैं। सिर्फ़ उन पर टैप करें जिन पर किसी ने टिक या हस्ताक्षर नहीं किया।"),
  done: p("Done", "पूरी"),
  missedWord: p("Missed", "छूटी"),
  closedDay: p("Closed", "बंद"),
  step3: p("3. Anything to tell the admin? (not needed)", "3. प्रशासक को कुछ बताना है? (ज़रूरी नहीं)"),
  notePlaceholder: p("For example: tap was leaking on Wednesday", "जैसे: बुधवार को नल टपक रहा था"),
  replaceNote: p("This week already has a photo. The new one will take its place; the old one is kept.", "इस हफ़्ते की फ़ोटो पहले से है। नई फ़ोटो उसकी जगह लेगी; पुरानी रखी रहेगी।"),
  save: p("Save chart", "चार्ट सहेजें"),
  needPhoto: p("Take a photo of the chart first.", "पहले चार्ट की फ़ोटो लें।"),
  uploading: (i: number, n: number) => p(`Sending photo ${i} of ${n}…`, `फ़ोटो ${n} में से ${i} भेजी जा रही है…`),
  checking: p("Checking the photos…", "फ़ोटो जाँची जा रही हैं…"),
  saved: p("Chart saved", "चार्ट सहेजा गया"),
  savedMissed: (n: number) => (n ? p(`Saved. ${n} missed ${n === 1 ? "check" : "checks"} told to the admin.`, `सहेजा गया। ${n} छूटी जाँच प्रशासक को बताई गई।`) : p("Saved. Every check was done.", "सहेजा गया। हर जाँच पूरी थी।")),
  savedLost: p("We could not hear back. It may have saved: close this and look at the list before uploading again.", "जवाब नहीं आया। शायद सहेज गया हो: इसे बंद करके सूची देखें, फिर ही दोबारा अपलोड करें।"),

  /* photo sheet */
  photoTitle: (toilet: string, week: Pair) => p(`${toilet} · ${week.en}`, `${toilet} · ${week.hi}`),
  photoOf: (i: number, n: number) => p(`Page ${i} of ${n}`, `पन्ना ${i} / ${n}`),
  noteFrom: p("Note", "नोट"),
  missedList: p("Checks missed", "छूटी जाँच"),
  removePhoto: p("Take this photo off", "यह फ़ोटो हटाएँ"),
  removePhotoAsk: p("Take this photo off the week? It stays on file, and the week shows as not uploaded.", "यह फ़ोटो इस हफ़्ते से हटाएँ? यह रिकॉर्ड में रहेगी, और हफ़्ता अपलोड नहीं हुआ दिखेगा।"),
  removedPhoto: p("Photo taken off", "फ़ोटो हटाई गई"),
  openFull: p("Open full size", "पूरे आकार में खोलें"),

  /* manage */
  manage: p("Toilets & check times", "शौचालय व जाँच का समय"),
  manageHint: p("Add or remove toilets; set the times and what is ticked", "शौचालय जोड़ें या हटाएँ; समय और जाँच की बातें तय करें"),
  toiletsList: p("Toilets", "शौचालय"),
  addToilet: p("Add toilet", "शौचालय जोड़ें"),
  change: p("Change", "बदलें"),
  remove: p("Remove", "हटाएँ"),
  removeAsk: (name: string) => p(`Remove “${name}”? Its old charts stay; no new chart is asked for.`, `“${name}” हटाएँ? पुराने चार्ट रहेंगे; नया चार्ट नहीं माँगा जाएगा।`),
  name: p("Name", "नाम"),
  namePlaceholder: p("For example: Boys, ground floor", "जैसे: लड़के, भूतल"),
  place: p("Where (not needed)", "कहाँ (ज़रूरी नहीं)"),
  placePlaceholder: p("For example: Near the library", "जैसे: पुस्तकालय के पास"),
  usedByLabel: p("Used by", "कौन इस्तेमाल करता है"),
  moveUp: p("Move up", "ऊपर करें"),
  times: p("Check times", "जाँच का समय"),
  morningAt: p("Morning check", "सुबह की जाँच"),
  afternoonAt: p("Afternoon check", "दोपहर की जाँच"),
  checklist: p("What is ticked at each check", "हर जाँच में क्या देखा जाए"),
  checklistHint: p("Up to 8 lines. They are printed as columns on the chart.", "अधिकतम 8 पंक्तियाँ। ये चार्ट पर खानों की तरह छपती हैं।"),
  itemEn: p("In English", "अंग्रेज़ी में"),
  itemHi: p("In Hindi", "हिंदी में"),
  addItem: p("Add a line", "पंक्ति जोड़ें"),
  removeItem: p("Remove this line", "यह पंक्ति हटाएँ"),
  saveSettings: p("Save times and list", "समय और सूची सहेजें"),
  saveToilet: p("Save toilet", "शौचालय सहेजें"),
  savedToilet: p("Toilet saved", "शौचालय सहेजा गया"),
  removedToilet: p("Toilet removed", "शौचालय हटाया गया"),
  savedSettings: p("Times and list saved", "समय और सूची सहेजी गई"),
  fixAbove: p("Please fix the boxes marked in red.", "लाल निशान वाले खाने ठीक करें।"),

  answer: {
    not_set_up: p("Toilet checks is still being set up. Try again later.", "शौचालय जाँच अभी तैयार हो रही है। बाद में कोशिश करें।"),
    not_found: p("This was removed or changed by someone else. The list is now up to date.", "इसे किसी और ने हटा या बदल दिया। सूची अब ताज़ा है।"),
    duplicate: p("A toilet with this name is already on the list.", "इस नाम का शौचालय पहले से सूची में है।"),
    changed: p("Someone changed this toilet while you were editing. Close it and look again.", "आपके बदलते समय किसी और ने यह शौचालय बदल दिया। बंद करके फिर देखें।"),
    bad_request: p("Something in the form was not right. Check it and save again.", "फ़ॉर्म में कुछ ठीक नहीं था। देखकर फिर सहेजें।"),
    photo: p("A photo could not be read. Take it again and save.", "एक फ़ोटो पढ़ी नहीं जा सकी। फिर से लेकर सहेजें।"),
    storage: p("The photos could not be sent. Check the internet and press Save again.", "फ़ोटो भेजी नहीं जा सकीं। इंटरनेट देखकर फिर सहेजें दबाएँ।"),
    failed: p("Could not save just now. Check the internet and try again.", "अभी सहेजा नहीं जा सका। इंटरनेट देखकर फिर कोशिश करें।"),
    denied: p("This account cannot do this.", "यह खाता यह नहीं कर सकता।"),
    preview: p("You are seeing the app as someone else. Switch back to make changes.", "आप ऐप को किसी और की तरह देख रहे हैं। बदलाव के लिए वापस आएँ।"),
    session: p("The year was changed in another tab. Reload this page and try again.", "दूसरे टैब में साल बदला गया। यह पेज दोबारा खोलकर फिर कोशिश करें।"),
    week: p("Charts can be uploaded for this week and the weeks before it only.", "चार्ट सिर्फ़ इस हफ़्ते और पिछले हफ़्तों के लिए अपलोड हो सकते हैं।"),
  },
};

/** The words under a box that was not filled in right. */
export const PROBLEM: Record<Problem, Pair> = {
  name_missing: p("Please write the toilet's name.", "कृपया शौचालय का नाम लिखें।"),
  name_long: p("Keep the name under 60 letters.", "नाम 60 अक्षर से छोटा रखें।"),
  place_long: p("Keep this under 60 letters.", "इसे 60 अक्षर से छोटा रखें।"),
  used_by: p("Choose who uses it.", "चुनें कि कौन इस्तेमाल करता है।"),
  time: p("Choose a time.", "समय चुनें।"),
  times_order: p("The afternoon check must be after the morning one.", "दोपहर की जाँच सुबह के बाद होनी चाहिए।"),
  items_none: p("Write at least one thing to check.", "जाँच की कम से कम एक बात लिखें।"),
  items_many: p("Up to 8 lines fit on the chart.", "चार्ट पर अधिकतम 8 पंक्तियाँ आती हैं।"),
  item_long: p("Keep each line under 40 letters.", "हर पंक्ति 40 अक्षर से छोटी रखें।"),
  item_blank: p("A line is empty.", "एक पंक्ति ख़ाली है।"),
};
