import { t, type Localized } from "@/platform/i18n/language";

/**
 * Why a WhatsApp message did not go, in words the office can act on (D-562).
 *
 * Meta answers with numbers (131026, 132001 …); the log keeps the number and
 * this turns it into one sentence in English and Hindi plus what to do next.
 * `retryable` is whether trying the same message again later can work without
 * anybody changing anything: a busy server can, a number that is not on
 * WhatsApp cannot. Pure.
 */

export type NextStep = "retry" | "wait" | "check_number" | "call_parent" | "fix_template" | "settings" | "none";

export type PlainError = {
  /** Rule 9: a pair, rendered with primary()/secondary() against the reader's language. */
  text: Localized;
  retryable: boolean;
  next: NextStep;
};

function plain(en: string, hi: string, retryable: boolean, next: NextStep): PlainError {
  return { text: t(hi, en), retryable, next };
}

const BUSY = plain(
  "WhatsApp was busy. Trying again in a few minutes should work.",
  "WhatsApp व्यस्त था। कुछ मिनट बाद फिर भेजने पर चला जाना चाहिए।",
  true,
  "retry",
);

const MESSAGES: Record<string, PlainError> = {
  // Meta: the number and the person.
  "131026": plain(
    "This number is not on WhatsApp, or cannot get messages right now.",
    "यह नंबर WhatsApp पर नहीं है, या अभी संदेश नहीं ले पा रहा।",
    false,
    "call_parent",
  ),
  "131021": plain("A message cannot be sent to the school's own number.", "विद्यालय के अपने नंबर पर संदेश नहीं भेजा जा सकता।", false, "check_number"),
  "131030": plain(
    "This number is not on the WhatsApp test list yet.",
    "यह नंबर अभी WhatsApp की टेस्ट सूची में नहीं है।",
    false,
    "settings",
  ),
  "131047": plain(
    "It is more than 24 hours since this person last wrote, so only an approved template can go.",
    "इस व्यक्ति के पिछले संदेश को 24 घंटे से ज़्यादा हो गए, इसलिए अब केवल स्वीकृत टेम्पलेट ही जा सकता है।",
    false,
    "none",
  ),
  "131050": plain("This person has stopped messages from the school.", "इस व्यक्ति ने विद्यालय के संदेश बंद कर दिए हैं।", false, "call_parent"),
  "131049": plain(
    "WhatsApp held this message back to protect the school's number. Try again tomorrow, or call.",
    "WhatsApp ने विद्यालय के नंबर की सुरक्षा के लिए यह संदेश रोका। कल फिर भेजें या फ़ोन करें।",
    false,
    "wait",
  ),
  "131056": plain(
    "Too many messages to this one number in a short time. Wait a little and try again.",
    "थोड़े समय में इस नंबर पर बहुत संदेश गए। थोड़ा रुककर फिर भेजें।",
    true,
    "wait",
  ),
  "131048": plain(
    "WhatsApp has limited the school's number because people marked messages as spam. Stop sending for today.",
    "लोगों ने संदेशों को स्पैम बताया, इसलिए WhatsApp ने विद्यालय का नंबर सीमित कर दिया। आज भेजना बंद करें।",
    false,
    "wait",
  ),
  // Meta: the template.
  "132000": plain(
    "The message has a different number of blanks than the approved template.",
    "संदेश में खाली जगहों की संख्या स्वीकृत टेम्पलेट से अलग है।",
    false,
    "fix_template",
  ),
  "132001": plain(
    "This template is not on the school's WhatsApp account in this language.",
    "यह टेम्पलेट इस भाषा में विद्यालय के WhatsApp खाते पर नहीं है।",
    false,
    "fix_template",
  ),
  "132005": plain("The filled-in message is too long for WhatsApp.", "भरा हुआ संदेश WhatsApp के लिए बहुत लंबा है।", false, "fix_template"),
  "132007": plain("WhatsApp refused the wording of a filled-in blank.", "WhatsApp ने किसी खाली जगह के शब्द स्वीकार नहीं किए।", false, "fix_template"),
  "132012": plain("A filled-in blank is in the wrong format for this template.", "कोई खाली जगह इस टेम्पलेट के लिए गलत ढंग से भरी है।", false, "fix_template"),
  "132015": plain("Meta has paused this template. Nothing can go under it until it is fixed.", "Meta ने यह टेम्पलेट रोक दिया है। ठीक होने तक इससे कुछ नहीं जाएगा।", false, "fix_template"),
  "132016": plain("Meta has switched this template off.", "Meta ने यह टेम्पलेट बंद कर दिया है।", false, "fix_template"),
  "132018": plain("A filled-in blank had a line break or a tab in it.", "किसी खाली जगह में नई पंक्ति या टैब था।", false, "fix_template"),
  "131008": plain("A blank in the message was left empty.", "संदेश की कोई खाली जगह भरी नहीं गई।", false, "fix_template"),
  "131009": plain("WhatsApp did not accept one of the values in the message.", "WhatsApp ने संदेश का कोई मान स्वीकार नहीं किया।", false, "fix_template"),
  "131052": plain("WhatsApp could not fetch the attached PDF.", "WhatsApp संलग्न PDF नहीं ले पाया।", true, "retry"),
  "131053": plain("WhatsApp could not take the attached PDF.", "WhatsApp संलग्न PDF नहीं ले पाया।", false, "retry"),
  // Meta: the account and the connection.
  "190": plain(
    "The school's WhatsApp sign-in has expired. An admin needs to renew the access token.",
    "विद्यालय के WhatsApp का साइन-इन समाप्त हो गया है। किसी एडमिन को एक्सेस टोकन नया करना होगा।",
    false,
    "settings",
  ),
  "131005": plain("The school's WhatsApp key is not allowed to send messages.", "विद्यालय की WhatsApp कुंजी को संदेश भेजने की अनुमति नहीं है।", false, "settings"),
  "131031": plain("Meta has locked the school's WhatsApp account.", "Meta ने विद्यालय का WhatsApp खाता बंद कर दिया है।", false, "settings"),
  "131042": plain("There is a payment problem on the school's WhatsApp account.", "विद्यालय के WhatsApp खाते में भुगतान की समस्या है।", false, "settings"),
  "133010": plain("The school's number is not registered with WhatsApp yet.", "विद्यालय का नंबर अभी WhatsApp पर पंजीकृत नहीं है।", false, "settings"),
  "368": plain("Meta has blocked the school's number for a while.", "Meta ने विद्यालय का नंबर कुछ समय के लिए रोक दिया है।", false, "wait"),
  "4": BUSY,
  "80007": BUSY,
  "130429": BUSY,
  "131000": BUSY,
  "131016": BUSY,
  "131057": BUSY,
  "1": BUSY,
  "2": BUSY,
  // One's own reasons. None of these ever reached WhatsApp.
  network: plain(
    "One could not reach the WhatsApp server. The message may or may not have gone. Check before sending again.",
    "One WhatsApp सर्वर तक नहीं पहुँच पाया। संदेश गया या नहीं, पक्का नहीं। दोबारा भेजने से पहले जाँचें।",
    false,
    "check_number",
  ),
  server_error: plain(
    "The WhatsApp server had a problem. The message may or may not have gone. Check before sending again.",
    "WhatsApp सर्वर में समस्या थी। संदेश गया या नहीं, पक्का नहीं। दोबारा भेजने से पहले जाँचें।",
    false,
    "check_number",
  ),
  no_receipt: plain(
    "The WhatsApp server answered without a message number. It may have gone. Check before sending again.",
    "WhatsApp सर्वर ने संदेश नंबर नहीं दिया। शायद चला गया हो। दोबारा भेजने से पहले जाँचें।",
    false,
    "check_number",
  ),
  daily_limit: plain(
    "Today's WhatsApp limit is used up. It will go tomorrow if sent again.",
    "आज की WhatsApp सीमा पूरी हो गई। कल फिर भेजने पर चला जाएगा।",
    true,
    "wait",
  ),
  dry_run: plain(
    "Practice mode is on: written to the log, not sent.",
    "अभ्यास मोड चालू है: लॉग में लिखा गया, भेजा नहीं गया।",
    false,
    "settings",
  ),
  feature_off: plain(
    "WhatsApp for this kind of message is switched off in Settings.",
    "इस तरह के संदेश के लिए WhatsApp सेटिंग्स में बंद है।",
    false,
    "settings",
  ),
  template_not_approved: plain(
    "This template is not approved on the school's WhatsApp yet.",
    "यह टेम्पलेट अभी विद्यालय के WhatsApp पर स्वीकृत नहीं है।",
    false,
    "fix_template",
  ),
  template_mismatch: plain(
    "This message does not match its approved template (blanks, PDF or button).",
    "यह संदेश अपने स्वीकृत टेम्पलेट से मेल नहीं खाता (खाली जगहें, PDF या बटन)।",
    false,
    "fix_template",
  ),
  not_owner_test_number: plain(
    "While testing, One may message only the owner's own number. Real parents are switched off.",
    "जाँच के दौरान One केवल मालिक के अपने नंबर पर संदेश भेज सकता है। असली अभिभावक बंद हैं।",
    false,
    "none",
  ),
  outside_24h: plain(
    "A typed message can only go within 24 hours of this person's last message. Use a template.",
    "लिखा हुआ संदेश केवल इस व्यक्ति के पिछले संदेश के 24 घंटे के भीतर जा सकता है। टेम्पलेट भेजें।",
    false,
    "none",
  ),
  not_configured: plain(
    "The school's WhatsApp server is not connected yet.",
    "विद्यालय का WhatsApp सर्वर अभी जुड़ा नहीं है।",
    false,
    "settings",
  ),
  fees_number: plain(
    "That is the fees app's number. One never sends to it or from it.",
    "यह फ़ीस ऐप का नंबर है। One इस पर या इससे कभी संदेश नहीं भेजता।",
    false,
    "none",
  ),
  bad_destination: plain("The phone number is not a valid mobile number.", "फ़ोन नंबर सही मोबाइल नंबर नहीं है।", false, "check_number"),
  read_failed: plain(
    "One could not read its WhatsApp switches, so it did not send. Try again in a minute.",
    "One अपनी WhatsApp सेटिंग नहीं पढ़ पाया, इसलिए नहीं भेजा। एक मिनट बाद फिर कोशिश करें।",
    true,
    "retry",
  ),
};

const UNKNOWN = plain(
  "WhatsApp did not take this message.",
  "WhatsApp ने यह संदेश नहीं लिया।",
  false,
  "check_number",
);

/** The sentence for an error code: Meta's number or One's own reason. */
export function describeError(code: string | number | null | undefined, title?: string | null): PlainError {
  const key = code === null || code === undefined ? "" : String(code).trim();
  const known = MESSAGES[key];
  if (known) return known;
  if (!key && title) return { ...UNKNOWN, text: t(`WhatsApp ने यह संदेश नहीं लिया: ${title}`, `WhatsApp did not take this message: ${title}`) };
  return UNKNOWN;
}

/** Whether the queue may try the same message again by itself. */
export function isRetryableCode(code: string | number | null | undefined): boolean {
  return describeError(code).retryable;
}
