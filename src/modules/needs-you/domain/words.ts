import type { IconName } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";

import type { NeedKind, NeedLane, NeedReason } from "./types";

/**
 * Every word Needs you says, in both languages (D-630). Written for staff who
 * are new to apps: short, the verb first, no office words.
 */
export const NW = {
  title: p("Needs you", "आपके लिए"),
  hint: p("What is waiting for you, in order", "आपके लिए क्या बाकी है, क्रम से"),
  next: p("Do this next", "अब यह करें"),
  open: p("Open the list", "पूरी सूची खोलें"),
  seeAll: p("See all", "सब देखें"),
  doneToday: p("Done today", "आज पूरे हुए"),
  nothingDone: p("Nothing finished yet today", "आज अभी कुछ पूरा नहीं हुआ"),
  allClear: p("All done for now", "अभी सब हो गया"),
  allClearSub: p("Nothing is waiting on you. Well done!", "अभी आपके लिए कुछ बाकी नहीं। बहुत बढ़िया!"),
  remindLater: p("Remind me later", "बाद में याद दिलाएँ"),
  remindWhen: p("When should I remind you?", "कब याद दिलाऊँ?"),
  addOwn: p("Add my own", "अपना काम जोड़ें"),
  addTitle: p("Add something to do", "करने का काम जोड़ें"),
  addHint: p(
    "Type or speak it, with a time if you like: “kal subah 9 baje Ramesh ke papa ko phone”.",
    "लिखें या बोलें, चाहें तो समय के साथ: “कल सुबह 9 बजे रमेश के पापा को फ़ोन”।",
  ),
  addPlaceholder: p("What do you need to do?", "क्या करना है?"),
  save: p("Save", "सहेजें"),
  saving: p("Saving…", "सहेज रहे हैं…"),
  saved: p("Saved", "सहेजा गया"),
  cancel: p("Cancel", "रद्द करें"),
  done: p("Done", "हो गया"),
  undo: p("Undo", "वापस"),
  noTime: p("No time", "कोई समय नहीं"),
  inHour: p("In 1 hour", "1 घंटे बाद"),
  afterLunch: p("After lunch", "लंच के बाद"),
  evening: p("This evening", "आज शाम"),
  tomorrowMorning: p("Tomorrow morning", "कल सुबह"),
  sayTime: p("Say or type a time", "समय बोलें या लिखें"),
  heard: p("I'll remind you", "मैं याद दिलाऊँगा"),
  remindAt: p("Reminder", "याद"),
  remindedNow: p("You asked to be reminded now", "आपने अभी याद दिलाने को कहा था"),
  backNow: p("Back on your list", "फिर से आपकी सूची में"),
  remindSet: p("I'll remind you", "याद दिला दूँगा"),
  arrangedAi: p("Arranged by AI", "AI ने क्रम लगाया"),
  arrangedRules: p("Sorted by time", "समय के हिसाब से"),
  arranging: p("AI is arranging your list…", "AI आपकी सूची का क्रम लगा रहा है…"),
  aiReady: p("A better order is ready", "बेहतर क्रम तैयार है"),
  useIt: p("Use it", "लगाएँ"),
  listen: p("Listen", "सुनें"),
  left: (n: number): Pair => p(n === 1 ? "1 job left today" : `${n} jobs left today`, `आज ${n} काम बाकी`),
  doneCount: (n: number): Pair => p(`${n} done`, `${n} पूरे`),
  waitingSince: p("Waiting since", "से इंतज़ार"),
  waitingOn: p("Waiting on", "किसका इंतज़ार"),
  stripNone: p("Nothing waiting on you right now", "अभी आपके लिए कुछ बाकी नहीं"),
  viewing: p("You are only looking: nothing here can be changed.", "आप केवल देख रहे हैं: यहाँ कुछ बदला नहीं जा सकता।"),
  failed: p("Could not save. Please try again.", "सहेजा नहीं गया। फिर से कोशिश करें।"),
  tooLong: p("Please keep it short, under 200 letters.", "छोटा लिखें, 200 अक्षरों से कम।"),
  empty: p("Please write what you need to do.", "क्या करना है, लिखें।"),
  remove: p("Remove this to-do", "यह काम हटाएँ"),
  removed: p("Removed", "हटाया गया"),
  later: p("Later", "बाद में"),
  bringBack: p("Bring back", "वापस लाएँ"),
  changeTime: p("Change time", "समय बदलें"),
  remindMe: p("Remind me", "याद दिलाएँ"),
  understood: p("I understood", "मैंने समझा"),
  noTimeFound: p("No time in it: it goes on today's list. Add a time if you like.", "इसमें समय नहीं है: यह आज की सूची में जाएगा। चाहें तो समय जोड़ें।"),
  timeUnclear: p("I could not read a time. Try “kal 9 baje” or “in 2 hours”.", "समय समझ नहीं आया। “कल 9 बजे” या “2 घंटे बाद” लिखें।"),
  orPick: p("Or pick one", "या एक चुनें"),
  readTime: p("Use this time", "यह समय लें"),
  whyFirst: p("Why first?", "पहले क्यों?"),
  laneCount: (n: number): Pair => p(String(n), String(n)),
  noneInLane: p("Nothing here", "यहाँ कुछ नहीं"),
  myOwn: p("My own to-dos", "मेरे अपने काम"),
  someoneWaits: (n: number): Pair => p(n === 1 ? "1 waiting" : `${n} waiting`, `${n} इंतज़ार में`),
  listenLine: (n: number): Pair => p(n === 1 ? "You have 1 job." : `You have ${n} jobs.`, `आपके ${n} काम हैं।`),
  office: p("The office", "कार्यालय"),
  teachers: p("Teachers", "शिक्षक"),
  admin: p("The admin", "प्रशासक"),
} as const;

