import type { ChatDesk } from "@/modules/chats/domain/types";
import { p, type Pair } from "@/vx/text";

/**
 * The words of the Chats screens (D-616), in both languages. Pure, and kept
 * out of `src/messages/index.ts`, which every page carries: only the chats'
 * own pages and their pop-up read these.
 */

export const T = {
  title: p("Chats with parents", "अभिभावकों से चैट"),
  short: p("Chats", "चैट"),
  crumb: p("Parents · WhatsApp", "अभिभावक · व्हाट्सऐप"),
  back: p("All chats", "सभी चैट"),

  // The admin's tabs (the owner, 15 Nov 2026: filtered, never a flood).
  forYou: p("For you", "आपके लिए"),
  teachers: p("Class teachers", "कक्षा अध्यापक"),
  accounts: p("Accounts", "अकाउंट्स"),
  all: p("All", "सभी"),
  allTeachers: p("All teachers", "सभी अध्यापक"),

  active: p("Open", "खुली"),
  waitingOnly: p("Waiting", "प्रतीक्षा"),
  done: p("Done", "पूरी"),
  hasDues: p("Fees due", "फीस बाकी"),
  search: p("Name, phone or admission no.", "नाम, फ़ोन या प्रवेश संख्या"),

  emptyTitle: p("No parent is waiting", "कोई अभिभावक प्रतीक्षा में नहीं"),
  emptyBody: p(
    "When a parent writes on WhatsApp and needs a person at school, the chat comes here, and you get a WhatsApp message with a link.",
    "जब कोई अभिभावक व्हाट्सऐप पर लिखते हैं और उन्हें स्कूल के किसी व्यक्ति की ज़रूरत होती है, तो बातचीत यहाँ आती है और आपको लिंक के साथ व्हाट्सऐप संदेश मिलता है।",
  ),
  emptyFiltered: p("No chat matches", "कोई बातचीत नहीं मिली"),
  emptyFilteredBody: p("Try another tab, or clear the search.", "दूसरा टैब देखें, या खोज हटाएँ।"),
  emptyDone: p("Nothing marked done yet", "अभी कुछ पूरा नहीं हुआ"),
  off: p("Chats are switched off", "चैट बंद हैं"),
  offBody: p(
    "Parents' messages go to Veer Patta AI and Messages as before. An admin can switch chats on in Settings → WhatsApp.",
    "अभिभावकों के संदेश पहले की तरह Veer Patta AI और संदेश में जाते हैं। एडमिन Settings → WhatsApp में चैट चालू कर सकते हैं।",
  ),
  oldLink: p("That link is more than a week old. Here are your chats.", "वह लिंक एक हफ़्ते से पुराना है। ये रहीं आपकी चैट।"),
  couldNotRead: p("The chats could not be read just now.", "अभी चैट पढ़ी नहीं जा सकीं।"),
  tryAgain: p("Try again", "फिर कोशिश करें"),
  clearFilters: p("Show my chats", "मेरी चैट दिखाएँ"),
  waitingCount: (count: number) => (count === 1 ? p("1 parent waiting", "1 अभिभावक प्रतीक्षा में") : p(`${count} parents waiting`, `${count} अभिभावक प्रतीक्षा में`)),
  showLabel: p("Open or finished chats", "चालू या पूरी हुई बातचीत"),
  practice: p("Practice", "अभ्यास"),
  practiceBanner: p(
    "Practice chats: replies go only to the owner's test number.",
    "अभ्यास चैट: जवाब सिर्फ़ मालिक के टेस्ट नंबर पर जाते हैं।",
  ),

  // A row.
  school: p("School", "स्कूल"),
  wantsPrincipal: p("Wants the principal", "प्रधानाचार्य से बात"),
  complaint: p("Complaint", "शिकायत"),
  noAnswerDay: p("No answer for a day", "एक दिन से जवाब नहीं"),
  takenBy: (name: string) => p(`${name} is answering`, `${name} जवाब दे रहे हैं`),
  youAnswering: p("You are answering", "आप जवाब दे रहे हैं"),
  unread: (count: number) => p(`${count} new`, `${count} नए`),
  open: p("Open", "खोलें"),
  parentOf: (children: string) => p(`Parent of ${children}`, `${children} के अभिभावक`),
  rowWaiting: p("Waiting for a reply", "जवाब की प्रतीक्षा"),
  rowOpen: p("Replied", "जवाब दिया"),
  rowDone: p("Finished", "पूरी"),
  finishedItself: p("Finished by itself", "अपने आप पूरी"),
  secWaiting: p("Waiting for a reply", "जवाब की प्रतीक्षा में"),
  secOthers: p("Other chats", "बाकी बातचीत"),
  secDone: p("Finished talks", "पूरी हुई बातचीत"),
  showOpen: p("Open chats", "चालू बातचीत"),
  showDone: p("Finished", "पूरी हुई"),
  duesHint: p("Families with fees due, the biggest first", "जिन परिवारों की फीस बाकी है, सबसे ज़्यादा वाले पहले"),
  duesFailed: p("Fees due could not be read just now. Try again in a minute.", "बाकी फीस अभी पढ़ी नहीं जा सकी। एक मिनट बाद फिर कोशिश करें।"),
  due: (amount: string) => p(`${amount} due`, `${amount} बाकी`),
  more: (count: number) => p(`${count} more: search to find them`, `${count} और: खोजकर ढूँढें`),
  pickChat: p("Choose a chat on the left", "बाईं ओर से कोई बातचीत चुनें"),
  pickChatBody: p("The parent's messages and your reply box open here.", "अभिभावक के संदेश और आपका जवाब यहाँ खुलेंगे।"),

  // The chat window.
  call: p("Call", "कॉल"),
  childPage: p("Child's page", "बच्चे का पेज"),
  childPageOf: (name: string) => p(`${name}'s page`, `${name} का पेज`),
  noMessages: p("No messages yet", "अभी कोई संदेश नहीं"),
  newBelow: p("New messages", "नए संदेश"),
  signedOut: p("You are signed out. Sign in again to see new messages.", "आप साइन आउट हो गए हैं। नए संदेश देखने के लिए फिर से साइन इन करें।"),
  goneBack: p("Back to chats", "चैट पर वापस"),
  earlierFailed: p("Earlier messages could not be read. Try again.", "पुराने संदेश अभी नहीं पढ़े जा सके। फिर कोशिश करें।"),
  opening: p("Opening the chat…", "बातचीत खुल रही है…"),
  wantsAdminBanner: p("The parent asked to talk to the principal.", "अभिभावक ने प्रधानाचार्य से बात करने को कहा है।"),
  complaintBanner: p("The parent has a complaint. Read it carefully before you reply.", "अभिभावक की शिकायत है। जवाब देने से पहले ध्यान से पढ़ें।"),
  signIn: p("Sign in", "साइन इन करें"),
  jumpDown: p("Go to the newest message", "सबसे नए संदेश पर जाएँ"),
  actionsLabel: p("What you can do", "आप क्या कर सकते हैं"),
  markDone: p("Finished", "बात पूरी"),
  markDoneLong: p("Talk finished", "बात पूरी हुई"),
  markDoneHint: p(
    "Tap when nothing more is needed. If the parent writes again, the chat comes back.",
    "जब और कुछ न करना हो तब दबाएँ। अभिभावक फिर लिखें तो बातचीत वापस आ जाएगी।",
  ),
  reopen: p("Open again", "फिर खोलें"),
  pass: p("Give to someone else", "किसी और को दें"),
  takeOver: p("Reply yourself", "खुद जवाब दें"),
  handBack: p("Give it back", "वापस करें"),
  older: p("Show earlier messages", "पुराने संदेश दिखाएँ"),
  today: p("Today", "आज"),
  yesterday: p("Yesterday", "कल"),
  newMessages: p("New messages", "नए संदेश"),
  ai: p("Veer Patta AI", "Veer Patta AI"),
  aiSaid: p("Veer Patta AI answered", "Veer Patta AI ने जवाब दिया"),
  sendAgain: p("Send again", "फिर भेजें"),
  sentAgain: p("Sent again below", "नीचे फिर भेजा गया"),
  openFile: p("Open", "खोलें"),
  download: p("Download", "डाउनलोड"),
  voiceNote: p("Voice note", "वॉइस नोट"),
  map: p("Open the map", "नक्शा खोलें"),
  notPassedOn: p(
    "The parent sent something WhatsApp does not pass on (a poll, or a view-once photo).",
    "अभिभावक ने कुछ ऐसा भेजा जो व्हाट्सऐप आगे नहीं भेजता (पोल या एक बार दिखने वाली फ़ोटो)।",
  ),
  tapped: p("Tapped", "दबाया"),
  you: p("You", "आप"),
  tick: {
    sending: p("Sending…", "भेज रहे हैं…"),
    sent: p("Sent", "भेजा गया"),
    delivered: p("Delivered", "पहुँच गया"),
    read: p("Read by the parent", "अभिभावक ने पढ़ा"),
    waiting: p("Waits for the parent", "अभिभावक की प्रतीक्षा में"),
    failed: p("Not sent", "नहीं गया"),
  },
  tapToRetry: p("Not sent. Tap Send again.", "नहीं गया। फिर भेजें दबाएँ।"),
  sentToast: p("Sent to the parent's WhatsApp", "अभिभावक के व्हाट्सऐप पर भेजा गया"),
  waitingToast: p("Saved. It reaches the parent as soon as they reply.", "सहेजा गया। अभिभावक के जवाब देते ही पहुँच जाएगा।"),
  failedToast: p("Not sent. Your words are still in the box.", "नहीं गया। आपके शब्द बॉक्स में ही हैं।"),
  helpTitle: p("How chats work", "चैट कैसे काम करती है"),
  help1: p("A parent writes on WhatsApp", "अभिभावक व्हाट्सऐप पर लिखते हैं"),
  help1Body: p(
    "Parents write to the school's WhatsApp number. When they need a person, the chat comes to you here, and you get a WhatsApp message with a link.",
    "अभिभावक स्कूल के व्हाट्सऐप नंबर पर लिखते हैं। जब उन्हें किसी व्यक्ति की ज़रूरत होती है, बातचीत यहाँ आपके पास आती है और आपको लिंक वाला व्हाट्सऐप संदेश मिलता है।",
  ),
  help2: p("Reply here", "यहाँ जवाब दें"),
  help2Body: p(
    "Type or speak your reply, or add a photo or PDF, then tap Send. The parent gets it on WhatsApp from the school's number, with your name on top.",
    "जवाब लिखें या बोलें, या फ़ोटो या PDF जोड़ें, फिर भेजें दबाएँ। अभिभावक को यह स्कूल के नंबर से व्हाट्सऐप पर मिलेगा, ऊपर आपके नाम के साथ।",
  ),
  help3: p("Tap Finished at the end", "आख़िर में बात पूरी दबाएँ"),
  help3Body: p(
    "When the talk is over, tap Finished. Not your question? Tap Give to someone else, and the right person gets it.",
    "बात ख़त्म होने पर बात पूरी दबाएँ। सवाल आपका नहीं है? किसी और को दें दबाएँ, सही व्यक्ति को मिल जाएगा।",
  ),
  // When chats finish by themselves (D-645): nobody has to remember Finished.
  help3Itself: p("No need to tap Finished", "बात पूरी दबाना ज़रूरी नहीं"),
  help3ItselfBody: (hours: number) =>
    p(
      `A chat finishes by itself when the parent says thanks or ok after your answer, or when nobody writes for ${hours} hours. If you settled it on a phone call, tap Finished. Not your question? Tap Give to someone else.`,
      `आपके जवाब के बाद अभिभावक धन्यवाद या ठीक है लिखें, या ${hours} घंटे तक कोई न लिखे, तो बातचीत अपने आप पूरी हो जाती है। फ़ोन पर बात हो गई हो तो बात पूरी दबाएँ। सवाल आपका नहीं है? किसी और को दें दबाएँ।`,
    ),
  // After a phone call (D-645).
  callAsk: p("Did the call settle it?", "क्या फ़ोन पर बात पूरी हो गई?"),
  callAskBody: p(
    "If it did, tap Yes. The chat is finished and nobody is reminded about it.",
    "हो गई हो तो हाँ दबाएँ। बातचीत पूरी हो जाएगी और किसी को याद नहीं दिलाया जाएगा।",
  ),
  callYes: p("Yes, finished", "हाँ, पूरी हुई"),
  callNo: p("Not yet", "अभी नहीं"),
  listening: p("Listening… speak now", "सुन रहे हैं… अब बोलें"),
  stop: p("Stop", "रोकें"),
  fileTooBig: p("This file is too big. Send a file under 16 MB, or a photo.", "यह फ़ाइल बहुत बड़ी है। 16 MB से छोटी फ़ाइल या फ़ोटो भेजें।"),
  fileWrongType: p("Only photos, PDF, Word and Excel files can be sent.", "सिर्फ़ फ़ोटो, PDF, Word और Excel फ़ाइलें भेजी जा सकती हैं।"),
  uploadFailed: p("The file did not upload. Check the internet and try again.", "फ़ाइल अपलोड नहीं हुई। इंटरनेट देखकर फिर कोशिश करें।"),
  offline: p("No internet. Your message is still in the box.", "इंटरनेट नहीं है। आपका संदेश बॉक्स में ही है।"),
  readOnly: p("Only reading", "सिर्फ़ पढ़ने के लिए"),

  // Writing.
  placeholder: p("Write to the parent…", "अभिभावक को लिखें…"),
  placeholderFile: p("Add a line (optional)…", "एक पंक्ति जोड़ें (ज़रूरी नहीं)…"),
  send: p("Send", "भेजें"),
  sending: p("Sending…", "भेज रहे हैं…"),
  attach: p("Photo or file", "फ़ोटो या फ़ाइल"),
  photo: p("Photo", "फ़ोटो"),
  camera: p("Camera", "कैमरा"),
  file: p("PDF, Word or Excel", "PDF, Word या Excel"),
  removeFile: p("Remove", "हटाएँ"),
  preparing: p("Making the photo smaller…", "फ़ोटो छोटी कर रहे हैं…"),
  uploading: p("Uploading…", "अपलोड हो रहा है…"),
  speak: p("Speak", "बोलें"),
  quick: p("Quick replies", "तुरंत जवाब"),
  windowOpen: p("Your message reaches the parent's WhatsApp now.", "आपका संदेश अभी अभिभावक के व्हाट्सऐप पर पहुँचेगा।"),
  windowClosed: p(
    "The parent last wrote more than a day ago. WhatsApp first tells them the school has written; your message reaches them when they reply.",
    "अभिभावक ने एक दिन से ज़्यादा पहले लिखा था। व्हाट्सऐप पहले उन्हें बताएगा कि स्कूल ने लिखा है; उनके जवाब देते ही आपका संदेश पहुँच जाएगा।",
  ),
  parentSees: (head: string) => p(`The parent sees it from: ${head}`, `अभिभावक को दिखेगा: ${head}`),
  watchTaken: (name: string) =>
    p(`${name} is replying to this parent. You can read the chat.`, `${name} इस अभिभावक को जवाब दे रहे हैं। आप बातचीत पढ़ सकते हैं।`),
  watchOnly: (desk: Pair) => p(`You can read this chat. Replies come from ${desk.en}.`, `आप यह बातचीत पढ़ सकते हैं। जवाब ${desk.hi ?? desk.en} देते हैं।`),
  takeOverWhy: (desk: Pair) =>
    p(
      `This chat is for ${desk.en}. To answer the parent yourself, tap Reply yourself. They will see that you are replying.`,
      `यह बातचीत ${desk.hi ?? desk.en} के लिए है। अभिभावक को खुद जवाब देने के लिए "खुद जवाब दें" दबाएँ। उन्हें दिखेगा कि आप जवाब दे रहे हैं।`,
    ),
  youTook: (desk: Pair) =>
    p(`You are replying to this parent. When you are done, give it back to ${desk.en}.`, `आप इस अभिभावक को जवाब दे रहे हैं। काम हो जाए तो इसे ${desk.hi ?? desk.en} को वापस करें।`),
  doneItselfBanner: (reason: "thanks" | "quiet") =>
    reason === "thanks"
      ? p(
          "This talk finished by itself: the parent only said thanks after the answer. If they write again, it comes back.",
          "यह बात अपने आप पूरी हुई: जवाब के बाद अभिभावक ने सिर्फ़ धन्यवाद कहा। वे फिर लिखें तो यह वापस आ जाएगी।",
        )
      : p(
          "This talk finished by itself: nobody wrote for a long time after the answer. If the parent writes again, it comes back.",
          "यह बात अपने आप पूरी हुई: जवाब के बाद काफ़ी देर तक किसी ने नहीं लिखा। अभिभावक फिर लिखें तो यह वापस आ जाएगी।",
        ),
  doneBanner: (name: string | null) =>
    name
      ? p(`${name} marked this talk finished. If the parent writes again, it comes back.`, `${name} ने यह बात पूरी की। अभिभावक फिर लिखें तो यह वापस आ जाएगी।`)
      : p("This talk is finished. If the parent writes again, it comes back.", "यह बात पूरी हो गई है। अभिभावक फिर लिखें तो यह वापस आ जाएगी।"),
  moved: p("This chat was joined with the family's other chat. Opening it…", "यह बातचीत परिवार की दूसरी बातचीत से जुड़ गई। उसे खोल रहे हैं…"),
  gone: p("This chat is not open to you any more.", "यह बातचीत अब आपके लिए खुली नहीं है।"),

  // Passing a chat on (D-617).
  passTitle: p("Who should reply?", "जवाब कौन देगा?"),
  passWhy: p(
    "The chat moves to them and they get a message at once. The parent does not see this.",
    "बातचीत उनके पास चली जाएगी और उन्हें तुरंत संदेश मिलेगा। अभिभावक को यह नहीं दिखता।",
  ),
  passNote: p("A note for them (the parent will not see it)", "उनके लिए एक नोट (अभिभावक को नहीं दिखेगा)"),
  passNotePlaceholder: p("e.g. Please check the receipt for October", "जैसे: कृपया अक्टूबर की रसीद देख लें"),
  passTo: p("Give to them", "उन्हें दें"),
  passPick: p("Choose a person first", "पहले व्यक्ति चुनें"),
  classTeacherOf: (name: string, children: string) => p(`${name}, class teacher of ${children}`, `${name}, ${children} के कक्षा अध्यापक`),
  accountsDesk: p("Accounts office", "अकाउंट्स विभाग"),
  officeDesk: p("School office", "स्कूल ऑफ़िस"),
  principalDesk: p("The principal", "प्रधानाचार्य"),
  passed: p("Moved to them. They will reply now.", "उनके पास भेज दी। अब वे जवाब देंगे।"),

  // Results of an action.
  takenOver: p("You can reply to this parent now", "अब आप इस अभिभावक को जवाब दे सकते हैं"),
  handedBack: p("Given back", "वापस कर दी"),
  markedDone: p("Talk finished", "बात पूरी हुई"),
  reopened: p("Open again", "फिर खुली"),
  failed: p("That did not go through. Nothing was changed.", "यह नहीं हो पाया। कुछ नहीं बदला।"),
  changedFirst: p("Somebody changed this chat a moment ago. Here it is as it is now.", "किसी ने अभी यह बातचीत बदली है। अब जैसी है वैसी दिख रही है।"),
  notAllowed: p("Only the person handling this chat can change it.", "इसे वही बदल सकते हैं जो यह बातचीत संभाल रहे हैं।"),
  noTeacher: p("That teacher does not teach this family's children.", "वे अध्यापक इस परिवार के बच्चों को नहीं पढ़ाते।"),
  sameDesk: p("The chat is already with them.", "बातचीत पहले से उन्हीं के पास है।"),
  previewing: p("You are seeing One as somebody else. Switch back to make changes.", "आप One को किसी और की तरह देख रहे हैं। बदलाव के लिए वापस आएँ।"),

  // The pop-up.
  popTitle: (name: string) => p(`${name} wrote`, `${name} ने लिखा`),
  popWaiting: (count: number) => (count === 1 ? p("1 parent waiting", "1 अभिभावक प्रतीक्षा में") : p(`${count} parents waiting`, `${count} अभिभावक प्रतीक्षा में`)),
  popOpen: p("Open chat", "चैट खोलें"),
  popLater: p("Later", "बाद में"),
} as const;

