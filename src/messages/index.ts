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
  teacherTasks: t("मेरे काम", "My tasks"),
  taskDetails: t("विवरण", "Details"),
  taskMarks: t("अंक", "Marks"),
  taskAttendance: t("उपस्थिति", "Attendance"),
  taskWaiting: t("शिक्षकों की प्रतीक्षा", "Waiting on teachers"),
  taskApprove: t("अनुमोदन बाकी", "To approve"),
  taskComplete: t("पूरा", "Complete"),
  taskSaved: t("सहेजा गया।", "Saved."),
  taskReviewSave: t("जाँचें और सहेजें", "Review and save"),
  taskSubmit: t("पूरा करके जमा करें", "Submit completed work"),
  taskDraft: t("मसौदा सहेजें", "Save draft"),
  taskReason: t("बदलाव का कारण", "Reason for correction"),
  taskRetry: t("उसी सहेजने की फिर जाँच करें", "Retry the same save"),
  taskUnknown: t("सहेजने की पुष्टि नहीं मिली। उसी प्रयास की फिर जाँच करें।", "Save outcome is unknown. Retry the same save to recover its receipt."),
  taskDraftUnconfirmed: t("इस डिवाइस पर सेव है · स्कूल में सहेजने की पुष्टि नहीं मिली", "Saved on this device · school save unconfirmed"),
  taskRefused: t("सहेजा नहीं गया। काम या अधिकार बदल गया हो सकता है। पृष्ठ फिर खोलें।", "Not saved. The work or your access may have changed. Reload the page."),
  taskApprovalNote: t("विवरण प्रशासक के अनुमोदन के बाद आधिकारिक रिकॉर्ड बनेंगे।", "Details become official after administrator approval."),
  taskViewAll: t("सभी देखें", "View all"),
  skipToContent: t("मुख्य सामग्री पर जाएँ", "Skip to main content"),
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
  pageNotLoaded: t("यह पेज खुल नहीं पाया", "This page couldn't load"),
  pageNotLoadedHelp: t("नेटवर्क धीमा हो सकता है। पेज दोबारा खोलें — जो सहेजा जा चुका है वह सुरक्षित है।", "The connection may be slow. Reload the page — anything already saved is safe."),
  reload: t("दोबारा खोलें", "Reload"),
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
  notFoundDetail: t(
    "शायद पता बदल गया है। अपने मुख्य पेज से दोबारा शुरू कीजिए।",
    "The address may have changed. Start again from your own home screen.",
  ),
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
  moreIntro: t(
    "आपकी भूमिका के बाकी सभी पन्ने।",
    "Everything else your role can open.",
  ),
  navMore: t("और", "More"),
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
  notYourClassTitle: t("यह आपकी कक्षा नहीं है", "This is not one of your classes"),
  notYourClassDetail: t(
    "आपकी कक्षाएँ आज वाले पेज पर हैं। किसी और कक्षा के रिकॉर्ड के लिए कार्यालय से पूछें।",
    "Your classes are on Today. For another class's records, ask the office.",
  ),
  notYourStudentTitle: t(
    "यह बच्चा आपकी किसी कक्षा में नहीं है",
    "This child is not in one of your classes",
  ),
  roleAdminOnlyHint: t(
    "भूमिका केवल कोई दूसरा प्रशासक बदल सकता है।",
    "Only another administrator can change a role.",
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

  /* -------------------------------------------------------- timetable */
  timetableTitle: t("समय-सारिणी", "Timetable"),
  timetableNone: t(
    "अभी कोई समय-सारिणी नहीं है।",
    "Nothing uploaded yet. Paste the sheet to check it against the master data.",
  ),
  timetableUpload: t("नई शीट जाँचें", "Check a new sheet"),
  timetableSheet: t("शीट", "Sheet"),
  timetableSheetHint: t(
    "एक्सेल से कॉपी करके यहाँ चिपकाएँ। दिन का नाम अपनी पंक्ति में, फिर हर कक्षा की पंक्ति।",
    "Paste from Excel. A day name on its own line, then one line per class.",
  ),
  timetableSheetName: t("इस शीट का नाम", "Name this sheet"),
  timetableSheetNameHint: t(
    "जैसे “v11” या “दीवाली के बाद”।",
    "Something you will recognise later, like “v11” or “after Diwali”.",
  ),
  timetableCheck: t("जाँचें", "Check"),
  timetableChecking: t("जाँच हो रही है…", "Checking…"),
  timetableReady: t(
    "सब मिल गया। यह शीट लागू की जा सकती है।",
    "Everything resolved. This sheet can be published.",
  ),
  timetableBlocked: t(
    "पहले नीचे की चीज़ें ठीक करें, फिर दोबारा जाँचें।",
    "Fix the items below, then check the sheet again.",
  ),
  timetableFixOn: t("यहाँ ठीक करें", "Fix on"),
  timetableCells: t("खाने", "cells"),
  timetableSlots: t("पीरियड", "periods"),
  timetableProblems: t("शीट में गड़बड़", "Problems in the sheet"),
  timetableSaveDraft: t("ड्राफ़्ट सहेजें", "Save as draft"),
  timetablePublish: t("लागू करें", "Publish"),
  timetablePublishHint: t(
    "लागू करने पर पिछली समय-सारिणी अपने आप पुरानी हो जाएगी।",
    "Publishing archives whatever is live now and regenerates teaching assignments.",
  ),
  timetablePublished: t("लागू", "Published"),
  timetableDraft: t("ड्राफ़्ट", "Draft"),
  timetableArchived: t("पुरानी", "Archived"),
  timetableDelete: t("ड्राफ़्ट हटाएँ", "Delete draft"),
  timetableVersions: t("शीट का इतिहास", "Versions"),
  timetableByClass: t("कक्षा से", "By class"),
  timetableByTeacher: t("अध्यापक से", "By teacher"),
  timetableByDay: t("दिन से", "By day"),
  timetableFree: t("कौन खाली है", "Who is free"),
  timetableChooseClass: t("कक्षा चुनें", "Choose a class"),
  timetableChooseTeacher: t("अध्यापक चुनें", "Choose a teacher"),
  timetableChooseDay: t("दिन चुनें", "Choose a day"),
  timetablePeriod: t("पीरियड", "Period"),
  timetableNobodyFree: t("कोई खाली नहीं", "Nobody is free"),
  timetableNoPublished: t(
    "अभी कोई समय-सारिणी लागू नहीं है।",
    "No timetable is published yet.",
  ),
  timetableSharedBadge: t("साझा", "Shared"),
  timetableParallelBadge: t("समानांतर", "Parallel"),
  timetableLoad: t("हफ़्ते के पीरियड", "Periods a week"),
  timetableClash: t("टकराव", "Clash"),
  /* ------------------------------------------------------------ teach */
  teachTitle: t("मेरा दिन", "My day"),
  teachToday: t("आज", "Today"),
  teachNoTimetable: t(
    "अभी कोई समय-सारिणी लागू नहीं है।",
    "No timetable is published yet, so your periods cannot be shown.",
  ),
  teachNoPeriods: t("आज आपका कोई पीरियड नहीं है।", "You have no periods today."),
  teachMyClasses: t("मेरी कक्षाएँ", "My classes"),
  teachNeedsDoing: t("करना बाकी", "Needs doing"),
  teachAllDone: t("आज का सब हो गया।", "Everything for today is done."),
  teachTakeRegister: t("हाज़िरी लें", "Take the register"),
  teachRegisterTaken: t("हाज़िरी हो गई", "Register taken"),
  teachSchoolClosed: t(
    "आज विद्यालय बंद है।",
    "School is closed today, so there is no register to take.",
  ),
  navTeach: t("पढ़ाई", "Teach"),
  teachPeriodsToday: t("आज के पीरियड", "Today's periods"),
  teachPeriod: t("पीरियड", "Period"),
  teachNoClassHeld: t(
    "आप किसी कक्षा के कक्षा-अध्यापक नहीं हैं।",
    "You are not class teacher of any class, so no daily register is yours to take.",
  ),
  teachOpenClass: t("कक्षा खोलें", "Open the class"),
  teachDailyRegister: t("दैनिक हाज़िरी", "Daily register"),
  teachMarkFor: t("किसके लिए", "Marking for"),
  teachChooseClass: t("कक्षा चुनें", "Choose a class"),
  teachClassTitle: t("कक्षा", "Class"),
  teachRoll: t("बच्चों की सूची", "Class roll"),
  teachStudents: t("बच्चे", "students"),
  teachViewRegister: t("मासिक रजिस्टर देखें", "See the monthly register"),

  /* ------------------------------------------------------ attendance */
  attendanceTitle: t("हाज़िरी", "Attendance"),
  attendancePresent: t("उपस्थित", "Present"),
  attendanceAbsent: t("अनुपस्थित", "Absent"),
  attendanceLate: t("देर से", "Late"),
  attendanceLeave: t("छुट्टी", "Leave"),
  attendanceMarkAllPresent: t("सब उपस्थित", "All present"),
  attendanceSubmit: t("जमा करें", "Submit"),
  attendanceSubmitted: t("जमा हो गई", "Submitted"),
  attendanceSaving: t("सहेजा जा रहा है…", "Saving…"),
  // Said *while* the connection is down, so it is in the present tense and
  // only ever rendered behind `!online`.
  attendanceOffline: t(
    "इंटरनेट नहीं है। आपकी हाज़िरी इसी फ़ोन पर रखी है — इंटरनेट लौटने पर सहेजें दबाएँ। अपने-आप कुछ नहीं भेजा जाएगा।",
    "No connection. Your marks are kept on this phone — press Save when you are back online. Nothing is sent on its own.",
  ),
  // Said when the connection is *fine*: a standing note that the register
  // keeps working if it drops. Separate from `attendanceOffline` because the
  // Teach card used to show that one unconditionally, which told every teacher
  // on a perfectly good connection that she had none.
  attendanceWorksOffline: t(
    "इंटरनेट चला जाए तो भी खुले रजिस्टर में आपकी हाज़िरी फ़ोन पर रहती है। जब तक आप सहेजें न दबाएँ, कुछ दर्ज नहीं होता।",
    "If the connection drops, an open register keeps your marks on this phone. Nothing is recorded until you press Save.",
  ),
  attendanceQueued: t("भेजना बाकी", "waiting to send"),
  attendanceEmptyRoll: t(
    "इस कक्षा में कोई बच्चा नहीं है।",
    "Nobody is enrolled in this class. Build the enrolment record first.",
  ),
  attendanceNotYours: t(
    "यह आपकी कक्षा नहीं है।",
    "This is not one of your classes.",
  ),
  attendanceOnBehalf: t(
    "आप अध्यापक की ओर से दर्ज कर रहे हैं।",
    "You are recording this on the teacher's behalf — it will be marked as such.",
  ),
  attendanceLocked: t(
    "यह रजिस्टर दर्ज हो चुका है। बदलने के लिए कारण के साथ सुधार करें।",
    "This register is recorded. To change it, correct it with a reason.",
  ),
  attendanceMarked: t("दर्ज", "marked"),
  attendanceNoClassChosen: t(
    "कौन सी कक्षा की हाज़िरी लेनी है?",
    "Which class are you taking the register for?",
  ),
  attendanceForDay: t("तारीख़", "Date"),
  attendanceAlreadyIn: t("यह हाज़िरी जमा हो चुकी है।", "This register is already in."),
  attendanceTakenBy: t("दर्ज किया", "Recorded by"),
  attendanceStillOpen: t("अभी खुला है", "Still open"),

  // P6: nothing is recorded until somebody saves, and a save is the whole roll.
  attendanceNotRecorded: t("अभी दर्ज नहीं", "Not recorded yet"),
  childOne: t("बच्चा", "child"),
  childMany: t("बच्चे", "children"),
  attendancePreview: t(
    "अभी कुछ दर्ज नहीं हुआ। सहेजने तक सब उपस्थित दिखेंगे — केवल जो नहीं आए उन्हें बदलें।",
    "Nothing is recorded yet. Everyone shows as present until you save — change only the children who are not.",
  ),
  attendanceReview: t("जाँचें और सहेजें", "Review and save"),
  attendanceReviewCorrection: t("सुधार जाँचें", "Review the correction"),
  attendanceCheckTitle: t("सहेजने से पहले देख लें", "Check before saving"),
  attendanceEveryonePresent: t("सब उपस्थित", "Everyone present"),
  attendanceExceptions: t("जो उपस्थित नहीं", "Not present"),
  attendanceSaveConfirm: t("हाज़िरी सहेजें", "Save attendance"),
  attendanceSaveCorrection: t("सुधार सहेजें", "Save the correction"),
  attendanceBackToList: t("सूची पर लौटें", "Back to the list"),
  attendanceRecorded: t("दर्ज", "Recorded"),
  attendanceCorrect: t("इस रजिस्टर में सुधार करें", "Correct this register"),
  attendanceCorrecting: t(
    "आप दर्ज रजिस्टर में सुधार कर रहे हैं। पुराना संशोधन भी रखा जाएगा।",
    "You are correcting a recorded register. The earlier revision is kept.",
  ),
  attendanceCorrectReason: t("सुधार क्यों? (ज़रूरी — रजिस्टर के साथ रखा जाएगा)", "Why? (required — kept with the register)"),
  attendanceChanges: t("क्या बदलेगा", "What changes"),
  attendanceNoChanges: t("अभी कुछ नहीं बदला", "Nothing has changed yet"),
  attendanceCancelCorrection: t("सुधार छोड़ें", "Leave it as it is"),
  attendanceChecking: t("जाँच रहे हैं कि हाज़िरी सहेजी गई या नहीं…", "Checking whether your save completed…"),
  attendanceNotSavedRetry: t(
    "सहेजी नहीं गई। फिर से कोशिश करें — यह दो बार नहीं सहेजी जाएगी।",
    "Not saved. Try again — it will not be saved twice.",
  ),
  attendanceReloadList: t("नई सूची खोलें", "Open the new list"),
  attendanceSeeSaved: t("जो सहेजा गया वह देखें", "See what was saved"),
  attendanceJoined: t("अब सूची में", "Now on the list"),
  attendanceLeft: t("अब सूची में नहीं", "No longer on the list"),
  attendanceHistory: t("इतिहास", "History"),
  attendanceHistoryImported: t("संशोधन रखे जाने से पहले दर्ज", "Recorded before revisions were kept"),
  attendanceHistoryChanged: t("बदले", "changed"),
  attendanceDue: t(
    "रजिस्टर बाकी है — सहेजने पर ही दर्ज होगा।",
    "This register is outstanding — it is recorded only when saved.",
  ),

  /* ---------------------------------------------------------- notes */
  notesTitle: t("टिप्पणियाँ", "Notes"),
  notesNone: t("अभी कोई टिप्पणी नहीं है।", "No notes yet."),
  notesWrite: t("टिप्पणी लिखें", "Write a note"),
  notesKind: t("किस बारे में", "About"),
  notesBody: t("बात", "Note"),
  notesAboutClass: t("पूरी कक्षा के बारे में", "About the whole class"),
  notesDelete: t("हटाएँ", "Delete"),
  notesAdded: t("टिप्पणी जुड़ गई।", "Note added."),
  notesOwnOnly: t(
    "आप अपनी ही लिखी टिप्पणी हटा सकते हैं।",
    "You can only remove a note you wrote yourself.",
  ),
  notesConcerns: t("ध्यान देने योग्य", "need attention"),
  notesAboutStudent: t("इस बच्चे के बारे में", "About this child"),

  /* --------------------------------------------------- student card */
  studentTitle: t("बच्चे का विवरण", "Student"),
  studentAttendance: t("उपस्थिति", "Attendance"),
  studentAttendanceNone: t(
    "अभी कोई हाज़िरी दर्ज नहीं है।",
    "No attendance recorded yet.",
  ),
  studentFather: t("पिता", "Father"),
  studentMother: t("माता", "Mother"),
  studentGuardianPhone: t("अभिभावक का फ़ोन", "Guardian phone"),
  studentAdmissionNo: t("प्रवेश क्रमांक", "Admission no."),
  studentRollNo: t("रोल नंबर", "Roll no."),
  studentFees: t("फ़ीस", "Fees"),
  studentFeeDue: t("बकाया फ़ीस", "Fee outstanding"),
  studentLateFee: t("विलंब शुल्क", "Late fee"),
  studentFeePaid: t("जमा", "Paid"),
  studentFeeUnavailable: t(
    "फ़ीस की जानकारी अभी नहीं मिल सकी।",
    "The fee figures could not be read just now.",
  ),
  studentFeeNote: t(
    "फ़ीस और विलंब शुल्क अलग-अलग हैं — इन्हें जोड़ा नहीं जाता।",
    "Fees and late fees are separate and are never added together. The fee app is the authority for both.",
  ),

  /* -------------------------------------------------------- register */
  registerMonthly: t("मासिक रजिस्टर", "Monthly register"),
  registerPrint: t("छापें", "Print"),
  registerMonth: t("महीना", "Month"),
  registerNoData: t(
    "इस महीने की कोई हाज़िरी दर्ज नहीं है।",
    "No attendance was recorded this month.",
  ),
  registerWorkingDays: t("कार्यदिवस", "Working days"),
  registerPercent: t("प्रतिशत", "Percent"),
  registerDaysRecorded: t("दर्ज दिन", "Days recorded"),
  registerBelow: t("75% से कम", "Below 75%"),
  registerKey: t("संकेत", "Key"),
  registerBlankDay: t(
    "खाली ख़ाना — उस दिन हाज़िरी दर्ज नहीं हुई।",
    "A blank cell means no register was taken that day.",
  ),
  registerPreviousMonth: t("पिछला महीना", "Previous month"),
  registerNextMonth: t("अगला महीना", "Next month"),
  registerClassTotal: t("कक्षा की उपस्थिति", "Class attendance"),

  /* ------------------------------------------------- substitutions */
  navSubstitutions: t("व्यवस्था", "Cover"),
  subsTitle: t("व्यवस्था", "Cover"),
  subsForDay: t("किस दिन की", "For"),
  dutyTitle: t("व्यवस्था", "Cover duty"),
  dutyYours: t("यह व्यवस्था आपकी है", "This cover is yours"),
  dutyChangedTitle: t("यह व्यवस्था बदल गई है", "This cover has changed"),
  dutyChangedDetail: t(
    "जो सूचना आपको मिली थी वह अब सही नहीं है। आपको इस पीरियड में जाने की ज़रूरत नहीं — जब तक नीचे नई व्यवस्था आपकी न हो।",
    "The notice you received no longer stands. You are not needed for this period unless the current cover below is yours.",
  ),
  dutyCancelledTitle: t("यह व्यवस्था रद्द हो गई", "This cover was cancelled"),
  dutyCancelledDetail: t("आपको इस पीरियड में जाने की ज़रूरत नहीं है।", "You do not need to go to this period."),
  dutyNotForYou: t("यह लिंक आपके खाते के लिए नहीं है", "This link is not for your account"),
  dutyNotForYouDetail: t(
    "अपनी व्यवस्था आज वाले पेज पर देखें।",
    "Your own cover duties are on Today.",
  ),
  dutyAcknowledge: t("देख लिया — मैं जाऊँगा/जाऊँगी", "Acknowledge — I will be there"),
  dutyAcknowledged: t("आपने देख लिया है", "You have acknowledged this"),
  dutyCannotCover: t("मैं नहीं ले सकता/सकती", "I cannot cover this"),
  dutyCannotCoverNote: t("क्यों? (वैकल्पिक, केवल समन्वयक देखेंगे)", "Why? (optional, only the coordinator sees it)"),
  dutyCannotCoverSent: t(
    "समन्वयक को बता दिया गया। जब तक कोई और न दिया जाए, यह आपकी ही है।",
    "The coordinator has been told. Until someone else is assigned, it stays with you.",
  ),
  dutyAckMeans: t(
    "पुष्टि का मतलब है आपने देख लिया — कक्षा में पहुँचना फिर भी ज़रूरी है।",
    "Acknowledging says you have seen it — you still need to be in the room.",
  ),
  dutyPeriodOver: t("यह पीरियड समाप्त हो चुका", "This period has ended"),
  dutyWhen: t("कब", "When"),
  dutyClasses: t("कक्षा", "Class"),
  dutySubject: t("विषय", "Subject"),
  dutyCoveringFor: t("किसकी जगह", "Covering for"),
  teachCoverOpen: t("खोलें और पुष्टि करें", "Open and acknowledge"),
  coverSendNow: t("अभी भेजें", "Send now"),
  coverTransport: t("माध्यम", "Transport"),
  coverConfirmedReceived: t("मिल गई (पूछकर पुष्टि की)", "Received (checked in person)"),
  coverResend: t("फिर भेजें", "Send again"),
  coverResendMaybeTwice: t("फिर भेजें — दो बार पहुँच सकती है", "Send again — may arrive twice"),
  coverSwitchesTitle: t("चालू / बंद", "Switches"),
  coverSwitchesHint: t(
    "बंद करने से कुछ मिटता नहीं — बनी हुई व्यवस्था और सूचनाओं का इतिहास दिखता रहता है।",
    "Switching off deletes nothing — committed cover and notice history stay visible.",
  ),
  coverSwitchCommand: t("व्यवस्था सहेजना", "Saving absences and cover"),
  coverSwitchNotices: t("सूचनाएँ भेजना", "Sending cover notices"),
  switchOn: t("चालू", "On"),
  switchOff: t("बंद", "Off"),
  switchTurnOn: t("चालू करें", "Turn on"),
  switchTurnOff: t("बंद करें", "Turn off"),
  coverSaveAbsence: t("अनुपस्थिति सहेजें और व्यवस्था करें", "Save absence & arrange cover"),
  coverSaved: t("सहेजा गया", "Saved"),
  coverAlreadySaved: t("यह पहले ही सहेजा जा चुका था", "This was already saved"),
  coverChecking: t("जाँच रहे हैं कि यह सहेजा गया या नहीं…", "Checking whether this saved…"),
  coverNotSavedRetry: t(
    "सहेजा नहीं गया। फिर से कोशिश करना सुरक्षित है — दो बार नहीं होगा।",
    "Not saved. Trying again is safe — it cannot be saved twice.",
  ),
  coverBackAtSchool: t("स्कूल में हैं", "Back at school"),
  coverAssign: t("इन्हें दें", "Assign"),
  coverChooseTeacher: t("अध्यापक चुनें", "Choose a teacher"),
  coverRelease: t("हटाएँ", "Release"),
  coverRearrange: t("फिर से व्यवस्था करें", "Arrange again"),
  coverAssigned: t("व्यवस्था हुई", "Assigned"),
  coverNeedsHelp: t("मदद चाहिए", "Needs help"),
  coverStarted: t("पीरियड शुरू हो चुका", "Period has started"),
  coverFor: t("की जगह", "Covering for"),
  coverSuggested: t("सुझाव", "Suggested"),
  coverManual: t("हाथ से", "Chosen by hand"),
  coverAcknowledged: t("अध्यापक ने देखा", "Teacher acknowledged"),
  coverNotAcknowledged: t("अभी देखा नहीं", "Not yet acknowledged"),
  coverCannotCover: t("अध्यापक नहीं ले सकते", "Teacher cannot cover"),
  coverNoticeQueued: t("सूचना कतार में", "Notice queued"),
  coverNoticeSent: t("सूचना भेजी गई", "Notice accepted by WhatsApp"),
  coverNoticeUnknown: t("सूचना की पुष्टि नहीं", "Delivery not confirmed"),
  coverNoticeFailed: t("सूचना नहीं गई", "Notice failed"),
  coverNoticeBlocked: t("नंबर नहीं — सूचना नहीं जाएगी", "No phone — notice blocked"),
  coverNoticeNone: t("सूचना नहीं", "No notice"),
  coverNoLogin: t("इनका लॉगिन नहीं — लिंक नहीं खोल पाएँगे", "No login — cannot open the link"),
  coverHistory: t("पहले की व्यवस्था", "Earlier versions"),
  coverDutiesTitle: t("आज की व्यवस्था", "Cover duties"),
  coverNothingNeeded: t("इस दिन किसी व्यवस्था की ज़रूरत नहीं।", "No cover is needed on this day."),
  coverClash: t("समय-सारणी में टकराव — कुछ पाठ जाँचें", "The timetable has clashes — check some lessons"),
  subsAbsentToday: t("आज अनुपस्थित", "Away today"),
  subsNobodyAway: t("आज कोई अनुपस्थित नहीं है।", "Nobody is marked away."),
  subsMarkAbsent: t("अनुपस्थित दर्ज करें", "Mark somebody away"),
  subsWholeDay: t("पूरा दिन", "Whole day"),
  subsPeriods: t("कौन से पीरियड", "Which periods"),
  subsReason: t("कारण", "Reason"),
  subsRemoveAbsence: t("आ गए", "They came in"),
  subsNoTimetable: t(
    "पहले समय-सारिणी लागू करें।",
    "Publish a timetable first — cover is worked out from it.",
  ),
  subsNoVacancies: t(
    "कोई पीरियड खाली नहीं है।",
    "No period is left without a teacher.",
  ),
  subsGenerate: t("व्यवस्था बनाएँ", "Work out the cover"),
  subsRegenerate: t("फिर से बनाएँ", "Work it out again"),
  subsPublish: t("जारी करें", "Publish"),
  subsUnpublish: t("वापस लें", "Withdraw"),
  subsPublished: t("जारी", "Published"),
  subsDraft: t("मसौदा", "Draft"),
  subsNotPublished: t(
    "यह अभी जारी नहीं हुआ — अध्यापकों को दिखाई नहीं देगा।",
    "Not published yet, so no teacher can see it.",
  ),
  subsStale: t(
    "समय-सारिणी बदल गई है — फिर से बनाएँ।",
    "The timetable has been republished since this was planned. Work it out again.",
  ),
  subsCovered: t("व्यवस्था हुई", "Covered"),
  subsSelfStudy: t("स्वयं अध्ययन", "Self study"),
  subsMerged: t("साथ बैठेंगे", "Joined another class"),
  subsOpen: t("कोई नहीं मिला", "Nobody free"),
  subsNeedsReview: t("पुष्टि करें", "Confirm"),
  subsPin: t("पक्का करें", "Pin"),
  subsUnpin: t("पक्का हटाएँ", "Unpin"),
  subsPinned: t("पक्का", "Pinned"),
  subsPinKeeps: t(
    "पक्की की गई व्यवस्था दोबारा बनाने पर भी बनी रहती है।",
    "A pinned row survives working the cover out again.",
  ),
  subsChangeTeacher: t("बदलें", "Change"),
  subsChooseTeacher: t("अध्यापक चुनें", "Choose who covers"),
  subsSetSelfStudy: t("स्वयं अध्ययन रखें", "Leave as self study"),
  subsMergeInto: t("इस कक्षा के साथ", "Send them to"),
  subsPeriodShort: t("पी", "P"),
  subsOriginal: t("मूल अध्यापक", "Normally"),
  subsWhy: t("क्यों", "Why"),
  subsPlanSummary: t("सारांश", "Summary"),
  subsPoliciesTitle: t("व्यवस्था की नीति", "Cover policy"),
  subsRulesTitle: t("व्यवस्था के नियम", "Cover rules"),
  subsRulesIntro: t(
    "समय-सारणी यह नहीं बताती कि पीरियड कब होता है, या टीम में कितने अध्यापक होने ज़रूरी हैं। यहाँ स्कूल यह तय करता है।",
    "The timetable cannot say when a period happens or how many of a team must be there. The school decides both here.",
  ),
  bellsTitle: t("घंटी का समय", "Bell times"),
  bellsHint: t(
    "जो पीरियड शुरू हो चुका है, उसकी व्यवस्था ऐप अपने-आप नहीं करता।",
    "Cover is never arranged automatically for a period that has already started.",
  ),
  bellsStarts: t("शुरू", "Starts"),
  bellsEnds: t("समाप्त", "Ends"),
  bellsRevision: t("संस्करण", "Revision"),
  lessonsTitle: t("समय-सारणी में पाठ", "Lessons in the timetable"),
  lessonsHint: t(
    "एक अध्यापक का एक साथ कई कक्षाओं को पढ़ाना एक ही पाठ है; बँटी हुई कक्षा के दोनों हिस्से अलग पाठ हैं।",
    "One teacher with several classes at once is one lesson; the two halves of a split class are two.",
  ),
  lessonOrdinary: t("सामान्य", "Ordinary"),
  lessonJoint: t("संयुक्त", "Joint"),
  lessonParallel: t("बँटी कक्षा का हिस्सा", "Split-class cohort"),
  lessonTeam: t("टीम", "Team block"),
  teamRulesTitle: t("टीम के नियम", "Team rules"),
  teamRulesHint: t(
    "नियम के बिना, टीम का कोई अध्यापक अनुपस्थित होने पर ऐप ख़ुद व्यवस्था नहीं करता — व्यक्ति देखता है।",
    "Without a rule, any absence from a team is shown to a person and never arranged by the app.",
  ),
  teamMinimum: t("कम से कम उपस्थित", "Must be present"),
  teamNoRule: t("नियम नहीं", "No rule"),
  teamNone: t("समय-सारणी में कोई टीम नहीं", "No team blocks in the published timetable"),
  teamSize: t("टीम", "Team"),
  teamBlocksPerWeek: t("हफ़्ते में", "Per week"),
  clashesTitle: t("समय-सारणी में टकराव", "Timetable clashes"),
  clashesHint: t(
    "एक ही व्यक्ति एक ही समय दो पाठों में। व्यवस्था से पहले समय-सारणी ठीक करें।",
    "One person in two lessons at once. Fix the timetable before relying on cover for these.",
  ),
  clashesNone: t("कोई टकराव नहीं", "No clashes"),
  subsPoliciesHint: t(
    "कौन कब विद्यालय में है, और किसे कब बुलाया जा सकता है।",
    "Who is in the building when, and who may be asked to cover.",
  ),
  subsOnSite: t("विद्यालय में", "In school for"),
  subsRole: t("श्रेणी", "Kind"),
  subsMaxAuto: t("अपने आप अधिकतम", "Automatic cover limit"),
  subsPolicyNote: t("टिप्पणी", "Note"),
  subsPolicyReset: t("सामान्य कर दें", "Back to the default"),
  subsFullDay: t("पूरा दिन", "Full day"),
  subsCoverFor: t("की जगह", "covering for"),
  teachCoverDuty: t("आज की व्यवस्था", "Cover duty today"),
  teachCoverNone: t("आज कोई व्यवस्था नहीं है।", "No cover duty today."),

  /* ---------------------------------------------------- collection */
  navCollection: t("जानकारी", "Collection"),
  collectionTitle: t("जानकारी जुटाएँ", "Collect information"),
  collectionIntro: t(
    "एक लिंक भेजिए — अध्यापक बिना साइन इन किए भर देंगे।",
    "Send one link. A teacher fills it in without signing in.",
  ),
  collectionNone: t("अभी कोई निवेदन नहीं है।", "Nothing has been asked for yet."),
  collectionNew: t("नया निवेदन", "Ask for something"),
  collectionFieldsTitle: t("कौन-कौन सी जानकारी", "What can be asked for"),
  collectionFieldsIntro: t(
    "हर सवाल एक बार लिखा जाता है और कई बार पूछा जाता है।",
    "Each question is written once and asked many times.",
  ),
  collectionFieldKey: t("कुंजी", "Key"),
  collectionFieldKeyHint: t(
    "यह बाद में बदली नहीं जा सकती — उत्तर इसी से जुड़ते हैं।",
    "This cannot be changed later: every answer points at it.",
  ),
  collectionFieldType: t("किस तरह का उत्तर", "Kind of answer"),
  collectionFieldMode: t("कैसे पूछें", "How to ask"),
  collectionFieldLength: t("कितने अंक/अक्षर", "Exact length"),
  collectionFieldMax: t("अधिकतम", "Largest allowed"),
  collectionFieldOptions: t("विकल्प", "Choices"),
  collectionFieldOptionsHint: t(
    "एक पंक्ति में एक",
    "One per line",
  ),
  collectionFieldFeeColumn: t("फ़ीस ऐप का कॉलम", "Fee app column"),
  collectionFieldFeeColumnHint: t(
    "मिलान के लिए — VPPS One फ़ीस ऐप में कभी नहीं लिखता।",
    "For comparison only. VPPS One never writes to the fee app.",
  ),
  collectionFieldHelp: t("सहायता पंक्ति", "Helper line"),
  collectionRetire: t("पूछना बंद करें", "Stop asking this"),
  collectionRestore: t("फिर से पूछें", "Ask this again"),
  collectionRetired: t("बंद", "Retired"),
  collectionAsking: t("क्या पूछा जा रहा है", "What is being asked"),
  collectionChooseFields: t("जानकारी चुनें", "Choose what to ask for"),
  collectionDueDate: t("कब तक", "Due by"),
  collectionAssignTo: t("किसे भेजना है", "Who is being asked"),
  collectionReason: t("कारण", "Why this list"),
  collectionReasonHint: t(
    "पूरी कक्षा नहीं है तो बताइए — वरना सूची अधूरी लगती है।",
    "If this is not the whole class, say why. Otherwise the list reads as broken.",
  ),
  collectionOpen: t("लिंक चालू करें", "Open the link"),
  collectionClose: t("लिंक बंद करें", "Close the link"),
  collectionReopen: t("फिर चालू करें", "Open it again"),
  collectionLink: t("लिंक", "Link"),
  collectionCopyLink: t("लिंक कॉपी करें", "Copy the link"),
  collectionCopied: t("कॉपी हो गया", "Copied"),
  collectionOpenWhatsapp: t("व्हाट्सएप में खोलें", "Open in WhatsApp"),
  collectionRotate: t("नया लिंक बनाएँ", "Replace the link"),
  collectionRotateHint: t(
    "पुराना लिंक तुरंत बंद हो जाएगा।",
    "The old link stops working at once.",
  ),
  collectionDraftNotice: t(
    "यह अभी मसौदा है — लिंक काम नहीं करेगा।",
    "This is still a draft, so the link does not open.",
  ),
  collectionProgress: t("कितना भरा", "Filled in"),
  collectionWaitingOn: t("किनका बाकी है", "Still waiting on"),
  collectionAnswered: t("उत्तर आए", "answered"),

  /* -------------------------------------------------------- review */
  reviewTitle: t("आई हुई जानकारी", "Answers to check"),
  reviewNone: t("कुछ जाँचने को नहीं है।", "Nothing is waiting to be checked."),
  reviewChanges: t("बदलाव", "Changes"),
  reviewConfirmations: t("जैसा था वैसा ही", "Confirmed unchanged"),
  reviewConfirmationsHint: t(
    "इन्हें एक साथ स्वीकार कर लीजिए — कुछ बदला नहीं है।",
    "Accept these together: a teacher looked and nothing changed.",
  ),
  reviewWas: t("पहले", "Was"),
  reviewNow: t("अब", "Now"),
  reviewAccept: t("स्वीकार करें", "Accept"),
  reviewReject: t("अस्वीकार करें", "Reject"),
  reviewAcceptAll: t("सब स्वीकार करें", "Accept all of these"),
  reviewSharedPhone: t("और बच्चों पर भी यही नंबर", "also on other children"),
  reviewSharedPhoneHint: t(
    "भाई-बहन का एक ही नंबर होना सामान्य है।",
    "Siblings sharing a number is normal, not a mistake.",
  ),
  reviewDecided: t("फ़ैसला", "Decided"),
  reviewFeeAppDiffers: t(
    "फ़ीस ऐप में अलग दर्ज है — वहाँ स्वयं बदलिए।",
    "The fee app holds something different. Change it there, deliberately.",
  ),

  /* ----------------------------------------------------- documents */
  documentsTitle: t("कागज़ात", "Documents"),
  documentsNone: t("कोई कागज़ नहीं है।", "No documents yet."),
  documentsAdd: t("कागज़ जोड़ें", "Add a document"),
  documentsKind: t("किस तरह का", "What is it"),
  documentsFile: t("फ़ाइल", "File"),
  documentsNote: t("टिप्पणी", "Note"),
  documentsOpen: t("खोलें", "Open"),
  documentsRemove: t("हटाएँ", "Remove"),
  documentsLimit: t(
    "PDF या फ़ोटो, 10 MB तक।",
    "A PDF or a photograph, up to 10 MB.",
  ),
  documentsPrivate: t(
    "लिंक एक मिनट चलता है — साझा न करें।",
    "The link lasts a minute and is not for sharing.",
  ),
  recordsTitle: t("दर्ज जानकारी", "What we hold"),
  recordsNone: t("अभी कुछ दर्ज नहीं है।", "Nothing recorded yet."),

  /* ------------------------------------------------------ messages */
  messagesTitle: t("संदेश", "Messages"),
  messagesIntro: t(
    "कतार में, भेजे गए और जो नहीं गए — दोबारा भेजने के इतिहास के साथ।",
    "Queued, sent and failed updates, with their retry history.",
  ),
  messagesTemplates: t("टेम्पलेट", "Templates"),
  messagesQueue: t("भेजने की सूची", "To send"),
  messagesNone: t("कोई संदेश नहीं है।", "No messages."),
  messagesTemplateCode: t("प्रदाता का नाम", "Provider name"),
  messagesTemplateCodeHint: t(
    "AiSensy में यही नाम होना चाहिए।",
    "This must match the campaign name in AiSensy exactly.",
  ),
  messagesBody: t("संदेश", "Message"),
  messagesBodyHint: t(
    "{{1}}, {{2}} की जगह भरी जाएगी।",
    "{{1}}, {{2}} are filled in when it is sent.",
  ),
  messagesVariables: t("क्या-क्या भरना है", "What goes in the blanks"),
  messagesAudience: t("किसके लिए", "Who it is for"),
  messagesHasButton: t("लिंक बटन है", "Has a link button"),
  messagesSendByHand: t("व्हाट्सएप खोलकर भेजें", "Open WhatsApp and send"),
  messagesMarkSent: t("भेज दिया", "I have sent it"),
  messagesCancel: t("रद्द करें", "Cancel"),
  messagesParentRule: t(
    "अभिभावक को संदेश हमेशा कोई व्यक्ति स्वयं भेजता है।",
    "A message to a parent is always pressed by a person, never by the app.",
  ),

  // P9: approved against what is true when it goes; a wrong number stops use.
  messagesNotConfigured: t(
    "प्रदाता अभी जुड़ा नहीं है — व्हाट्सएप खोलकर भेजिए।",
    "No provider is connected, so open it in WhatsApp and press send.",
  ),

  /* -------------------------------------------- the public link pages */
  linkTitle: t("विद्यालय की जानकारी", "School information"),
  linkToDo: t("करने हैं", "to do"),
  linkDueBy: t("कब तक", "Due by"),
  linkSaved: t("सहेज लिया", "Saved"),
  linkSentDone: t("भेज दिया ✓", "Sent ✓"),
  linkSaveAll: t("भेजें", "Send"),
  linkUnchanged: t("यही सही है", "This is right"),
  linkChange: t("बदलें", "Change"),
  linkNothingToDo: t("सब भर चुका है। धन्यवाद।", "All done. Thank you."),
  linkClosed: t("यह लिंक अब नहीं खुलता।", "This link no longer opens."),
  linkYourRequests: t("आपके लिए", "For you"),
  linkNoRequests: t("अभी कुछ भरना बाकी नहीं है।", "Nothing to fill in right now."),
  linkTooMany: t(
    "बहुत बार खोला गया — थोड़ी देर बाद फिर कोशिश कीजिए।",
    "Too many attempts. Please wait a minute and try again.",
  ),
  linkRollEmpty: t(
    "इस कक्षा में कोई बच्चा नहीं है।",
    "Nobody is on this class's roll.",
  ),

  /* --------------------------------------------------- assessments */
  navAssessments: t("परीक्षा", "Exams"),
  assessmentsTitle: t("परीक्षाएँ", "Exams"),
  assessmentsIntro: t(
    "हर परीक्षा के लिए कक्षा, विषय और पूर्णांक तय कीजिए।",
    "Each exam needs its classes, its subjects and what each paper is out of.",
  ),
  assessmentsNone: t("अभी कोई परीक्षा नहीं है।", "No exams yet."),
  assessmentNew: t("नई परीक्षा", "Add an exam"),
  assessmentTerm: t("सत्र", "Term"),
  assessmentCode: t("संक्षिप्त कोड", "Short code"),
  assessmentKind: t("प्रकार", "Kind"),
  assessmentWeight: t("भार", "Weight"),
  assessmentWeightHint: t(
    "प्रगति पत्र में यह परीक्षा कितनी गिनी जाएगी।",
    "How much this exam counts towards the term.",
  ),
  assessmentStarts: t("कब से", "From"),
  assessmentEnds: t("कब तक", "To"),
  assessmentOpen: t("अंक भरना शुरू करें", "Open for marks"),
  assessmentLock: t("बंद करें", "Lock"),
  assessmentUnlock: t("फिर खोलें", "Unlock"),
  assessmentLockHint: t(
    "बंद परीक्षा में अंक नहीं बदले जा सकते।",
    "No marks can be entered or changed while an exam is locked.",
  ),
  assessmentDelete: t("मसौदा हटाएँ", "Delete this draft"),

  /* ------------------------------------------------------- papers */
  papersTitle: t("पेपर", "Papers"),
  papersNone: t(
    "अभी कोई पेपर नहीं जोड़ा गया।",
    "No papers yet. A paper is one class, one subject and a total.",
  ),
  paperAdd: t("पेपर जोड़ें", "Add a paper"),
  paperMax: t("पूर्णांक", "Out of"),
  paperPass: t("उत्तीर्ण अंक", "Pass mark"),
  paperSubject: t("विषय", "Subject"),

  /* -------------------------------------------------------- marks */
  marksTitle: t("अंक", "Marks"),
  marksGrid: t("अंक भरें", "Enter marks"),
  marksNone: t("भरने को कुछ नहीं है।", "Nothing to enter."),
  marksAbsent: t("अनुपस्थित", "Absent"),
  marksNotEntered: t("नहीं भरा", "Not entered"),
  marksEntered: t("भरे गए", "entered"),
  marksSaveRow: t("मसौदा सहेजें", "Save draft"),
  marksSaved: t("सहेज लिया", "Saved"),
  marksLocked: t(
    "यह परीक्षा बंद है।",
    "This exam is locked, so marks cannot be changed.",
  ),
  marksChangeLog: t("बदलाव का लेखा", "Change log"),
  marksChangeNone: t("अभी कोई बदलाव नहीं हुआ।", "Nothing has been changed yet."),
  marksChangeReason: t("कारण", "Why"),
  marksChangeReasonHint: t(
    "पहले से भरे अंक बदल रहे हैं तो कारण लिखिए।",
    "Changing a mark somebody has already seen? Say why.",
  ),
  marksWhoIsLeft: t("किनके अंक बाकी हैं", "Still to enter"),
  marksAllIn: t("सब अंक भर चुके हैं।", "Every mark is in."),

  // P7: drafted, then submitted, then corrected only with a reason.
  marksExempt: t("छूट", "Exempt"),
  marksSubmit: t("अंक जमा करें", "Submit marks"),
  marksSubmitCheck: t("जमा करने से पहले देख लें", "Check before submitting"),
  marksSubmitMeans: t(
    "जमा करने का अर्थ है कि आपने अंक भर दिए। इससे परिणाम स्वीकृत या रिपोर्ट जारी नहीं होती।",
    "Submitting says you have finished entering. It does not approve a result or issue a report.",
  ),
  marksSubmitConfirm: t("हाँ, जमा करें", "Yes, submit"),
  marksBack: t("अंकों पर लौटें", "Back to the marks"),
  marksStillBlank: t("अभी खाली", "Still blank"),
  marksBlankNeverZero: t("खाली को शून्य नहीं माना जाता।", "A blank is never counted as zero."),
  marksDraftStatus: t("मसौदा — अभी जमा नहीं", "Draft — not submitted yet"),
  marksSubmittedStatus: t("जमा", "Submitted"),
  marksCorrect: t("जमा अंक सुधारें", "Correct submitted marks"),
  marksCorrecting: t(
    "आप जमा पेपर के अंक बदल रहे हैं। हर बदलाव कारण के साथ लेखे में रहेगा।",
    "You are changing a submitted paper. Every change is kept in the log with your reason.",
  ),
  marksCorrectReason: t("बदलाव क्यों? (ज़रूरी)", "Why? (required)"),
  marksSaveCorrection: t("सुधार सहेजें", "Save the correction"),
  marksLeaveAsIs: t("जैसे हैं वैसे छोड़ें", "Leave them as they are"),
  marksReopen: t("अध्यापक के लिए फिर खोलें", "Reopen for the teacher"),
  marksChecking: t("जाँच रहे हैं कि अंक सहेजे गए या नहीं…", "Checking whether your save completed…"),
  marksNotSavedRetry: t(
    "सहेजे नहीं गए। फिर से कोशिश करें — दो बार नहीं सहेजे जाएँगे।",
    "Not saved. Try again — it will not be saved twice.",
  ),
  marksReload: t("पेज फिर से खोलें", "Reload the page"),
  marksNotYourSubject: t(
    "इस कक्षा में यह विषय आपका नहीं है — अंक इसके विषय-अध्यापक भरेंगे।",
    "This subject is not yours in this class — its subject teacher enters these marks.",
  ),
  paperMarkStep: t("अंक किस हिस्से तक", "Marks go to"),
  paperMarkStepWhole: t("पूरे अंक", "Whole marks"),
  paperMarkStepHalf: t("आधे अंक", "Halves"),
  paperMarkStepQuarter: t("चौथाई अंक", "Quarters"),
  paperAllowExempt: t("छूट दी जा सकती है", "A child may be exempt"),
  paperSchemeInUse: t(
    "इस पेपर के अंक भरे जा रहे हैं — पूर्णांक, अंक का हिस्सा या छूट अब नहीं बदल सकते।",
    "Marks are being entered on this paper — its maximum, step and exemption cannot change now.",
  ),
  paperSubmitted: t("जमा", "Submitted"),
  paperDraft: t("मसौदा", "Draft"),

  // P8: a card is issued once, from an approved scheme; a reissue keeps the old one.

  /* ----------------------------------------------------- progress */
  progressTitle: t("प्रगति", "Progress"),
  progressPerPaper: t("पेपर के हिसाब से", "By paper"),
  progressPerStudent: t("बच्चे के हिसाब से", "By child"),
  progressTotal: t("कुल", "Total"),
  progressPercent: t("प्रतिशत", "Percent"),
  progressGrade: t("श्रेणी", "Grade"),
  progressMissing: t("अंक बाकी", "papers unmarked"),
  progressNoMarks: t("अभी कोई अंक नहीं है।", "No marks yet."),

  /* -------------------------------------------------- report cards */
  reportTitle: t("प्रगति पत्र", "Report card"),
  reportNone: t("इस सत्र का कोई प्रगति पत्र नहीं है।", "No report card for this term."),
  reportIssue: t("जारी करें", "Issue this card"),
  reportReissue: t("फिर जारी करें", "Issue it again"),
  reportIssued: t("जारी हो गया", "Issued"),
  reportIssuedOn: t("जारी", "Issued"),
  reportPreview: t("पूर्वावलोकन", "Preview"),
  reportPreviewHint: t(
    "यह आज के अंकों से बना है। जारी करने पर यही रुक जाएगा।",
    "Built from today's marks. Issuing it freezes exactly this.",
  ),
  reportFrozenHint: t(
    "जारी किया गया पत्र वैसा ही रहता है, बाद में अंक बदलें तब भी।",
    "An issued card stays as it was, even if a mark changes later.",
  ),
  reportGradeDefault: t(
    "श्रेणी की सीमाएँ अभी मानक हैं — विद्यालय से पुष्टि करनी है।",
    "The grade bands are a common default and still need confirming with the school.",
  ),
  reportAttendance: t("उपस्थिति", "Attendance"),
  reportSubject: t("विषय", "Subject"),
  reportOutOf: t("पूर्णांक", "Out of"),
  // Shown only when the exams in this term do not count equally — otherwise
  // the percentage is exactly the two numbers beside it divided, and saying so
  // would invite a question nobody had.
  reportWeighted: t(
    "प्रतिशत परीक्षाओं के भार के अनुसार निकाला गया है, इसलिए यह कुल के सीधे भाग से अलग है।",
    "The percentage is weighted by what each exam counts for, so it is not the total divided straight.",
  ),

  /* -------------------------------------------------------- exports */
  exportsTitle: t("निर्यात", "Exports"),
  exportsIntro: t(
    "जो भी निर्यात होता है उसका लेखा रखा जाता है।",
    "Everything taken out of here is logged: who took what, and when.",
  ),
  exportMarks: t("अंक निर्यात करें", "Export marks"),
  exportNone: t("अभी कुछ निर्यात नहीं हुआ।", "Nothing has been exported yet."),
  exportRows: t("पंक्तियाँ", "rows"),
  exportTakenBy: t("किसने लिया", "Taken by"),

  /* ----------------------------------------------------------- jobs */
  jobsTitle: t("अपने आप चलने वाले काम", "Scheduled jobs"),
  jobsIntro: t(
    "कुछ काम हर दिन अपने आप होते हैं। यहाँ दिखता है कि आख़िरी बार कब और क्या हुआ।",
    "Some work happens on its own every day. This is when it last ran, and what it did.",
  ),
  jobsRunNow: t("अभी चलाएँ", "Run now"),
  jobsRunning: t("चल रहा है…", "Running…"),
  jobsNeverRun: t("अभी तक नहीं चला।", "This has not run yet."),
  jobsLastRun: t("आख़िरी बार", "Last run"),
  jobsHistory: t("पिछले कुछ रन", "Recent runs"),
  jobsNoHistory: t("अभी कोई रन नहीं हुआ।", "Nothing has run yet."),
  jobsSchedule: t("समय", "Runs"),
  jobsTookMs: t("लगा", "took"),
  jobsManual: t("हाथ से चलाया", "Run by hand"),
  jobsScheduled: t("अपने आप चला", "Ran on schedule"),
  jobsStale: t(
    "यह रन बीच में ही रुक गया लगता है।",
    "This run seems to have stopped part-way.",
  ),
  jobsBusy: t(
    "यह काम अभी पहले से चल रहा है।",
    "That job is already running.",
  ),
  jobsDone: t("हो गया।", "Done."),
  jobsFailed: t("नहीं हो सका।", "That did not work."),
  // Said when a job is asked for a second time on a day it has already done.
  // Not a refusal: pressing the button again forces it, and this is what the
  // schedule itself gets when a cron fires twice.
  jobsAlreadyToday: t(
    "यह आज पहले ही हो चुका है — फिर भी चलाना हो तो दोबारा दबाइए।",
    "This already ran today. Press again if you want it to run anyway.",
  ),
  jobsForceRun: t("फिर भी चलाएँ", "Run it anyway"),

  timetableClashFound: t(
    "एक ही समय पर दो जगह।",
    "The same teacher is expected in two different lessons at once.",
  ),
  noSessionFound: t(
    "कोई सत्र नहीं मिला।",
    "No academic session was found in the fee app's classes.",
  ),

  /* ------------------------------------------------- the other two apps */
  //
  // Names first, purpose second (PLAN §3a): "SamPark" and "School Fees" are
  // what the staff already call them, and the half after the dash is what
  // tells somebody which one their task is in.
  navApps: t("ऐप", "Apps"),
  appsTitle: t("स्कूल के ऐप", "The school's apps"),
  appsIntro: t(
    "फ़ीस और विद्यार्थी जानकारी अपने-अपने ऐप में ही रहती है। यहाँ से सीधे खुल जाएगा।",
    "Fees and student information stay in their own apps. These open them directly.",
  ),
  appSampark: t("सम्पर्क — विद्यार्थी जानकारी", "SamPark — Student information"),
  appSamparkPurpose: t(
    "अभिभावक के नंबर, पते और दस्तावेज़ इकट्ठा करना।",
    "Collecting parents' numbers, addresses and documents.",
  ),
  appSchoolFees: t("स्कूल फ़ीस — भुगतान और बकाया", "School Fees — Payments and dues"),
  // Deliberately says "the separate deployment" now. Since the port, this app
  // has a fee desk of its own — and the two are not the same data: the desk
  // in here is on schoolfees-dev, this link is on the live one. Two doors
  // labelled "taking payments" with the school's real money behind one of
  // them is the ambiguity worth spending a sentence on.
  appSchoolFeesPurpose: t(
    "पुराना फ़ीस ऐप — असली डेटा। इस ऐप का शुल्क डेस्क अलग है।",
    "The separate School Fees deployment, on live data. The fee desk inside this app is not the same database.",
  ),
  appOpenApp: t("ऐप खोलें", "Open the app"),
  appExternal: t("अलग ऐप", "A separate app"),
  appSignInAgain: t(
    "यह अलग ऐप है — वहाँ अपने उसी ऐप के खाते से साइन इन करना पड़ सकता है।",
    "This is a separate app. You may need to sign in there with that app's own account.",
  ),
  appLiveData: t("असली डेटा", "Live data"),
  appTestData: t("टेस्ट डेटा", "Test data"),
  appOpensLiveData: t(
    "यह असली स्कूल डेटा खोलता है, टेस्ट डेटा नहीं।",
    "This opens the school's live data, not test data.",
  ),
  appOpensTestData: t(
    "यह टेस्ट डेटा खोलता है।",
    "This opens test data.",
  ),
  appOpenThisChild: t("इस बच्चे को खोलें", "Open this child"),
  appFindThisChild: t("इस बच्चे को खोजें", "Find this child"),
  // The desktop sidebar's three groups, in the order a day runs.
  // A title or a reason somebody typed, shown to a reader whose language it
  // was not written in. Short, because it sits beside the text itself.
  // The teacher hero. The same two words every morning, so it is recognised
  // rather than read.
  teachFirstThingsFirst: t("सबसे पहले", "First things first"),
  teachTakeRegisterNow: t("हाज़िरी ले लीजिए", "Take the register"),
  // A subject taught to several classes at once is one lesson in one room,
  // not one row per class (B-20).
  teachCombinedLesson: t("एक साथ", "Combined"),
  /* --------------------------------------------- the role home queues */
  //
  // PLAN section 3 asks for "exceptions with counts and owners". The owner is
  // the load-bearing half: a number with no name beside it is somebody else
  // problem to everybody who reads it.
  /* ------------------------------------------------- student directory */
  recordsSourceHint: t(
    "हर जानकारी के साथ लिखा है कि वह कहाँ से आई।",
    "Each value says where it came from.",
  ),
  /* ------------------------------------------------- who a round asks */
  audienceClass: t("कक्षा", "Class"),
  audienceHouse: t("सदन", "House"),
  audienceRoute: t("बस मार्ग", "Bus route"),
  audienceList: t("चुनी हुई सूची", "A chosen list"),
  // One link over every group in the round, held by the office.
  audienceMaster: t("सभी कक्षाएँ", "All classes"),

  /* ------------------------------------------------------ rounds (R3.2) */

  roundsTitle: t("राउंड", "Rounds"),
  roundsHint: t(
    "एक सवाल, कई कक्षाओं से। पहले देखिए किसके पास जाएगा, फिर बनाइए।",
    "One question, asked of many classes. See who it reaches before you make it.",
  ),
  roundsNone: t("अभी कोई राउंड नहीं है।", "No rounds yet."),
  roundNew: t("नया राउंड", "New round"),
  roundCreate: t("राउंड बनाएँ", "Create the round"),
  roundCreated: t("राउंड बन गया।", "The round is saved."),

  roundWho: t("किनसे पूछना है", "Who to ask about"),
  roundWhat: t("क्या पूछना है", "What to ask for"),
  roundWhen: t("कब तक", "By when"),
  roundWhy: t("क्यों", "Why"),

  roundClasses: t("कक्षाएँ", "Classes"),
  roundAllClasses: t("सभी कक्षाएँ", "Every class"),
  roundGaps: t("सिर्फ़ जिनकी जानकारी बाकी है", "Only the children we are missing this for"),
  roundGapsHint: t(
    "एक से ज़्यादा चुनने पर सिर्फ़ वे बच्चे आएँगे जिनकी सभी चुनी हुई जानकारी बाकी है।",
    "Choosing more than one selects only the children missing all of them.",
  ),

  roundPreview: t("अभी देखिए", "See who this reaches"),
  roundPreviewUpdate: t("गिनती दोबारा देखें", "Update the count"),
  // Singular and plural, because both languages inflect and Hindi is the one
  // that gets forgotten: "1 कक्षाओं में" reads as broken to every Hindi
  // speaker in the school and is invisible to anybody reviewing in English.
  roundCoversOne: t("बच्चा", "child"),
  roundCoversMany: t("बच्चे", "children"),
  roundAcrossOne: t("कक्षा में", "class"),
  roundAcrossMany: t("कक्षाओं में", "classes"),
  roundNobody: t(
    "इस चुनाव में कोई बच्चा नहीं आता। कुछ और चुनकर देखिए।",
    "Nothing is selected yet. Choose a class, a house or a filter.",
  ),
  roundNobodyMatched: t(
    "इस चुनाव में कोई बच्चा नहीं मिला।",
    "No child matches this selection.",
  ),
  roundNarrowedFrom: t("में से", "narrowed from"),

  roundReasonNeeded: t(
    "पूरी कक्षा नहीं जा रही, इसलिए कारण लिखना ज़रूरी है — शिक्षक को अधूरी सूची अपने आप समझ नहीं आएगी।",
    "This is not a whole class, so it needs a reason — an unexplained short list reads to a teacher as a broken one.",
  ),
  roundReasonSuggested: t("सुझाया गया कारण", "Suggested reason"),

  roundUnknownGap: t(
    "एक फ़िल्टर ऐसी जानकारी का था जो अब सूची में नहीं है। उसे छोड़ दिया गया।",
    "One filter named something no longer on the list. It was left out.",
  ),

  roundNoLinksYet: t(
    "अभी कोई लिंक नहीं बना। लिंक भेजना अगला काम है।",
    "No links yet. Handing them to teachers is the next task.",
  ),

  /* ------------------------------------------------------ the ask list */

  askListTitle: t("सूची चढ़ाइए", "Upload a list"),
  askListHint: t(
    "जब कोई फ़िल्टर उन बच्चों को नहीं ढूँढ़ सकता जिनके बारे में पूछना है — उनका SR नंबर सूची में लिखिए।",
    "For when no filter can find the children you mean — write their SR numbers in a sheet.",
  ),
  askListTemplate: t("नमूना फ़ाइल", "Download the template"),
  askListChoose: t("फ़ाइल चुनिए", "Choose the file"),
  askListCheck: t("मिलान देखिए", "Check the list"),
  askListMatched: t("मिल गए", "Matched"),
  askListUnmatched: t("नहीं मिले", "Not matched"),
  askListAllMatched: t("हर पंक्ति मिल गई।", "Every row matched."),
  askListNoIdentityColumn: t(
    "इस फ़ाइल में SR नंबर का कॉलम नहीं है, इसलिए किसी बच्चे को पहचाना नहीं जा सकता।",
    "This file has no SR number column, so no child in it can be identified.",
  ),
  askListEmpty: t("फ़ाइल में कोई पंक्ति नहीं है।", "The file has no rows."),
  askListRow: t("पंक्ति", "Row"),

  // Why one row could not be used. Pairs, not sentences built in the domain:
  // an English-only error list is exactly the half-translated feeling D-129
  // is about.
  askListMissNoIdentifier: t(
    "SR नंबर नहीं लिखा — सिर्फ़ नाम से बच्चा नहीं पहचाना जा सकता",
    "No SR number — a name alone cannot identify a child",
  ),
  askListMissNotFound: t(
    "इस SR नंबर का कोई एक बच्चा नहीं मिला",
    "No one child has this SR number",
  ),
  askListMissNotEnrolled: t(
    "यह बच्चा इस सत्र की हाज़िरी में नहीं है",
    "This child is not on this session's roll",
  ),
  askListMissAlreadyListed: t(
    "यह बच्चा ऊपर की किसी पंक्ति में पहले से है",
    "This child is already on an earlier row",
  ),

  /* ------------------------------------------------- the fan-out (R3.3) */

  fanOutTitle: t("लिंक बनाइए", "Make the links"),
  fanOutReady: t("तैयार", "Ready"),
  fanOutBlocked: t("रुके हुए", "Held up"),
  fanOutUnassigned: t("किसी समूह में नहीं", "In no group"),
  // **Not the same as "in no group".** Skipped is blocked *plus* unassigned:
  // a child in a class whose teacher is not recorded is very much in a group,
  // and calling them ungrouped sends the office looking in the wrong place.
  fanOutSkipped: t(
    "बच्चों तक कोई लिंक नहीं पहुँचेगा",
    "children no link would reach",
  ),
  fanOutCreate: t("लिंक बनाएँ", "Make the links"),
  fanOutResume: t("बाकी लिंक बनाएँ", "Make the rest"),
  fanOutMade: t("लिंक बन गए।", "The links are made."),
  fanOutNoneReady: t(
    "अभी कोई समूह तैयार नहीं है। नीचे रुके हुए समूह देखिए।",
    "No group is ready yet. See what is held up below.",
  ),
  fanOutStopped: t(
    "यहाँ आकर रुक गया। जो लिंक बन चुके हैं वे काम कर रहे हैं — बाकी दोबारा बनाइए।",
    "It stopped here. The links already made still work — make the rest again.",
  ),
  fanOutTooBig: t(
    "इतने लिंक एक बार में नहीं बनाए जा सकते। पहले चुनाव छोटा कीजिए।",
    "That is too many links at once. Narrow the selection first.",
  ),

  // Why a group cannot be sent as it stands. The office fixes these.
  fanOutManyOwners: t("एक से ज़्यादा शिक्षक दर्ज हैं", "More than one teacher is assigned"),
  fanOutNoOwner: t("कोई शिक्षक दर्ज नहीं है", "No teacher is assigned"),
  fanOutNoPhone: t("नंबर दर्ज नहीं है", "No number is saved"),
  fanOutNoHouse: t("सदन दर्ज नहीं है", "No house on record"),
  fanOutNoRoute: t("बस मार्ग दर्ज नहीं है", "No bus route on record"),

  /* ------------------------------------------------------ the board */

  boardTitle: t("कहाँ तक पहुँचा", "Where it has got to"),
  boardLinks: t("लिंक", "Links"),
  boardAnswered: t("जवाब आए", "answered"),
  boardOpen: t("लिंक चालू कीजिए", "Turn the links on"),
  boardOpened: t("चालू", "Live"),
  boardSent: t("भेजा गया", "Handed over"),
  boardMarkSent: t("भेज दिया", "Mark as handed over"),
  boardRemind: t("याद दिलाया", "Chased"),
  boardMarkReminded: t("याद दिला दिया", "Mark as chased"),
  boardMaster: t("दफ़्तर का अपना लिंक", "The office's own link"),
  boardCopy: t("लिंक कॉपी कीजिए", "Copy the link"),
  boardNoLinks: t("अभी कोई लिंक नहीं बना।", "No links yet."),

  /* ----------------------------------------------- reviewing a round (R3.4) */

  // **S-07.** Neither value is wrong, so this is not a warning — it is a
  // decision somebody has to take deliberately rather than by default.
  reviewStale: t("जवाब के बाद रिकॉर्ड बदला है", "The record changed after this answer"),
  reviewStaleNow: t("अभी दर्ज है", "on record now"),
  reviewStaleShown: t("शिक्षक को दिखाया गया था", "shown to the teacher"),
  reviewSuperseded: t("नया जवाब आ चुका है", "A newer answer has arrived"),
  reviewSupersededHint: t(
    "इसी बच्चे की इसी जानकारी का बाद का जवाब क़तार में है।",
    "A later answer for this child and this field is in the queue.",
  ),

  studentsTitle: t("विद्यार्थी", "Students"),
  studentsHint: t(
    "नाम, एसआर नंबर या फ़ोन नंबर से खोजिए।",
    "Search by name, SR number or phone number.",
  ),
  studentsSearchLabel: t("विद्यार्थी खोजें", "Search students"),
  studentsSearchHint: t("नाम, एसआर या फ़ोन", "Name, SR or phone"),
  studentsAllClasses: t("सभी कक्षाएँ", "All classes"),
  studentsClear: t("हटाएँ", "Clear"),
  studentsNone: t("कोई नहीं", "Nobody"),
  // Two different nothings: nobody matched what was typed, and there is
  // nobody on the roll at all. Only one of them is about the search box.
  studentsNoMatch: t("इस खोज से कोई नहीं मिला।", "Nobody matched that search."),
  studentsTryAgain: t(
    "नाम का कुछ हिस्सा, पूरा एसआर नंबर, या दस अंकों का फ़ोन नंबर आज़माइए।",
    "Try part of a name, a whole SR number, or a ten-digit phone number.",
  ),
  studentsEmpty: t(
    "इस सत्र में अभी कोई विद्यार्थी दर्ज नहीं है।",
    "No students are on the roll for this session yet.",
  ),
  studentsPages: t("पन्ने", "Pages"),
  studentsPrevious: t("पिछला", "Previous"),
  studentsNext: t("अगला", "Next"),
  studentsSourceNote: t(
    "नाम और एसआर नंबर स्कूल फ़ीस ऐप के हैं। यहाँ स्वीकार किए गए सुधार बच्चे के पन्ने पर अलग दिखते हैं।",
    "Names and SR numbers come from the School Fees app. Corrections approved here are shown separately on the child’s own page.",
  ),

  homeNeedsAttention: t("ध्यान चाहिए", "Needs attention"),
  homeNeedsAttentionHint: t(
    "एक फ़ैसला कीजिए, फिर अपने काम पर लौटिए।",
    "Make a decision, then get back to your day.",
  ),
  homeAllClear: t(
    "अभी कुछ बाकी नहीं है।",
    "Nothing is waiting for anyone right now.",
  ),
  homeOwner: t("किसका काम", "Whose"),
  homeToday: t("आज", "Today"),
  homeRegistersOutstanding: t("हाज़िरी बाकी", "Registers not in"),
  homeStaffAway: t("आज अनुपस्थित स्टाफ़", "Staff away"),
  homeChangesToReview: t("जाँचने को बदलाव", "Changes to review"),
  homeJobsFailed: t("नहीं चले काम", "Jobs that failed"),
  homeSchoolClosedToday: t("आज विद्यालय बंद है", "School is closed today"),
  homeOwnerTeachers: t("अध्यापक", "Teachers"),
  homeOwnerOffice: t("कार्यालय", "Office"),
  homeOwnerCoordinator: t("शैक्षणिक संयोजक", "Academic coordinator"),
  homeOwnerAdmin: t("प्रशासक", "Admin"),
  homeSchoolToday: t("आज स्कूल में", "The school today"),
  homeChildrenOnRoll: t("रजिस्टर पर बच्चे", "Children on the roll"),
  homeClasses: t("कक्षाएँ", "Classes"),
  homeRegistersIn: t("हाज़िरी आ चुकी", "Registers in"),
  homeUnavailable: t(
    "यह गिनती अभी नहीं पढ़ी जा सकी।",
    "This count could not be read just now.",
  ),
  preferencesTitle: t("आपकी सेटिंग", "Your settings"),
  preferencesLanguageHint: t(
    "आप ऐप किस भाषा में पढ़ना चाहते हैं। कभी भी बदल सकते हैं।",
    "Which language you read the app in. You can change it whenever you like.",
  ),
  authoredInEnglish: t("अंग्रेज़ी में", "in English"),
  authoredInHindi: t("हिन्दी में", "in Hindi"),
  authoredTitleHint: t(
    "एक ही भाषा काफ़ी है। दूसरी भाषा चाहें तो नीचे भर दें।",
    "One language is enough. Add the other only if you want to.",
  ),
  authoredOptional: t("वैकल्पिक", "Optional"),

  navGroupToday: t("आज का काम", "Today's work"),
  navGroupRecords: t("रिकॉर्ड", "Records"),
  navGroupSetup: t("व्यवस्था", "Setup"),
  navGroupMoney: t("शुल्क डेस्क", "Fee desk"),
  navFees: t("फ़ीस", "Fees"),
  schoolWelcome: t("आपके स्कूल का कार्यक्षेत्र", "Your school workspace"),
  schoolLocation: t("अमेट, राजस्थान", "Amet, Rajasthan"),
  schoolWorkspaceHint: t("स्कूल के सभी काम, एक ही जगह।", "Your school day, together in one place."),
  schoolMorning: t("सुप्रभात", "Good morning"),
  schoolAfternoon: t("नमस्कार", "Good afternoon"),
  schoolEvening: t("शुभ संध्या", "Good evening"),
  nativeWorkspaces: t("आपके कार्यक्षेत्र", "Your workspaces"),
  nativeWorkspacesHint: t("फ़ीस, जानकारी और समय-चक्र इसी कार्यक्षेत्र में खोलें।", "Open fees, collection and timetable here in VPPS One."),
  nativeStudentFees: t("इस बच्चे की फ़ीस खोलें", "Open this student's fees"),
  nativeCollection: t("जानकारी का कार्यक्षेत्र खोलें", "Open Collection"),
  navPaymentDesk: t("भुगतान", "Payment Desk"),
  navTransactions: t("लेन-देन", "Transactions"),
  navDefaulters: t("बकाया", "Defaulters"),
  navFeeStudents: t("शुल्क — बच्चे", "Students (fees)"),
  navReminders: t("स्मरण", "Reminders"),
  navFeeSetup: t("शुल्क व्यवस्था", "Fee Setup"),
  navFeeExports: t("शुल्क निर्यात", "Fee exports"),
  navFeeAdminTools: t("शुल्क उपकरण", "Fee admin tools"),

  appSearchInstead: t(
    "यहाँ का पहचान-नंबर वहाँ नहीं चलता, इसलिए खोज खुलेगी।",
    "An id from here does not exist there, so this opens the search screen instead.",
  ),

  /* ------------------------------------------------- where you start (D2) */
  startTitle: t("आप कहाँ से शुरू करें", "Where you start"),
  startHint: t(
    "साइन इन करने पर यही स्क्रीन खुलेगी। किसी लिंक से आए हैं तो वही लिंक खुलेगा।",
    "This is the screen that opens when you sign in. A link you followed still opens that link instead.",
  ),
  startRoleHome: t("आपका सामान्य मुख्य पेज", "Your usual Home"),
  startRoleHomeHint: t(
    "आपके काम के लिए जो तय है — यही अभी चल रहा है।",
    "Whatever your role opens on. This is what happens today.",
  ),
  startStaysInThisApp: t("इसी ऐप में", "Stays in VPPS One"),
  startOpensAnotherApp: t("दूसरा ऐप खुलेगा", "Opens the other app"),
  startLeavesAppWarning: t(
    "दूसरा ऐप चुनने पर साइन इन के बाद सीधा वही खुलेगा। VPPS One पर लौटने के लिए इसका पता फिर खोलें।",
    "Choose another app and signing in will open it straight away. To come back here, open this app's own address again.",
  ),
  startCurrent: t("अभी चुना हुआ", "Your choice now"),

  /* ---------------------------------------------- the teacher's day (D2) */
  teachYourClass: t("आपकी कक्षा", "Your class"),
  teachYourClasses: t("आपकी कक्षाएँ", "Your classes"),
  teachNoClassOfYourOwn: t(
    "आपके नाम कोई कक्षा नहीं है।",
    "No class is assigned to you.",
  ),
  teachFirstLesson: t("पहला कालांश", "First lesson"),
  teachTodaysTimetable: t("आज का समय-चक्र", "Today's timetable"),
  teachFullWeek: t("पूरा सप्ताह", "Full week"),

  /* ------------------------------------- the administrator's overview (D2) */
  overviewTeachingNotAway: t("अनुपस्थित दर्ज नहीं किए गए शिक्षक", "Teachers not marked away"),
  overviewTeachingBasis: t("सक्रिय शिक्षक, दर्ज अनुपस्थितियों को छोड़कर; यह उपस्थिति पुष्टि नहीं है।", "Active teachers minus recorded absences; this is not confirmed attendance."),
  overviewAllScreens: t("सभी स्क्रीन", "All screens"),
  overviewOpenRegisters: t("रजिस्टर खोलें", "Open registers"),
  overviewReviewChanges: t("बदलाव देखें", "Review changes"),
  overviewOpenCover: t("प्रतिस्थापन खोलें", "Open cover plan"),
  overviewOpenJobs: t("कार्य स्थिति देखें", "Open job status"),
  overviewOpenLive: t("लाइव कार्यस्थान खोलें", "Open live workspace"),
  overviewTitle: t("स्कूल की स्थिति", "School overview"),
  overviewEyebrow: t("स्कूल संचालन", "School operations"),
  overviewTodayAtSchool: t("आज स्कूल में", "Today at school"),
  overviewAttendanceSubmitted: t("हाज़िरी जमा", "Attendance submitted"),
  overviewStaffPresent: t("स्टाफ़ उपस्थित", "Staff present"),
  overviewCoverArranged: t("कालांश की व्यवस्था", "Cover arranged"),
  overviewCoverNoPlan: t(
    "आज के लिए कोई प्रकाशित योजना नहीं है।",
    "No plan has been published for today.",
  ),
  overviewExamsOpen: t("अंक भरे जा रहे हैं", "Exams open for marks"),
  overviewWorkspaces: t("स्कूल के कार्यक्षेत्र", "School workspaces"),
  overviewWorkspacesHint: t("सीधे सही डेस्क पर जाएँ", "Go straight to the right desk"),
  overviewOpen: t("खोलें", "Open"),
  overviewRoundProgress: t("जानकारी का चक्र", "Information round"),
  overviewRoundNone: t(
    "अभी कोई चक्र खुला नहीं है।",
    "No round is open at the moment.",
  ),
  overviewAnsweredOf: t("उत्तर आए", "answered"),
  overviewFeeSummary: t("फ़ीस का हिसाब", "Fee collection"),
  // The fee app is in this app now, so "the real numbers are in the School
  // Fees app" stopped being true — it sent staff out of a screen to a place
  // they were already standing in. The figures themselves are still not
  // read onto this panel (R6.2); the fee desk is where they live.
  overviewFeeUnavailable: t(
    "फ़ीस के आँकड़े इस पैनल पर अभी नहीं आते। पूरा हिसाब शुल्क डेस्क पर है।",
    "Fee figures are not read onto this panel yet. The full picture is on the fee desk.",
  ),
  overviewFeeDesk: t("शुल्क डेस्क खोलें", "Open the fee desk"),
  overviewOfClasses: t("कक्षाओं में से", "of classes"),
  overviewPeriods: t("कालांश", "periods"),

  /* --------------------------------------------- page eyebrows (D3) ----
     The small line above a page title, naming the part of the school the
     screen belongs to. One per area rather than one per route: the atlas uses
     them to group ("SAMPARK / REVIEW"), not to label. */
  eyebrowSchoolOffice: t("कार्यालय", "School office"),
  eyebrowMyClass: t("मेरी कक्षा", "My class"),
  eyebrowSampark: t("सम्पर्क", "SamPark"),
  eyebrowAcademics: t("शैक्षणिक", "Academics"),
  eyebrowExams: t("परीक्षा और रिपोर्ट", "Exams and reports"),
  eyebrowAdministration: t("विद्यालय प्रशासन", "School administration"),
  eyebrowPersonal: t("आपका खाता", "Your account"),
  eyebrowCover: t("कक्षा व्यवस्था", "Class cover"),
  eyebrowFees: t("शुल्क", "Fees"),

  /* ------------------------------------------------- shared panels (D3) */
  panelStudentDirectory: t("बच्चों की सूची", "Student directory"),
  panelSearchNote: t("खोज भरोसे की है", "A reliable search"),
  panelSearchNoteText: t(
    "एसआर नंबर अक्षरों की तरह रखा जाता है, इसलिए आगे के शून्य नहीं मिटते। खोज के बाद भी कक्षा और सत्र वही रहते हैं।",
    "SR numbers are kept as text, so leading zeros are never lost. The class and session you chose stay chosen after a search.",
  ),
  panelStaffDirectory: t("स्टाफ़ की सूची", "Staff directory"),
  panelStaffNote: t("भूमिका और काम अलग-अलग हैं", "Role and assignment are separate"),
  panelStaffNoteText: t(
    "कार्यालय की भूमिका अपने आप लेखाकार नहीं बनाती। फ़ीस ऐप की पहुँच और पढ़ाने का काम अलग-अलग तय होते हैं।",
    "An office role is not automatically an accountant. Fee-app access and teaching assignments are decided independently.",
  ),
  panelRegisterSummary: t("हाज़िरी का हिसाब", "Register summary"),
  panelExceptionsFirst: t("पहले अपवाद भरिए", "Mark the exceptions first"),
  panelExceptionsFirstText: t(
    "सब उपस्थित दिखते हैं। केवल जो अनुपस्थित, आधा दिन, देर से या छुट्टी पर हैं उन्हें बदलिए, गिनती देखिए, फिर सहेजिए।",
    "Everyone starts as present. Change only the children who are absent, half day, late or on leave, check the counts, then save.",
  ),
  panelReviewQueue: t("जाँच की कतार", "Review queue"),
  panelCurrentMatters: t("अभी का रिकॉर्ड देखिए", "The current record matters"),
  panelCurrentMattersText: t(
    "अगर किसी और ने यह रिकॉर्ड बदल दिया है, तो फ़ैसले से पहले नया मान फिर से मिला लीजिए।",
    "If somebody else has already changed this record, compare again before deciding.",
  ),
  panelOperational: t("संचालन की व्यवस्था", "Operational settings"),
  panelOperationalHint: t("सिर्फ़ प्रशासक को दिखता है", "Visible to administrators"),
  panelPreviewEffect: t("असर पहले देखिए", "Preview the effect"),
  panelPreviewEffectText: t(
    "स्कूल-भर के बदलाव से पहले देख लीजिए कि किन कक्षाओं और रिकॉर्ड पर असर पड़ेगा। रोज़ का काम सेटिंग से बाहर रखिए।",
    "Before a school-wide change, look at which classes and records it touches. Keep daily work out of the settings area.",
  ),
  panelAcademicSetup: t("शैक्षणिक व्यवस्था", "Academic setup"),
  panelInformationSetup: t("जानकारी जुटाने की व्यवस्था", "Information collection"),
  panelManage: t("खोलें", "Manage"),
  panelViewStatus: t("स्थिति देखें", "View status"),

  /* ------------------------------------------- staff figures (D3) */
  staffActiveCount: t("सक्रिय स्टाफ़", "Active staff"),
  staffActiveHint: t("अभी के स्कूल खाते", "Current school accounts"),
  staffClassesAssigned: t("कक्षा-अध्यापक तय", "Classes assigned"),
  staffClassesAllHave: t(
    "हर कक्षा का अध्यापक है",
    "Every class has a class teacher",
  ),
  staffClassesMissing: t(
    "कुछ कक्षाओं का अध्यापक बाकी है",
    "Some classes still have nobody",
  ),
  staffCoordinators: t("संयोजक", "Coordinators"),
  staffCoordinatorsHint: t("शैक्षणिक और परीक्षा", "Academic and examinations"),
  staffAwaitingClass: t("कक्षा का इंतज़ार", "Awaiting a class"),
  attendanceTodaysRegister: t("आज की हाज़िरी", "Today's register"),
  staffAwaitingClassHint: t(
    "पढ़ाने वाले जिन्हें कक्षा नहीं मिली",
    "Teaching staff with no class of their own",
  ),
  pwaTitle: t("अपने फ़ोन या कंप्यूटर पर लगाएँ", "Install on your phone or computer"),
  pwaHint: t("VPPS One को अपने ऐप की तरह खोलें। इंटरनेट जाने पर खुले फ़ॉर्म का मसौदा इस डिवाइस पर रहेगा।", "Open VPPS One as an app. Drafts on opened forms stay on this device when the connection drops."),
  pwaInstalled: t("यह ऐप पहले से लगा है।", "You are using the installed app."),
  pwaIos: t("Safari में शेयर खोलें → होम स्क्रीन पर जोड़ें → जोड़ें।", "In Safari, open Share → Add to Home Screen → Add."),
  pwaManual: t("Chrome या Edge के मेन्यू में ऐप इंस्टॉल करें चुनें। iPhone पर Safari से होम स्क्रीन पर जोड़ें।", "In Chrome or Edge, choose Install app from the browser menu. On iPhone, use Safari’s Add to Home Screen."),
  pwaInstall: t("VPPS One लगाएँ", "Install VPPS One"),
  pwaUpdate: t("नया संस्करण तैयार है", "Update available"),
  pwaUpdateHint: t("आपका मसौदा सुरक्षित करके ऐप फिर खुलेगा।", "Save your drafts and reopen with the new version."),
  pwaFinishForm: t("पहले खुला फ़ॉर्म पूरा या बंद करें। डिवाइस पर सेव न हो तो अभी अपडेट न करें।", "Finish or close the open form first. Resolve any draft storage error before updating."),
  pwaReload: t("अपडेट करके फिर खोलें", "Update and reopen"),
  draftFound: t("इस फ़ोन में पहले लिखा हुआ रखा है। भेजने से पहले देख लें।", "Something you wrote earlier is kept on this phone. Look at it before sending."),
  draftChanged: t("स्कूल का रिकॉर्ड बदल चुका है। पिछला मसौदा लाकर मिलान करें।", "The school record has changed. Restore the draft to review the differences."),
  draftRestore: t("वापस लाएँ", "Bring it back"),
  draftDiscard: t("मिटाएँ", "Throw it away"),
  draftStorageError: t("इस डिवाइस पर सेव नहीं हुआ। ऐप बंद करने से पहले ऑनलाइन सेव करें।", "Could not save on this device. Save online before closing the app."),
  draftWriting: t("डिवाइस पर सेव हो रहा है…", "Saving on this device…"),
  draftSchool: t("स्कूल में सेव हो गया", "Saved by school"),
  draftLocal: t("इस डिवाइस पर सेव है · स्कूल में भेजना बाकी है", "Saved on this device · not yet saved by school"),
  draftWaiting: t("इस डिवाइस पर सेव है · इंटरनेट का इंतज़ार", "Saved on this device · waiting for a connection"),
  draftOffline: t("इंटरनेट नहीं है · खुला काम जारी रख सकते हैं", "Offline · you can continue working on this form"),
  draftReady: t("बदलाव इस डिवाइस पर अपने-आप सेव होंगे", "Changes save automatically on this device"),
  directorySelect: t("बाईं सूची में बच्चे का नाम चुनें", "Select a student from the list"),
  directoryOpen: t("पूरा रिकॉर्ड खोलें", "Open full record"),
  overviewSummary: t("आज का सार", "Today's overview"),

} as const;

export type MessageKey = keyof typeof m;