export const LANE_WORDS: Record<NeedLane, { title: Pair; hint: Pair; icon: IconName; tone: "bad" | "acc" | "info" | "mut" }> = {
  now: { title: p("Do now", "अभी करें"), hint: p("Late, starting soon, or someone is waiting", "देर हो रही है, जल्दी शुरू होगा, या कोई इंतज़ार में है"), icon: "zap", tone: "bad" },
  today: { title: p("Today", "आज"), hint: p("To be done today", "आज करना है"), icon: "sun", tone: "acc" },
  later: { title: p("Later", "बाद में"), hint: p("Another day, or put off for later", "किसी और दिन, या बाद के लिए रखा"), icon: "clock", tone: "info" },
  waiting: { title: p("Waiting on others", "दूसरों के जवाब का इंतज़ार"), hint: p("You did your part", "आपका काम हो गया"), icon: "history", tone: "mut" },
};

/** Why a job is where it is: one short reason, said after "First, …". */
export const REASON_WORDS: Record<NeedReason, Pair> = {
  late: p("it is late", "देर हो रही है"),
  starts_soon: p("it starts soon", "जल्दी शुरू होगा"),
  someone_waiting: p("someone is waiting", "कोई इंतज़ार कर रहा है"),
  reminded: p("you asked to be reminded", "आपने याद दिलाने को कहा था"),
  quick_first: p("it takes a minute", "एक मिनट का काम है"),
  due_today: p("it is due today", "आज करना है"),
  big_job_early: p("a big job is best started early", "बड़ा काम जल्दी शुरू करना अच्छा"),
};

export const KIND_ICON: Record<NeedKind, IconName> = {
  attendance: "calCheck",
  cover: "swap",
  marks: "clipboard",
  remarks: "award",
  task: "inbox",
  followup: "note",
  notice: "megaphone",
  wish: "cake",
  leave: "calendar",
  counter: "users",
  calls: "phone",
  promise: "flag",
  cheques: "bank",
  upi: "zap",
  close: "lock",
  request: "send",
  exam_marks: "clipboard",
  exam_step: "list",
  results: "grad",
  refund: "rupee",
  job: "alert",
  parent: "message",
  toilets: "toilet",
  chat: "message",
  own: "notePen",
};

/** Hindi minutes and hours for "in 20 min" style lines. */
export function inMinutes(minutes: number): Pair {
  if (minutes <= 0) return p("now", "अभी");
  if (minutes < 60) return p(`in ${minutes} min`, `${minutes} मिनट में`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? p(`in ${h} h ${m} min`, `${h} घंटे ${m} मिनट में`) : p(`in ${h} h`, `${h} घंटे में`);
}

/** "40 min late", "2 days late". */
export function lateBy(minutes: number): Pair {
  if (minutes >= 24 * 60) {
    const d = Math.floor(minutes / (24 * 60));
    return p(d === 1 ? "1 day late" : `${d} days late`, `${d} दिन देर`);
  }
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    return p(h === 1 ? "1 hour late" : `${h} hours late`, `${h} घंटे देर`);
  }
  return p(`${minutes} min late`, `${minutes} मिनट देर`);
}
