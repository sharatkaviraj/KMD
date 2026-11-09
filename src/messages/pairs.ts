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


export const teacherTasks = /* @__PURE__ */ t("मेरे काम", "My tasks");
export const taskDetails = /* @__PURE__ */ t("विवरण", "Details");
export const taskMarks = /* @__PURE__ */ t("अंक", "Marks");
export const taskAttendance = /* @__PURE__ */ t("उपस्थिति", "Attendance");
export const taskWaiting = /* @__PURE__ */ t("शिक्षकों की प्रतीक्षा", "Waiting on teachers");
export const taskApprove = /* @__PURE__ */ t("अनुमोदन बाकी", "To approve");
export const taskComplete = /* @__PURE__ */ t("पूरा", "Complete");
export const taskSaved = /* @__PURE__ */ t("सहेजा गया।", "Saved.");
export const taskReviewSave = /* @__PURE__ */ t("जाँचें और सहेजें", "Review and save");
export const taskSubmit = /* @__PURE__ */ t("पूरा करके जमा करें", "Submit completed work");
export const taskDraft = /* @__PURE__ */ t("मसौदा सहेजें", "Save draft");
export const taskReason = /* @__PURE__ */ t("बदलाव का कारण", "Reason for correction");
export const taskRetry = /* @__PURE__ */ t("उसी सहेजने की फिर जाँच करें", "Retry the same save");
export const taskUnknown = /* @__PURE__ */ t("सहेजने की पुष्टि नहीं मिली। उसी प्रयास की फिर जाँच करें।", "Save outcome is unknown. Retry the same save to recover its receipt.");
export const taskDraftUnconfirmed = /* @__PURE__ */ t("इस डिवाइस पर सेव है · स्कूल में सहेजने की पुष्टि नहीं मिली", "Saved on this device · school save unconfirmed");
export const taskRefused = /* @__PURE__ */ t("सहेजा नहीं गया। काम या अधिकार बदल गया हो सकता है। पृष्ठ फिर खोलें।", "Not saved. The work or your access may have changed. Reload the page.");
export const taskApprovalNote = /* @__PURE__ */ t("विवरण प्रशासक के अनुमोदन के बाद आधिकारिक रिकॉर्ड बनेंगे।", "Details become official after administrator approval.");
export const taskViewAll = /* @__PURE__ */ t("सभी देखें", "View all");
export const skipToContent = /* @__PURE__ */ t("मुख्य सामग्री पर जाएँ", "Skip to main content");
  /* ------------------------------------------------------------- general */
export const appName = /* @__PURE__ */ t("VPPS One", "VPPS One");
export const save = /* @__PURE__ */ t("सहेजें", "Save");
export const saved = /* @__PURE__ */ t("सहेजा", "Saved");
export const saving = /* @__PURE__ */ t("सहेजा जा रहा है…", "Saving…");
export const cancel = /* @__PURE__ */ t("रद्द करें", "Cancel");
export const add = /* @__PURE__ */ t("जोड़ें", "Add");
export const edit = /* @__PURE__ */ t("बदलें", "Edit");
export const change = /* @__PURE__ */ t("बदलें", "Change");
export const back = /* @__PURE__ */ t("वापस", "Back");
export const yes = /* @__PURE__ */ t("हाँ", "Yes");
export const no = /* @__PURE__ */ t("नहीं", "No");
export const goHome = /* @__PURE__ */ t("मुख्य पर जाएँ", "Go home");
export const tryAgain = /* @__PURE__ */ t("फिर कोशिश करें", "Try again");
export const pageNotLoaded = /* @__PURE__ */ t("यह पेज खुल नहीं पाया", "This page couldn't load");
export const pageNotLoadedHelp = /* @__PURE__ */ t("नेटवर्क धीमा हो सकता है। पेज दोबारा खोलें — जो सहेजा जा चुका है वह सुरक्षित है।", "The connection may be slow. Reload the page — anything already saved is safe.");
export const reload = /* @__PURE__ */ t("दोबारा खोलें", "Reload");
export const loading = /* @__PURE__ */ t("लोड हो रहा है", "Loading");
export const shown = /* @__PURE__ */ t("दिखाए गए", "shown");
export const active = /* @__PURE__ */ t("सक्रिय", "active");
export const inactive = /* @__PURE__ */ t("निष्क्रिय", "Inactive");
export const reactivate = /* @__PURE__ */ t("फिर सक्रिय करें", "Reactivate");
export const deactivate = /* @__PURE__ */ t("निष्क्रिय करें", "Deactivate");
export const remove = /* @__PURE__ */ t("हटाएँ", "Remove");
export const restore = /* @__PURE__ */ t("वापस लाएँ", "Restore");
export const done = /* @__PURE__ */ t("पूरा", "Done");
export const pending = /* @__PURE__ */ t("बाकी", "To do");
export const somethingWrong = /* @__PURE__ */ t("कुछ गड़बड़ हो गई।", "Something went wrong.");
export const notFound = /* @__PURE__ */ t("यह पेज नहीं मिला।", "That page does not exist.");
export const notFoundDetail = /* @__PURE__ */ t(
    "शायद पता बदल गया है। अपने मुख्य पेज से दोबारा शुरू कीजिए।",
    "The address may have changed. Start again from your own home screen.",
  );
export const reference = /* @__PURE__ */ t("संदर्भ", "ref");
export const errorReassure = /* @__PURE__ */ t(
    "जो आपने सहेजा था वह सुरक्षित है। फिर कोशिश करें; बार-बार हो तो ऑफ़िस को फ़ोन करके यह नंबर बताएँ।",
    "Nothing you saved is lost. Try again; if it keeps happening, call the office and read out this number.",
  );

  /* ------------------------------------------------------------- session */
export const session = /* @__PURE__ */ t("सत्र", "Session");
export const noSession = /* @__PURE__ */ t("कोई सत्र नहीं मिला", "No session found");
export const testData = /* @__PURE__ */ t("टेस्ट", "Test");
export const testDataLong = /* @__PURE__ */ t("टेस्ट डेटा", "Test data");
export const testDataNotice = /* @__PURE__ */ t(
    "यह टेस्ट डेटा है। यहाँ किया गया कोई बदलाव असली रिकॉर्ड नहीं बदलता।",
    "This runs on the test session in schoolfees-dev. Nothing here touches real student or fee records.",
  );

  /* ----------------------------------------------------------------- nav */
export const navHome = /* @__PURE__ */ t("मुख्य", "Home");
export const navStaff = /* @__PURE__ */ t("स्टाफ़", "Staff");
export const navAcademics = /* @__PURE__ */ t("शैक्षणिक", "Academics");
export const navCalendar = /* @__PURE__ */ t("कैलेंडर", "Calendar");
export const navEnrolments = /* @__PURE__ */ t("नामांकन", "Enrolments");
export const moreIntro = /* @__PURE__ */ t(
    "आपकी भूमिका के बाकी सभी पन्ने।",
    "Everything else your role can open.",
  );
export const navMore = /* @__PURE__ */ t("और", "More");
export const mainNavigation = /* @__PURE__ */ t("मुख्य नेविगेशन", "Main navigation");

  /* --------------------------------------------------------------- login */
export const signIn = /* @__PURE__ */ t("साइन इन करें", "Sign in");
export const signingIn = /* @__PURE__ */ t("साइन इन हो रहा है…", "Signing in…");
export const signedIn = /* @__PURE__ */ t("साइन इन", "Signed in");
export const signOut = /* @__PURE__ */ t("साइन आउट", "Sign out");
export const signInTitle = /* @__PURE__ */ t("साइन इन", "Sign in");
export const email = /* @__PURE__ */ t("ईमेल", "Email");
export const password = /* @__PURE__ */ t("पासवर्ड", "Password");
export const noSignup = /* @__PURE__ */ t(
    "खाता विद्यालय प्रशासक बनाते हैं। यहाँ नया खाता नहीं बनता।",
    "Accounts are created by the school admin — there is no sign-up here.",
  );
export const loginBadCredentials = /* @__PURE__ */ t(
    "ईमेल या पासवर्ड गलत है।",
    "That email and password do not match an account.",
  );
export const loginBothFields = /* @__PURE__ */ t(
    "ईमेल और पासवर्ड दोनों भरें।",
    "Enter both your email and your password.",
  );
export const loginNotConfirmed = /* @__PURE__ */ t(
    "यह खाता अभी पुष्टि नहीं हुआ है। विद्यालय प्रशासक से संपर्क करें।",
    "This account is not confirmed yet. Ask the school admin.",
  );
export const loginRateLimited = /* @__PURE__ */ t(
    "बहुत बार कोशिश हुई। कुछ मिनट रुककर फिर प्रयास करें।",
    "Too many attempts. Wait a few minutes and try again.",
  );
export const loginUnavailable = /* @__PURE__ */ t(
    "अभी साइन इन नहीं हो पा रहा। थोड़ी देर बाद फिर प्रयास करें।",
    "Unable to sign in right now. Please try again.",
  );
export const noProfile = /* @__PURE__ */ t(
    "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है।",
    "This account has no VPPS One staff profile yet.",
  );
export const noProfileAskAdmin = /* @__PURE__ */ t(
    "इस खाते का VPPS One में कोई स्टाफ़ प्रोफ़ाइल नहीं है। विद्यालय प्रशासक से संपर्क करें।",
    "This account has no VPPS One staff profile yet. Ask the school admin to add one.",
  );
export const accountInactive = /* @__PURE__ */ t("यह स्टाफ़ खाता निष्क्रिय है।", "This staff account is inactive.");
export const accountInactiveAskAdmin = /* @__PURE__ */ t(
    "यह स्टाफ़ खाता निष्क्रिय है। विद्यालय प्रशासक से संपर्क करें।",
    "This staff account is inactive. Ask the school admin.",
  );

  /* ----------------------------------------------------------- dashboard */
export const welcome = /* @__PURE__ */ t("नमस्ते", "Welcome");
export const openToYou = /* @__PURE__ */ t("आपके लिए", "Open to you");
export const openToYouHint = /* @__PURE__ */ t(
    "आपकी भूमिका के हिसाब से",
    "What your role can open",
  );

  /* ------------------------------------------------------- access denied */
export const accessDenied = /* @__PURE__ */ t("अनुमति नहीं", "You cannot open this");
export const accessDeniedBody = /* @__PURE__ */ t(
    "आपकी भूमिका इस स्क्रीन को नहीं खोल सकती।",
    "Your role does not have access to this screen. Ask the school admin if you need it.",
  );
export const role = /* @__PURE__ */ t("भूमिका", "Role");
export const permissionNeeded = /* @__PURE__ */ t("आवश्यक अनुमति", "Needs");
export const permissions = /* @__PURE__ */ t("अनुमतियाँ", "Permissions");

  /* --------------------------------------------------------------- staff */
export const staffTitle = /* @__PURE__ */ t("स्टाफ़", "Staff");
export const staffIntro = /* @__PURE__ */ t(
    "हर अध्यापक की प्रोफ़ाइल — चाहे वे ऐप में साइन इन करें या नहीं।",
    "Every teacher needs a profile, whether or not they sign in.",
  );
export const staffSearch = /* @__PURE__ */ t("नाम, संक्षिप्त नाम या फ़ोन", "Name, short name or phone");
export const staffSearchLabel = /* @__PURE__ */ t("स्टाफ़ खोजें", "Search staff");
export const staffNone = /* @__PURE__ */ t(
    "अभी कोई स्टाफ़ प्रोफ़ाइल नहीं है।",
    "Add the teachers and office staff. Every teacher on the timetable needs a profile, even the ones who never sign in.",
  );
export const staffNoMatch = /* @__PURE__ */ t("कोई स्टाफ़ नहीं मिला।", "Nothing matches that search.");
export const staffShowInactive = /* @__PURE__ */ t("निष्क्रिय भी दिखाएँ", "Show inactive");
export const staffNew = /* @__PURE__ */ t("नया स्टाफ़", "Add staff");
export const staffNewNotice = /* @__PURE__ */ t(
    "यह प्रोफ़ाइल है, खाता नहीं। साइन इन के लिए खाता Supabase में अलग से बनता है।",
    "This creates a profile, not a login. Sign-in accounts are created separately in Supabase — a teacher who never opens the app still needs a profile here, because the timetable joins on the short name.",
  );
export const staffInactiveNotice = /* @__PURE__ */ t(
    "यह प्रोफ़ाइल निष्क्रिय है।",
    "Inactive. They stay on past timetables and registers, but will not appear in pickers.",
  );
export const staffNoLogin = /* @__PURE__ */ t(
    "इनका कोई साइन-इन खाता नहीं है।",
    "No sign-in account is linked. That is normal for a teacher who is on the timetable but never opens the app. To give them access, create the account in Supabase Auth with their email.",
  );
export const name = /* @__PURE__ */ t("नाम", "Name");
export const fullName = /* @__PURE__ */ t("पूरा नाम", "Full name");
export const shortName = /* @__PURE__ */ t("संक्षिप्त नाम", "Short name");
export const shortNameNewHint = /* @__PURE__ */ t(
    "समय-सारिणी में इसी नाम से पहचान होगी। बाद में बदला नहीं जा सकता।",
    "This is how the timetable will name them. It cannot be changed later.",
  );
export const shortNameLockedHint = /* @__PURE__ */ t(
    "यह बदला नहीं जा सकता — समय-सारिणी इसी से जुड़ती है।",
    "Cannot be changed; the timetable joins on it.",
  );
export const teaches = /* @__PURE__ */ t("कक्षा लेते हैं", "Teaches classes");
export const teaching = /* @__PURE__ */ t("अध्यापन", "Teaching");
export const classBadge = /* @__PURE__ */ t("कक्षा", "Class");
export const phone = /* @__PURE__ */ t("फ़ोन", "Phone");
export const whatsapp = /* @__PURE__ */ t("व्हाट्सएप", "WhatsApp");
export const whatsappHint = /* @__PURE__ */ t("अलग हो तो भरें", "Only if different");
export const signsIn = /* @__PURE__ */ t("साइन इन", "Signs in");
export const language = /* @__PURE__ */ t("भाषा", "Language");
export const languageHint = /* @__PURE__ */ t(
    "यह व्यक्ति ऐप किस भाषा में पढ़ेगा।",
    "Which language this person reads the app in.",
  );
export const languageHindi = /* @__PURE__ */ t("हिन्दी", "Hindi");
export const languageEnglish = /* @__PURE__ */ t("अंग्रेज़ी", "English");
export const languageBoth = /* @__PURE__ */ t("दोनों", "Both");
export const cannotDeactivateSelf = /* @__PURE__ */ t(
    "अपना खाता निष्क्रिय नहीं कर सकते",
    "You cannot deactivate your own account",
  );
export const alreadyInactive = /* @__PURE__ */ t("पहले से निष्क्रिय", "Already inactive");
export const cannotChangeOwnRole = /* @__PURE__ */ t(
    "अपनी भूमिका आप नहीं बदल सकते",
    "You cannot change your own role",
  );
export const notYourClassTitle = /* @__PURE__ */ t("यह आपकी कक्षा नहीं है", "This is not one of your classes");
export const notYourClassDetail = /* @__PURE__ */ t(
    "आपकी कक्षाएँ आज वाले पेज पर हैं। किसी और कक्षा के रिकॉर्ड के लिए कार्यालय से पूछें।",
    "Your classes are on Today. For another class's records, ask the office.",
  );
export const notYourStudentTitle = /* @__PURE__ */ t(
    "यह बच्चा आपकी किसी कक्षा में नहीं है",
    "This child is not in one of your classes",
  );
export const roleAdminOnlyHint = /* @__PURE__ */ t(
    "भूमिका केवल कोई दूसरा प्रशासक बदल सकता है।",
    "Only another administrator can change a role.",
  );
export const shortNameImmutable = /* @__PURE__ */ t(
    "संक्षिप्त नाम बदला नहीं जा सकता",
    "The short name cannot be changed",
  );
