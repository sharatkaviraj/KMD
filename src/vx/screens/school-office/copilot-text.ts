import { p } from "@/vx/text";

/** Words for the manual entry assistant ("Portal Copilot"). Every line a pair. */
export const C = {
  title: p("Manual entry assistant", "पोर्टल भरने का सहायक"),
  honesty: p("Manual entry assistant — you type into the official portal; One never logs in or submits.", "पोर्टल भरने का सहायक — आप आधिकारिक पोर्टल में स्वयं भरते हैं; वन कभी लॉग-इन या जमा नहीं करता।"),
  enteredMeaning: p("“Entered” records what you typed. It is not the portal's acceptance.", "“भरा गया” केवल यह दर्ज करता है कि आपने क्या भरा। यह पोर्टल की स्वीकृति नहीं है।"),
  entered: p("Entered", "भरा गया"), mismatch: p("Mismatch", "अंतर"), notYet: p("Not entered", "अभी नहीं भरा"),
  copy: p("Copy", "कॉपी"), copied: p("Copied", "कॉपी हुआ"), copyFailed: p("Copy failed — select the value and copy it by hand.", "कॉपी नहीं हुआ — मान चुनकर स्वयं कॉपी करें।"),
  copyRow: p("Copy row", "पूरी पंक्ति कॉपी करें"), markEntered: p("Mark entered → next", "भरा गया → अगला"),
  mismatchNote: p("What does the portal show differently?", "पोर्टल में क्या अलग दिख रहा है?"), saveMismatch: p("Save mismatch", "अंतर दर्ज करें"), cancel: p("Cancel", "रद्द करें"),
  prev: p("Previous", "पिछला"), next: p("Next", "अगला"), students: p("Students", "विद्यार्थी"), blank: p("(blank)", "(खाली)"),
  shortcuts: p("Keys: J or → next · K or ← previous · 1–9 copy a field", "कुंजियाँ: J या → अगला · K या ← पिछला · 1–9 फ़ील्ड कॉपी"),
  saveFailed: p("Didn't save. Check the connection and try again.", "सहेजा नहीं गया। कनेक्शन जाँचकर फिर कोशिश करें।"),
  allDone: p("Every row is marked. Record the portal's actual outcome on the batch.", "सभी पंक्तियाँ दर्ज हैं। बैच पर पोर्टल का वास्तविक परिणाम दर्ज करें।"),
  backToBatch: p("Batch", "बैच"), empty: p("This list has no rows.", "इस सूची में कोई पंक्ति नहीं है।"),
  open: p("Open manual entry assistant", "पोर्टल भरने का सहायक खोलें"), mismatches: p("Mismatches noted", "दर्ज अंतर"),
  readOnly: p("View only — marking rows needs permission to prepare returns.", "केवल देखने के लिए — पंक्तियाँ दर्ज करने हेतु विवरण तैयार करने की अनुमति चाहिए।"),
};
export const positionOf = (index: number, total: number) => p(`Student ${index} of ${total}`, `${total} में से विद्यार्थी ${index}`);
export const enteredOf = (entered: number, total: number) => p(`${entered} of ${total} entered`, `${total} में से ${entered} भरे गए`);
