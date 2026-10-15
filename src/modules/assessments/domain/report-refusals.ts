import { t, type Localized } from "@/platform/i18n/language";

/**
 * Why a card was not issued, in words an exam coordinator can act on (P8).
 * Each is a fact `issue_report_card` checked inside the transaction that would
 * have written the card; nothing was written.
 */
export const reportRefusals: Record<string, Localized> = {
  no_approved_scheme: t(
    "इस सत्र के लिए रिपोर्ट का स्वीकृत नियम नहीं है। पहले नियम स्वीकृत करें।",
    "This term has no approved report scheme. Approve the scheme first.",
  ),
  scheme_changed: t(
    "रिपोर्ट का नियम अभी बदला है। पेज फिर से खोलें।",
    "The report scheme has just changed. Reload the page.",
  ),
  papers_not_submitted: t(
    "कुछ पेपर के अंक अभी जमा नहीं हुए",
    "Some papers have not been submitted by their teachers yet",
  ),
  no_marks: t(
    "इस सत्र-भाग के कोई अंक नहीं हैं — खाली रिपोर्ट जारी नहीं होती।",
    "This term has no marks for the child — an empty card is not issued.",
  ),
  incomplete: t(
    "कुछ अंक अभी भरे नहीं गए — अधूरी रिपोर्ट जारी नहीं होती।",
    "Some marks are still missing — an incomplete card is not issued.",
  ),
  marks_moved: t(
    "रिपोर्ट बनने के बाद कुछ अंक बदले हैं। पेज फिर से खोलें",
    "Some marks changed after this card was worked out. Reload the page",
  ),
  stale: t(
    "यह रिपोर्ट किसी और ने अभी जारी की है। पेज फिर से खोलें।",
    "Someone else issued this card meanwhile. Reload the page.",
  ),
  reason_required: t(
    "दोबारा जारी करने का कारण लिखें — पिछली रिपोर्ट रखी जाएगी।",
    "Say why it is being reissued — the earlier card is kept.",
  ),
  not_permitted: t("रिपोर्ट जारी करना परीक्षा-प्रभारी का काम है।", "Issuing a card is the exam office's."),
  not_enrolled: t("यह बच्चा इस सत्र में नामांकित नहीं है।", "This child is not enrolled this session."),
  id_reused: t(
    "यह फ़ॉर्म पहले ही किसी और बदलाव के लिए भेजा जा चुका है। पेज फिर से खोलें।",
    "This form was already used for a different change. Reload the page.",
  ),
  bad_request: t("कुछ अधूरा भेजा गया। पेज फिर से खोलें।", "Something was missing. Reload the page."),
  failed: t(
    "जारी नहीं हो सकी। फिर से कोशिश करना सुरक्षित है — दो बार जारी नहीं होगी।",
    "Not issued. Trying again is safe — it will not be issued twice.",
  ),
};