export const profileNotFound = /* @__PURE__ */ t("प्रोफ़ाइल नहीं मिली।", "That profile was not found.");
export const profileNotSaved = /* @__PURE__ */ t("प्रोफ़ाइल सहेजी नहीं जा सकी।", "Could not save the profile.");
export const changesNotSaved = /* @__PURE__ */ t("बदलाव सहेजे नहीं जा सके।", "Could not save the changes.");

  /* ----------------------------------------------------------- academics */
export const academicsTitle = /* @__PURE__ */ t("शैक्षणिक", "Academics");
export const academicsNotice = /* @__PURE__ */ t(
    "समय-सारिणी इन्हीं नामों से जुड़ेगी।",
    "Phase 2 resolves every timetable cell against these two lists. A class with no label, or a subject the sheet names and this list does not, is what an import will stop on.",
  );
export const noFeeClasses = /* @__PURE__ */ t(
    "फ़ीस ऐप में कोई कक्षा नहीं मिली।",
    "No classes were found in the fee app, so there is no session to work in yet.",
  );
export const subjects = /* @__PURE__ */ t("विषय", "Subjects");
export const subjectsIntro = /* @__PURE__ */ t(
    "कोड वही रखें जो समय-सारिणी की शीट में है।",
    "Use the code exactly as the timetable sheet writes it.",
  );
export const subjectsNone = /* @__PURE__ */ t(
    "अभी कोई विषय नहीं है।",
    "Add every subject the timetable names. Phase 2 resolves each cell against this list.",
  );
export const subjectFirst = /* @__PURE__ */ t("पहला विषय जोड़ें", "Add the first subject");
export const subjectNew = /* @__PURE__ */ t("नया विषय", "Add subject");
export const subjectEdit = /* @__PURE__ */ t("विषय बदलें", "Edit subject");
export const code = /* @__PURE__ */ t("कोड", "Code");
export const codeNewHint = /* @__PURE__ */ t(
    "समय-सारिणी की शीट में यह विषय जिस नाम से लिखा है।",
    "Exactly as the timetable sheet writes it.",
  );
export const codeLockedHint = /* @__PURE__ */ t("कोड बदला नहीं जा सकता", "The code cannot be changed");
export const nameHindi = /* @__PURE__ */ t("हिन्दी नाम", "Hindi name");
export const nameEnglish = /* @__PURE__ */ t("अंग्रेज़ी नाम", "English name");
export const sortOrder = /* @__PURE__ */ t("क्रम", "Order");
export const sortOrderHint = /* @__PURE__ */ t(
    "छोटा नंबर पहले दिखेगा।",
    "Lower numbers come first in lists and report cards.",
  );
export const subjectNotFound = /* @__PURE__ */ t("विषय नहीं मिला।", "That subject was not found.");
export const subjectNotSaved = /* @__PURE__ */ t("विषय सहेजा नहीं जा सका।", "Could not save the subject.");

export const classLabels = /* @__PURE__ */ t("कक्षा के नाम", "Class labels");
export const classLabelsMapped = /* @__PURE__ */ t("मैप किए", "mapped");
export const classLabelsDone = /* @__PURE__ */ t(
    "हर कक्षा का नाम तय है।",
    "Every class has a timetable label. A Phase 2 import can resolve all of them.",
  );
export const classLabelsTodo = /* @__PURE__ */ t(
    "समय-सारिणी की शीट में कक्षा जिस नाम से लिखी है, वही यहाँ भरें।",
    "Enter each class exactly as the timetable sheet writes it — “11-S”, “5”, “NUR”. Unmapped classes are listed first.",
  );
export const classLabelsNothing = /* @__PURE__ */ t(
    "फ़ीस ऐप में कोई कक्षा नहीं मिली।",
    "No classes were found in the fee app, so there is nothing to map yet.",
  );
export const feeAppClass = /* @__PURE__ */ t("फ़ीस ऐप की कक्षा", "Fee app class");
export const timetableLabel = /* @__PURE__ */ t("समय-सारिणी का नाम", "Timetable label");
export const mapped = /* @__PURE__ */ t("मैप्ड", "Mapped");
export const labelTakenByAnotherClass = /* @__PURE__ */ t(
    "इस सत्र में यह नाम किसी और कक्षा का है",
    "Another class already uses this label this session",
  );
export const notSaved = /* @__PURE__ */ t("सहेजा नहीं जा सका।", "Could not save.");

  /* ---------------------------------------------------- class teachers */
export const classTeachers = /* @__PURE__ */ t("कक्षा अध्यापक", "Class teachers");
export const classTeachersIntro = /* @__PURE__ */ t(
    "हर कक्षा का अध्यापक — बदलने पर पुराना रिकॉर्ड रहता है, मिटता नहीं।",
    "Who holds each class. Replacing somebody keeps the old record; nothing is overwritten.",
  );
export const classTeacherNone = /* @__PURE__ */ t("अभी कोई नहीं", "Nobody yet");
export const classTeacherAssign = /* @__PURE__ */ t("अध्यापक चुनें", "Assign a teacher");
export const classTeacherReplace = /* @__PURE__ */ t("बदलकर दूसरा अध्यापक दें", "Hand over to somebody else");
export const classTeacherChoose = /* @__PURE__ */ t("चुनें", "Choose");
export const classTeacherFrom = /* @__PURE__ */ t("इस तारीख़ से", "From");
export const classTeacherHistory = /* @__PURE__ */ t("पिछला रिकॉर्ड", "Earlier");
export const classTeacherReplaceHint = /* @__PURE__ */ t(
    "पिछले अध्यापक का कार्यकाल एक दिन पहले बंद हो जाएगा।",
    "The current holder's term ends the day before this date.",
  );
export const classTeachersAssigned = /* @__PURE__ */ t("दिए गए", "assigned");
export const classTeachersDone = /* @__PURE__ */ t(
    "हर कक्षा का अध्यापक तय है।",
    "Every class has a class teacher.",
  );
export const classTeachersTodo = /* @__PURE__ */ t(
    "जिन कक्षाओं का अध्यापक तय नहीं है, वे सबसे ऊपर हैं।",
    "Classes with nobody assigned are listed first.",
  );

  /* --------------------------------------------------------- calendar */
export const calendarTitle = /* @__PURE__ */ t("शैक्षणिक कैलेंडर", "Academic calendar");
export const calendarIntro = /* @__PURE__ */ t(
    "सिर्फ़ वे दिन भरें जो सामान्य नहीं हैं। बाकी दिन साप्ताहिक नियम से तय होते हैं — रविवार अवकाश, शनिवार कार्यदिवस।",
    "Only enter the days that are not ordinary. Everything else follows the weekly pattern — Sunday closed, Saturday a working day.",
  );
export const calendarNone = /* @__PURE__ */ t(
    "अभी कोई दिन दर्ज नहीं है।",
    "Nothing entered yet. Add the holidays, exams and vacations for this session.",
  );
export const calendarAdd = /* @__PURE__ */ t("दिन जोड़ें", "Add days");
export const calendarDate = /* @__PURE__ */ t("तारीख़", "Date");
export const calendarUntil = /* @__PURE__ */ t("इस तारीख़ तक", "Until");
export const calendarUntilHint = /* @__PURE__ */ t(
    "एक से ज़्यादा दिन के लिए भरें — जैसे पूरी छुट्टियाँ।",
    "Fill this for a range, such as a whole vacation.",
  );
export const calendarKind = /* @__PURE__ */ t("किस तरह का दिन", "Kind of day");
export const calendarLabelHi = /* @__PURE__ */ t("नाम (हिन्दी)", "Name (Hindi)");
export const calendarLabelEn = /* @__PURE__ */ t("नाम (अंग्रेज़ी)", "Name (English)");
export const calendarSchoolOpen = /* @__PURE__ */ t("विद्यालय खुला", "School open");
export const calendarSchoolClosed = /* @__PURE__ */ t("विद्यालय बंद", "School closed");
export const calendarTimetableRuns = /* @__PURE__ */ t("समय-सारिणी चलेगी", "Timetable runs");
export const calendarDaysEntered = /* @__PURE__ */ t("दिन दर्ज", "days entered");

  /* -------------------------------------------------------- enrolments */
export const enrolmentsTitle = /* @__PURE__ */ t("नामांकन", "Enrolments");
export const enrolmentsIntro = /* @__PURE__ */ t(
    "फ़ीस ऐप बताता है कि बच्चा आज किस कक्षा में है। यह रिकॉर्ड बताता है कि किस सत्र में कहाँ था — रिपोर्ट कार्ड और उपस्थिति इसी पर टिकते हैं।",
    "The fee app holds where a child is today. This holds where they were in a given session, which is what a report card and an attendance percentage are about.",
  );
export const enrolmentsNone = /* @__PURE__ */ t(
    "अभी नामांकन नहीं बना है।",
    "Nothing built yet. Build the record from the fee app to begin.",
  );
export const enrolmentsBuild = /* @__PURE__ */ t("फ़ीस ऐप से बनाएँ", "Build from the fee app");
export const enrolmentsRebuild = /* @__PURE__ */ t("फिर से मिलाएँ", "Rebuild from the fee app");
export const enrolmentsRebuildHint = /* @__PURE__ */ t(
    "मौजूदा रिकॉर्ड अपडेट होंगे, मिटेंगे नहीं।",
    "Existing rows are updated, never deleted.",
  );
export const enrolmentsInAgreement = /* @__PURE__ */ t("मिलान सही", "in agreement");
export const enrolmentsAllMatch = /* @__PURE__ */ t(
    "फ़ीस ऐप और यह रिकॉर्ड पूरी तरह मिलते हैं।",
    "This record and the fee app agree on every student.",
  );
export const enrolmentsDifferences = /* @__PURE__ */ t("अंतर", "Differences");
export const enrolmentsFixable = /* @__PURE__ */ t(
    "फिर से मिलाने पर ठीक हो जाएँगे",
    "would be resolved by a rebuild",
  );
export const enrolmentsNeedsPerson = /* @__PURE__ */ t(
    "इन्हें कोई व्यक्ति ही तय कर सकता है — इनकी उपस्थिति और अंक यहाँ दर्ज हैं।",
    "These need a person. Their attendance and marks are recorded here, so the row is kept rather than dropped.",
  );
export const enrolmentsRoll = /* @__PURE__ */ t("कक्षा में", "on the roll");
export const enrolmentsStudents = /* @__PURE__ */ t("विद्यार्थी", "students");
export const enrolmentsSkippedNoClass = /* @__PURE__ */ t(
    "बिना कक्षा के छोड़े गए",
    "skipped — no class in the fee app",
  );
export const enrolmentsCheck = /* @__PURE__ */ t("मिलान जाँच", "Consistency check");
export const enrolmentsBuiltNotice = /* @__PURE__ */ t("नामांकन बन गया।", "The record was built.");

  /* -------------------------------------------------------- timetable */
export const timetableTitle = /* @__PURE__ */ t("समय-सारिणी", "Timetable");
export const timetableNone = /* @__PURE__ */ t(
    "अभी कोई समय-सारिणी नहीं है।",
    "Nothing uploaded yet. Paste the sheet to check it against the master data.",
  );
export const timetableUpload = /* @__PURE__ */ t("नई शीट जाँचें", "Check a new sheet");
export const timetableSheet = /* @__PURE__ */ t("शीट", "Sheet");
export const timetableSheetHint = /* @__PURE__ */ t(
    "एक्सेल से कॉपी करके यहाँ चिपकाएँ। दिन का नाम अपनी पंक्ति में, फिर हर कक्षा की पंक्ति।",
    "Paste from Excel. A day name on its own line, then one line per class.",
  );
export const timetableSheetName = /* @__PURE__ */ t("इस शीट का नाम", "Name this sheet");
export const timetableSheetNameHint = /* @__PURE__ */ t(
    "जैसे “v11” या “दीवाली के बाद”।",
    "Something you will recognise later, like “v11” or “after Diwali”.",
  );
export const timetableCheck = /* @__PURE__ */ t("जाँचें", "Check");
export const timetableChecking = /* @__PURE__ */ t("जाँच हो रही है…", "Checking…");
export const timetableReady = /* @__PURE__ */ t(
    "सब मिल गया। यह शीट लागू की जा सकती है।",
    "Everything resolved. This sheet can be published.",
  );
export const timetableBlocked = /* @__PURE__ */ t(
    "पहले नीचे की चीज़ें ठीक करें, फिर दोबारा जाँचें।",
    "Fix the items below, then check the sheet again.",
  );
export const timetableFixOn = /* @__PURE__ */ t("यहाँ ठीक करें", "Fix on");
export const timetableCells = /* @__PURE__ */ t("खाने", "cells");
export const timetableSlots = /* @__PURE__ */ t("पीरियड", "periods");
export const timetableProblems = /* @__PURE__ */ t("शीट में गड़बड़", "Problems in the sheet");
export const timetableSaveDraft = /* @__PURE__ */ t("ड्राफ़्ट सहेजें", "Save as draft");
export const timetablePublish = /* @__PURE__ */ t("लागू करें", "Publish");
export const timetablePublishHint = /* @__PURE__ */ t(
    "लागू करने पर पिछली समय-सारिणी अपने आप पुरानी हो जाएगी।",
    "Publishing archives whatever is live now and regenerates teaching assignments.",
  );
export const timetablePublished = /* @__PURE__ */ t("लागू", "Published");
export const timetableDraft = /* @__PURE__ */ t("ड्राफ़्ट", "Draft");
export const timetableArchived = /* @__PURE__ */ t("पुरानी", "Archived");
export const timetableDelete = /* @__PURE__ */ t("ड्राफ़्ट हटाएँ", "Delete draft");
export const timetableVersions = /* @__PURE__ */ t("शीट का इतिहास", "Versions");
export const timetableByClass = /* @__PURE__ */ t("कक्षा से", "By class");
export const timetableByTeacher = /* @__PURE__ */ t("अध्यापक से", "By teacher");
export const timetableByDay = /* @__PURE__ */ t("दिन से", "By day");
export const timetableFree = /* @__PURE__ */ t("कौन खाली है", "Who is free");
export const timetableChooseClass = /* @__PURE__ */ t("कक्षा चुनें", "Choose a class");
export const timetableChooseTeacher = /* @__PURE__ */ t("अध्यापक चुनें", "Choose a teacher");
export const timetableChooseDay = /* @__PURE__ */ t("दिन चुनें", "Choose a day");
export const timetablePeriod = /* @__PURE__ */ t("पीरियड", "Period");
export const timetableNobodyFree = /* @__PURE__ */ t("कोई खाली नहीं", "Nobody is free");
export const timetableNoPublished = /* @__PURE__ */ t(
    "अभी कोई समय-सारिणी लागू नहीं है।",
    "No timetable is published yet.",
  );
export const timetableSharedBadge = /* @__PURE__ */ t("साझा", "Shared");
export const timetableParallelBadge = /* @__PURE__ */ t("समानांतर", "Parallel");
export const timetableLoad = /* @__PURE__ */ t("हफ़्ते के पीरियड", "Periods a week");
export const timetableClash = /* @__PURE__ */ t("टकराव", "Clash");
  /* ------------------------------------------------------------ teach */
export const teachTitle = /* @__PURE__ */ t("मेरा दिन", "My day");
export const teachToday = /* @__PURE__ */ t("आज", "Today");
export const teachNoTimetable = /* @__PURE__ */ t(
    "अभी कोई समय-सारिणी लागू नहीं है।",
    "No timetable is published yet, so your periods cannot be shown.",
  );
export const teachNoPeriods = /* @__PURE__ */ t("आज आपका कोई पीरियड नहीं है।", "You have no periods today.");
export const teachMyClasses = /* @__PURE__ */ t("मेरी कक्षाएँ", "My classes");
export const teachNeedsDoing = /* @__PURE__ */ t("करना बाकी", "Needs doing");
export const teachAllDone = /* @__PURE__ */ t("आज का सब हो गया।", "Everything for today is done.");
export const teachTakeRegister = /* @__PURE__ */ t("हाज़िरी लें", "Take the register");
export const teachRegisterTaken = /* @__PURE__ */ t("हाज़िरी हो गई", "Register taken");
export const teachSchoolClosed = /* @__PURE__ */ t(
    "आज विद्यालय बंद है।",
    "School is closed today, so there is no register to take.",
  );
