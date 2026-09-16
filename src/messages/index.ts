import { t } from "@/platform/i18n/language";

/**
 * Every string the app says, written once as a Hindi/English pair.
 *
 * A catalogue rather than strings in components, because the same sentence now
 * has to be renderable three ways and a pair scattered across JSX cannot be
 * checked. `tests/messages.test.ts` asserts that every entry really does have
 * both halves and that neither is a copy of the other.
 *
 * Kept flat and grouped by screen. This is a school app with a few dozen
 * screens, not a product with forty locales — a nested key hierarchy would
 * cost more to navigate than it saves.
 */

export const m = {
  /* ------------------------------------------------------------- general */
  appName: t("VPPS One", "VPPS One"),
  save: t("सहेजें", "Save"),
  saved: t("सहेजा", "Saved"),
  saving: t("सहेजा जा रहा है…", "Saving…"),
  cancel: t("रद्द करें", "Cancel"),
  add: t("जोड़ें", "Add"),
  edit: t("बदलें", "Edit"),
  change: t("बदलें", "Change"),
  back: t("वापस", "Back"),
  yes: t("हाँ", "Yes"),
  no: t("नहीं", "No"),
  goHome: t("मुख्य पर जाएँ", "Go home"),
  tryAgain: t("फिर कोशिश करें", "Try again"),
  loading: t("लोड हो रहा है", "Loading"),
  shown: t("दिखाए गए", "shown"),
  active: t("सक्रिय", "active"),
  inactive: t("निष्क्रिय", "Inactive"),
  reactivate: t("फिर सक्रिय करें", "Reactivate"),
  deactivate: t("निष्क्रिय करें", "Deactivate"),
  remove: t("हटाएँ", "Remove"),
  restore: t("वापस लाएँ", "Restore"),
  done: t("पूरा", "Done"),
  pending: t("बाकी", "To do"),
  somethingWrong: t("कुछ गड़बड़ हो गई।", "Something went wrong."),
  notFound: t("यह पेज नहीं मिला।", "That page does not exist."),
  reference: t("संदर्भ", "ref"),

  /* ------------------------------------------------------------- session */
  session: t("सत्र", "Session"),
  noSession: t("कोई सत्र नहीं मिला", "No session found"),
  testData: t("टेस्ट", "Test"),
  testDataLong: t("टेस्ट डेटा", "Test data"),
  testDataNotice: t(
    "यह टेस्ट डेटा है। यहाँ किया गया कोई बदलाव असली रिकॉर्ड नहीं बदलता।",
    "This runs on the test session in schoolfees-dev. Nothing here touches real student or fee records.",
  ),

  /* ----------------------------------------------------------------- nav */
  navHome: t("मुख्य", "Home"),
  navStaff: t("स्टाफ़", "Staff"),
  navAcademics: t("शैक्षणिक", "Academics"),
  navCalendar: t("कैलेंडर", "Calendar"),
  navEnrolments: t("नामांकन", "Enrolments"),
  mainNavigation: t("मुख्य नेविगेशन", "Main navigation"),

  /* --------------------------------------------------------------- login */
  signIn: t("साइन इन करें", "Sign in"),
  signingIn: t("साइन इन हो रहा है…", "Signing in…"),
  signedIn: t("साइन इन", "Signed in"),
  signOut: t("साइन आउट", "Sign out"),
  signInTitle: t("साइन इन", "Sign in"),
  email: t("ईमेल", "Email"),
  password: t("पासवर्ड", "Password"),
  noSignup: t(
    "खाता विद्यालय प्रशासक बनाते हैं। यहाँ नया खाता नहीं बनता।",
    "Accounts are created by the school admin — there is no sign-up here.",
  ),
  loginBadCredentials: t(
    "ईमेल या पासवर्ड गलत है।",
    "That email and password do not match an account.",
  ),
  loginBothFields: t(
    "ईमेल और पासवर्ड दोनों भरें।",
    "Enter both your email and your password.",
  ),
  loginNotConfirmed: t(
    "यह खाता अभी पुष्टि नहीं हुआ है। विद्यालय प्रशासक से संपर्क करें।",
    "This account is not confirmed yet. Ask the school admin.",
  ),
  loginRateLimited: t(
    "बहुत बार कोशिश हुई। कुछ मिनट रुककर फिर प्रयास करें।",
    "Too many attempts. Wait a few minutes and try again.",
  ),
  loginUnavailable: t(
    "अभी साइन इन नहीं हो पा रहा। थोड़ी देर बाद फिर प्रयास करें।",
    "Unable to sign in right now. Please try again.",
  ),
  noProfile: t(
    "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है।",
    "This account has no VPPS One staff profile yet.",
  ),
  noProfileAskAdmin: t(
    "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है। विद्यालय प्रशासक से संपर्क करें।",
    "This account has no VPPS One staff profile yet. Ask the school admin to add one.",
  ),
  accountInactive: t("यह स्टाफ़ खाता निष्क्रिय है।", "This staff account is inactive."),
  accountInactiveAskAdmin: t(
    "यह स्टाफ़ खाता निष्क्रिय है। विद्यालय प्रशासक से संपर्क करें।",
    "This staff account is inactive. Ask the school admin.",
  ),

  /* ----------------------------------------------------------- dashboard */
  welcome: t("नमस्ते", "Welcome"),
  openToYou: t("आपके लिए", "Open to you"),
  openToYouHint: t(
    "आपकी भूमिका के हिसाब से",
    "What your role can open",
  ),

  /* ------------------------------------------------------- access denied */
  accessDenied: t("अनुमति नहीं", "You cannot open this"),
  accessDeniedBody: t(
    "आपकी भूमिका इस स्क्रीन को नहीं खोल सकती।",
    "Your role does not have access to this screen. Ask the school admin if you need it.",
  ),
  role: t("भूमिका", "Role"),
  permissionNeeded: t("आवश्यक अनुमति", "Needs"),
  permissions: t("अनुमतियाँ", "Permissions"),

  /* --------------------------------------------------------------- staff */
  staffTitle: t("स्टाफ़", "Staff"),
  staffIntro: t(
    "हर अध्यापक की प्रोफ़ाइल — चाहे वे ऐप में साइन इन करें या नहीं।",
    "Every teacher needs a profile, whether or not they sign in.",
  ),
  staffSearch: t("नाम, संक्षिप्त नाम या फ़ोन", "Name, short name or phone"),
  staffSearchLabel: t("स्टाफ़ खोजें", "Search staff"),
  staffNone: t(
    "अभी कोई स्टाफ़ प्रोफ़ाइल नहीं है।",
    "Add the teachers and office staff. Every teacher on the timetable needs a profile, even the ones who never sign in.",
  ),
  staffNoMatch: t("कोई स्टाफ़ नहीं मिला।", "Nothing matches that search."),
  staffShowInactive: t("निष्क्रिय भी दिखाएँ", "Show inactive"),
  staffNew: t("नया स्टाफ़", "Add staff"),
  staffNewNotice: t(
    "यह प्रोफ़ाइल है, खाता नहीं। साइन इन के लिए खाता Supabase में अलग से बनता है।",
    "This creates a profile, not a login. Sign-in accounts are created separately in Supabase — a teacher who never opens the app still needs a profile here, because the timetable joins on the short name.",
  ),
  staffInactiveNotice: t(
    "यह प्रोफ़ाइल निष्क्रिय है।",
    "Inactive. They stay on past timetables and registers, but will not appear in pickers.",
  ),
  staffNoLogin: t(
    "इनका कोई साइन-इन खाता नहीं है।",
    "No sign-in account is linked. That is normal for a teacher who is on the timetable but never opens the app. To give them access, create the account in Supabase Auth with their email.",
  ),
  name: t("नाम", "Name"),
  fullName: t("पूरा नाम", "Full name"),
  shortName: t("संक्षिप्त नाम", "Short name"),
  shortNameNewHint: t(
    "समय-सारिणी में इसी नाम से पहचान होगी। बाद में बदला नहीं जा सकता।",
    "This is how the timetable will name them. It cannot be changed later.",
  ),
  shortNameLockedHint: t(
    "यह बदला नहीं जा सकता — समय-सारिणी इसी से जुड़ती है।",
    "Cannot be changed; the timetable joins on it.",
  ),
  teaches: t("कक्षा लेते हैं", "Teaches classes"),
  teaching: t("अध्यापन", "Teaching"),
  classBadge: t("कक्षा", "Class"),
  phone: t("फ़ोन", "Phone"),
  whatsapp: t("व्हाट्सएप", "WhatsApp"),
  whatsappHint: t("अलग हो तो भरें", "Only if different"),
  signsIn: t("साइन इन", "Signs in"),
  language: t("भाषा", "Language"),
  languageHint: t(
    "यह व्यक्ति ऐप किस भाषा में पढ़ेगा।",
    "Which language this person reads the app in.",
  ),
  languageHindi: t("हिन्दी", "Hindi"),
  languageEnglish: t("अंग्रेज़ी", "English"),
  languageBoth: t("दोनों", "Both"),
  cannotDeactivateSelf: t(
    "अपना खाता निष्क्रिय नहीं कर सकते",
    "You cannot deactivate your own account",
  ),
  alreadyInactive: t("पहले से निष्क्रिय", "Already inactive"),
  cannotChangeOwnRole: t(
    "अपनी भूमिका आप नहीं बदल सकते",
    "You cannot change your own role",
  ),
  shortNameImmutable: t(
    "संक्षिप्त नाम बदला नहीं जा सकता",
    "The short name cannot be changed",
  ),
  profileNotFound: t("प्रोफ़ाइल नहीं मिली।", "That profile was not found."),
  profileNotSaved: t("प्रोफ़ाइल सहेजी नहीं जा सकी।", "Could not save the profile."),
  changesNotSaved: t("बदलाव सहेजे नहीं जा सके।", "Could not save the changes."),

  /* ----------------------------------------------------------- academics */
  academicsTitle: t("शैक्षणिक", "Academics"),
  academicsNotice: t(
    "समय-सारिणी इन्हीं नामों से जुड़ेगी।",
    "Phase 2 resolves every timetable cell against these two lists. A class with no label, or a subject the sheet names and this list does not, is what an import will stop on.",
  ),
  noFeeClasses: t(
    "फ़ीस ऐप में कोई कक्षा नहीं मिली।",
    "No classes were found in the fee app, so there is no session to work in yet.",
  ),
  subjects: t("विषय", "Subjects"),
  subjectsIntro: t(
    "कोड वही रखें जो समय-सारिणी की शीट में है।",
    "Use the code exactly as the timetable sheet writes it.",
  ),
  subjectsNone: t(
    "अभी कोई विषय नहीं है।",
    "Add every subject the timetable names. Phase 2 resolves each cell against this list.",
  ),
  subjectFirst: t("पहला विषय जोड़ें", "Add the first subject"),
  subjectNew: t("नया विषय", "Add subject"),
  subjectEdit: t("विषय बदलें", "Edit subject"),
  code: t("कोड", "Code"),
  codeNewHint: t(
    "समय-सारिणी की शीट में यह विषय जिस नाम से लिखा है।",
    "Exactly as the timetable sheet writes it.",
  ),
  codeLockedHint: t("कोड बदला नहीं जा सकता", "The code cannot be changed"),
  nameHindi: t("हिन्दी नाम", "Hindi name"),
  nameEnglish: t("अंग्रेज़ी नाम", "English name"),
  sortOrder: t("क्रम", "Order"),
  sortOrderHint: t(
    "छोटा नंबर पहले दिखेगा।",
    "Lower numbers come first in lists and report cards.",
  ),
  subjectNotFound: t("विषय नहीं मिला।", "That subject was not found."),
  subjectNotSaved: t("विषय सहेजा नहीं जा सका।", "Could not save the subject."),

  classLabels: t("कक्षा के नाम", "Class labels"),
  classLabelsMapped: t("मैप किए", "mapped"),
  classLabelsDone: t(
    "हर कक्षा का नाम तय है।",
    "Every class has a timetable label. A Phase 2 import can resolve all of them.",
  ),
  classLabelsTodo: t(
    "समय-सारिणी की शीट में कक्षा जिस नाम से लिखी है, वही यहाँ भरें।",
    "Enter each class exactly as the timetable sheet writes it — “11-S”, “5”, “NUR”. Unmapped classes are listed first.",
  ),
  classLabelsNothing: t(
    "फ़ीस ऐप में कोई कक्षा नहीं मिली।",
    "No classes were found in the fee app, so there is nothing to map yet.",
  ),
  feeAppClass: t("फ़ीस ऐप की कक्षा", "Fee app class"),
  timetableLabel: t("समय-सारिणी का नाम", "Timetable label"),
  mapped: t("मैप्ड", "Mapped"),
  labelTakenByAnotherClass: t(
    "इस सत्र में यह नाम किसी और कक्षा का है",
    "Another class already uses this label this session",
  ),
  notSaved: t("सहेजा नहीं जा सका।", "Could not save."),

  /* ---------------------------------------------------- class teachers */
  classTeachers: t("कक्षा अध्यापक", "Class teachers"),
  classTeachersIntro: t(
    "हर कक्षा का अध्यापक — बदलने पर पुराना रिकॉर्ड रहता है, मिटता नहीं।",
    "Who holds each class. Replacing somebody keeps the old record; nothing is overwritten.",
  ),
  classTeacherNone: t("अभी कोई नहीं", "Nobody yet"),
  classTeacherAssign: t("अध्यापक चुनें", "Assign a teacher"),
  classTeacherReplace: t("बदलकर दूसरा अध्यापक दें", "Hand over to somebody else"),
  classTeacherChoose: t("चुनें", "Choose"),
  classTeacherFrom: t("इस तारीख़ से", "From"),
  classTeacherHistory: t("पिछला रिकॉर्ड", "Earlier"),
  classTeacherReplaceHint: t(
    "पिछले अध्यापक का कार्यकाल एक दिन पहले बंद हो जाएगा।",
    "The current holder's term ends the day before this date.",
  ),
  classTeachersAssigned: t("दिए गए", "assigned"),
  classTeachersDone: t(
    "हर कक्षा का अध्यापक तय है।",
    "Every class has a class teacher.",
  ),
  classTeachersTodo: t(
    "जिन कक्षाओं का अध्यापक तय नहीं है, वे सबसे ऊपर हैं।",
    "Classes with nobody assigned are listed first.",
  ),

  /* --------------------------------------------------------- calendar */
  calendarTitle: t("शैक्षणिक कैलेंडर", "Academic calendar"),
  calendarIntro: t(
    "सिर्फ़ वे दिन भरें जो सामान्य नहीं हैं। बाकी दिन साप्ताहिक नियम से तय होते हैं — रविवार अवकाश, शनिवार कार्यदिवस।",
    "Only enter the days that are not ordinary. Everything else follows the weekly pattern — Sunday closed, Saturday a working day.",
  ),
  calendarNone: t(
    "अभी कोई दिन दर्ज नहीं है।",
    "Nothing entered yet. Add the holidays, exams and vacations for this session.",
  ),
  calendarAdd: t("दिन जोड़ें", "Add days"),
  calendarDate: t("तारीख़", "Date"),
  calendarUntil: t("इस तारीख़ तक", "Until"),
  calendarUntilHint: t(
    "एक से ज़्यादा दिन के लिए भरें — जैसे पूरी छुट्टियाँ।",
    "Fill this for a range, such as a whole vacation.",
  ),
  calendarKind: t("किस तरह का दिन", "Kind of day"),
  calendarLabelHi: t("नाम (हिन्दी)", "Name (Hindi)"),
  calendarLabelEn: t("नाम (अंग्रेज़ी)", "Name (English)"),
  calendarSchoolOpen: t("विद्यालय खुला", "School open"),
  calendarSchoolClosed: t("विद्यालय बंद", "School closed"),
  calendarTimetableRuns: t("समय-सारिणी चलेगी", "Timetable runs"),
  calendarDaysEntered: t("दिन दर्ज", "days entered"),

  /* -------------------------------------------------------- enrolments */
  enrolmentsTitle: t("नामांकन", "Enrolments"),
  enrolmentsIntro: t(
    "फ़ीस ऐप बताता है कि बच्चा आज किस कक्षा में है। यह रिकॉर्ड बताता है कि किस सत्र में कहाँ था — रिपोर्ट कार्ड और उपस्थिति इसी पर टिकते हैं।",
    "The fee app holds where a child is today. This holds where they were in a given session, which is what a report card and an attendance percentage are about.",
  ),
  enrolmentsNone: t(
    "अभी नामांकन नहीं बना है।",
    "Nothing built yet. Build the record from the fee app to begin.",
  ),
  enrolmentsBuild: t("फ़ीस ऐप से बनाएँ", "Build from the fee app"),
  enrolmentsRebuild: t("फिर से मिलाएँ", "Rebuild from the fee app"),
  enrolmentsRebuildHint: t(
    "मौजूदा रिकॉर्ड अपडेट होंगे, मिटेंगे नहीं।",
    "Existing rows are updated, never deleted.",
  ),
  enrolmentsInAgreement: t("मिलान सही", "in agreement"),
  enrolmentsAllMatch: t(
    "फ़ीस ऐप और यह रिकॉर्ड पूरी तरह मिलते हैं।",
    "This record and the fee app agree on every student.",
  ),
  enrolmentsDifferences: t("अंतर", "Differences"),
  enrolmentsFixable: t(
    "फिर से मिलाने पर ठीक हो जाएँगे",
    "would be resolved by a rebuild",
  ),
  enrolmentsNeedsPerson: t(
    "इन्हें कोई व्यक्ति ही तय कर सकता है — इनकी उपस्थिति और अंक यहाँ दर्ज हैं।",
    "These need a person. Their attendance and marks are recorded here, so the row is kept rather than dropped.",
  ),
  enrolmentsRoll: t("कक्षा में", "on the roll"),
  enrolmentsStudents: t("विद्यार्थी", "students"),
  enrolmentsSkippedNoClass: t(
    "बिना कक्षा के छोड़े गए",
    "skipped — no class in the fee app",
  ),
  enrolmentsCheck: t("मिलान जाँच", "Consistency check"),
  enrolmentsBuiltNotice: t("नामांकन बन गया।", "The record was built."),
  noSessionFound: t(
    "कोई सत्र नहीं मिला।",
    "No academic session was found in the fee app's classes.",
  ),
} as const;

export type MessageKey = keyof typeof m;
