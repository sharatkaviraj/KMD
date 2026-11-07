import { p, type Pair } from "@/vx/text";
import type { RequestErrorCode, RequestStage } from "@/modules/certificates/domain/request-view";

/** Words for certificate requests (D-542), shared by the teacher's screens and the approver's queue. */
export const R = {
  card: p("Certificates", "प्रमाण पत्र"),
  cardHint: p("Need a study, character or birth-date certificate for this child? Ask here. Once approved it comes signed and sealed, ready to send to the family.",
    "इस बच्चे का अध्ययन, चरित्र या जन्म तिथि प्रमाण पत्र चाहिए? यहाँ माँगें। मंज़ूरी के बाद यह हस्ताक्षर और मुहर के साथ आएगा, परिवार को भेजने के लिए तैयार।"),
  ask: p("Ask for a certificate", "प्रमाण पत्र माँगें"),
  askAnother: p("Ask for another certificate", "दूसरा प्रमाण पत्र माँगें"),
  which: p("Which certificate?", "कौन सा प्रमाण पत्र?"),
  purpose: p("What is it for? (optional)", "किस काम के लिए? (वैकल्पिक)"),
  purposeHint: p("Printed on the certificate, e.g. a scholarship application", "प्रमाण पत्र पर छपेगा, जैसे छात्रवृत्ति आवेदन"),
  conduct: p("The child's conduct", "बच्चे का आचरण"),
  note: p("Note for the office (optional)", "कार्यालय के लिए नोट (वैकल्पिक)"),
  notePlaceholder: p("For example: the parent needs it by Friday", "जैसे: अभिभावक को शुक्रवार तक चाहिए"),
  send: p("Send for approval", "मंज़ूरी के लिए भेजें"),
  sending: p("Sending to the office…", "कार्यालय को भेज रहे हैं…"),
  sent: p("Sent for approval", "मंज़ूरी के लिए भेज दिया"),
  sentBody: p("The office will check it, then sign and seal it. You will see it here and on your Today screen. Then download it and send it to the family.",
    "कार्यालय जाँच कर हस्ताक्षर और मुहर लगाएगा। यह यहाँ और आपकी ‘आज’ स्क्रीन पर दिखेगा। फिर इसे डाउनलोड करके परिवार को भेजें।"),
  already: p("This certificate was already asked for. It is waiting for approval.", "यह प्रमाण पत्र पहले ही माँगा जा चुका है। मंज़ूरी बाकी है।"),
  done: p("Done", "हो गया"),
  mine: p("My certificate requests", "मेरे माँगे प्रमाण पत्र"),
  openReady: p("Ready: open to download or send to the parent", "तैयार: डाउनलोड करने या अभिभावक को भेजने के लिए खोलें"),
  moreOnChildPage: (n: number): Pair => p(`${n} more: each one is on that child's page`, `${n} और: हर एक उस बच्चे के पेज पर है`),
  asked: p("Asked", "माँगा"),
  withdraw: p("Cancel request", "अनुरोध रद्द करें"),
  withdrawn: p("Request cancelled", "अनुरोध रद्द हुआ"),
  download: p("Download", "डाउनलोड करें"),
  sendParent: p("Send to parent", "अभिभावक को भेजें"),
  sendParentHint: p("Opens your phone's share list: choose WhatsApp and the parent.", "फ़ोन की शेयर सूची खुलेगी: व्हाट्सऐप और अभिभावक चुनें।"),
  downloaded: p("Saved to your phone", "फ़ोन में सेव हो गया"),
  shareAgain: p("The certificate is ready. Tap “Send to parent” once more to choose WhatsApp.", "प्रमाण पत्र तैयार है। व्हाट्सऐप चुनने के लिए ‘अभिभावक को भेजें’ एक बार और दबाएँ।"),
  loading: p("Reading certificate requests…", "प्रमाण पत्र अनुरोध पढ़ रहे हैं…"),
  loadFailed: p("Couldn't read certificate requests", "प्रमाण पत्र अनुरोध नहीं पढ़ पाए"),
  retry: p("Try again", "फिर कोशिश करें"),
  signedBy: p("Signed and sealed", "हस्ताक्षर व मुहर सहित"),
  // The approver's queue.
  queue: p("Asked by teachers", "अध्यापकों के अनुरोध"),
  queueHint: p("Check the child's details, then approve: the certificate is made with the principal's signature and the school seal, and the teacher can download it.",
    "बच्चे की जानकारी जाँचें, फिर मंज़ूर करें: प्रमाण पत्र प्रधानाचार्य के हस्ताक्षर और विद्यालय की मुहर के साथ बनेगा, और अध्यापक उसे डाउनलोड कर सकेंगे।"),
  approve: p("Approve and sign", "मंज़ूर करें और हस्ताक्षर करें"),
  approving: p("Signing and sealing…", "हस्ताक्षर और मुहर लग रही है…"),
  approved: p("Approved, signed and sealed", "मंज़ूर, हस्ताक्षर व मुहर सहित"),
  approvedBody: p("The teacher can download it now.", "अध्यापक अब इसे डाउनलोड कर सकते हैं।"),
  decline: p("Decline", "मना करें"),
  declineTitle: p("Why can't this be given?", "यह क्यों नहीं दिया जा सकता?"),
  declineSend: p("Decline and tell the teacher", "मना करें और अध्यापक को बताएँ"),
  declined: p("Declined", "मना किया"),
  reason: p("Reason", "कारण"),
  askedBy: p("Asked by", "माँगने वाले"),
  father: p("Father", "पिता"),
  born: p("Born", "जन्म"),
  forPurpose: p("For", "किसके लिए"),
  noteFrom: p("Note", "नोट"),
  details: p("A few details need attention before it can be made", "बनाने से पहले कुछ जानकारी ठीक करनी है"),
  fixRecord: p("Open the student record", "विद्यार्थी रिकॉर्ड खोलें"),
  openIssue: p("Open in register", "रजिस्टर में खोलें"),
  print: p("Print", "प्रिंट करें"),
  waitingCount: (n: number): Pair => p(`${n} certificate ${n === 1 ? "request" : "requests"} from teachers`, `अध्यापकों के ${n} प्रमाण पत्र अनुरोध`),
  waitingAction: p("Approve and sign", "मंज़ूर करें और हस्ताक्षर करें"),
};