export const navTeach = /* @__PURE__ */ t("पढ़ाई", "Teach");
export const teachPeriodsToday = /* @__PURE__ */ t("आज के पीरियड", "Today's periods");
export const teachPeriod = /* @__PURE__ */ t("पीरियड", "Period");
export const teachNoClassHeld = /* @__PURE__ */ t(
    "आप किसी कक्षा के कक्षा-अध्यापक नहीं हैं।",
    "You are not class teacher of any class, so no daily register is yours to take.",
  );
export const teachOpenClass = /* @__PURE__ */ t("कक्षा खोलें", "Open the class");
export const teachDailyRegister = /* @__PURE__ */ t("दैनिक हाज़िरी", "Daily register");
export const teachMarkFor = /* @__PURE__ */ t("किसके लिए", "Marking for");
export const teachChooseClass = /* @__PURE__ */ t("कक्षा चुनें", "Choose a class");
export const teachClassTitle = /* @__PURE__ */ t("कक्षा", "Class");
export const teachRoll = /* @__PURE__ */ t("बच्चों की सूची", "Class roll");
export const teachStudents = /* @__PURE__ */ t("बच्चे", "students");
export const teachViewRegister = /* @__PURE__ */ t("मासिक रजिस्टर देखें", "See the monthly register");

  /* ------------------------------------------------------ attendance */
export const attendanceTitle = /* @__PURE__ */ t("हाज़िरी", "Attendance");
export const attendancePresent = /* @__PURE__ */ t("उपस्थित", "Present");
export const attendanceAbsent = /* @__PURE__ */ t("अनुपस्थित", "Absent");
export const attendanceLate = /* @__PURE__ */ t("देर से", "Late");
export const attendanceLeave = /* @__PURE__ */ t("छुट्टी", "Leave");
export const attendanceMarkAllPresent = /* @__PURE__ */ t("सब उपस्थित", "All present");
export const attendanceSubmit = /* @__PURE__ */ t("जमा करें", "Submit");
export const attendanceSubmitted = /* @__PURE__ */ t("जमा हो गई", "Submitted");
export const attendanceSaving = /* @__PURE__ */ t("सहेजा जा रहा है…", "Saving…");
  // Said *while* the connection is down, so it is in the present tense and
  // only ever rendered behind `!online`.
export const attendanceOffline = /* @__PURE__ */ t(
    "इंटरनेट नहीं है। आपकी हाज़िरी इसी फ़ोन पर रखी है — इंटरनेट लौटने पर सहेजें दबाएँ। अपने-आप कुछ नहीं भेजा जाएगा।",
    "No connection. Your marks are kept on this phone — press Save when you are back online. Nothing is sent on its own.",
  );
  // Said when the connection is *fine*: a standing note that the register
  // keeps working if it drops. Separate from `attendanceOffline` because the
  // Teach card used to show that one unconditionally, which told every teacher
  // on a perfectly good connection that she had none.
export const attendanceWorksOffline = /* @__PURE__ */ t(
    "इंटरनेट चला जाए तो भी खुले रजिस्टर में आपकी हाज़िरी फ़ोन पर रहती है। जब तक आप सहेजें न दबाएँ, कुछ दर्ज नहीं होता।",
    "If the connection drops, an open register keeps your marks on this phone. Nothing is recorded until you press Save.",
  );
export const attendanceQueued = /* @__PURE__ */ t("भेजना बाकी", "waiting to send");
export const attendanceEmptyRoll = /* @__PURE__ */ t(
    "इस कक्षा में कोई बच्चा नहीं है।",
    "Nobody is enrolled in this class. Build the enrolment record first.",
  );
export const attendanceNotYours = /* @__PURE__ */ t(
    "यह आपकी कक्षा नहीं है।",
    "This is not one of your classes.",
  );
export const attendanceOnBehalf = /* @__PURE__ */ t(
    "आप अध्यापक की ओर से दर्ज कर रहे हैं।",
    "You are recording this on the teacher's behalf — it will be marked as such.",
  );
export const attendanceLocked = /* @__PURE__ */ t(
    "यह रजिस्टर दर्ज हो चुका है। बदलने के लिए कारण के साथ सुधार करें।",
    "This register is recorded. To change it, correct it with a reason.",
  );
export const attendanceMarked = /* @__PURE__ */ t("दर्ज", "marked");
export const attendanceNoClassChosen = /* @__PURE__ */ t(
    "कौन सी कक्षा की हाज़िरी लेनी है?",
    "Which class are you taking the register for?",
  );
export const attendanceForDay = /* @__PURE__ */ t("तारीख़", "Date");
export const attendanceAlreadyIn = /* @__PURE__ */ t("यह हाज़िरी जमा हो चुकी है।", "This register is already in.");
export const attendanceTakenBy = /* @__PURE__ */ t("दर्ज किया", "Recorded by");
export const attendanceStillOpen = /* @__PURE__ */ t("अभी खुला है", "Still open");

  // P6: nothing is recorded until somebody saves, and a save is the whole roll.
export const attendanceNotRecorded = /* @__PURE__ */ t("अभी दर्ज नहीं", "Not recorded yet");
export const childOne = /* @__PURE__ */ t("बच्चा", "child");
export const childMany = /* @__PURE__ */ t("बच्चे", "children");
export const attendancePreview = /* @__PURE__ */ t(
    "अभी कुछ दर्ज नहीं हुआ। सहेजने तक सब उपस्थित दिखेंगे — केवल जो नहीं आए उन्हें बदलें।",
    "Nothing is recorded yet. Everyone shows as present until you save — change only the children who are not.",
  );
export const attendanceReview = /* @__PURE__ */ t("जाँचें और सहेजें", "Review and save");
export const attendanceReviewCorrection = /* @__PURE__ */ t("सुधार जाँचें", "Review the correction");
export const attendanceCheckTitle = /* @__PURE__ */ t("सहेजने से पहले देख लें", "Check before saving");
export const attendanceEveryonePresent = /* @__PURE__ */ t("सब उपस्थित", "Everyone present");
export const attendanceExceptions = /* @__PURE__ */ t("जो उपस्थित नहीं", "Not present");
export const attendanceSaveConfirm = /* @__PURE__ */ t("हाज़िरी सहेजें", "Save attendance");
export const attendanceSaveCorrection = /* @__PURE__ */ t("सुधार सहेजें", "Save the correction");
export const attendanceBackToList = /* @__PURE__ */ t("सूची पर लौटें", "Back to the list");
export const attendanceRecorded = /* @__PURE__ */ t("दर्ज", "Recorded");
export const attendanceCorrect = /* @__PURE__ */ t("इस रजिस्टर में सुधार करें", "Correct this register");
export const attendanceCorrecting = /* @__PURE__ */ t(
    "आप दर्ज रजिस्टर में सुधार कर रहे हैं। पुराना संशोधन भी रखा जाएगा।",
    "You are correcting a recorded register. The earlier revision is kept.",
  );
export const attendanceCorrectReason = /* @__PURE__ */ t("सुधार क्यों? (ज़रूरी — रजिस्टर के साथ रखा जाएगा)", "Why? (required — kept with the register)");
export const attendanceChanges = /* @__PURE__ */ t("क्या बदलेगा", "What changes");
export const attendanceNoChanges = /* @__PURE__ */ t("अभी कुछ नहीं बदला", "Nothing has changed yet");
export const attendanceCancelCorrection = /* @__PURE__ */ t("सुधार छोड़ें", "Leave it as it is");
export const attendanceChecking = /* @__PURE__ */ t("जाँच रहे हैं कि हाज़िरी सहेजी गई या नहीं…", "Checking whether your save completed…");
export const attendanceNotSavedRetry = /* @__PURE__ */ t(
    "सहेजी नहीं गई। फिर से कोशिश करें — यह दो बार नहीं सहेजी जाएगी।",
    "Not saved. Try again — it will not be saved twice.",
  );
export const attendanceReloadList = /* @__PURE__ */ t("नई सूची खोलें", "Open the new list");
export const attendanceSeeSaved = /* @__PURE__ */ t("जो सहेजा गया वह देखें", "See what was saved");
export const attendanceJoined = /* @__PURE__ */ t("अब सूची में", "Now on the list");
export const attendanceLeft = /* @__PURE__ */ t("अब सूची में नहीं", "No longer on the list");
export const attendanceHistory = /* @__PURE__ */ t("इतिहास", "History");
export const attendanceHistoryImported = /* @__PURE__ */ t("संशोधन रखे जाने से पहले दर्ज", "Recorded before revisions were kept");
export const attendanceHistoryChanged = /* @__PURE__ */ t("बदले", "changed");
export const attendanceDue = /* @__PURE__ */ t(
    "रजिस्टर बाकी है — सहेजने पर ही दर्ज होगा।",
    "This register is outstanding — it is recorded only when saved.",
  );

  /* ---------------------------------------------------------- notes */
export const notesTitle = /* @__PURE__ */ t("टिप्पणियाँ", "Notes");
export const notesNone = /* @__PURE__ */ t("अभी कोई टिप्पणी नहीं है।", "No notes yet.");
export const notesWrite = /* @__PURE__ */ t("टिप्पणी लिखें", "Write a note");
export const notesKind = /* @__PURE__ */ t("किस बारे में", "About");
export const notesBody = /* @__PURE__ */ t("बात", "Note");
export const notesAboutClass = /* @__PURE__ */ t("पूरी कक्षा के बारे में", "About the whole class");
export const notesDelete = /* @__PURE__ */ t("हटाएँ", "Delete");
export const notesAdded = /* @__PURE__ */ t("टिप्पणी जुड़ गई।", "Note added.");
export const notesOwnOnly = /* @__PURE__ */ t(
    "आप अपनी ही लिखी टिप्पणी हटा सकते हैं।",
    "You can only remove a note you wrote yourself.",
  );
export const notesConcerns = /* @__PURE__ */ t("ध्यान देने योग्य", "need attention");
export const notesAboutStudent = /* @__PURE__ */ t("इस बच्चे के बारे में", "About this child");

  /* --------------------------------------------------- student card */
export const studentTitle = /* @__PURE__ */ t("बच्चे का विवरण", "Student");
export const studentAttendance = /* @__PURE__ */ t("उपस्थिति", "Attendance");
export const studentAttendanceNone = /* @__PURE__ */ t(
    "अभी कोई हाज़िरी दर्ज नहीं है।",
    "No attendance recorded yet.",
  );
export const studentFather = /* @__PURE__ */ t("पिता", "Father");
export const studentMother = /* @__PURE__ */ t("माता", "Mother");
export const studentGuardianPhone = /* @__PURE__ */ t("अभिभावक का फ़ोन", "Guardian phone");
export const studentAdmissionNo = /* @__PURE__ */ t("प्रवेश क्रमांक", "Admission no.");
export const studentRollNo = /* @__PURE__ */ t("रोल नंबर", "Roll no.");
export const studentFees = /* @__PURE__ */ t("फ़ीस", "Fees");
export const studentFeeDue = /* @__PURE__ */ t("बकाया फ़ीस", "Fee outstanding");
export const studentLateFee = /* @__PURE__ */ t("विलंब शुल्क", "Late fee");
export const studentFeePaid = /* @__PURE__ */ t("जमा", "Paid");
export const studentFeeUnavailable = /* @__PURE__ */ t(
    "फ़ीस की जानकारी अभी नहीं मिल सकी।",
    "The fee figures could not be read just now.",
  );
export const studentFeeNote = /* @__PURE__ */ t(
    "फ़ीस और विलंब शुल्क अलग-अलग हैं — इन्हें जोड़ा नहीं जाता।",
    "Fees and late fees are separate and are never added together. The fee app is the authority for both.",
  );

  /* -------------------------------------------------------- register */
export const registerMonthly = /* @__PURE__ */ t("मासिक रजिस्टर", "Monthly register");
export const registerPrint = /* @__PURE__ */ t("छापें", "Print");
export const registerMonth = /* @__PURE__ */ t("महीना", "Month");
export const registerNoData = /* @__PURE__ */ t(
    "इस महीने की कोई हाज़िरी दर्ज नहीं है।",
    "No attendance was recorded this month.",
  );
export const registerWorkingDays = /* @__PURE__ */ t("कार्यदिवस", "Working days");
export const registerPercent = /* @__PURE__ */ t("प्रतिशत", "Percent");
export const registerDaysRecorded = /* @__PURE__ */ t("दर्ज दिन", "Days recorded");
export const registerBelow = /* @__PURE__ */ t("75% से कम", "Below 75%");
export const registerKey = /* @__PURE__ */ t("संकेत", "Key");
export const registerBlankDay = /* @__PURE__ */ t(
    "खाली ख़ाना — उस दिन हाज़िरी दर्ज नहीं हुई।",
    "A blank cell means no register was taken that day.",
  );
export const registerPreviousMonth = /* @__PURE__ */ t("पिछला महीना", "Previous month");
export const registerNextMonth = /* @__PURE__ */ t("अगला महीना", "Next month");
export const registerClassTotal = /* @__PURE__ */ t("कक्षा की उपस्थिति", "Class attendance");

  /* ------------------------------------------------- substitutions */
export const navSubstitutions = /* @__PURE__ */ t("व्यवस्था", "Cover");
export const subsTitle = /* @__PURE__ */ t("व्यवस्था", "Cover");
export const subsForDay = /* @__PURE__ */ t("किस दिन की", "For");
export const dutyTitle = /* @__PURE__ */ t("व्यवस्था", "Cover duty");
export const dutyYours = /* @__PURE__ */ t("यह व्यवस्था आपकी है", "This cover is yours");
export const dutyChangedTitle = /* @__PURE__ */ t("यह व्यवस्था बदल गई है", "This cover has changed");
export const dutyChangedDetail = /* @__PURE__ */ t(
    "जो सूचना आपको मिली थी वह अब सही नहीं है। आपको इस पीरियड में जाने की ज़रूरत नहीं — जब तक नीचे नई व्यवस्था आपकी न हो।",
    "The notice you received no longer stands. You are not needed for this period unless the current cover below is yours.",
  );
export const dutyCancelledTitle = /* @__PURE__ */ t("यह व्यवस्था रद्द हो गई", "This cover was cancelled");
export const dutyCancelledDetail = /* @__PURE__ */ t("आपको इस पीरियड में जाने की ज़रूरत नहीं है।", "You do not need to go to this period.");
export const dutyNotForYou = /* @__PURE__ */ t("यह लिंक आपके खाते के लिए नहीं है", "This link is not for your account");
export const dutyNotForYouDetail = /* @__PURE__ */ t(
    "अपनी व्यवस्था आज वाले पेज पर देखें।",
    "Your own cover duties are on Today.",
  );
export const dutyAcknowledge = /* @__PURE__ */ t("देख लिया — मैं जाऊँगा/जाऊँगी", "Acknowledge — I will be there");
export const dutyAcknowledged = /* @__PURE__ */ t("आपने देख लिया है", "You have acknowledged this");
export const dutyCannotCover = /* @__PURE__ */ t("मैं नहीं ले सकता/सकती", "I cannot cover this");
export const dutyCannotCoverNote = /* @__PURE__ */ t("क्यों? (वैकल्पिक, केवल समन्वयक देखेंगे)", "Why? (optional, only the coordinator sees it)");
export const dutyCannotCoverSent = /* @__PURE__ */ t(
    "समन्वयक को बता दिया गया। जब तक कोई और न दिया जाए, यह आपकी ही है।",
    "The coordinator has been told. Until someone else is assigned, it stays with you.",
  );
export const dutyAckMeans = /* @__PURE__ */ t(
    "पुष्टि का मतलब है आपने देख लिया — कक्षा में पहुँचना फिर भी ज़रूरी है।",
    "Acknowledging says you have seen it — you still need to be in the room.",
  );