/** A desk as the screens name it, with the class teacher's name when there is one. */
export function deskWords(desk: ChatDesk, teacherName: string | null, wantsAdmin: boolean): Pair {
  if (desk === "class") return teacherName ? p(`Class teacher · ${teacherName}`, `कक्षा अध्यापक · ${teacherName}`) : p("Class teacher", "कक्षा अध्यापक");
  if (desk === "accounts") return p("Accounts", "अकाउंट्स");
  return wantsAdmin ? p("Principal", "प्रधानाचार्य") : p("Office", "ऑफ़िस");
}

/** The desk as "for …" in a sentence: "the class teacher, Anita Verma". */
export function deskForWords(desk: ChatDesk, teacherName: string | null): Pair {
  if (desk === "class") return teacherName ? p(`the class teacher, ${teacherName}`, `कक्षा अध्यापक ${teacherName}`) : p("the class teacher", "कक्षा अध्यापक");
  if (desk === "accounts") return p("the accounts office", "अकाउंट्स विभाग");
  return p("the school office", "स्कूल ऑफ़िस");
}

/**
 * Ready lines a person can tap into the box and change before sending, in the
 * parent's own language (Hinglish readers get Hinglish). Short and polite, as
 * the office writes; never a promise the school has not made.
 */
export const QUICK_REPLIES: Record<"hi" | "hx" | "en", readonly string[]> = {
  en: [
    "Thank you, we will check and reply soon.",
    "Noted, thank you.",
    "Please come to the school office during school hours.",
    "Please call the school office.",
  ],
  hx: [
    "Dhanyavaad, hum dekh kar jaldi batate hain.",
    "Theek hai, note kar liya hai.",
    "Kripya school time mein office aa jaiye.",
    "Kripya school office mein call kar lijiye.",
  ],
  hi: [
    "धन्यवाद, हम देखकर जल्दी बताते हैं।",
    "ठीक है, नोट कर लिया है।",
    "कृपया स्कूल समय में ऑफ़िस आ जाइए।",
    "कृपया स्कूल ऑफ़िस में फ़ोन कर लीजिए।",
  ],
};
