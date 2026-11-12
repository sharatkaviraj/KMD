import { t, type Localized } from "@/platform/i18n/language";

/**
 * Settings → WhatsApp (D-562, D-566): the school's own WhatsApp number, its
 * safety switches, the approved templates, the hub's Pay now set, the message
 * log and parents' replies.
 *
 * Rule 9 pairs in a module of their own, like `ai-connection.ts`: only this
 * server page imports it, so none of it ships on a budgeted route.
 */
export const waMessages = {
  crumb: t("सेटिंग्स", "Settings"),
  title: t("स्कूल का WhatsApp", "School WhatsApp"),
  intro: t(
    "One अब अभिभावकों और स्टाफ़ को स्कूल के अपने नंबर से संदेश भेजता है। यहाँ देखें कि क्या जुड़ा है, कौन-से संदेश मंज़ूर हैं, और कौन-सा संदेश नहीं पहुँचा।",
    "One now messages parents and staff from the school's own number. See here what is connected, which messages are approved, and which message did not arrive.",
  ),
  senderName: "Veer Patta School",

  // connection
  connectionTitle: t("जुड़ाव", "Connection"),
  connected: t("जुड़ा है", "Connected"),
  notConnected: t("अभी जुड़ा नहीं", "Not connected yet"),
  practiceBadge: t("अभ्यास चालू", "Practice mode on"),
  providerHub: t("स्कूल का अपना WhatsApp हब", "The school's own WhatsApp hub"),
  providerMeta: t("Meta Cloud API, सीधे", "Meta Cloud API, directly"),
  providerMock: t("नकली (कुछ बाहर नहीं जाता)", "Mock (nothing leaves)"),
  providerNone: t("तय नहीं", "Not set"),
  rowProvider: t("किससे भेजा जाता है", "Sends through"),
  rowNumber: t("नंबर", "Number"),
  rowWebhook: t("पहुँचने की ख़बर", "Delivery updates"),
  webhookOn: t("मिल रही है", "Coming in"),
  webhookOff: t("अभी नहीं (webhook तैयार नहीं)", "Not yet (webhook not set up)"),
  notConnectedHelp: t(
    "हब की चाबी (WHATSAPP_HUB_KEY) अभी Vercel में भरनी है। तब तक कोई संदेश नहीं जाएगा।",
    "The hub's key (WHATSAPP_HUB_KEY) is still to be added in Vercel. Until then no message goes.",
  ),
  checkConnection: t("जुड़ाव जाँचें", "Check connection"),
  checking: t("जाँच रहे हैं…", "Checking…"),

  // safety
  safetyTitle: t("किसे संदेश जा सकता है", "Who can get a message"),
  realOff: t("असली अभिभावक: बंद", "Real parents: off"),
  realOffHelp: t(
    "जाँच के दौरान One सिर्फ़ मालिक के अपने नंबर पर संदेश भेजता है, संदेश किसी के लिए भी हो। इसे Janmejay की लिखित मंज़ूरी के बाद ही चालू किया जाएगा, इस पेज से नहीं।",
    "While testing, One messages only the owner's own number, whoever the message is for. It is switched on only after Janmejay's written approval, never from this page.",
  ),
  realOn: t("असली अभिभावक: चालू", "Real parents: on"),
  ownerNumber: t("जाँच का नंबर", "Test number"),
  ownerMissing: t("तय नहीं — कोई संदेश नहीं जाएगा", "Not set — no message will go"),
  practiceTitle: t("अभ्यास मोड", "Practice mode"),
  practiceOnHelp: t("चालू: हर संदेश सिर्फ़ लिखा जाता है, भेजा नहीं जाता।", "On: every message is only written down here, never sent."),
  practiceOffHelp: t("बंद: मंज़ूर संदेश सच में भेजे जाते हैं (ऊपर के नियमों के अंदर)।", "Off: approved messages really go (within the rules above)."),
  practiceTurnOn: t("अभ्यास चालू करें", "Turn practice on"),
  practiceTurnOff: t("अभ्यास बंद करें", "Turn practice off"),
  saving: t("सहेज रहे हैं…", "Saving…"),
  dailyLimit: t("एक दिन में अधिकतम", "Most in one day"),
  sentToday: (n: number) => t(`आज ${n} भेजे`, `${n} sent today`),
  switchesUnread: t("सेटिंग पढ़ी नहीं जा सकी, इसलिए कुछ नहीं भेजा जाएगा।", "The switches could not be read, so nothing will be sent."),

  // features
  featuresTitle: t("कौन-से संदेश", "Which messages"),
  featuresHelp: t("हर तरह का संदेश अलग से चालू या बंद होता है। बंद संदेश यहाँ 'रोका गया' दिखता है।", "Each kind of message is switched on or off by itself. A switched-off message shows here as 'Held back'."),
  on: t("चालू", "On"),
  off: t("बंद", "Off"),
  turnOn: t("चालू करें", "Switch on"),
  turnOff: t("बंद करें", "Switch off"),
  feesAppSends: t("फ़ीस ऐप", "Fees app"),
  feesAppSendsHelp: t(
    "यह संदेश फ़ीस ऐप अपने नंबर से भेजता है, इसलिए One नहीं भेजता। अभिभावकों को दो बार नहीं मिलेगा।",
    "The Fees app sends this from its own number, so One does not. Parents never get it twice.",
  ),
  helperHelp: t(
    "Veer Patta AI अभिभावकों के सवालों का जवाब देता है: फ़ीस, रसीद, हाज़िरी, परिणाम। अभी सिर्फ़ अभ्यास वाले बच्चों के लिए, मालिक के नंबर पर।",
    "Veer Patta AI answers parents' questions: fees, receipts, attendance, results. For now only the practice children, on the owner's number.",
  ),

  // templates
  templatesTitle: t("मंज़ूर संदेश (टेम्पलेट)", "Approved messages (templates)"),
  templatesHelp: t(
    "हर संदेश पहले Meta से मंज़ूर होता है। जो मंज़ूर नहीं है, वह नहीं भेजा जाता — स्टाफ़ को भेजने से पहले यहीं दिखता है। मंज़ूरी सिर्फ़ हब की सूची से आती है, हाथ से नहीं।",
    "Every message is approved by Meta first. One that is not approved is never sent, and staff see that here before they send. Approval comes only from the hub's list, never by hand.",
  ),
  checkTemplates: t("WhatsApp से जाँचें", "Check with WhatsApp"),
  checkingTemplates: t("जाँच रहे हैं…", "Checking…"),
  noTemplates: t("कोई टेम्पलेट नहीं", "No templates"),
  templateCounts: (approved: number, total: number) => t(`${total} में से ${approved} मंज़ूर`, `${approved} of ${total} approved`),
  showAll: t("सब दिखाएँ", "Show all"),
  quality: (value: string) => t(`गुणवत्ता: ${value}`, `Quality: ${value}`),

  // everything One asks the hub to carry (D-566, D-573)
  hubTitle: t("स्कूल के नंबर के संदेश", "Messages on the school's number"),
  hubHelp: t(
    "Pay now वाले फ़ीस संदेश, अभिभावकों के लिए स्कूल सूचनाएँ (आज अनुपस्थित, अवकाश, परीक्षा, PTM), और स्टाफ़ व अध्यापकों के संदेश — हिंदी और English में। पहले Meta हर संदेश मंज़ूर करता है, इसमें कुछ मिनट से एक-दो दिन लगते हैं। नए संदेश एक घंटे के अंदर अपने-आप मंज़ूरी के लिए चले जाते हैं। मंज़ूरी के लिए भेजने पर किसी को कोई संदेश नहीं जाता।",
    "Fee reminders with Pay now, school notices for parents (absent today, school closed, exams, PTM), and messages for staff and teachers, in Hindi and English. Meta approves each one first, which takes a few minutes to a day or two. New ones go for approval by themselves within the hour. Sending for approval sends nothing to anyone.",
  ),
  hubCounts: (approved: number, waiting: number, notSent: number) =>
    t(`${approved} मंज़ूर · ${waiting} मंज़ूरी बाकी · ${notSent} अभी नहीं भेजे`, `${approved} approved · ${waiting} waiting for Meta · ${notSent} not sent yet`),
  hubSend: (n: number) => t(`${n} संदेश मंज़ूरी के लिए भेजें`, `Send ${n} for approval`),
  hubSending: t("Meta को भेज रहे हैं… करीब आधा मिनट", "Sending to Meta… about half a minute"),
  hubSendConfirm: t(
    "ये संदेश Meta को मंज़ूरी के लिए जाएँगे। किसी अभिभावक या स्टाफ़ को कुछ नहीं जाएगा। भेजें?",
    "These go to Meta for approval. Nothing goes to any parent or member of staff. Send them?",
  ),
  hubAllSent: t("सब भेजे जा चुके हैं। मंज़ूरी आते ही यहाँ दिखेगी।", "All have been sent. Approval shows here as soon as it comes."),
  hubNeedsHub: t("पहले हब जोड़ें (ऊपर 'जुड़ाव जाँचें'), फिर यहाँ से भेजें।", "Connect the hub first (Check connection above), then send from here."),
  hubList: (n: number) => t(`सभी ${n} देखें`, `See all ${n}`),

  // log
  problemsTitle: t("जो नहीं पहुँचे", "Did not arrive"),
  problemsNone: t("कोई परेशानी नहीं — सब ठीक है।", "No problems — everything is fine."),
  logTitle: t("हाल के संदेश", "Recent messages"),
  logNone: t("अभी कोई संदेश नहीं भेजा गया।", "No message has been sent yet."),
  logUnread: t("संदेशों की सूची पढ़ी नहीं जा सकी।", "Could not read the message list."),
  retry: t("फिर भेजें", "Send again"),
  retrying: t("भेज रहे हैं…", "Sending…"),
  retryUnknown: t("फिर भी भेजें", "Send anyway"),
  retryUnknownHelp: t("हो सकता है पहला संदेश पहुँच गया हो। अभिभावक से पूछ लें, फिर ही दबाएँ।", "The first one may have arrived. Check with the parent first."),
  retryOwnScreen: t("उसी स्क्रीन से फिर भेजें", "Send again from its own screen"),
  retried: t("फिर भेजा गया", "Sent again"),
  paid: t("भुगतान हो गया", "Paid"),
  practice: t("अभ्यास", "Practice"),

  // replies
  repliesTitle: t("अभिभावकों के जवाब", "Parents' replies"),
  repliesNone: t("अभी कोई जवाब नहीं आया।", "No replies yet."),
  repliesHelp: t("स्कूल के नंबर पर आए जवाब। One अपने-आप कोई जवाब नहीं भेजता।", "Replies to the school's number. One never answers by itself."),
  replyTo: t("इसका जवाब:", "Answers:"),

  // results of actions
  done: t("हो गया", "Done"),
  failedToSave: t("सहेजा नहीं जा सका। फिर कोशिश करें।", "Could not save. Try again."),
  adminOnly: t("यह सिर्फ़ एडमिन बदल सकते हैं।", "Only an admin can change this."),
} as const;

