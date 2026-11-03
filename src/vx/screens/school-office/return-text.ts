import { p, type Pair } from "@/vx/text";
export const PORTAL_LABELS: Record<string, Pair> = { psp: p("PSP", "पीएसपी"), udise: p("UDISE+", "यूडाइस+"), class5: p("Class 5 examinations", "कक्षा 5 परीक्षा"), class8: p("Class 8 examinations", "कक्षा 8 परीक्षा"), rbse10: p("RBSE Class 10", "आरबीएसई कक्षा 10"), rbse12: p("RBSE Class 12", "आरबीएसई कक्षा 12") };
export const RETURN_STATE: Record<string, Pair> = { preparing: p("File needs retry", "फ़ाइल फिर तैयार करें"), exported: p("File prepared", "फ़ाइल तैयार"), staged: p("Differences ready to review", "अंतर जाँचने के लिए तैयार"), applied: p("Changes applied", "बदलाव लागू"), submitted: p("Submission recorded", "जमा करना दर्ज"), accepted: p("Acceptance recorded", "स्वीकृति दर्ज"), partially_accepted: p("Partly accepted", "आंशिक स्वीकृति"), rejected: p("Rejection recorded", "अस्वीकृति दर्ज") };
export const G = {
  title: p("Government returns", "सरकारी विवरण"), prepare: p("Prepare a return", "विवरण तैयार करें"), destination: p("Destination", "कहाँ जमा करना है"), module: p("Purpose / module", "कार्य / विभाग"), schoolCode: p("School code", "विद्यालय कोड"), class: p("Class", "कक्षा"), allClasses: p("All classes", "सभी कक्षाएँ"),
  manual: p("Reference sheet - for manual portal entry", "संदर्भ सूची - पोर्टल पर स्वयं भरने के लिए"), manualHint: p("No compatible upload format has been verified for this choice. This sheet helps with manual entry.", "इस विकल्प के लिए अपलोड प्रारूप सत्यापित नहीं है। यह सूची पोर्टल पर स्वयं भरने में मदद करेगी।"),
  verified: p("Upload format verified by the school", "विद्यालय द्वारा सत्यापित अपलोड प्रारूप"), format: p("File format", "फ़ाइल प्रारूप"), check: p("Check details", "जानकारी जाँचें"), download: p("Download prepared file", "तैयार फ़ाइल डाउनलोड करें"),
  checkFailed: p("Could not finish. The source or format may have changed; check details and try again.", "कार्य पूरा नहीं हुआ। मूल रिकॉर्ड या प्रारूप बदला हो सकता है; जानकारी जाँचकर फिर कोशिश करें।"),
  ready: p("Ready", "तैयार"), blocked: p("Needs details", "जानकारी बाकी"), exclude: p("Prepare only ready rows and record the excluded count", "केवल तैयार पंक्तियों की सूची बनाएँ और छोड़ी हुई संख्या दर्ज रखें"),
  make: p("Prepare file", "फ़ाइल बनाएँ"), batches: p("Recent batches", "हाल की सूचियाँ"), noBatches: p("No batches yet", "अभी कोई सूची नहीं"), noBatchesSub: p("Check the selected records, then prepare one complete file.", "चुने हुए रिकॉर्ड जाँचकर एक पूरी फ़ाइल तैयार करें।"),
  outcomeHint: p("Preparing or downloading a file does not submit it. Record the actual portal outcome separately.", "फ़ाइल तैयार या डाउनलोड करने से वह जमा नहीं होती। पोर्टल का वास्तविक परिणाम अलग दर्ज करें।"),
  import: p("Import returned file", "वापस मिली फ़ाइल पढ़ें"), importHint: p("Use the exact supported format. Files up to 750 KB; text cells only, no formulas or macros.", "ठीक वही समर्थित प्रारूप प्रयोग करें। अधिकतम 750 केबी; टेक्स्ट सेल, बिना फ़ॉर्मूला या मैक्रो।"),
  review: p("Review differences", "अंतर जाँचें"), apply: p("Apply permitted changes", "अनुमत बदलाव लागू करें"), conflict: p("Conflict", "अंतर सुलझाना है"), unmatched: p("No matching student", "विद्यार्थी का मिलान नहीं हुआ"), unchanged: p("Unchanged", "कोई बदलाव नहीं"),
  conflictHint: p("Resolve conflicts at their source, then upload a fresh file. Names, admission facts, fees and internal marks are not overwritten here.", "पहले मूल रिकॉर्ड में अंतर सुलझाएँ और नई फ़ाइल लाएँ। यहाँ नाम, प्रवेश की जानकारी, फीस या आंतरिक अंक नहीं बदले जाते।"),
  acknowledgement: p("Acknowledgement / reference and note", "पावती / संदर्भ और टिप्पणी"), evidence: p("Official acknowledgement or returned status (PDF, PNG or JPG; up to 750 KB)", "आधिकारिक पावती या प्राप्त स्थिति (पीडीएफ, पीएनजी या जेपीजी; अधिकतम 750 केबी)"),
  submitted: p("Record submission", "जमा करना दर्ज करें"), accepted: p("Record acceptance", "स्वीकृति दर्ज करें"), rejected: p("Record rejection", "अस्वीकृति दर्ज करें"),
  outcome: p("Record actual portal outcome", "पोर्टल का वास्तविक परिणाम दर्ज करें"), evidenceRequired: p("An official acknowledgement is required for acceptance or rejection. The operator verifies which school, session and batch it covers.", "स्वीकृति या अस्वीकृति के लिए आधिकारिक पावती आवश्यक है। संचालक उसका विद्यालय, सत्र और सूची जाँचें।"),
  adapter: p("Set up a verified format", "सत्यापित प्रारूप जोड़ें"), source: p("Current circular / template reference", "वर्तमान परिपत्र / प्रारूप का संदर्भ"), specimen: p("Current blank or redacted specimen", "वर्तमान खाली या पहचान हटाया हुआ नमूना"), inspect: p("Read specimen columns", "नमूने के कॉलम पढ़ें"),
  sheet: p("Worksheet name", "वर्कशीट का नाम"), mapField: p("One record field", "वन में जानकारी"), required: p("Required by this format", "इस प्रारूप में आवश्यक"), selectField: p("Choose field", "फ़ील्ड चुनें"),
  confirm: p("I checked this current specimen, its school/session and exact portal requirements. This mapping is approved for this purpose.", "मैंने वर्तमान नमूना, विद्यालय/सत्र और पोर्टल की आवश्यकताएँ जाँच ली हैं। इस कार्य के लिए यह मिलान स्वीकृत है।"),
  saveFormat: p("Save verified format", "सत्यापित प्रारूप सहेजें"), supported: p("Supports one flat CSV/XLSX sheet with explicit school, session and matching ID columns. Other formats can still use a reference sheet.", "विद्यालय, सत्र और पहचान के कॉलम वाली एक समतल सीएसवी/एक्सएलएसएक्स शीट समर्थित है। अन्य प्रारूपों में संदर्भ सूची उपयोग करें।"),
  portal: p("Open official portal", "आधिकारिक पोर्टल खोलें"), preflight: p("Record check", "रिकॉर्ड की जाँच"),
};
export function returnReason(reason: string): Pair {
  const known: Record<string, Pair> = { identity_unverified: p("Enrolment needs verification", "नामांकन सत्यापित करें"), duplicate_identity: p("Duplicate identifier", "दोहराई गई पहचान"), wrong_session: p("Different academic session", "दूसरा शैक्षणिक सत्र"), wrong_school: p("Different school code", "दूसरा विद्यालय कोड"), unsafe_cell: p("Formula-like text needs correction", "फ़ॉर्मूला जैसा पाठ सुधारें"), invalid_cell: p("Invalid or unsafe cell", "अमान्य या असुरक्षित सेल"), external_id_collision: p("External ID belongs to another record", "बाहरी पहचान दूसरे रिकॉर्ड से जुड़ी है"), ambiguous_identity: p("More than one possible match", "एक से अधिक मिलान"), "missing:admissionNo": p("Admission / SR number missing", "प्रवेश / एसआर संख्या नहीं है") };
  if (known[reason]) return known[reason];
  if (reason.startsWith("protected_field:")) return p("A protected record differs", "सुरक्षित मूल रिकॉर्ड में अंतर है");
  if (reason.startsWith("missing:")) return p("Required detail missing", "आवश्यक जानकारी बाकी है");
  if (reason.startsWith("invalid_code:")) return p("Value is not in this format's code list", "मान इस प्रारूप की कोड सूची में नहीं है");
  return p("Review this detail", "यह जानकारी जाँचें");
}

