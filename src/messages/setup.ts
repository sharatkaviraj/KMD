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
} as const;