type Note = { tone: "ok" | "warn" | "bad" | "info"; text: Localized };

/** The line shown after an action, from the `?note=` it came back with. */
export function noteFor(note: string, params: Record<string, string | undefined>): Note | null {
  const why = params.why ?? "";
  // A refusal, answered beside the card whose button was pressed (`<area>_locked`).
  if (/^[a-z]+_locked$/.test(note)) {
    return params.why === "preview"
      ? { tone: "info", text: t("आप One को किसी और की तरह देख रहे हैं। बदलने के लिए अपने खाते पर लौटें। कुछ नहीं बदला।", "You are seeing One as someone else. Go back to your own view to change this. Nothing was changed.") }
      : { tone: "info", text: t("अभ्यास खाता यहाँ देख सकता है, पर पूरे स्कूल की WhatsApp सेटिंग नहीं बदल सकता। कुछ नहीं बदला।", "A practice account can look here but cannot change the school's WhatsApp settings. Nothing was changed.") };
  }
  switch (note) {
    case "conn_ok":
      return { tone: "ok", text: t(`जुड़ा है। WhatsApp इस नंबर को "${params.name ?? "Veer Patta School"}" बताता है।`, `Connected. WhatsApp names this number "${params.name ?? "Veer Patta School"}".`) };
    case "conn_bad":
      return { tone: "bad", text: t(`जुड़ा नहीं: ${why}`, `Not connected: ${why}`) };
    case "practice_on":
      return { tone: "ok", text: t("अभ्यास चालू। अब कोई संदेश नहीं जाएगा, सिर्फ़ लिखा जाएगा।", "Practice on. No message goes now; each is only written down.") };
    case "practice_off":
      return { tone: "warn", text: t("अभ्यास बंद। मंज़ूर संदेश अब सच में जाएँगे (जाँच के नंबर पर)।", "Practice off. Approved messages now really go (to the test number).") };
    case "feature_saved":
      return { tone: "ok", text: t("सहेज लिया।", "Saved.") };
    case "save_bad":
      return { tone: "bad", text: waMessages.failedToSave };
    case "feature_fees_app":
      return { tone: "info", text: waMessages.feesAppSendsHelp };
    case "templates_ok":
      return {
        tone: "ok",
        text: t(
          `${params.checked ?? 0} टेम्पलेट जाँचे: ${params.approved ?? 0} मंज़ूर, ${params.missing ?? 0} अभी खाते में नहीं।`,
          `Checked ${params.checked ?? 0} templates: ${params.approved ?? 0} approved, ${params.missing ?? 0} not on the account yet.`,
        ),
      };
    case "templates_bad":
      return { tone: "bad", text: t(`जाँच नहीं हो सकी: ${why}`, `Could not check: ${why}`) };
    case "hub_sent": {
      const failed = Number(params.failed ?? 0);
      return {
        tone: failed > 0 ? "warn" : "ok",
        text: t(
          `${params.sent ?? 0} संदेश Meta को मंज़ूरी के लिए भेजे।${failed > 0 ? ` ${failed} नहीं जा सके: ${why}` : ""} मंज़ूरी आते ही यहाँ दिखेगी।`,
          `Sent ${params.sent ?? 0} to Meta for approval.${failed > 0 ? ` ${failed} could not go: ${why}` : ""} Approval shows here as soon as it comes.`,
        ),
      };
    }
    case "hub_bad":
      return { tone: "bad", text: t(`मंज़ूरी के लिए नहीं भेजा जा सका: ${why}`, `Could not send for approval: ${why}`) };
    case "retry_accepted":
      return { tone: "ok", text: t("फिर भेज दिया। WhatsApp ने ले लिया।", "Sent again. WhatsApp took it.") };
    case "retry_dry_run":
      return { tone: "info", text: t("अभ्यास चालू है: लिखा गया, भेजा नहीं।", "Practice mode is on: written down, not sent.") };
    case "retry_queued":
      return { tone: "info", text: t("WhatsApp व्यस्त है। One थोड़ी देर में अपने-आप फिर कोशिश करेगा।", "WhatsApp is busy. One will try again by itself shortly.") };
    case "retry_refused":
    case "retry_rejected":
    case "retry_unknown":
      return { tone: "bad", text: t(`नहीं भेजा: ${why}`, `Not sent: ${why}`) };
    case "retry_duplicate":
      return { tone: "info", text: t("यह संदेश पहले ही WhatsApp को दिया जा चुका है।", "This message was already handed to WhatsApp.") };
    case "retry_own_screen":
      return { tone: "info", text: t("यह संदेश अपनी ही स्क्रीन से फिर भेजा जाता है, ताकि पहले जाँच हो सके।", "This one is sent again from its own screen, so it can be checked first.") };
    case "retry_confirm_unknown":
      return { tone: "warn", text: waMessages.retryUnknownHelp };
    case "retry_already_retried":
      return { tone: "info", text: t("यह पहले ही फिर भेजा जा चुका है।", "This one has already been sent again.") };
    case "retry_not_failed":
    case "retry_not_found":
    case "retry_bad":
      return { tone: "info", text: t("इसे फिर भेजने की ज़रूरत नहीं।", "There is nothing to send again here.") };
    default:
      return null;
  }
}