export const dutyPeriodOver = /* @__PURE__ */ t("यह पीरियड समाप्त हो चुका", "This period has ended");
export const dutyWhen = /* @__PURE__ */ t("कब", "When");
export const dutyClasses = /* @__PURE__ */ t("कक्षा", "Class");
export const dutySubject = /* @__PURE__ */ t("विषय", "Subject");
export const dutyCoveringFor = /* @__PURE__ */ t("किसकी जगह", "Covering for");
export const teachCoverOpen = /* @__PURE__ */ t("खोलें और पुष्टि करें", "Open and acknowledge");
export const coverSendNow = /* @__PURE__ */ t("अभी भेजें", "Send now");
export const coverTransport = /* @__PURE__ */ t("माध्यम", "Transport");
export const coverConfirmedReceived = /* @__PURE__ */ t("मिल गई (पूछकर पुष्टि की)", "Received (checked in person)");
export const coverResend = /* @__PURE__ */ t("फिर भेजें", "Send again");
export const coverResendMaybeTwice = /* @__PURE__ */ t("फिर भेजें — दो बार पहुँच सकती है", "Send again — may arrive twice");
export const coverSwitchesTitle = /* @__PURE__ */ t("चालू / बंद", "Switches");
export const coverSwitchesHint = /* @__PURE__ */ t(
    "बंद करने से कुछ मिटता नहीं — बनी हुई व्यवस्था और सूचनाओं का इतिहास दिखता रहता है।",
    "Switching off deletes nothing — committed cover and notice history stay visible.",
  );
export const coverSwitchCommand = /* @__PURE__ */ t("व्यवस्था सहेजना", "Saving absences and cover");
export const coverSwitchNotices = /* @__PURE__ */ t("सूचनाएँ भेजना", "Sending cover notices");
export const switchOn = /* @__PURE__ */ t("चालू", "On");
export const switchOff = /* @__PURE__ */ t("बंद", "Off");
export const switchTurnOn = /* @__PURE__ */ t("चालू करें", "Turn on");
export const switchTurnOff = /* @__PURE__ */ t("बंद करें", "Turn off");
export const coverSaveAbsence = /* @__PURE__ */ t("अनुपस्थिति सहेजें और व्यवस्था करें", "Save absence & arrange cover");
export const coverSaved = /* @__PURE__ */ t("सहेजा गया", "Saved");
export const coverAlreadySaved = /* @__PURE__ */ t("यह पहले ही सहेजा जा चुका था", "This was already saved");
export const coverChecking = /* @__PURE__ */ t("जाँच रहे हैं कि यह सहेजा गया या नहीं…", "Checking whether this saved…");
export const coverNotSavedRetry = /* @__PURE__ */ t(
    "सहेजा नहीं गया। फिर से कोशिश करना सुरक्षित है — दो बार नहीं होगा।",
    "Not saved. Trying again is safe — it cannot be saved twice.",
  );
export const coverBackAtSchool = /* @__PURE__ */ t("स्कूल में हैं", "Back at school");
export const coverAssign = /* @__PURE__ */ t("इन्हें दें", "Assign");
export const coverChooseTeacher = /* @__PURE__ */ t("अध्यापक चुनें", "Choose a teacher");
export const coverRelease = /* @__PURE__ */ t("हटाएँ", "Release");
export const coverRearrange = /* @__PURE__ */ t("फिर से व्यवस्था करें", "Arrange again");
export const coverAssigned = /* @__PURE__ */ t("व्यवस्था हुई", "Assigned");
export const coverNeedsHelp = /* @__PURE__ */ t("मदद चाहिए", "Needs help");
export const coverStarted = /* @__PURE__ */ t("पीरियड शुरू हो चुका", "Period has started");
export const coverFor = /* @__PURE__ */ t("की जगह", "Covering for");
export const coverSuggested = /* @__PURE__ */ t("सुझाव", "Suggested");
export const coverManual = /* @__PURE__ */ t("हाथ से", "Chosen by hand");
export const coverAcknowledged = /* @__PURE__ */ t("अध्यापक ने देखा", "Teacher acknowledged");
export const coverNotAcknowledged = /* @__PURE__ */ t("अभी देखा नहीं", "Not yet acknowledged");
export const coverCannotCover = /* @__PURE__ */ t("अध्यापक नहीं ले सकते", "Teacher cannot cover");
export const coverNoticeQueued = /* @__PURE__ */ t("सूचना कतार में", "Notice queued");
export const coverNoticeSent = /* @__PURE__ */ t("सूचना भेजी गई", "Notice accepted by WhatsApp");
export const coverNoticeUnknown = /* @__PURE__ */ t("सूचना की पुष्टि नहीं", "Delivery not confirmed");
export const coverNoticeFailed = /* @__PURE__ */ t("सूचना नहीं गई", "Notice failed");
export const coverNoticeBlocked = /* @__PURE__ */ t("नंबर नहीं — सूचना नहीं जाएगी", "No phone — notice blocked");
export const coverNoticeNone = /* @__PURE__ */ t("सूचना नहीं", "No notice");
export const coverNoLogin = /* @__PURE__ */ t("इनका लॉगिन नहीं — लिंक नहीं खोल पाएँगे", "No login — cannot open the link");
export const coverHistory = /* @__PURE__ */ t("पहले की व्यवस्था", "Earlier versions");
export const coverDutiesTitle = /* @__PURE__ */ t("आज की व्यवस्था", "Cover duties");
export const coverNothingNeeded = /* @__PURE__ */ t("इस दिन किसी व्यवस्था की ज़रूरत नहीं।", "No cover is needed on this day.");
export const coverClash = /* @__PURE__ */ t("समय-सारणी में टकराव — कुछ पाठ जाँचें", "The timetable has clashes — check some lessons");
export const subsAbsentToday = /* @__PURE__ */ t("आज अनुपस्थित", "Away today");
export const subsNobodyAway = /* @__PURE__ */ t("आज कोई अनुपस्थित नहीं है।", "Nobody is marked away.");
export const subsMarkAbsent = /* @__PURE__ */ t("अनुपस्थित दर्ज करें", "Mark somebody away");
export const subsWholeDay = /* @__PURE__ */ t("पूरा दिन", "Whole day");
export const subsPeriods = /* @__PURE__ */ t("कौन से पीरियड", "Which periods");
export const subsReason = /* @__PURE__ */ t("कारण", "Reason");
export const subsRemoveAbsence = /* @__PURE__ */ t("आ गए", "They came in");
export const subsNoTimetable = /* @__PURE__ */ t(
    "पहले समय-सारिणी लागू करें।",
    "Publish a timetable first — cover is worked out from it.",
  );
export const subsNoVacancies = /* @__PURE__ */ t(
    "कोई पीरियड खाली नहीं है।",
    "No period is left without a teacher.",
  );
export const subsGenerate = /* @__PURE__ */ t("व्यवस्था बनाएँ", "Work out the cover");
export const subsRegenerate = /* @__PURE__ */ t("फिर से बनाएँ", "Work it out again");
export const subsPublish = /* @__PURE__ */ t("जारी करें", "Publish");
export const subsUnpublish = /* @__PURE__ */ t("वापस लें", "Withdraw");
export const subsPublished = /* @__PURE__ */ t("जारी", "Published");
export const subsDraft = /* @__PURE__ */ t("मसौदा", "Draft");
export const subsNotPublished = /* @__PURE__ */ t(
    "यह अभी जारी नहीं हुआ — अध्यापकों को दिखाई नहीं देगा।",
    "Not published yet, so no teacher can see it.",
  );
export const subsStale = /* @__PURE__ */ t(
    "समय-सारिणी बदल गई है — फिर से बनाएँ।",
    "The timetable has been republished since this was planned. Work it out again.",
  );
export const subsCovered = /* @__PURE__ */ t("व्यवस्था हुई", "Covered");
export const subsSelfStudy = /* @__PURE__ */ t("स्वयं अध्ययन", "Self study");
export const subsMerged = /* @__PURE__ */ t("साथ बैठेंगे", "Joined another class");
export const subsOpen = /* @__PURE__ */ t("कोई नहीं मिला", "Nobody free");
export const subsNeedsReview = /* @__PURE__ */ t("पुष्टि करें", "Confirm");
export const subsPin = /* @__PURE__ */ t("पक्का करें", "Pin");
export const subsUnpin = /* @__PURE__ */ t("पक्का हटाएँ", "Unpin");
export const subsPinned = /* @__PURE__ */ t("पक्का", "Pinned");
export const subsPinKeeps = /* @__PURE__ */ t(
    "पक्की की गई व्यवस्था दोबारा बनाने पर भी बनी रहती है।",
    "A pinned row survives working the cover out again.",
  );
export const subsChangeTeacher = /* @__PURE__ */ t("बदलें", "Change");
export const subsChooseTeacher = /* @__PURE__ */ t("अध्यापक चुनें", "Choose who covers");
export const subsSetSelfStudy = /* @__PURE__ */ t("स्वयं अध्ययन रखें", "Leave as self study");
export const subsMergeInto = /* @__PURE__ */ t("इस कक्षा के साथ", "Send them to");
export const subsPeriodShort = /* @__PURE__ */ t("पी", "P");
export const subsOriginal = /* @__PURE__ */ t("मूल अध्यापक", "Normally");
export const subsWhy = /* @__PURE__ */ t("क्यों", "Why");
export const subsPlanSummary = /* @__PURE__ */ t("सारांश", "Summary");
export const subsPoliciesTitle = /* @__PURE__ */ t("व्यवस्था की नीति", "Cover policy");
export const subsRulesTitle = /* @__PURE__ */ t("व्यवस्था के नियम", "Cover rules");
export const subsRulesIntro = /* @__PURE__ */ t(
    "समय-सारणी यह नहीं बताती कि पीरियड कब होता है, या टीम में कितने अध्यापक होने ज़रूरी हैं। यहाँ स्कूल यह तय करता है।",
    "The timetable cannot say when a period happens or how many of a team must be there. The school decides both here.",
  );
export const bellsTitle = /* @__PURE__ */ t("घंटी का समय", "Bell times");
export const bellsHint = /* @__PURE__ */ t(
    "जो पीरियड शुरू हो चुका है, उसकी व्यवस्था ऐप अपने-आप नहीं करता।",
    "Cover is never arranged automatically for a period that has already started.",
  );
export const bellsStarts = /* @__PURE__ */ t("शुरू", "Starts");
export const bellsEnds = /* @__PURE__ */ t("समाप्त", "Ends");
export const bellsRevision = /* @__PURE__ */ t("संस्करण", "Revision");
export const lessonsTitle = /* @__PURE__ */ t("समय-सारणी में पाठ", "Lessons in the timetable");
export const lessonsHint = /* @__PURE__ */ t(
    "एक अध्यापक का एक साथ कई कक्षाओं को पढ़ाना एक ही पाठ है; बँटी हुई कक्षा के दोनों हिस्से अलग पाठ हैं।",
    "One teacher with several classes at once is one lesson; the two halves of a split class are two.",
  );
export const lessonOrdinary = /* @__PURE__ */ t("सामान्य", "Ordinary");
export const lessonJoint = /* @__PURE__ */ t("संयुक्त", "Joint");
export const lessonParallel = /* @__PURE__ */ t("बँटी कक्षा का हिस्सा", "Split-class cohort");
export const lessonTeam = /* @__PURE__ */ t("टीम", "Team block");
export const teamRulesTitle = /* @__PURE__ */ t("टीम के नियम", "Team rules");
export const teamRulesHint = /* @__PURE__ */ t(
    "नियम के बिना, टीम का कोई अध्यापक अनुपस्थित होने पर ऐप ख़ुद व्यवस्था नहीं करता — व्यक्ति देखता है।",
    "Without a rule, any absence from a team is shown to a person and never arranged by the app.",
  );
export const teamMinimum = /* @__PURE__ */ t("कम से कम उपस्थित", "Must be present");
export const teamNoRule = /* @__PURE__ */ t("नियम नहीं", "No rule");
export const teamNone = /* @__PURE__ */ t("समय-सारणी में कोई टीम नहीं", "No team blocks in the published timetable");
export const teamSize = /* @__PURE__ */ t("टीम", "Team");
export const teamBlocksPerWeek = /* @__PURE__ */ t("हफ़्ते में", "Per week");
export const clashesTitle = /* @__PURE__ */ t("समय-सारणी में टकराव", "Timetable clashes");
export const clashesHint = /* @__PURE__ */ t(
    "एक ही व्यक्ति एक ही समय दो पाठों में। व्यवस्था से पहले समय-सारणी ठीक करें।",
    "One person in two lessons at once. Fix the timetable before relying on cover for these.",
  );
export const clashesNone = /* @__PURE__ */ t("कोई टकराव नहीं", "No clashes");
export const subsPoliciesHint = /* @__PURE__ */ t(
    "कौन कब विद्यालय में है, और किसे कब बुलाया जा सकता है।",
    "Who is in the building when, and who may be asked to cover.",
  );
export const subsOnSite = /* @__PURE__ */ t("विद्यालय में", "In school for");
export const subsRole = /* @__PURE__ */ t("श्रेणी", "Kind");
export const subsMaxAuto = /* @__PURE__ */ t("अपने आप अधिकतम", "Automatic cover limit");
export const subsPolicyNote = /* @__PURE__ */ t("टिप्पणी", "Note");
export const subsPolicyReset = /* @__PURE__ */ t("सामान्य कर दें", "Back to the default");
export const subsFullDay = /* @__PURE__ */ t("पूरा दिन", "Full day");
export const subsCoverFor = /* @__PURE__ */ t("की जगह", "covering for");
export const teachCoverDuty = /* @__PURE__ */ t("आज की व्यवस्था", "Cover duty today");
export const teachCoverNone = /* @__PURE__ */ t("आज कोई व्यवस्था नहीं है।", "No cover duty today.");

  /* ---------------------------------------------------- collection */
export const navCollection = /* @__PURE__ */ t("जानकारी", "Collection");
export const collectionTitle = /* @__PURE__ */ t("जानकारी जुटाएँ", "Collect information");
export const collectionIntro = /* @__PURE__ */ t(
    "एक लिंक भेजिए — अध्यापक बिना साइन इन किए भर देंगे।",
    "Send one link. A teacher fills it in without signing in.",
  );
export const collectionNone = /* @__PURE__ */ t("अभी कोई निवेदन नहीं है।", "Nothing has been asked for yet.");
export const collectionNew = /* @__PURE__ */ t("नया निवेदन", "Ask for something");
export const collectionFieldsTitle = /* @__PURE__ */ t("कौन-कौन सी जानकारी", "What can be asked for");
export const collectionFieldsIntro = /* @__PURE__ */ t(
    "हर सवाल एक बार लिखा जाता है और कई बार पूछा जाता है।",
    "Each question is written once and asked many times.",
  );
export const collectionFieldKey = /* @__PURE__ */ t("कुंजी", "Key");
export const collectionFieldKeyHint = /* @__PURE__ */ t(
    "यह बाद में बदली नहीं जा सकती — उत्तर इसी से जुड़ते हैं।",
    "This cannot be changed later: every answer points at it.",
  );
export const collectionFieldType = /* @__PURE__ */ t("किस तरह का उत्तर", "Kind of answer");
export const collectionFieldMode = /* @__PURE__ */ t("कैसे पूछें", "How to ask");
export const collectionFieldLength = /* @__PURE__ */ t("कितने अंक/अक्षर", "Exact length");
export const collectionFieldMax = /* @__PURE__ */ t("अधिकतम", "Largest allowed");
export const collectionFieldOptions = /* @__PURE__ */ t("विकल्प", "Choices");
export const collectionFieldOptionsHint = /* @__PURE__ */ t(
    "एक पंक्ति में एक",
    "One per line",
  );
export const collectionFieldFeeColumn = /* @__PURE__ */ t("फ़ीस ऐप का कॉलम", "Fee app column");
export const collectionFieldFeeColumnHint = /* @__PURE__ */ t(
    "मिलान के लिए — VPPS One फ़ीस ऐप में कभी नहीं लिखता।",
    "For comparison only. VPPS One never writes to the fee app.",
  );