export const STAGE: Record<RequestStage, { label: Pair; tone: "warn" | "ok" | "bad" | "mut" }> = {
  waiting: { label: p("Waiting for approval", "मंज़ूरी बाकी"), tone: "warn" },
  ready: { label: p("Signed and ready", "हस्ताक्षरित, तैयार"), tone: "ok" },
  declined: { label: p("Not approved", "मंज़ूर नहीं"), tone: "bad" },
  gone: { label: p("Cancelled by the office", "कार्यालय ने रद्द किया"), tone: "mut" },
};

export const DECLINE_REASONS: Pair[] = [
  p("Details are not in the register yet", "जानकारी अभी रजिस्टर में नहीं है"),
  p("Please ask the parent to apply at the office", "कृपया अभिभावक को कार्यालय में आवेदन करने को कहें"),
  p("Already issued this session", "इस सत्र में पहले ही जारी हो चुका है"),
];

export const REQUEST_ERRORS: Partial<Record<RequestErrorCode, Pair>> = {
  forbidden: p("You can ask only for children in your own classes.", "आप केवल अपनी कक्षाओं के बच्चों के लिए माँग सकते हैं।"),
  not_enrolled: p("This child is not on the roll this session.", "यह बच्चा इस सत्र में नामांकित नहीं है।"),
  decided: p("Someone has already answered this request.", "इस अनुरोध का उत्तर पहले ही दिया जा चुका है।"),
  not_ready: p("This certificate is not ready yet.", "यह प्रमाण पत्र अभी तैयार नहीं है।"),
  reason_required: p("Write a short reason for the teacher.", "अध्यापक के लिए छोटा सा कारण लिखें।"),
  invalid: p("Something in the form is not right. Check and try again.", "फ़ॉर्म में कुछ ठीक नहीं है। जाँचकर फिर कोशिश करें।"),
};
export const UNAVAILABLE = p("Didn't finish. Check the internet and try again.", "पूरा नहीं हुआ। इंटरनेट जाँचकर फिर कोशिश करें।");
export const requestError = (code: RequestErrorCode | undefined): Pair => (code && REQUEST_ERRORS[code]) || UNAVAILABLE;
