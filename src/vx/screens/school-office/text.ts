import { p, type Pair } from "@/vx/text";
import type { CertificateField, CertificateStatus } from "@/modules/certificates/domain/certificate";
export const O = {
  title: p("School Office", "विद्यालय कार्यालय"), certificates: p("Certificates", "प्रमाण पत्र"), returns: p("Government returns", "सरकारी विवरण"),
  study: p("Study certificate", "अध्ययन प्रमाण पत्र"), preparing: p("Preparing…", "तैयार हो रहा है…"), retry: p("Try again", "फिर कोशिश करें"),
  unavailable: p("Could not prepare the certificate. Your request is retained; try again.", "प्रमाण पत्र तैयार नहीं हुआ। अनुरोध सुरक्षित है; फिर कोशिश करें।"),
  details: p("A few details need attention", "कुछ जानकारी ठीक करनी है"), fix: p("Fix student details", "विद्यार्थी की जानकारी सुधारें"),
  identity: p("Check the student's enrolment and identity", "विद्यार्थी का नामांकन और पहचान जाँचें"), source: p("The current school record is unavailable", "वर्तमान विद्यालय रिकॉर्ड उपलब्ध नहीं है"),
  templateMissing: p("The certificate template needs setup", "प्रमाण पत्र का प्रारूप तय करना है"), setup: p("Certificate settings", "प्रमाण पत्र की सेटिंग्स"),
  signature: p("Print copy - signature required", "प्रिंट प्रति - हस्ताक्षर आवश्यक"), manual: p("Physical signature and school seal are required on every print copy, including reprints.", "हर प्रिंट प्रति पर हस्ताक्षर और विद्यालय की मुहर आवश्यक है; दोबारा प्रिंट पर भी।"),
  find: p("Find student", "विद्यार्थी खोजें"), search: p("Student, SR number or certificate number", "विद्यार्थी, एसआर या प्रमाण पत्र संख्या"),
  empty: p("No certificates in this view", "इस सूची में कोई प्रमाण पत्र नहीं"), emptySub: p("Open a student profile and choose Study certificate. Known details are filled for you.", "विद्यार्थी का पेज खोलकर अध्ययन प्रमाण पत्र चुनें। मौजूद जानकारी अपने आप भरेगी।"),
  student: p("Student", "विद्यार्थी"), number: p("Certificate number", "प्रमाण पत्र संख्या"), status: p("Status", "स्थिति"), prepared: p("Prepared", "तैयार किया"),
  all: p("All statuses", "सभी स्थितियाँ"), searchButton: p("Search", "खोजें"), previous: p("Previous", "पिछला"), next: p("Next", "अगला"),
  download: p("Download original PDF", "मूल पीडीएफ डाउनलोड करें"), print: p("Open / print PDF", "पीडीएफ खोलें / प्रिंट करें"), history: p("History", "इतिहास"),
  register: p("Certificate register", "प्रमाण पत्र रजिस्टर"), uploaded: p("Uploaded documents", "अपलोड किए दस्तावेज़"), schoolIssued: p("School-issued certificates", "विद्यालय के प्रमाण पत्र"),
  openRegister: p("See certificate history", "प्रमाण पत्र का इतिहास देखें"), noIssued: p("No school-issued certificates yet", "अभी विद्यालय का कोई प्रमाण पत्र नहीं"),
  loadFailed: p("Could not read certificates", "प्रमाण पत्र नहीं पढ़ पाए"), loading: p("Reading certificates…", "प्रमाण पत्र पढ़ रहे हैं…"),
  cancelled: p("Cancel certificate", "प्रमाण पत्र रद्द करें"), correct: p("Create corrected copy", "सुधारी हुई प्रति बनाएँ"),
  handover: p("Record signed handover", "हस्ताक्षर सहित सौंपना दर्ज करें"), reason: p("Reason", "कारण"),
  saved: p("Saved", "सहेजा गया"), save: p("Save template version", "प्रारूप का नया संस्करण सहेजें"), saveFailed: p("Could not save. Another change may have been made; refresh and try again.", "सहेजा नहीं गया। शायद दूसरा बदलाव हुआ है; पेज दोबारा खोलकर कोशिश करें।"),
  frozen: p("This PDF keeps the school details, student facts and template as they were when prepared.", "इस पीडीएफ में तैयार करते समय की विद्यालय, विद्यार्थी और प्रारूप की जानकारी सुरक्षित है।"),
  archived: p("This issue is retained as an archive. It is not the current certificate.", "यह प्रमाण पत्र इतिहास के लिए रखा है। यह वर्तमान प्रमाण पत्र नहीं है।"),
  correctionHint: p("Correct the authoritative student record first. A new copy gets a new number and preserves the old issue.", "पहले विद्यार्थी का मूल रिकॉर्ड सुधारें। नई प्रति को नई संख्या मिलेगी और पुरानी प्रति इतिहास में रहेगी।"),
  test: p("TEST document - not valid for official use", "टेस्ट दस्तावेज़ - आधिकारिक उपयोग के लिए मान्य नहीं"),
};
export const FIELD_LABELS: Record<CertificateField, Pair> = {
  studentName: p("Student name", "विद्यार्थी का नाम"), admissionNo: p("Admission / SR number", "प्रवेश / एसआर संख्या"), classLabel: p("Class", "कक्षा"), sessionLabel: p("Academic session", "शैक्षणिक सत्र"),
  enrolledOn: p("Enrolment date", "नामांकन तिथि"), leftOn: p("Leaving date", "विद्यालय छोड़ने की तिथि"), dateOfBirth: p("Date of birth", "जन्म तिथि"), fatherName: p("Father's name", "पिता का नाम"), motherName: p("Mother's name", "माता का नाम"),
};
export const CERTIFICATE_STATUS: Record<CertificateStatus, Pair> = { prepared: p("Signature required", "हस्ताक्षर आवश्यक"), issued: p("Signed handover recorded", "हस्ताक्षर सहित सौंपना दर्ज"), superseded: p("Superseded", "नई प्रति जारी"), cancelled: p("Cancelled", "रद्द") };