export const featureLabels: Record<string, Localized> = {
  fee_reminder: t("फ़ीस की याद", "Fee reminders"),
  receipt: t("रसीद", "Receipts"),
  reversal: t("रसीद वापसी", "Receipt reversals"),
  fee_statement: t("फ़ीस विवरण", "Fee statements"),
  school_notice: t("स्कूल सूचनाएँ (परीक्षा, PTM, छुट्टी)", "School notices (exams, PTM, closures)"),
  absent_notice: t("आज अनुपस्थित", "Absent today"),
  collection_request: t("जानकारी माँगने के लिंक", "Collection links"),
  report_delivery: t("रिपोर्ट कार्ड", "Report cards"),
  general: t("अभिभावकों को अन्य संदेश", "Other parent messages"),
  staff_notice: t("स्टाफ़ सूचनाएँ", "Staff notices"),
  teacher_task: t("शिक्षक कार्य", "Teacher tasks"),
  parent_helper: t("Veer Patta AI (अभिभावकों के सवाल)", "Veer Patta AI (parents' questions)"),
};

export const messageStatusLabels: Record<string, Localized> = {
  dry_run: t("अभ्यास (नहीं भेजा)", "Practice (not sent)"),
  held: t("रोका गया", "Held back"),
  queued: t("भेजने की प्रतीक्षा", "Waiting to send"),
  sending: t("भेज रहे हैं", "Sending"),
  retry_wait: t("फिर कोशिश होगी", "Will try again"),
  accepted: t("WhatsApp को सौंपा", "Handed to WhatsApp"),
  sent: t("भेजा गया", "Sent"),
  delivered: t("पहुँच गया", "Delivered"),
  read: t("पढ़ लिया", "Read"),
  failed: t("नहीं पहुँचा", "Failed"),
  unknown: t("पता नहीं पहुँचा या नहीं", "Not sure it went"),
  cancelled: t("रद्द", "Cancelled"),
};

export const templateStatusLabels: Record<string, Localized> = {
  approved: t("मंज़ूर", "Approved"),
  pending: t("Meta की मंज़ूरी बाकी", "Waiting for Meta"),
  not_submitted: t("Meta को अभी नहीं भेजा", "Not sent to Meta yet"),
  rejected: t("नामंज़ूर", "Rejected"),
  paused: t("Meta ने रोका", "Paused by Meta"),
  disabled: t("बंद", "Switched off"),
};
