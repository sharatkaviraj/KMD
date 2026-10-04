import { t } from "@/platform/i18n/language";

/**
 * The set-up catalogue: pairs for screens a handful of staff open — the
 * report scheme, the parent message policy, the attendance rules, wrong
 * numbers. The same rule as `src/messages/index.ts` (rule 9: every string a
 * Hindi/English pair, rendered with `primary()`/`secondary()`), in its own
 * module so that a client component on one of these screens ships them and
 * nothing else does. Everything in `index.ts` is in every page's JavaScript;
 * this is not (D-229).
 */
export const ms = {
  attendanceRulesTitle: t("हाज़िरी के नियम", "Attendance rules"),
  attendanceRulesHalfDay: t("आधा दिन कितना गिना जाए", "How much a half day counts"),
  attendanceRulesHalfDayHint: t(
    "0 से 1 तक। 0.5 का अर्थ आधा दिन उपस्थित। हर रिपोर्ट और प्रतिशत यही नियम मानेगा।",
    "From 0 to 1. 0.5 counts a half day as half present. Every report and percentage uses this rule.",
  ),
  attendanceRulesSaved: t("नियम सहेजा गया", "Rule saved"),
  attendanceRulesRange: t("0 से 1 के बीच की संख्या लिखें", "Enter a number from 0 to 1"),
  reportReissued: t("नई रिपोर्ट जारी हुई — पिछली रखी गई है।", "Reissued — the earlier card is kept."),
  reportDraftWatermark: t("मसौदा — जारी नहीं", "DRAFT — not issued"),
  reportRevision: t("संशोधन", "Revision"),
  reportHistory: t("जारी रिपोर्टों का इतिहास", "Cards issued"),
  reportSuperseded: t("बदली गई", "Superseded"),
  reportCurrent: t("अभी की", "Current"),
  reportImported: t("संशोधन रखे जाने से पहले जारी", "Issued before revisions were kept"),
  reportReissueReason: t("दोबारा क्यों? (ज़रूरी)", "Why reissue? (required)"),
  reportNoScheme: t(
    "इस सत्र का रिपोर्ट नियम अभी स्वीकृत नहीं — यह झलक सामान्य श्रेणियों से बनी है।",
    "This term's report scheme is not approved yet — this preview uses the default bands.",
  ),
  reportAttendanceNotRecorded: t("दिन दर्ज नहीं", "days not recorded"),
  reportPassed: t("उत्तीर्ण", "Passed"),
  reportNotPassed: t("उत्तीर्ण नहीं", "Not passed"),
  reportSignature: t("हस्ताक्षर", "Signature"),
  reportSchemeLink: t("रिपोर्ट का नियम", "Report scheme"),
  schemeTitle: t("रिपोर्ट का नियम", "Report scheme"),
  schemeIntro: t(
    "इस सत्र की रिपोर्ट इन नियमों से बनेगी। स्वीकृत होने के बाद नियम नहीं बदलता — बदलाव नया संशोधन है।",
    "This term's cards are worked out by these rules. Once approved a scheme does not change — a change is a new revision.",
  ),
  schemeDefaultBands: t(
    "ये श्रेणियाँ सामान्य (CBSE जैसी) हैं — विद्यालय की अपनी श्रेणियाँ हों तो बदलें।",
    "These are the common CBSE-style bands — replace them with the school's own if it has them.",
  ),
  schemeBands: t("श्रेणियाँ (हर पंक्ति: आरंभ % अक्षर English | हिन्दी)", "Grade bands (each line: from %, label, English | Hindi)"),
  schemeDecimals: t("प्रतिशत कितने दशमलव तक (श्रेणी से पहले, आधा ऊपर)", "Percentage decimals (rounded half up, before grading)"),
  schemePass: t("उत्तीर्ण प्रतिशत (वैकल्पिक)", "Pass percentage (optional)"),
  schemeAttendanceFrom: t("उपस्थिति की अवधि — से", "Attendance period — from"),
  schemeAttendanceTo: t("उपस्थिति की अवधि — तक", "Attendance period — to"),
  schemeHeaderEn: t("शीर्षक (English)", "Header (English)"),
  schemeHeaderHi: t("शीर्षक (हिन्दी)", "Header (Hindi)"),
  schemeSignatories: t("हस्ताक्षर की पंक्तियाँ (English | हिन्दी)", "Signature lines (English | Hindi)"),
  schemeSaveDraft: t("मसौदा सहेजें", "Save draft"),
  schemeApprove: t("नियम स्वीकृत करें", "Approve the scheme"),
  schemeApproveMeans: t(
    "स्वीकृत करने पर नियम पक्का हो जाता है और रिपोर्ट इसी से जारी होंगी।",
    "Approving makes the scheme final; cards are issued from it.",
  ),
  schemeDraftSaved: t("मसौदा सहेजा गया", "Draft saved"),
  schemeApproved: t("नियम स्वीकृत हुआ", "Scheme approved"),
  schemeNoDraft: t("स्वीकृत करने को कोई मसौदा नहीं है", "There is no draft to approve"),
  schemeApprovedBy: t("स्वीकृत", "Approved"),
  schemeDraftStatus: t("मसौदा", "Draft"),
  schemeNone: t("अभी कोई नियम नहीं", "No scheme yet"),
  messagesApproveOpen: t("स्वीकृत करें और व्हाट्सएप खोलें", "Approve and open WhatsApp"),
  messagesStaleBadge: t("पुराना", "Out of date"),
  messagesApprovedOpen: t(
    "स्वीकृत। व्हाट्सएप खुला है — भेजने के बाद नीचे बताएँ।",
    "Approved. WhatsApp is open — after you press send there, say so here.",
  ),
  messagesOpenAgain: t("व्हाट्सएप फिर खोलें", "Open WhatsApp again"),
  messagesConfirmSent: t("मैंने भेज दिया", "I sent it"),
  messagesStale: t(
    "यह संदेश पुराना हो गया है — इसे स्वीकृत नहीं किया गया:",
    "This message is out of date — it was not approved:",
  ),
  messagesStaleHint: t(
    "इसे वापस लें और नई जानकारी से नया संदेश बनाएँ।",
    "Withdraw it and queue a fresh one from what is true now.",
  ),
  messagesSentRecorded: t("भेजा गया दर्ज हुआ।", "Recorded as sent."),
  messagesSentWarning: t(
    "भेजा गया दर्ज हुआ — पर स्वीकृति के बाद यह बदल गया था। सुधार का संदेश तैयार करें:",
    "Recorded as sent — but this had changed since it was approved. Prepare a correction:",
  ),
  messagesApproveFirst: t("पहले स्वीकृत करें, फिर भेजें।", "Approve it first, then send it."),
  messagesAlreadyClosed: t("यह संदेश पहले ही भेजा या रद्द किया जा चुका है।", "This message was already sent or withdrawn."),
  messagesWrongNumber: t("नंबर गलत है", "Wrong number"),
  messagesWrongNumberReason: t("क्या गलत है? (ज़रूरी)", "What is wrong with it? (required)"),
  messagesFlagNeedsReason: t("नंबर और कारण दोनों चाहिए।", "Give the number and say what is wrong."),
  messagesFlagSubmit: t("गलत बताएँ और भेजना रोकें", "Report it and stop sending to it"),
  messagesFlagged: t("जिन नंबरों को गलत बताया गया", "Numbers reported as wrong"),
  messagesFlaggedHint: t(
    "इन पर कुछ नहीं भेजा जाता। प्रशासक जाँचकर, कारण लिखकर हटा सकते हैं।",
    "Nothing is sent to these. An administrator can clear one after checking, with a note.",
  ),
  messagesFlagClear: t("जाँच ली — हटाएँ", "Checked — clear it"),
  messagesFlagClearNote: t("क्या जाँचा?", "What was checked?"),
  policyTitle: t("अभिभावक संदेश का नियम", "Parent message policy"),
  policyIntro: t(
    "हर प्रकार के संदेश को कोई व्यक्ति स्वीकृत करता है। अपने-आप भेजने की छूट तभी जब प्रशासक बताएँ किसे, कब, क्या और गलती पर क्या होगा — और स्कूल का स्विच चालू हो।",
    "A person approves every kind of message. Automatic sending is an exception only when an administrator names who, when, what and what happens on a mistake — and the school's switch is on.",
  ),
  policyApprovalRequired: t("हर संदेश व्यक्ति स्वीकृत करे (सुझाया गया)", "A person approves every message (recommended)"),
  policyApprovalShort: t("स्वीकृति ज़रूरी", "Approval required"),
  policyAutomatic: t("अपने-आप (छूट)", "Automatic (exception)"),
  policyRecipients: t("किसे (अपने-आप)", "Recipients (automatic)"),
  policyTrigger: t("कब", "Trigger"),
  policyContent: t("कौन सा संदेश", "Which message"),
  policyCorrection: t("गलती हो तो", "On a mistake"),
  policyVersion: t("संस्करण", "Version"),
  policySaved: t("नियम सहेजा गया — पुरानी स्वीकृतियाँ फिर देखनी होंगी।", "Policy saved — messages approved under the old version must be looked at again."),
  policyExceptionIncomplete: t(
    "अपने-आप भेजने के लिए किसे, कब, क्या और गलती पर क्या — चारों लिखें।",
    "To send automatically, name all four: recipients, trigger, message and what happens on a mistake.",
  ),
  policySwitchOff: t(
    "स्कूल का स्विच बंद है — कोई भी संदेश अपने-आप अभिभावक को नहीं जाता।",
    "The school's switch is off — nothing goes to a parent automatically.",
  ),
  policyStale: t(
    "किसी और ने अभी यह नियम बदला — उनका बदलाव रखा गया है। पेज दोबारा खोलकर देखें, फिर सहेजें।",
    "Somebody else changed this policy just now, and theirs stands. Reopen the page, check it, then save.",
  ),
  messagesWithdrawnWrongNumber: t(
    "वापस लिया गया — यह नंबर गलत बताया गया है।",
    "Withdrawn — this number was reported as wrong.",
  ),
  messagesNumberFlagged: t(
    "यह नंबर गलत बताया गया है — प्रशासक के जाँचने तक इस पर संदेश नहीं जाएगा।",
    "This number has been reported as wrong. Nothing goes to it until an administrator has checked it.",
  ),
} as const;