export const collectionFieldHelp = /* @__PURE__ */ t("सहायता पंक्ति", "Helper line");
export const collectionRetire = /* @__PURE__ */ t("पूछना बंद करें", "Stop asking this");
export const collectionRestore = /* @__PURE__ */ t("फिर से पूछें", "Ask this again");
export const collectionRetired = /* @__PURE__ */ t("बंद", "Retired");
export const collectionAsking = /* @__PURE__ */ t("क्या पूछा जा रहा है", "What is being asked");
export const collectionChooseFields = /* @__PURE__ */ t("जानकारी चुनें", "Choose what to ask for");
export const collectionDueDate = /* @__PURE__ */ t("कब तक", "Due by");
export const collectionAssignTo = /* @__PURE__ */ t("किसे भेजना है", "Who is being asked");
export const collectionReason = /* @__PURE__ */ t("कारण", "Why this list");
export const collectionReasonHint = /* @__PURE__ */ t(
    "पूरी कक्षा नहीं है तो बताइए — वरना सूची अधूरी लगती है।",
    "If this is not the whole class, say why. Otherwise the list reads as broken.",
  );
export const collectionOpen = /* @__PURE__ */ t("लिंक चालू करें", "Open the link");
export const collectionClose = /* @__PURE__ */ t("लिंक बंद करें", "Close the link");
export const collectionReopen = /* @__PURE__ */ t("फिर चालू करें", "Open it again");
export const collectionLink = /* @__PURE__ */ t("लिंक", "Link");
export const collectionCopyLink = /* @__PURE__ */ t("लिंक कॉपी करें", "Copy the link");
export const collectionCopied = /* @__PURE__ */ t("कॉपी हो गया", "Copied");
export const collectionOpenWhatsapp = /* @__PURE__ */ t("व्हाट्सएप में खोलें", "Open in WhatsApp");
export const collectionRotate = /* @__PURE__ */ t("नया लिंक बनाएँ", "Replace the link");
export const collectionRotateHint = /* @__PURE__ */ t(
    "पुराना लिंक तुरंत बंद हो जाएगा।",
    "The old link stops working at once.",
  );
export const collectionDraftNotice = /* @__PURE__ */ t(
    "यह अभी मसौदा है — लिंक काम नहीं करेगा।",
    "This is still a draft, so the link does not open.",
  );
export const collectionProgress = /* @__PURE__ */ t("कितना भरा", "Filled in");
export const collectionWaitingOn = /* @__PURE__ */ t("किनका बाकी है", "Still waiting on");
export const collectionAnswered = /* @__PURE__ */ t("उत्तर आए", "answered");

  /* -------------------------------------------------------- review */
export const reviewTitle = /* @__PURE__ */ t("आई हुई जानकारी", "Answers to check");
export const reviewNone = /* @__PURE__ */ t("कुछ जाँचने को नहीं है।", "Nothing is waiting to be checked.");
export const reviewChanges = /* @__PURE__ */ t("बदलाव", "Changes");
export const reviewConfirmations = /* @__PURE__ */ t("जैसा था वैसा ही", "Confirmed unchanged");
export const reviewConfirmationsHint = /* @__PURE__ */ t(
    "इन्हें एक साथ स्वीकार कर लीजिए — कुछ बदला नहीं है।",
    "Accept these together: a teacher looked and nothing changed.",
  );
export const reviewWas = /* @__PURE__ */ t("पहले", "Was");
export const reviewNow = /* @__PURE__ */ t("अब", "Now");
export const reviewAccept = /* @__PURE__ */ t("स्वीकार करें", "Accept");
export const reviewReject = /* @__PURE__ */ t("अस्वीकार करें", "Reject");
export const reviewAcceptAll = /* @__PURE__ */ t("सब स्वीकार करें", "Accept all of these");
export const reviewSharedPhone = /* @__PURE__ */ t("और बच्चों पर भी यही नंबर", "also on other children");
export const reviewSharedPhoneHint = /* @__PURE__ */ t(
    "भाई-बहन का एक ही नंबर होना सामान्य है।",
    "Siblings sharing a number is normal, not a mistake.",
  );
export const reviewDecided = /* @__PURE__ */ t("फ़ैसला", "Decided");
export const reviewFeeAppDiffers = /* @__PURE__ */ t(
    "फ़ीस ऐप में अलग दर्ज है — वहाँ स्वयं बदलिए।",
    "The fee app holds something different. Change it there, deliberately.",
  );

  /* ----------------------------------------------------- documents */
export const documentsTitle = /* @__PURE__ */ t("कागज़ात", "Documents");
export const documentsNone = /* @__PURE__ */ t("कोई कागज़ नहीं है।", "No documents yet.");
export const documentsAdd = /* @__PURE__ */ t("कागज़ जोड़ें", "Add a document");
export const documentsKind = /* @__PURE__ */ t("किस तरह का", "What is it");
export const documentsFile = /* @__PURE__ */ t("फ़ाइल", "File");
export const documentsNote = /* @__PURE__ */ t("टिप्पणी", "Note");
export const documentsOpen = /* @__PURE__ */ t("खोलें", "Open");
export const documentsRemove = /* @__PURE__ */ t("हटाएँ", "Remove");
export const documentsLimit = /* @__PURE__ */ t(
    "PDF या फ़ोटो, 10 MB तक।",
    "A PDF or a photograph, up to 10 MB.",
  );
export const documentsPrivate = /* @__PURE__ */ t(
    "लिंक एक मिनट चलता है — साझा न करें।",
    "The link lasts a minute and is not for sharing.",
  );
export const recordsTitle = /* @__PURE__ */ t("दर्ज जानकारी", "What we hold");
export const recordsNone = /* @__PURE__ */ t("अभी कुछ दर्ज नहीं है।", "Nothing recorded yet.");

  /* ------------------------------------------------------ messages */
export const messagesTitle = /* @__PURE__ */ t("संदेश", "Messages");
export const messagesIntro = /* @__PURE__ */ t(
    "कतार में, भेजे गए और जो नहीं गए — दोबारा भेजने के इतिहास के साथ।",
    "Queued, sent and failed updates, with their retry history.",
  );
export const messagesTemplates = /* @__PURE__ */ t("टेम्पलेट", "Templates");
export const messagesQueue = /* @__PURE__ */ t("भेजने की सूची", "To send");
export const messagesNone = /* @__PURE__ */ t("कोई संदेश नहीं है।", "No messages.");
export const messagesTemplateCode = /* @__PURE__ */ t("प्रदाता का नाम", "Provider name");
export const messagesTemplateCodeHint = /* @__PURE__ */ t(
    "WhatsApp में स्वीकृत टेम्पलेट का यही नाम होना चाहिए।",
    "This must match the approved template's name on WhatsApp exactly.",
  );
export const messagesBody = /* @__PURE__ */ t("संदेश", "Message");
export const messagesBodyHint = /* @__PURE__ */ t(
    "{{1}}, {{2}} की जगह भरी जाएगी।",
    "{{1}}, {{2}} are filled in when it is sent.",
  );
export const messagesVariables = /* @__PURE__ */ t("क्या-क्या भरना है", "What goes in the blanks");
export const messagesAudience = /* @__PURE__ */ t("किसके लिए", "Who it is for");
export const messagesHasButton = /* @__PURE__ */ t("लिंक बटन है", "Has a link button");
export const messagesSendByHand = /* @__PURE__ */ t("व्हाट्सएप खोलकर भेजें", "Open WhatsApp and send");
export const messagesMarkSent = /* @__PURE__ */ t("भेज दिया", "I have sent it");
export const messagesCancel = /* @__PURE__ */ t("रद्द करें", "Cancel");
export const messagesParentRule = /* @__PURE__ */ t(
    "अभिभावक को संदेश हमेशा कोई व्यक्ति स्वयं भेजता है।",
    "A message to a parent is always pressed by a person, never by the app.",
  );

  // P9: approved against what is true when it goes; a wrong number stops use.
export const messagesNotConfigured = /* @__PURE__ */ t(
    "प्रदाता अभी जुड़ा नहीं है — व्हाट्सएप खोलकर भेजिए।",
    "No provider is connected, so open it in WhatsApp and press send.",
  );

  /* -------------------------------------------- the public link pages */
export const linkTitle = /* @__PURE__ */ t("विद्यालय की जानकारी", "School information");
export const linkToDo = /* @__PURE__ */ t("करने हैं", "to do");
export const linkDueBy = /* @__PURE__ */ t("कब तक", "Due by");
export const linkSaved = /* @__PURE__ */ t("सहेज लिया", "Saved");
export const linkSentDone = /* @__PURE__ */ t("भेज दिया ✓", "Sent ✓");
export const linkSaveAll = /* @__PURE__ */ t("भेजें", "Send");
export const linkUnchanged = /* @__PURE__ */ t("यही सही है", "This is right");
export const linkChange = /* @__PURE__ */ t("बदलें", "Change");
export const linkNothingToDo = /* @__PURE__ */ t("सब भर चुका है। धन्यवाद।", "All done. Thank you.");
export const linkClosed = /* @__PURE__ */ t("यह लिंक अब नहीं खुलता।", "This link no longer opens.");
export const linkYourRequests = /* @__PURE__ */ t("आपके लिए", "For you");
export const linkNoRequests = /* @__PURE__ */ t("अभी कुछ भरना बाकी नहीं है।", "Nothing to fill in right now.");
export const linkTooMany = /* @__PURE__ */ t(
    "बहुत बार खोला गया — थोड़ी देर बाद फिर कोशिश कीजिए।",
    "Too many attempts. Please wait a minute and try again.",
  );
export const linkRollEmpty = /* @__PURE__ */ t(
    "इस कक्षा में कोई बच्चा नहीं है।",
    "Nobody is on this class's roll.",
  );

  /* --------------------------------------------------- assessments */
export const navAssessments = /* @__PURE__ */ t("परीक्षा", "Exams");
export const assessmentsTitle = /* @__PURE__ */ t("परीक्षाएँ", "Exams");
export const assessmentsIntro = /* @__PURE__ */ t(
    "हर परीक्षा के लिए कक्षा, विषय और पूर्णांक तय कीजिए।",
    "Each exam needs its classes, its subjects and what each paper is out of.",
  );
export const assessmentsNone = /* @__PURE__ */ t("अभी कोई परीक्षा नहीं है।", "No exams yet.");
export const assessmentNew = /* @__PURE__ */ t("नई परीक्षा", "Add an exam");
export const assessmentTerm = /* @__PURE__ */ t("सत्र", "Term");
export const assessmentCode = /* @__PURE__ */ t("संक्षिप्त कोड", "Short code");
export const assessmentKind = /* @__PURE__ */ t("प्रकार", "Kind");
export const assessmentWeight = /* @__PURE__ */ t("भार", "Weight");
export const assessmentWeightHint = /* @__PURE__ */ t(
    "प्रगति पत्र में यह परीक्षा कितनी गिनी जाएगी।",
    "How much this exam counts towards the term.",
  );
export const assessmentStarts = /* @__PURE__ */ t("कब से", "From");
export const assessmentEnds = /* @__PURE__ */ t("कब तक", "To");
export const assessmentOpen = /* @__PURE__ */ t("अंक भरना शुरू करें", "Open for marks");
export const assessmentLock = /* @__PURE__ */ t("बंद करें", "Lock");
export const assessmentUnlock = /* @__PURE__ */ t("फिर खोलें", "Unlock");
export const assessmentLockHint = /* @__PURE__ */ t(
    "बंद परीक्षा में अंक नहीं बदले जा सकते।",
    "No marks can be entered or changed while an exam is locked.",
  );
export const assessmentDelete = /* @__PURE__ */ t("मसौदा हटाएँ", "Delete this draft");

  /* ------------------------------------------------------- papers */
export const papersTitle = /* @__PURE__ */ t("पेपर", "Papers");
export const papersNone = /* @__PURE__ */ t(
    "अभी कोई पेपर नहीं जोड़ा गया।",
    "No papers yet. A paper is one class, one subject and a total.",
  );
export const paperAdd = /* @__PURE__ */ t("पेपर जोड़ें", "Add a paper");
export const paperMax = /* @__PURE__ */ t("पूर्णांक", "Out of");
export const paperPass = /* @__PURE__ */ t("उत्तीर्ण अंक", "Pass mark");
export const paperSubject = /* @__PURE__ */ t("विषय", "Subject");

  /* -------------------------------------------------------- marks */
export const marksTitle = /* @__PURE__ */ t("अंक", "Marks");
export const marksGrid = /* @__PURE__ */ t("अंक भरें", "Enter marks");
export const marksNone = /* @__PURE__ */ t("भरने को कुछ नहीं है।", "Nothing to enter.");
export const marksAbsent = /* @__PURE__ */ t("अनुपस्थित", "Absent");
export const marksNotEntered = /* @__PURE__ */ t("नहीं भरा", "Not entered");
export const marksEntered = /* @__PURE__ */ t("भरे गए", "entered");
export const marksSaveRow = /* @__PURE__ */ t("मसौदा सहेजें", "Save draft");
export const marksSaved = /* @__PURE__ */ t("सहेज लिया", "Saved");
export const marksLocked = /* @__PURE__ */ t(
    "यह परीक्षा बंद है।",
    "This exam is locked, so marks cannot be changed.",
  );
export const marksChangeLog = /* @__PURE__ */ t("बदलाव का लेखा", "Change log");
export const marksChangeNone = /* @__PURE__ */ t("अभी कोई बदलाव नहीं हुआ।", "Nothing has been changed yet.");
export const marksChangeReason = /* @__PURE__ */ t("कारण", "Why");
export const marksChangeReasonHint = /* @__PURE__ */ t(
    "पहले से भरे अंक बदल रहे हैं तो कारण लिखिए।",
    "Changing a mark somebody has already seen? Say why.",
  );
export const marksWhoIsLeft = /* @__PURE__ */ t("किनके अंक बाकी हैं", "Still to enter");
export const marksAllIn = /* @__PURE__ */ t("सब अंक भर चुके हैं।", "Every mark is in.");

  // P7: drafted, then submitted, then corrected only with a reason.
export const marksExempt = /* @__PURE__ */ t("छूट", "Exempt");
export const marksSubmit = /* @__PURE__ */ t("अंक जमा करें", "Submit marks");
export const marksSubmitCheck = /* @__PURE__ */ t("जमा करने से पहले देख लें", "Check before submitting");
export const marksSubmitMeans = /* @__PURE__ */ t(
    "जमा करने का अर्थ है कि आपने अंक भर दिए। इससे परिणाम स्वीकृत या रिपोर्ट जारी नहीं होती।",
    "Submitting says you have finished entering. It does not approve a result or issue a report.",
  );
export const marksSubmitConfirm = /* @__PURE__ */ t("हाँ, जमा करें", "Yes, submit");
export const marksBack = /* @__PURE__ */ t("अंकों पर लौटें", "Back to the marks");
export const marksStillBlank = /* @__PURE__ */ t("अभी खाली", "Still blank");
export const marksBlankNeverZero = /* @__PURE__ */ t("खाली को शून्य नहीं माना जाता।", "A blank is never counted as zero.");
export const marksDraftStatus = /* @__PURE__ */ t("मसौदा — अभी जमा नहीं", "Draft — not submitted yet");
export const marksSubmittedStatus = /* @__PURE__ */ t("जमा", "Submitted");
export const marksCorrect = /* @__PURE__ */ t("जमा अंक सुधारें", "Correct submitted marks");
export const marksCorrecting = /* @__PURE__ */ t(
    "आप जमा पेपर के अंक बदल रहे हैं। हर बदलाव कारण के साथ लेखे में रहेगा।",
    "You are changing a submitted paper. Every change is kept in the log with your reason.",
  );