/* ----------------------------------------------- readiness board (J) */
export const FIELD_LABELS: Record<string, Pair> = {
  studentId: p("One student ID", "वन विद्यार्थी पहचान"), admissionNo: p("Admission / SR no.", "प्रवेश / एसआर संख्या"), studentName: p("Student name", "विद्यार्थी का नाम"), classLabel: p("Class", "कक्षा"),
  sessionLabel: p("Session", "सत्र"), schoolCode: p("School code", "विद्यालय कोड"), externalId: p("Portal ID", "पोर्टल पहचान"), registrationStatus: p("Registration status", "पंजीकरण स्थिति"),
};
const fieldOf = (reason: string) => FIELD_LABELS[reason.slice(reason.indexOf(":") + 1)] ?? p("Detail", "जानकारी");
/** A blocking reason as a sentence, naming the exact field. */
export function issueLabel(reason: string): Pair {
  const field = fieldOf(reason), hi = field.hi ?? field.en;
  if (reason.startsWith("missing:")) return p(`${field.en} missing`, `${hi} नहीं है`);
  if (reason.startsWith("too_long:")) return p(`${field.en} too long`, `${hi} बहुत लंबा है`);
  if (reason.startsWith("invalid_code:")) return p(`${field.en} not in the code list`, `${hi} कोड सूची में नहीं`);
  return returnReason(reason);
}
/** The same reason as a short grid column heading. */
export function issueShort(reason: string): Pair {
  const field = fieldOf(reason), hi = field.hi ?? field.en;
  if (reason.startsWith("missing:")) return field;
  if (reason.startsWith("too_long:")) return p(`${field.en} (long)`, `${hi} (लंबा)`);
  if (reason.startsWith("invalid_code:")) return p(`${field.en} (code)`, `${hi} (कोड)`);
  const short: Record<string, Pair> = { identity_unverified: p("Enrolment", "नामांकन"), duplicate_identity: p("Duplicate ID", "दोहरी पहचान"), wrong_session: p("Session", "सत्र"), wrong_school: p("School code", "विद्यालय कोड"), unsafe_cell: p("Formula text", "फ़ॉर्मूला पाठ"), invalid_cell: p("Invalid cell", "अमान्य सेल"), external_id_collision: p("Portal ID clash", "पोर्टल पहचान टकराव"), ambiguous_identity: p("Unclear match", "अस्पष्ट मिलान") };
  return short[reason] ?? p("Other", "अन्य");
}
export const R = {
  certificates: p("Certificates", "प्रमाणपत्र"), open: p("Open", "खोलें"), setUp: p("Set up", "सेट करें"), settings: p("Destination settings", "गंतव्य सेटिंग"),
  referenceSheet: p("Reference sheet", "संदर्भ सूची"), conflict: p("Conflict", "अंतर"), notChecked: p("Not checked yet", "अभी जाँचा नहीं"),
  deadlineUnverified: p("Deadline needs verification", "अंतिम तिथि अभी जाँचनी है"),
  source: p("School records are not available right now. Counts will show when they are.", "विद्यालय रिकॉर्ड अभी उपलब्ध नहीं हैं। उपलब्ध होने पर संख्या दिखेगी।"),
  whoMissing: p("Who is missing what", "किसकी क्या जानकारी बाकी है"), gridHint: p("Rows are classes, columns are what blocks them. Tap a number to see those students.", "पंक्तियाँ कक्षाएँ हैं, कॉलम रुकावट का कारण। विद्यार्थी देखने के लिए संख्या पर टैप करें।"),
  allReady: p("Every student is ready for this destination.", "इस गंतव्य के लिए सभी विद्यार्थी तैयार हैं।"), close: p("Close list", "सूची बंद करें"),
  askTeachers: p("Ask class teachers for missing details", "कक्षाध्यापकों से बाकी जानकारी माँगें"),
  askHint: p("Opens a details round for the classes with gaps; you choose what to ask. Admission numbers, enrolment and conflicts stay with the office.", "जिन कक्षाओं में जानकारी बाकी है उनके लिए जानकारी-दौर खुलेगा; क्या पूछना है आप चुनें। प्रवेश संख्या, नामांकन और अंतर कार्यालय ही सुलझाएगा।"),
  startManual: p("Start manual entry", "पोर्टल पर भरना शुरू करें"), continueManual: p("Continue manual entry", "पोर्टल पर भरना जारी रखें"), freshList: p("Prepare a fresh list", "नई सूची तैयार करें"),
  downloadUpload: p("Download upload file", "अपलोड फ़ाइल डाउनलोड करें"), uploadBlocked: p("An upload file needs every student ready. Resolve the details above first.", "अपलोड फ़ाइल के लिए सभी विद्यार्थी तैयार होने चाहिए। पहले ऊपर की जानकारी पूरी करें।"),
  nothingReady: p("No student is ready yet.", "अभी कोई विद्यार्थी तैयार नहीं है।"), working: p("Preparing…", "तैयार हो रहा है…"),
  noBatchesHere: p("No lists prepared for this destination yet.", "इस गंतव्य के लिए अभी कोई सूची नहीं बनी।"),
};
export const readyOf = (ready: number, total: number) => p(`${ready} / ${total} ready`, `${total} में से ${ready} तैयार`);
export const blockedLine = (details: number, conflicts: number) => p(`${details} need details · ${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`, `${details} की जानकारी बाकी · ${conflicts} अंतर`);
export const verifiedFormat = (version: number | null) => p(`Verified format v${version ?? 1}`, `सत्यापित प्रारूप v${version ?? 1}`);
export const manualProgressLine = (entered: number, total: number) => p(`Manual entry ${entered} / ${total}`, `पोर्टल पर भरे गए: ${total} में से ${entered}`);
export const excludedLine = (count: number) => p(count === 1 ? "1 student who needs details or has a conflict is left out of this list." : `${count} students who need details or have conflicts are left out of this list.`, `जानकारी बाकी या अंतर वाले ${count} विद्यार्थी इस सूची में नहीं होंगे।`);
export const studentCount = (count: number) => p(count === 1 ? "1 student" : `${count} students`, `${count} विद्यार्थी`);
