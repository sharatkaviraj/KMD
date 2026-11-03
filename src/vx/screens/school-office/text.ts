import { p, type Pair } from "@/vx/text";
import type { CertificateExtra, CertificateField, CertificateKind, CertificateStatus, ConductGrade } from "@/modules/certificates/domain/certificate";
export const O = {
  title: p("School Office", "विद्यालय कार्यालय"), certificates: p("Certificates", "प्रमाण पत्र"), returns: p("Government returns", "सरकारी विवरण"),
  study: p("Study certificate", "अध्ययन प्रमाण पत्र"), preparing: p("Preparing…", "तैयार हो रहा है…"), retry: p("Try again", "फिर कोशिश करें"),
  unavailable: p("Didn't finish. Try again; the same number will be used.", "पूरा नहीं हुआ। फिर कोशिश करें; वही संख्या रहेगी।"),
  details: p("A few details need attention", "कुछ जानकारी ठीक करनी है"), fix: p("Fix student details", "विद्यार्थी की जानकारी सुधारें"),
  identity: p("Check the student's enrolment and identity", "विद्यार्थी का नामांकन और पहचान जाँचें"), source: p("The current school record is unavailable", "वर्तमान विद्यालय रिकॉर्ड उपलब्ध नहीं है"),
  templateMissing: p("The certificate template needs setup", "प्रमाण पत्र का प्रारूप तय करना है"), setup: p("Certificate settings", "प्रमाण पत्र की सेटिंग्स"),
  signature: p("Awaiting signature", "हस्ताक्षर बाकी"), manual: p("Sign and stamp each print, then mark it handed over.", "हर प्रति पर हस्ताक्षर व मुहर लगाएँ, फिर सौंपना दर्ज करें।"),
  find: p("Find student", "विद्यार्थी खोजें"), search: p("Student, SR number or certificate number", "विद्यार्थी, एसआर या प्रमाण पत्र संख्या"),
  empty: p("Issue your first certificate", "पहला प्रमाण पत्र बनाएँ"), emptySub: p("Open a student and choose Certificate. Known details fill themselves in.", "विद्यार्थी खोलें और प्रमाण पत्र चुनें। मौजूद जानकारी अपने आप भरेगी।"),
  student: p("Student", "विद्यार्थी"), number: p("Certificate number", "प्रमाण पत्र संख्या"), status: p("Status", "स्थिति"), prepared: p("Prepared", "तैयार किया"),
  all: p("All statuses", "सभी स्थितियाँ"), searchButton: p("Search", "खोजें"), previous: p("Previous", "पिछला"), next: p("Next", "अगला"),
  download: p("Download PDF", "पीडीएफ डाउनलोड करें"), print: p("Print", "प्रिंट करें"), history: p("History", "इतिहास"),
  register: p("Certificate register", "प्रमाण पत्र रजिस्टर"), uploaded: p("Uploaded documents", "अपलोड किए दस्तावेज़"), schoolIssued: p("School-issued certificates", "विद्यालय के प्रमाण पत्र"),
  openRegister: p("See certificate history", "प्रमाण पत्र का इतिहास देखें"), noIssued: p("No school-issued certificates yet", "अभी विद्यालय का कोई प्रमाण पत्र नहीं"),
  loadFailed: p("Couldn't read certificates", "प्रमाण पत्र नहीं पढ़ पाए"), loading: p("Reading certificates…", "प्रमाण पत्र पढ़ रहे हैं…"),
  cancelled: p("Cancel certificate", "प्रमाण पत्र रद्द करें"), correct: p("Create corrected copy", "सुधारी हुई प्रति बनाएँ"),
  handover: p("Mark signed and handed over", "हस्ताक्षर कर सौंपना दर्ज करें"), reason: p("Reason", "कारण"),
  saved: p("Saved", "सहेजा गया"), save: p("Save template version", "प्रारूप का नया संस्करण सहेजें"), saveFailed: p("Couldn't save. Another change may have been made; refresh and try again.", "सहेजा नहीं गया। शायद दूसरा बदलाव हुआ है; पेज दोबारा खोलकर कोशिश करें।"),
  frozen: p("This PDF keeps the school details, student facts and wording as they were when prepared.", "इस पीडीएफ में तैयार करते समय की विद्यालय, विद्यार्थी और प्रारूप की जानकारी सुरक्षित है।"),
  archived: p("Kept as history. This is not the current certificate.", "इतिहास के लिए रखा है। यह वर्तमान प्रमाण पत्र नहीं है।"),
  correctionHint: p("Correct the student record first. A corrected copy gets a new number and keeps the old one in history.", "पहले विद्यार्थी का रिकॉर्ड सुधारें। सुधारी प्रति को नई संख्या मिलेगी और पुरानी इतिहास में रहेगी।"),
  test: p("TEST document - not valid for official use", "टेस्ट दस्तावेज़ - आधिकारिक उपयोग के लिए मान्य नहीं"),
  // Second pass: the sheet, the desk and the settings.
  certificate: p("Certificate", "प्रमाण पत्र"), chooseKind: p("Which document?", "कौन सा प्रमाण पत्र?"),
  purpose: p("Purpose (optional)", "उद्देश्य (वैकल्पिक)"), purposeHint: p("Printed as one line, e.g. a scholarship application", "एक पंक्ति में छपेगा, जैसे छात्रवृत्ति आवेदन"),
  make: p("Prepare certificate", "प्रमाण पत्र तैयार करें"), ready: p("Ready to print", "प्रिंट के लिए तैयार"),
  reprintFound: p("Already issued. This opens the same copy and number.", "पहले जारी हो चुका है। वही प्रति और संख्या खुलेगी।"),
  share: p("Share", "भेजें"), done: p("Done", "हो गया"), openIssue: p("Open in register", "रजिस्टर में खोलें"), another: p("Another document", "दूसरा प्रमाण पत्र"),
  addDetail: p("Add in the student record", "विद्यार्थी रिकॉर्ड में जोड़ें"), notLeft: p("The student isn't marked as left yet. Record the leaving date first, then prepare the TC.", "विद्यार्थी अभी विद्यालय छोड़ा हुआ दर्ज नहीं है। पहले छोड़ने की तिथि दर्ज करें, फिर टीसी बनाएँ।"),
  askOffice: p("Ask the office to add this, then try again.", "कार्यालय से यह जुड़वाएँ, फिर कोशिश करें।"), continueAfterFix: p("Back to the certificate", "प्रमाण पत्र पर लौटें"),
  desk: p("Desk", "डेस्क"), today: p("Prepared today", "आज तैयार"), awaiting: p("Awaiting signature", "हस्ताक्षर बाकी"), handedMonth: p("Handed over this month", "इस माह सौंपे"), issuedTotal: p("Current this session", "इस सत्र में वैध"),
  tray: p("Signing tray", "हस्ताक्षर ट्रे"), trayEmpty: p("Nothing waiting for a signature", "हस्ताक्षर के लिए कुछ बाकी नहीं"),
  trayHint: p("Print the tray, sign and stamp each page, then mark them handed over together.", "ट्रे प्रिंट करें, हर पेज पर हस्ताक्षर व मुहर लगाएँ, फिर सबको एक साथ सौंपा दर्ज करें।"),
  printTray: p("Print tray", "ट्रे प्रिंट करें"), markHanded: p("Mark handed over", "सौंपा दर्ज करें"), collectedBy: p("Collected by", "किसने लिया"),
  selectAll: p("Select all", "सभी चुनें"), selected: p("selected", "चुने"), handedDone: p("Marked handed over", "सौंपा दर्ज हुआ"),
  batch: p("Class batch", "कक्षा के लिए"), batchTitle: p("Certificates for a class", "पूरी कक्षा के प्रमाण पत्र"),
  batchHint: p("Prepare one document for every child in a class. Each gets its own number; blocked children are listed so they can be fixed.", "कक्षा के हर विद्यार्थी के लिए एक प्रमाण पत्र। हर एक को अपनी संख्या मिलेगी; जिनकी जानकारी अधूरी है उनकी सूची दिखेगी।"),
  chooseClass: p("Class", "कक्षा"), startBatch: p("Prepare for this class", "इस कक्षा के लिए तैयार करें"), stop: p("Stop", "रोकें"),
  batchDone: p("Batch finished", "बैच पूरा हुआ"), blocked: p("Needs details", "जानकारी अधूरी"), printAll: p("Print all", "सभी प्रिंट करें"),
  allKinds: p("All documents", "सभी प्रमाण पत्र"), kind: p("Document", "प्रमाण पत्र"),
  schoolDetails: p("School details on certificates", "प्रमाण पत्र पर विद्यालय का विवरण"), wording: p("Wording", "पाठ"),
  insert: p("Insert", "जोड़ें"), preview: p("Preview", "पूर्वावलोकन"), samplePdf: p("Open sample PDF", "नमूना पीडीएफ खोलें"),
  versionNote: p("Saving creates a new version. Documents already issued keep the wording they were printed with.", "सहेजने पर नया संस्करण बनेगा। जारी प्रमाण पत्र अपने पुराने पाठ के साथ ही रहेंगे।"),
};
export const KIND_LABELS: Record<CertificateKind, Pair> = {
  study: p("Study", "अध्ययन"), character: p("Character", "चरित्र"), dob: p("Date of birth", "जन्म तिथि"), tc: p("Transfer (TC)", "स्थानांतरण (टीसी)"),
};
export const KIND_HINTS: Record<CertificateKind, Pair> = {
  study: p("Confirms the child studies here", "विद्यार्थी यहाँ पढ़ता है"), character: p("Conduct and character", "आचरण और चरित्र"),
  dob: p("As in the Scholar's Register", "छात्र पंजिका के अनुसार"), tc: p("For a child who has left", "विद्यालय छोड़ चुके विद्यार्थी के लिए"),
};
export const FIELD_LABELS: Record<CertificateField, Pair> = {
  studentName: p("Student name", "विद्यार्थी का नाम"), admissionNo: p("Admission / SR number", "प्रवेश / एसआर संख्या"), classLabel: p("Class", "कक्षा"), sessionLabel: p("Academic session", "शैक्षणिक सत्र"),
  enrolledOn: p("Enrolment date", "नामांकन तिथि"), leftOn: p("Leaving date", "विद्यालय छोड़ने की तिथि"), admittedOn: p("Admission date", "प्रवेश की तिथि"), dateOfBirth: p("Date of birth", "जन्म तिथि"), fatherName: p("Father's name", "पिता का नाम"), motherName: p("Mother's name", "माता का नाम"),
};
export const EXTRA_LABELS: Record<CertificateExtra, Pair> = {
  reasonForLeaving: p("Reason for leaving", "विद्यालय छोड़ने का कारण"), conduct: p("Conduct", "आचरण"), lastResult: p("Result of last examination", "अंतिम परीक्षा का परिणाम"), remarks: p("Remarks", "टिप्पणी"),
};
export const CONDUCT_LABELS: Record<ConductGrade, Pair> = { excellent: p("Excellent", "उत्तम"), very_good: p("Very good", "बहुत अच्छा"), good: p("Good", "अच्छा"), satisfactory: p("Satisfactory", "संतोषजनक") };
export const LEAVING_REASONS: Pair[] = [
  p("Parent's request", "अभिभावक के आवेदन पर"), p("Change of residence", "निवास बदलने के कारण"), p("Transfer of parent's job", "अभिभावक के स्थानांतरण के कारण"), p("Completed studies at this school", "इस विद्यालय में अध्ययन पूर्ण"),
];
export const PURPOSES: Pair[] = [p("Scholarship application", "छात्रवृत्ति आवेदन"), p("Bank account", "बैंक खाता"), p("Aadhaar update", "आधार अद्यतन"), p("Passport", "पासपोर्ट")];
export const COLLECTORS: Pair[] = [p("Father", "पिता"), p("Mother", "माता"), p("Guardian", "अभिभावक"), p("Student", "विद्यार्थी")];
export const CERTIFICATE_STATUS: Record<CertificateStatus, Pair> = { prepared: p("Awaiting signature", "हस्ताक्षर बाकी"), issued: p("Handed over", "सौंप दिया"), superseded: p("Superseded", "नई प्रति जारी"), cancelled: p("Cancelled", "रद्द") };