export const marksCorrectReason = /* @__PURE__ */ t("बदलाव क्यों? (ज़रूरी)", "Why? (required)");
export const marksSaveCorrection = /* @__PURE__ */ t("सुधार सहेजें", "Save the correction");
export const marksLeaveAsIs = /* @__PURE__ */ t("जैसे हैं वैसे छोड़ें", "Leave them as they are");
export const marksReopen = /* @__PURE__ */ t("अध्यापक के लिए फिर खोलें", "Reopen for the teacher");
export const marksChecking = /* @__PURE__ */ t("जाँच रहे हैं कि अंक सहेजे गए या नहीं…", "Checking whether your save completed…");
export const marksNotSavedRetry = /* @__PURE__ */ t(
    "सहेजे नहीं गए। फिर से कोशिश करें — दो बार नहीं सहेजे जाएँगे।",
    "Not saved. Try again — it will not be saved twice.",
  );
  // The leave sheet keeps one id per request across its retries, so sending
  // again after a lost answer files it once.
export const leaveNotSentRetry = /* @__PURE__ */ t(
    "नहीं भेजा गया। फिर से भेजें — यह दो बार नहीं जाएगा।",
    "Not sent. Send again — it will not be sent twice.",
  );
export const marksReload = /* @__PURE__ */ t("पेज फिर से खोलें", "Reload the page");
export const marksNotYourSubject = /* @__PURE__ */ t(
    "इस कक्षा में यह विषय आपका नहीं है — अंक इसके विषय-अध्यापक भरेंगे।",
    "This subject is not yours in this class — its subject teacher enters these marks.",
  );
export const paperMarkStep = /* @__PURE__ */ t("अंक किस हिस्से तक", "Marks go to");
export const paperMarkStepWhole = /* @__PURE__ */ t("पूरे अंक", "Whole marks");
export const paperMarkStepHalf = /* @__PURE__ */ t("आधे अंक", "Halves");
export const paperMarkStepQuarter = /* @__PURE__ */ t("चौथाई अंक", "Quarters");
export const paperAllowExempt = /* @__PURE__ */ t("छूट दी जा सकती है", "A child may be exempt");
export const paperSchemeInUse = /* @__PURE__ */ t(
    "इस पेपर के अंक भरे जा रहे हैं — पूर्णांक, अंक का हिस्सा या छूट अब नहीं बदल सकते।",
    "Marks are being entered on this paper — its maximum, step and exemption cannot change now.",
  );
export const paperSubmitted = /* @__PURE__ */ t("जमा", "Submitted");
export const paperDraft = /* @__PURE__ */ t("मसौदा", "Draft");

  // P8: a card is issued once, from an approved scheme; a reissue keeps the old one.

  /* ----------------------------------------------------- progress */
export const progressTitle = /* @__PURE__ */ t("प्रगति", "Progress");
export const progressPerPaper = /* @__PURE__ */ t("पेपर के हिसाब से", "By paper");
export const progressPerStudent = /* @__PURE__ */ t("बच्चे के हिसाब से", "By child");
export const progressTotal = /* @__PURE__ */ t("कुल", "Total");
export const progressPercent = /* @__PURE__ */ t("प्रतिशत", "Percent");
export const progressGrade = /* @__PURE__ */ t("श्रेणी", "Grade");
export const progressMissing = /* @__PURE__ */ t("अंक बाकी", "papers unmarked");
export const progressNoMarks = /* @__PURE__ */ t("अभी कोई अंक नहीं है।", "No marks yet.");

  /* -------------------------------------------------- report cards */
export const reportTitle = /* @__PURE__ */ t("प्रगति पत्र", "Report card");
export const reportNone = /* @__PURE__ */ t("इस सत्र का कोई प्रगति पत्र नहीं है।", "No report card for this term.");
export const reportIssue = /* @__PURE__ */ t("जारी करें", "Issue this card");
export const reportReissue = /* @__PURE__ */ t("फिर जारी करें", "Issue it again");
export const reportIssued = /* @__PURE__ */ t("जारी हो गया", "Issued");
export const reportIssuedOn = /* @__PURE__ */ t("जारी", "Issued");
export const reportPreview = /* @__PURE__ */ t("पूर्वावलोकन", "Preview");
export const reportPreviewHint = /* @__PURE__ */ t(
    "यह आज के अंकों से बना है। जारी करने पर यही रुक जाएगा।",
    "Built from today's marks. Issuing it freezes exactly this.",
  );
export const reportFrozenHint = /* @__PURE__ */ t(
    "जारी किया गया पत्र वैसा ही रहता है, बाद में अंक बदलें तब भी।",
    "An issued card stays as it was, even if a mark changes later.",
  );
export const reportGradeDefault = /* @__PURE__ */ t(
    "श्रेणी की सीमाएँ अभी मानक हैं — विद्यालय से पुष्टि करनी है।",
    "The grade bands are a common default and still need confirming with the school.",
  );
export const reportAttendance = /* @__PURE__ */ t("उपस्थिति", "Attendance");
export const reportSubject = /* @__PURE__ */ t("विषय", "Subject");
export const reportOutOf = /* @__PURE__ */ t("पूर्णांक", "Out of");
  // Shown only when the exams in this term do not count equally — otherwise
  // the percentage is exactly the two numbers beside it divided, and saying so
  // would invite a question nobody had.
export const reportWeighted = /* @__PURE__ */ t(
    "प्रतिशत परीक्षाओं के भार के अनुसार निकाला गया है, इसलिए यह कुल के सीधे भाग से अलग है।",
    "The percentage is weighted by what each exam counts for, so it is not the total divided straight.",
  );

  /* -------------------------------------------------------- exports */
export const exportsTitle = /* @__PURE__ */ t("निर्यात", "Exports");
export const exportsIntro = /* @__PURE__ */ t(
    "जो भी निर्यात होता है उसका लेखा रखा जाता है।",
    "Everything taken out of here is logged: who took what, and when.",
  );
export const exportMarks = /* @__PURE__ */ t("अंक निर्यात करें", "Export marks");
export const exportNone = /* @__PURE__ */ t("अभी कुछ निर्यात नहीं हुआ।", "Nothing has been exported yet.");
export const exportRows = /* @__PURE__ */ t("पंक्तियाँ", "rows");
export const exportTakenBy = /* @__PURE__ */ t("किसने लिया", "Taken by");

  /* ----------------------------------------------------------- jobs */
export const jobsTitle = /* @__PURE__ */ t("अपने आप चलने वाले काम", "Scheduled jobs");
export const jobsIntro = /* @__PURE__ */ t(
    "कुछ काम हर दिन अपने आप होते हैं। यहाँ दिखता है कि आख़िरी बार कब और क्या हुआ।",
    "Some work happens on its own every day. This is when it last ran, and what it did.",
  );
export const jobsRunNow = /* @__PURE__ */ t("अभी चलाएँ", "Run now");
export const jobsRunning = /* @__PURE__ */ t("चल रहा है…", "Running…");
export const jobsNeverRun = /* @__PURE__ */ t("अभी तक नहीं चला।", "This has not run yet.");
export const jobsLastRun = /* @__PURE__ */ t("आख़िरी बार", "Last run");
export const jobsHistory = /* @__PURE__ */ t("पिछले कुछ रन", "Recent runs");
export const jobsNoHistory = /* @__PURE__ */ t("अभी कोई रन नहीं हुआ।", "Nothing has run yet.");
export const jobsSchedule = /* @__PURE__ */ t("समय", "Runs");
export const jobsTookMs = /* @__PURE__ */ t("लगा", "took");
export const jobsManual = /* @__PURE__ */ t("हाथ से चलाया", "Run by hand");
export const jobsScheduled = /* @__PURE__ */ t("अपने आप चला", "Ran on schedule");
export const jobsStale = /* @__PURE__ */ t(
    "यह रन बीच में ही रुक गया लगता है।",
    "This run seems to have stopped part-way.",
  );
export const jobsBusy = /* @__PURE__ */ t(
    "यह काम अभी पहले से चल रहा है।",
    "That job is already running.",
  );
export const jobsDone = /* @__PURE__ */ t("हो गया।", "Done.");
export const jobsFailed = /* @__PURE__ */ t("नहीं हो सका।", "That did not work.");
  // Said when a job is asked for a second time on a day it has already done.
  // Not a refusal: pressing the button again forces it, and this is what the
  // schedule itself gets when a cron fires twice.
export const jobsAlreadyToday = /* @__PURE__ */ t(
    "यह आज पहले ही हो चुका है — फिर भी चलाना हो तो दोबारा दबाइए।",
    "This already ran today. Press again if you want it to run anyway.",
  );
export const jobsForceRun = /* @__PURE__ */ t("फिर भी चलाएँ", "Run it anyway");

export const timetableClashFound = /* @__PURE__ */ t(
    "एक ही समय पर दो जगह।",
    "The same teacher is expected in two different lessons at once.",
  );
export const noSessionFound = /* @__PURE__ */ t(
    "कोई सत्र नहीं मिला।",
    "No academic session was found in the fee app's classes.",
  );

  /* ------------------------------------------------- the other two apps */
  //
  // Names first, purpose second (PLAN §3a): "SamPark" and "School Fees" are
  // what the staff already call them, and the half after the dash is what
  // tells somebody which one their task is in.
export const navApps = /* @__PURE__ */ t("ऐप", "Apps");
export const appsTitle = /* @__PURE__ */ t("स्कूल के ऐप", "The school's apps");
export const appsIntro = /* @__PURE__ */ t(
    "फ़ीस और विद्यार्थी जानकारी अपने-अपने ऐप में ही रहती है। यहाँ से सीधे खुल जाएगा।",
    "Fees and student information stay in their own apps. These open them directly.",
  );
export const appSampark = /* @__PURE__ */ t("सम्पर्क — विद्यार्थी जानकारी", "SamPark — Student information");
export const appSamparkPurpose = /* @__PURE__ */ t(
    "अभिभावक के नंबर, पते और दस्तावेज़ इकट्ठा करना।",
    "Collecting parents' numbers, addresses and documents.",
  );
export const appSchoolFees = /* @__PURE__ */ t("स्कूल फ़ीस — भुगतान और बकाया", "School Fees — Payments and dues");
  // Deliberately says "the separate deployment" now. Since the port, this app
  // has a fee desk of its own — and the two are not the same data: the desk
  // in here is on schoolfees-dev, this link is on the live one. Two doors
  // labelled "taking payments" with the school's real money behind one of
  // them is the ambiguity worth spending a sentence on.
export const appSchoolFeesPurpose = /* @__PURE__ */ t(
    "पुराना फ़ीस ऐप — असली डेटा। इस ऐप का शुल्क डेस्क अलग है।",
    "The separate School Fees deployment, on live data. The fee desk inside this app is not the same database.",
  );
export const appOpenApp = /* @__PURE__ */ t("ऐप खोलें", "Open the app");
export const appExternal = /* @__PURE__ */ t("अलग ऐप", "A separate app");
export const appSignInAgain = /* @__PURE__ */ t(
    "यह अलग ऐप है — वहाँ अपने उसी ऐप के खाते से साइन इन करना पड़ सकता है।",
    "This is a separate app. You may need to sign in there with that app's own account.",
  );
export const appLiveData = /* @__PURE__ */ t("असली डेटा", "Live data");
export const appTestData = /* @__PURE__ */ t("टेस्ट डेटा", "Test data");
export const appOpensLiveData = /* @__PURE__ */ t(
    "यह असली स्कूल डेटा खोलता है, टेस्ट डेटा नहीं।",
    "This opens the school's live data, not test data.",
  );
export const appOpensTestData = /* @__PURE__ */ t(
    "यह टेस्ट डेटा खोलता है।",
    "This opens test data.",
  );
export const appOpenThisChild = /* @__PURE__ */ t("इस बच्चे को खोलें", "Open this child");
export const appFindThisChild = /* @__PURE__ */ t("इस बच्चे को खोजें", "Find this child");
  // The desktop sidebar's three groups, in the order a day runs.
  // A title or a reason somebody typed, shown to a reader whose language it
  // was not written in. Short, because it sits beside the text itself.
  // The teacher hero. The same two words every morning, so it is recognised
  // rather than read.
export const teachFirstThingsFirst = /* @__PURE__ */ t("सबसे पहले", "First things first");
export const teachTakeRegisterNow = /* @__PURE__ */ t("हाज़िरी ले लीजिए", "Take the register");
  // A subject taught to several classes at once is one lesson in one room,
  // not one row per class (B-20).
export const teachCombinedLesson = /* @__PURE__ */ t("एक साथ", "Combined");
  /* --------------------------------------------- the role home queues */
  //
  // PLAN section 3 asks for "exceptions with counts and owners". The owner is
  // the load-bearing half: a number with no name beside it is somebody else
  // problem to everybody who reads it.
  /* ------------------------------------------------- student directory */
export const recordsSourceHint = /* @__PURE__ */ t(
    "हर जानकारी के साथ लिखा है कि वह कहाँ से आई।",
    "Each value says where it came from.",
  );
  /* ------------------------------------------------- who a round asks */
export const audienceClass = /* @__PURE__ */ t("कक्षा", "Class");
export const audienceHouse = /* @__PURE__ */ t("सदन", "House");
export const audienceRoute = /* @__PURE__ */ t("बस मार्ग", "Bus route");
export const audienceList = /* @__PURE__ */ t("चुनी हुई सूची", "A chosen list");
  // One link over every group in the round, held by the office.
export const audienceMaster = /* @__PURE__ */ t("सभी कक्षाएँ", "All classes");

  /* ------------------------------------------------------ rounds (R3.2) */

export const roundsTitle = /* @__PURE__ */ t("राउंड", "Rounds");
export const roundsHint = /* @__PURE__ */ t(
    "एक सवाल, कई कक्षाओं से। पहले देखिए किसके पास जाएगा, फिर बनाइए।",
    "One question, asked of many classes. See who it reaches before you make it.",
  );
export const roundsNone = /* @__PURE__ */ t("अभी कोई राउंड नहीं है।", "No rounds yet.");
export const roundNew = /* @__PURE__ */ t("नया राउंड", "New round");
export const roundCreate = /* @__PURE__ */ t("राउंड बनाएँ", "Create the round");
export const roundCreated = /* @__PURE__ */ t("राउंड बन गया।", "The round is saved.");

export const roundWho = /* @__PURE__ */ t("किनसे पूछना है", "Who to ask about");
export const roundWhat = /* @__PURE__ */ t("क्या पूछना है", "What to ask for");
export const roundWhen = /* @__PURE__ */ t("कब तक", "By when");
export const roundWhy = /* @__PURE__ */ t("क्यों", "Why");

export const roundClasses = /* @__PURE__ */ t("कक्षाएँ", "Classes");
export const roundAllClasses = /* @__PURE__ */ t("सभी कक्षाएँ", "Every class");
export const roundGaps = /* @__PURE__ */ t("सिर्फ़ जिनकी जानकारी बाकी है", "Only the children we are missing this for");
export const roundGapsHint = /* @__PURE__ */ t(
    "एक से ज़्यादा चुनने पर सिर्फ़ वे बच्चे आएँगे जिनकी सभी चुनी हुई जानकारी बाकी है।",
    "Choosing more than one selects only the children missing all of them.",
  );

export const roundPreview = /* @__PURE__ */ t("अभी देखिए", "See who this reaches");
export const roundPreviewUpdate = /* @__PURE__ */ t("गिनती दोबारा देखें", "Update the count");
  // Singular and plural, because both languages inflect and Hindi is the one
  // that gets forgotten: "1 कक्षाओं में" reads as broken to every Hindi
  // speaker in the school and is invisible to anybody reviewing in English.
export const roundCoversOne = /* @__PURE__ */ t("बच्चा", "child");
export const roundCoversMany = /* @__PURE__ */ t("बच्चे", "children");
export const roundAcrossOne = /* @__PURE__ */ t("कक्षा में", "class");
export const roundAcrossMany = /* @__PURE__ */ t("कक्षाओं में", "classes");
export const roundNobody = /* @__PURE__ */ t(
    "इस चुनाव में कोई बच्चा नहीं आता। कुछ और चुनकर देखिए।",
    "Nothing is selected yet. Choose a class, a house or a filter.",
  );
