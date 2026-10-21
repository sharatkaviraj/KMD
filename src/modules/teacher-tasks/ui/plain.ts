import { p } from "@/vx/text";

/**
 * Plain words for the assigned-work screens, where the shared catalogue
 * (`messages/setup.ts`) still says "API sending is unavailable" and
 * "Acceptance is not delivery confirmation" (smoke run, 20 Oct: the office
 * could not tell whether the teacher had been told at all). Each says what
 * happened to the teacher and what to do next.
 */
export const PLAIN = {
  created: p(
    "Given to the teacher. It shows on their Today in the app; this page says when they open it.",
    "शिक्षक को दे दिया। यह ऐप में उनके आज वाले पेज पर दिखेगा; वे कब खोलते हैं, यहाँ दिखेगा।",
  ),
  assigned: p("Given in the app", "ऐप में दिया गया"),
  reused: p("Already had this work; nothing new was added", "यह काम पहले से उनके पास था; कुछ नया नहीं जोड़ा"),
  unavailable: p(
    "The app cannot send WhatsApp messages by itself yet. Use 'Prepare WhatsApp link' to send the teacher a message from your own phone.",
    "ऐप अभी अपने-आप WhatsApp नहीं भेज सकता। 'WhatsApp लिंक तैयार करें' से अपने फ़ोन से शिक्षक को संदेश भेजें।",
  ),
  noReceipt: p(
    "WhatsApp does not tell us whether the teacher read the message. The line above says when they opened the work in the app; if they have not by tomorrow, call them.",
    "WhatsApp से पता नहीं चलता कि शिक्षक ने संदेश पढ़ा या नहीं। ऊपर लिखा है कि उन्होंने ऐप में काम कब खोला; कल तक न खोलें तो फ़ोन करें।",
  ),
  unopened: p("Not opened by the teacher yet", "शिक्षक ने अभी नहीं खोला"),
  copy: p("Copy the work's link", "काम का लिंक कॉपी करें"),
  revoke: p("Take the work back", "काम वापस लें"),
  reassign: p("Give it to another teacher", "दूसरे शिक्षक को दें"),
  askAgain: p("Ask again from the start", "फिर से शुरू से माँगें"),
};