export const roundNobodyMatched = /* @__PURE__ */ t(
    "इस चुनाव में कोई बच्चा नहीं मिला।",
    "No child matches this selection.",
  );
export const roundNarrowedFrom = /* @__PURE__ */ t("में से", "narrowed from");

export const roundReasonNeeded = /* @__PURE__ */ t(
    "पूरी कक्षा नहीं जा रही, इसलिए कारण लिखना ज़रूरी है — शिक्षक को अधूरी सूची अपने आप समझ नहीं आएगी।",
    "This is not a whole class, so it needs a reason — an unexplained short list reads to a teacher as a broken one.",
  );
export const roundReasonSuggested = /* @__PURE__ */ t("सुझाया गया कारण", "Suggested reason");

export const roundUnknownGap = /* @__PURE__ */ t(
    "एक फ़िल्टर ऐसी जानकारी का था जो अब सूची में नहीं है। उसे छोड़ दिया गया।",
    "One filter named something no longer on the list. It was left out.",
  );

export const roundNoLinksYet = /* @__PURE__ */ t(
    "अभी कोई लिंक नहीं बना। लिंक भेजना अगला काम है।",
    "No links yet. Handing them to teachers is the next task.",
  );

  /* ------------------------------------------------------ the ask list */

export const askListTitle = /* @__PURE__ */ t("सूची चढ़ाइए", "Upload a list");
export const askListHint = /* @__PURE__ */ t(
    "जब कोई फ़िल्टर उन बच्चों को नहीं ढूँढ़ सकता जिनके बारे में पूछना है — उनका SR नंबर सूची में लिखिए।",
    "For when no filter can find the children you mean — write their SR numbers in a sheet.",
  );
export const askListTemplate = /* @__PURE__ */ t("नमूना फ़ाइल", "Download the template");
export const askListChoose = /* @__PURE__ */ t("फ़ाइल चुनिए", "Choose the file");
export const askListCheck = /* @__PURE__ */ t("मिलान देखिए", "Check the list");
export const askListMatched = /* @__PURE__ */ t("मिल गए", "Matched");
export const askListUnmatched = /* @__PURE__ */ t("नहीं मिले", "Not matched");
export const askListAllMatched = /* @__PURE__ */ t("हर पंक्ति मिल गई।", "Every row matched.");
export const askListNoIdentityColumn = /* @__PURE__ */ t(
    "इस फ़ाइल में SR नंबर का कॉलम नहीं है, इसलिए किसी बच्चे को पहचाना नहीं जा सकता।",
    "This file has no SR number column, so no child in it can be identified.",
  );
export const askListEmpty = /* @__PURE__ */ t("फ़ाइल में कोई पंक्ति नहीं है।", "The file has no rows.");
export const askListRow = /* @__PURE__ */ t("पंक्ति", "Row");

  // Why one row could not be used. Pairs, not sentences built in the domain:
  // an English-only error list is exactly the half-translated feeling D-129
  // is about.
export const askListMissNoIdentifier = /* @__PURE__ */ t(
    "SR नंबर नहीं लिखा — सिर्फ़ नाम से बच्चा नहीं पहचाना जा सकता",
    "No SR number — a name alone cannot identify a child",
  );
export const askListMissNotFound = /* @__PURE__ */ t(
    "इस SR नंबर का कोई एक बच्चा नहीं मिला",
    "No one child has this SR number",
  );
export const askListMissNotEnrolled = /* @__PURE__ */ t(
    "यह बच्चा इस सत्र की हाज़िरी में नहीं है",
    "This child is not on this session's roll",
  );
export const askListMissAlreadyListed = /* @__PURE__ */ t(
    "यह बच्चा ऊपर की किसी पंक्ति में पहले से है",
    "This child is already on an earlier row",
  );

  /* ------------------------------------------------- the fan-out (R3.3) */

export const fanOutTitle = /* @__PURE__ */ t("लिंक बनाइए", "Make the links");
export const fanOutReady = /* @__PURE__ */ t("तैयार", "Ready");
export const fanOutBlocked = /* @__PURE__ */ t("रुके हुए", "Held up");
export const fanOutUnassigned = /* @__PURE__ */ t("किसी समूह में नहीं", "In no group");
  // **Not the same as "in no group".** Skipped is blocked *plus* unassigned:
  // a child in a class whose teacher is not recorded is very much in a group,
  // and calling them ungrouped sends the office looking in the wrong place.
export const fanOutSkipped = /* @__PURE__ */ t(
    "बच्चों तक कोई लिंक नहीं पहुँचेगा",
    "children no link would reach",
  );
export const fanOutCreate = /* @__PURE__ */ t("लिंक बनाएँ", "Make the links");
export const fanOutResume = /* @__PURE__ */ t("बाकी लिंक बनाएँ", "Make the rest");
export const fanOutMade = /* @__PURE__ */ t("लिंक बन गए।", "The links are made.");
export const fanOutNoneReady = /* @__PURE__ */ t(
    "अभी कोई समूह तैयार नहीं है। नीचे रुके हुए समूह देखिए।",
    "No group is ready yet. See what is held up below.",
  );
export const fanOutStopped = /* @__PURE__ */ t(
    "यहाँ आकर रुक गया। जो लिंक बन चुके हैं वे काम कर रहे हैं — बाकी दोबारा बनाइए।",
    "It stopped here. The links already made still work — make the rest again.",
  );
export const fanOutTooBig = /* @__PURE__ */ t(
    "इतने लिंक एक बार में नहीं बनाए जा सकते। पहले चुनाव छोटा कीजिए।",
    "That is too many links at once. Narrow the selection first.",
  );

  // Why a group cannot be sent as it stands. The office fixes these.
export const fanOutManyOwners = /* @__PURE__ */ t("एक से ज़्यादा शिक्षक दर्ज हैं", "More than one teacher is assigned");
export const fanOutNoOwner = /* @__PURE__ */ t("कोई शिक्षक दर्ज नहीं है", "No teacher is assigned");
export const fanOutNoPhone = /* @__PURE__ */ t("नंबर दर्ज नहीं है", "No number is saved");
export const fanOutNoHouse = /* @__PURE__ */ t("सदन दर्ज नहीं है", "No house on record");
export const fanOutNoRoute = /* @__PURE__ */ t("बस मार्ग दर्ज नहीं है", "No bus route on record");

  /* ------------------------------------------------------ the board */

export const boardTitle = /* @__PURE__ */ t("कहाँ तक पहुँचा", "Where it has got to");
export const boardLinks = /* @__PURE__ */ t("लिंक", "Links");
export const boardAnswered = /* @__PURE__ */ t("जवाब आए", "answered");
export const boardOpen = /* @__PURE__ */ t("लिंक चालू कीजिए", "Turn the links on");
export const boardOpened = /* @__PURE__ */ t("चालू", "Live");
export const boardSent = /* @__PURE__ */ t("भेजा गया", "Handed over");
export const boardMarkSent = /* @__PURE__ */ t("भेज दिया", "Mark as handed over");
export const boardRemind = /* @__PURE__ */ t("याद दिलाया", "Chased");
export const boardMarkReminded = /* @__PURE__ */ t("याद दिला दिया", "Mark as chased");
export const boardMaster = /* @__PURE__ */ t("दफ़्तर का अपना लिंक", "The office's own link");
export const boardCopy = /* @__PURE__ */ t("लिंक कॉपी कीजिए", "Copy the link");
export const boardNoLinks = /* @__PURE__ */ t("अभी कोई लिंक नहीं बना।", "No links yet.");

  /* ----------------------------------------------- reviewing a round (R3.4) */

  // **S-07.** Neither value is wrong, so this is not a warning — it is a
  // decision somebody has to take deliberately rather than by default.
export const reviewStale = /* @__PURE__ */ t("जवाब के बाद रिकॉर्ड बदला है", "The record changed after this answer");
export const reviewStaleNow = /* @__PURE__ */ t("अभी दर्ज है", "on record now");
export const reviewStaleShown = /* @__PURE__ */ t("शिक्षक को दिखाया गया था", "shown to the teacher");
export const reviewSuperseded = /* @__PURE__ */ t("नया जवाब आ चुका है", "A newer answer has arrived");
export const reviewSupersededHint = /* @__PURE__ */ t(
    "इसी बच्चे की इसी जानकारी का बाद का जवाब क़तार में है।",
    "A later answer for this child and this field is in the queue.",
  );

export const studentsTitle = /* @__PURE__ */ t("विद्यार्थी", "Students");
export const studentsHint = /* @__PURE__ */ t(
    "नाम, एसआर नंबर या फ़ोन नंबर से खोजिए।",
    "Search by name, SR number or phone number.",
  );
export const studentsSearchLabel = /* @__PURE__ */ t("विद्यार्थी खोजें", "Search students");
export const studentsSearchHint = /* @__PURE__ */ t("नाम, एसआर या फ़ोन", "Name, SR or phone");
export const studentsAllClasses = /* @__PURE__ */ t("सभी कक्षाएँ", "All classes");
export const studentsClear = /* @__PURE__ */ t("हटाएँ", "Clear");
export const studentsNone = /* @__PURE__ */ t("कोई नहीं", "Nobody");
  // Two different nothings: nobody matched what was typed, and there is
  // nobody on the roll at all. Only one of them is about the search box.
export const studentsNoMatch = /* @__PURE__ */ t("इस खोज से कोई नहीं मिला।", "Nobody matched that search.");
export const studentsTryAgain = /* @__PURE__ */ t(
    "नाम का कुछ हिस्सा, पूरा एसआर नंबर, या दस अंकों का फ़ोन नंबर आज़माइए।",
    "Try part of a name, a whole SR number, or a ten-digit phone number.",
  );
export const studentsEmpty = /* @__PURE__ */ t(
    "इस सत्र में अभी कोई विद्यार्थी दर्ज नहीं है।",
    "No students are on the roll for this session yet.",
  );
export const studentsPages = /* @__PURE__ */ t("पन्ने", "Pages");
export const studentsPrevious = /* @__PURE__ */ t("पिछला", "Previous");
export const studentsNext = /* @__PURE__ */ t("अगला", "Next");
export const studentsSourceNote = /* @__PURE__ */ t(
    "नाम और एसआर नंबर स्कूल फ़ीस ऐप के हैं। यहाँ स्वीकार किए गए सुधार बच्चे के पन्ने पर अलग दिखते हैं।",
    "Names and SR numbers come from the School Fees app. Corrections approved here are shown separately on the child’s own page.",
  );

export const homeNeedsAttention = /* @__PURE__ */ t("ध्यान चाहिए", "Needs attention");
export const homeNeedsAttentionHint = /* @__PURE__ */ t(
    "एक फ़ैसला कीजिए, फिर अपने काम पर लौटिए।",
    "Make a decision, then get back to your day.",
  );
export const homeAllClear = /* @__PURE__ */ t(
    "अभी कुछ बाकी नहीं है।",
    "Nothing is waiting for anyone right now.",
  );
export const homeOwner = /* @__PURE__ */ t("किसका काम", "Whose");
export const homeToday = /* @__PURE__ */ t("आज", "Today");
export const homeRegistersOutstanding = /* @__PURE__ */ t("हाज़िरी बाकी", "Registers not in");
export const homeStaffAway = /* @__PURE__ */ t("आज अनुपस्थित स्टाफ़", "Staff away");
export const homeChangesToReview = /* @__PURE__ */ t("जाँचने को बदलाव", "Changes to review");
export const homeJobsFailed = /* @__PURE__ */ t("नहीं चले काम", "Jobs that failed");
export const homeSchoolClosedToday = /* @__PURE__ */ t("आज विद्यालय बंद है", "School is closed today");
export const homeOwnerTeachers = /* @__PURE__ */ t("अध्यापक", "Teachers");
export const homeOwnerOffice = /* @__PURE__ */ t("कार्यालय", "Office");
export const homeOwnerCoordinator = /* @__PURE__ */ t("शैक्षणिक संयोजक", "Academic coordinator");
export const homeOwnerAdmin = /* @__PURE__ */ t("प्रशासक", "Admin");
export const homeSchoolToday = /* @__PURE__ */ t("आज स्कूल में", "The school today");
export const homeChildrenOnRoll = /* @__PURE__ */ t("रजिस्टर पर बच्चे", "Children on the roll");
export const homeClasses = /* @__PURE__ */ t("कक्षाएँ", "Classes");
export const homeRegistersIn = /* @__PURE__ */ t("हाज़िरी आ चुकी", "Registers in");
export const homeUnavailable = /* @__PURE__ */ t(
    "यह गिनती अभी नहीं पढ़ी जा सकी।",
    "This count could not be read just now.",
  );
export const preferencesTitle = /* @__PURE__ */ t("आपकी सेटिंग", "Your settings");
export const preferencesLanguageHint = /* @__PURE__ */ t(
    "आप ऐप किस भाषा में पढ़ना चाहते हैं। कभी भी बदल सकते हैं।",
    "Which language you read the app in. You can change it whenever you like.",
  );
export const authoredInEnglish = /* @__PURE__ */ t("अंग्रेज़ी में", "in English");
export const authoredInHindi = /* @__PURE__ */ t("हिन्दी में", "in Hindi");
export const authoredTitleHint = /* @__PURE__ */ t(
    "एक ही भाषा काफ़ी है। दूसरी भाषा चाहें तो नीचे भर दें।",
    "One language is enough. Add the other only if you want to.",
  );
export const authoredOptional = /* @__PURE__ */ t("वैकल्पिक", "Optional");

export const navGroupToday = /* @__PURE__ */ t("आज का काम", "Today's work");
export const navGroupRecords = /* @__PURE__ */ t("रिकॉर्ड", "Records");
export const navGroupSetup = /* @__PURE__ */ t("व्यवस्था", "Setup");
export const navGroupMoney = /* @__PURE__ */ t("शुल्क डेस्क", "Fee desk");
export const navFees = /* @__PURE__ */ t("फ़ीस", "Fees");
export const schoolWelcome = /* @__PURE__ */ t("आपके स्कूल का कार्यक्षेत्र", "Your school workspace");
export const schoolLocation = /* @__PURE__ */ t("अमेट, राजस्थान", "Amet, Rajasthan");
export const schoolWorkspaceHint = /* @__PURE__ */ t("स्कूल के सभी काम, एक ही जगह।", "Your school day, together in one place.");
export const schoolMorning = /* @__PURE__ */ t("सुप्रभात", "Good morning");
export const schoolAfternoon = /* @__PURE__ */ t("नमस्कार", "Good afternoon");
export const schoolEvening = /* @__PURE__ */ t("शुभ संध्या", "Good evening");
export const nativeWorkspaces = /* @__PURE__ */ t("आपके कार्यक्षेत्र", "Your workspaces");
export const nativeWorkspacesHint = /* @__PURE__ */ t("फ़ीस, जानकारी और समय-चक्र इसी कार्यक्षेत्र में खोलें।", "Open fees, collection and timetable here in VPPS One.");
export const nativeStudentFees = /* @__PURE__ */ t("इस बच्चे की फ़ीस खोलें", "Open this student's fees");
export const nativeCollection = /* @__PURE__ */ t("जानकारी का कार्यक्षेत्र खोलें", "Open Collection");
export const navPaymentDesk = /* @__PURE__ */ t("भुगतान", "Payment Desk");
export const navTransactions = /* @__PURE__ */ t("लेन-देन", "Transactions");
export const navDefaulters = /* @__PURE__ */ t("बकाया", "Defaulters");
export const navFeeStudents = /* @__PURE__ */ t("शुल्क — बच्चे", "Students (fees)");
export const navReminders = /* @__PURE__ */ t("स्मरण", "Reminders");
export const navFeeSetup = /* @__PURE__ */ t("शुल्क व्यवस्था", "Fee Setup");
export const navFeeExports = /* @__PURE__ */ t("शुल्क निर्यात", "Fee exports");
export const navFeeAdminTools = /* @__PURE__ */ t("शुल्क उपकरण", "Fee admin tools");

export const appSearchInstead = /* @__PURE__ */ t(
    "यहाँ का पहचान-नंबर वहाँ नहीं चलता, इसलिए खोज खुलेगी।",
    "An id from here does not exist there, so this opens the search screen instead.",
  );

  /* ------------------------------------------------- where you start (D2) */
export const startTitle = /* @__PURE__ */ t("आप कहाँ से शुरू करें", "Where you start");
export const startHint = /* @__PURE__ */ t(
    "साइन इन करने पर यही स्क्रीन खुलेगी। किसी लिंक से आए हैं तो वही लिंक खुलेगा।",
    "This is the screen that opens when you sign in. A link you followed still opens that link instead.",
  );
export const startRoleHome = /* @__PURE__ */ t("आपका सामान्य मुख्य पेज", "Your usual Home");
export const startRoleHomeHint = /* @__PURE__ */ t(
    "आपके काम के लिए जो तय है — यही अभी चल रहा है।",
    "Whatever your role opens on. This is what happens today.",
  );
export const startStaysInThisApp = /* @__PURE__ */ t("इसी ऐप में", "Stays in VPPS One");
export const startOpensAnotherApp = /* @__PURE__ */ t("दूसरा ऐप खुलेगा", "Opens the other app");
export const startLeavesAppWarning = /* @__PURE__ */ t(
    "दूसरा ऐप चुनने पर साइन इन के बाद सीधा वही खुलेगा। VPPS One पर लौटने के लिए इसका पता फिर खोलें।",
    "Choose another app and signing in will open it straight away. To come back here, open this app's own address again.",
  );
export const startCurrent = /* @__PURE__ */ t("अभी चुना हुआ", "Your choice now");

  /* ---------------------------------------------- the teacher's day (D2) */
export const teachYourClass = /* @__PURE__ */ t("आपकी कक्षा", "Your class");
export const teachYourClasses = /* @__PURE__ */ t("आपकी कक्षाएँ", "Your classes");
export const teachNoClassOfYourOwn = /* @__PURE__ */ t(
    "आपके नाम कोई कक्षा नहीं है।",
    "No class is assigned to you.",
  );
export const teachFirstLesson = /* @__PURE__ */ t("पहला कालांश", "First lesson");
export const teachTodaysTimetable = /* @__PURE__ */ t("आज का समय-चक्र", "Today's timetable");
export const teachFullWeek = /* @__PURE__ */ t("पूरा सप्ताह", "Full week");

  /* ------------------------------------- the administrator's overview (D2) */
export const overviewTeachingNotAway = /* @__PURE__ */ t("अनुपस्थित दर्ज नहीं किए गए शिक्षक", "Teachers not marked away");
export const overviewTeachingBasis = /* @__PURE__ */ t("सक्रिय शिक्षक, दर्ज अनुपस्थितियों को छोड़कर; यह उपस्थिति पुष्टि नहीं है।", "Active teachers minus recorded absences; this is not confirmed attendance.");
export const overviewAllScreens = /* @__PURE__ */ t("सभी स्क्रीन", "All screens");
export const overviewOpenRegisters = /* @__PURE__ */ t("रजिस्टर खोलें", "Open registers");
export const overviewReviewChanges = /* @__PURE__ */ t("बदलाव देखें", "Review changes");
export const overviewOpenCover = /* @__PURE__ */ t("प्रतिस्थापन खोलें", "Open cover plan");
export const overviewOpenJobs = /* @__PURE__ */ t("कार्य स्थिति देखें", "Open job status");
export const overviewOpenLive = /* @__PURE__ */ t("लाइव कार्यस्थान खोलें", "Open live workspace");
export const overviewTitle = /* @__PURE__ */ t("स्कूल की स्थिति", "School overview");
export const overviewEyebrow = /* @__PURE__ */ t("स्कूल संचालन", "School operations");
export const overviewTodayAtSchool = /* @__PURE__ */ t("आज स्कूल में", "Today at school");
export const overviewAttendanceSubmitted = /* @__PURE__ */ t("हाज़िरी जमा", "Attendance submitted");
export const overviewStaffPresent = /* @__PURE__ */ t("स्टाफ़ उपस्थित", "Staff present");
export const overviewCoverArranged = /* @__PURE__ */ t("कालांश की व्यवस्था", "Cover arranged");
export const overviewCoverNoPlan = /* @__PURE__ */ t(
    "आज के लिए कोई प्रकाशित योजना नहीं है।",
    "No plan has been published for today.",
  );
export const overviewExamsOpen = /* @__PURE__ */ t("अंक भरे जा रहे हैं", "Exams open for marks");
export const overviewWorkspaces = /* @__PURE__ */ t("स्कूल के कार्यक्षेत्र", "School workspaces");
export const overviewWorkspacesHint = /* @__PURE__ */ t("सीधे सही डेस्क पर जाएँ", "Go straight to the right desk");
export const overviewOpen = /* @__PURE__ */ t("खोलें", "Open");
export const overviewRoundProgress = /* @__PURE__ */ t("जानकारी का चक्र", "Information round");
export const overviewRoundNone = /* @__PURE__ */ t(
    "अभी कोई चक्र खुला नहीं है।",
    "No round is open at the moment.",
  );
export const overviewAnsweredOf = /* @__PURE__ */ t("उत्तर आए", "answered");
export const overviewFeeSummary = /* @__PURE__ */ t("फ़ीस का हिसाब", "Fee collection");
  // The fee app is in this app now, so "the real numbers are in the School
  // Fees app" stopped being true — it sent staff out of a screen to a place
  // they were already standing in. The figures themselves are still not
  // read onto this panel (R6.2); the fee desk is where they live.
export const overviewFeeUnavailable = /* @__PURE__ */ t(
    "फ़ीस के आँकड़े इस पैनल पर अभी नहीं आते। पूरा हिसाब शुल्क डेस्क पर है।",
    "Fee figures are not read onto this panel yet. The full picture is on the fee desk.",
  );
export const overviewFeeDesk = /* @__PURE__ */ t("शुल्क डेस्क खोलें", "Open the fee desk");
export const overviewOfClasses = /* @__PURE__ */ t("कक्षाओं में से", "of classes");
export const overviewPeriods = /* @__PURE__ */ t("कालांश", "periods");

  /* --------------------------------------------- page eyebrows (D3) ----
     The small line above a page title, naming the part of the school the
     screen belongs to. One per area rather than one per route: the atlas uses
     them to group ("SAMPARK / REVIEW"), not to label. */
export const eyebrowSchoolOffice = /* @__PURE__ */ t("कार्यालय", "School office");
export const eyebrowMyClass = /* @__PURE__ */ t("मेरी कक्षा", "My class");
export const eyebrowSampark = /* @__PURE__ */ t("सम्पर्क", "SamPark");
export const eyebrowAcademics = /* @__PURE__ */ t("शैक्षणिक", "Academics");
export const eyebrowExams = /* @__PURE__ */ t("परीक्षा और रिपोर्ट", "Exams and reports");
export const eyebrowAdministration = /* @__PURE__ */ t("विद्यालय प्रशासन", "School administration");
export const eyebrowPersonal = /* @__PURE__ */ t("आपका खाता", "Your account");
export const eyebrowCover = /* @__PURE__ */ t("कक्षा व्यवस्था", "Class cover");
export const eyebrowFees = /* @__PURE__ */ t("शुल्क", "Fees");

  /* ------------------------------------------------- shared panels (D3) */
export const panelStudentDirectory = /* @__PURE__ */ t("बच्चों की सूची", "Student directory");
export const panelSearchNote = /* @__PURE__ */ t("खोज भरोसे की है", "A reliable search");
export const panelSearchNoteText = /* @__PURE__ */ t(
    "एसआर नंबर अक्षरों की तरह रखा जाता है, इसलिए आगे के शून्य नहीं मिटते। खोज के बाद भी कक्षा और सत्र वही रहते हैं।",
    "SR numbers are kept as text, so leading zeros are never lost. The class and session you chose stay chosen after a search.",
  );
export const panelStaffDirectory = /* @__PURE__ */ t("स्टाफ़ की सूची", "Staff directory");
export const panelStaffNote = /* @__PURE__ */ t("भूमिका और काम अलग-अलग हैं", "Role and assignment are separate");
export const panelStaffNoteText = /* @__PURE__ */ t(
    "कार्यालय की भूमिका अपने आप लेखाकार नहीं बनाती। फ़ीस ऐप की पहुँच और पढ़ाने का काम अलग-अलग तय होते हैं।",
    "An office role is not automatically an accountant. Fee-app access and teaching assignments are decided independently.",
  );
export const panelRegisterSummary = /* @__PURE__ */ t("हाज़िरी का हिसाब", "Register summary");
export const panelExceptionsFirst = /* @__PURE__ */ t("पहले अपवाद भरिए", "Mark the exceptions first");
export const panelExceptionsFirstText = /* @__PURE__ */ t(
    "सब उपस्थित दिखते हैं। केवल जो अनुपस्थित, आधा दिन, देर से या छुट्टी पर हैं उन्हें बदलिए, गिनती देखिए, फिर सहेजिए।",
    "Everyone starts as present. Change only the children who are absent, half day, late or on leave, check the counts, then save.",
  );
export const panelReviewQueue = /* @__PURE__ */ t("जाँच की कतार", "Review queue");
export const panelCurrentMatters = /* @__PURE__ */ t("अभी का रिकॉर्ड देखिए", "The current record matters");
export const panelCurrentMattersText = /* @__PURE__ */ t(
    "अगर किसी और ने यह रिकॉर्ड बदल दिया है, तो फ़ैसले से पहले नया मान फिर से मिला लीजिए।",
    "If somebody else has already changed this record, compare again before deciding.",
  );
export const panelOperational = /* @__PURE__ */ t("संचालन की व्यवस्था", "Operational settings");
export const panelOperationalHint = /* @__PURE__ */ t("सिर्फ़ प्रशासक को दिखता है", "Visible to administrators");
export const panelPreviewEffect = /* @__PURE__ */ t("असर पहले देखिए", "Preview the effect");
export const panelPreviewEffectText = /* @__PURE__ */ t(
    "स्कूल-भर के बदलाव से पहले देख लीजिए कि किन कक्षाओं और रिकॉर्ड पर असर पड़ेगा। रोज़ का काम सेटिंग से बाहर रखिए।",
    "Before a school-wide change, look at which classes and records it touches. Keep daily work out of the settings area.",
  );
export const panelAcademicSetup = /* @__PURE__ */ t("शैक्षणिक व्यवस्था", "Academic setup");
export const panelInformationSetup = /* @__PURE__ */ t("जानकारी जुटाने की व्यवस्था", "Information collection");
export const panelManage = /* @__PURE__ */ t("खोलें", "Manage");
export const panelViewStatus = /* @__PURE__ */ t("स्थिति देखें", "View status");

  /* ------------------------------------------- staff figures (D3) */
export const staffActiveCount = /* @__PURE__ */ t("सक्रिय स्टाफ़", "Active staff");
export const staffActiveHint = /* @__PURE__ */ t("अभी के स्कूल खाते", "Current school accounts");
export const staffClassesAssigned = /* @__PURE__ */ t("कक्षा-अध्यापक तय", "Classes assigned");
export const staffClassesAllHave = /* @__PURE__ */ t(
    "हर कक्षा का अध्यापक है",
    "Every class has a class teacher",
  );
export const staffClassesMissing = /* @__PURE__ */ t(
    "कुछ कक्षाओं का अध्यापक बाकी है",
    "Some classes still have nobody",
  );
export const staffCoordinators = /* @__PURE__ */ t("संयोजक", "Coordinators");
export const staffCoordinatorsHint = /* @__PURE__ */ t("शैक्षणिक और परीक्षा", "Academic and examinations");
export const staffAwaitingClass = /* @__PURE__ */ t("कक्षा का इंतज़ार", "Awaiting a class");
export const attendanceTodaysRegister = /* @__PURE__ */ t("आज की हाज़िरी", "Today's register");
export const staffAwaitingClassHint = /* @__PURE__ */ t(
    "पढ़ाने वाले जिन्हें कक्षा नहीं मिली",
    "Teaching staff with no class of their own",
  );
export const pwaTitle = /* @__PURE__ */ t("अपने फ़ोन या कंप्यूटर पर लगाएँ", "Install on your phone or computer");
export const pwaHint = /* @__PURE__ */ t("VPPS One को अपने ऐप की तरह खोलें। इंटरनेट जाने पर खुले फ़ॉर्म का मसौदा इस डिवाइस पर रहेगा।", "Open VPPS One as an app. Drafts on opened forms stay on this device when the connection drops.");
export const pwaInstalled = /* @__PURE__ */ t("यह ऐप पहले से लगा है।", "You are using the installed app.");
export const pwaIos = /* @__PURE__ */ t("Safari में शेयर खोलें → होम स्क्रीन पर जोड़ें → जोड़ें।", "In Safari, open Share → Add to Home Screen → Add.");
export const pwaManual = /* @__PURE__ */ t("Chrome या Edge के मेन्यू में ऐप इंस्टॉल करें चुनें। iPhone पर Safari से होम स्क्रीन पर जोड़ें।", "In Chrome or Edge, choose Install app from the browser menu. On iPhone, use Safari’s Add to Home Screen.");
export const pwaInstall = /* @__PURE__ */ t("VPPS One लगाएँ", "Install VPPS One");
export const pwaUpdate = /* @__PURE__ */ t("नया संस्करण तैयार है", "Update available");
export const pwaUpdateHint = /* @__PURE__ */ t("आपका मसौदा सुरक्षित करके ऐप फिर खुलेगा।", "Save your drafts and reopen with the new version.");
export const pwaFinishForm = /* @__PURE__ */ t("पहले खुला फ़ॉर्म पूरा या बंद करें। डिवाइस पर सेव न हो तो अभी अपडेट न करें।", "Finish or close the open form first. Resolve any draft storage error before updating.");
export const pwaReload = /* @__PURE__ */ t("अपडेट करके फिर खोलें", "Update and reopen");
export const draftFound = /* @__PURE__ */ t("इस फ़ोन में पहले लिखा हुआ रखा है। भेजने से पहले देख लें।", "Something you wrote earlier is kept on this phone. Look at it before sending.");
export const draftChanged = /* @__PURE__ */ t("स्कूल का रिकॉर्ड बदल चुका है। पिछला मसौदा लाकर मिलान करें।", "The school record has changed. Restore the draft to review the differences.");
export const draftRestore = /* @__PURE__ */ t("वापस लाएँ", "Bring it back");
export const draftDiscard = /* @__PURE__ */ t("मिटाएँ", "Throw it away");
export const draftStorageError = /* @__PURE__ */ t("इस डिवाइस पर सेव नहीं हुआ। ऐप बंद करने से पहले ऑनलाइन सेव करें।", "Could not save on this device. Save online before closing the app.");
export const draftWriting = /* @__PURE__ */ t("डिवाइस पर सेव हो रहा है…", "Saving on this device…");
export const draftSchool = /* @__PURE__ */ t("स्कूल में सेव हो गया", "Saved by school");
export const draftLocal = /* @__PURE__ */ t("इस डिवाइस पर सेव है · स्कूल में भेजना बाकी है", "Saved on this device · not yet saved by school");
export const draftWaiting = /* @__PURE__ */ t("इस डिवाइस पर सेव है · इंटरनेट का इंतज़ार", "Saved on this device · waiting for a connection");
export const draftOffline = /* @__PURE__ */ t("इंटरनेट नहीं है · खुला काम जारी रख सकते हैं", "Offline · you can continue working on this form");
export const draftReady = /* @__PURE__ */ t("बदलाव इस डिवाइस पर अपने-आप सेव होंगे", "Changes save automatically on this device");
export const directorySelect = /* @__PURE__ */ t("बाईं सूची में बच्चे का नाम चुनें", "Select a student from the list");
export const directoryOpen = /* @__PURE__ */ t("पूरा रिकॉर्ड खोलें", "Open full record");
export const overviewSummary = /* @__PURE__ */ t("आज का सार", "Today's overview");
