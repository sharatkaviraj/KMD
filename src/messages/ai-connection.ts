import { t } from "@/platform/i18n/language";

/**
 * The AI connection (Claude / ChatGPT through MCP): the consent page, the
 * personal card and the admin page (docs/plans/2026-11-03-mcp-feasibility.md
 * §8.1). No state claims "connected and working" — One cannot see the AI app.
 *
 * Rule 9 pairs, in a module of their own rather than `setup.ts`: client
 * components on budgeted routes (/students, /preferences) import `setup.ts`,
 * and module-level `t()` calls are not tree-shaken, so pairs added there ship
 * on every one of them (D-229; the route bundle budget caught it). Only server
 * components import this file; the Settings home's row is
 * `ai-connection-link.ts`.
 */
export const aiConnectionMessages = {
  consentTitle: t("Claude / ChatGPT को VPPS One से जोड़ें", "Connect Claude / ChatGPT to VPPS One"),
  signedInAs: t("इस खाते से", "Signed in as"),
  wantsToRead: (provider: { hi: string; en: string }) =>
    t(`${provider.hi} आपके नाम से VPPS One पढ़ना चाहता है`, `${provider.en} wants to read VPPS One as you`),
  returnsTo: (host: string) => t(`अनुमति के बाद आप ${host} पर लौटेंगे।`, `After you answer you go back to ${host}.`),
  ownAccountOnly: t(
    "अनुमति तभी दें जब आपने अभी-अभी अपने ख़ुद के Claude/ChatGPT में Connect दबाया हो। किसी और का भेजा लिंक हो तो अनुमति न दें।",
    "Approve only if you pressed Connect in your own Claude/ChatGPT just now. If someone sent you this link, don't allow it.",
  ),
  localBadge: t("स्थानीय टेस्ट", "Local test"),
  localWarning: t(
    "यह अनुमति इसी कंप्यूटर पर चल रहे किसी प्रोग्राम को मिलेगी। तभी दें जब वह प्रोग्राम आपने ख़ुद चलाया हो।",
    "This gives access to a program on this computer. Allow it only if you started that program yourself.",
  ),
  canDo: t("यह क्या कर सकता है — सिर्फ़ पढ़ना", "What it can do — read only"),
  tools: {
    get_context: t("आपका नाम, भूमिका और चालू सत्र देखना", "See your name, role and the current session"),
    school_day_summary: t("किसी दिन हर कक्षा की हाज़िरी की गिनती देखना (बच्चों के नाम नहीं)", "See each class's attendance counts for a day (no pupil names)"),
    who_is_away: t("कौन-से स्टाफ़ अनुपस्थित हैं (कारण कभी नहीं)", "See which staff are away (never the reason)"),
    cover_plan: t("दिन की व्यवस्था (कौन किसकी जगह)", "See the day's cover plan"),
    pending_leave: t("निर्णय के लिए रुकी छुट्टियाँ (टिप्पणी कभी नहीं)", "See leave waiting for a decision (never the note)"),
  } as Record<string, { hi: string; en: string }>,
  cannot: t(
    "यह कुछ बदल नहीं सकता, फ़ीस नहीं देख सकता, और बच्चों के नाम, फ़ोन या कागज़ात नहीं देख सकता।",
    "It cannot change anything, cannot see fees, and cannot see pupils' names, phone numbers or documents.",
  ),
  lasts: t(
    "यह अनुमति 90 दिन चलेगी। VPPS One → पसंद में कभी भी बंद कर सकते हैं।",
    "This lasts 90 days. You can disconnect it at any time in VPPS One → Preferences.",
  ),
  approve: t("अनुमति दें", "Allow"),
  deny: t("अनुमति न दें", "Don't allow"),
  goBack: t("वापस जाएँ", "Go back"),
  invalidRequest: t(
    "यह कनेक्शन अनुरोध सही नहीं है। AI ऐप से फिर शुरू करें। कहीं कुछ भेजा नहीं गया।",
    "This connection request is not valid. Start again from the AI app. Nothing was sent anywhere.",
  ),
  unknownHost: t("इस पते पर AI कनेक्शन उपलब्ध नहीं है।", "The AI connection is not served at this address."),
  notEligible: t("इस खाते पर AI कनेक्शन अभी उपलब्ध नहीं है।", "The AI connection is not available on this account yet."),
  testNotAdmin: t("TEST सत्र में AI कनेक्शन सिर्फ़ प्रशासक खाते के लिए है।", "Only admin accounts may use the AI connection in the TEST session."),
  switchedOff: t("स्कूल ने AI कनेक्शन बंद किया है।", "The school has switched the AI connection off."),
  notSaved: t("अनुमति दर्ज नहीं हो सकी। फिर से कोशिश करें।", "The approval could not be saved. Try again."),
  // The card
  cardTitle: t("Claude / ChatGPT कनेक्टर", "Claude / ChatGPT connector"),
  // Today's one-line status (owner, 4 Nov: "highlight it on the home page")
  stripTitle: t("Claude कनेक्टर", "Claude connector"),
  stripNotConnected: t("Claude को VPPS One से जोड़ें — दो मिनट लगते हैं", "Connect Claude to VPPS One — it takes two minutes"),
  stripSwitchedOffAdmin: t("स्कूल का AI स्विच बंद है", "The school's AI switch is off"),
  stripConnect: t("जोड़ें", "Connect"),
  stripReconnect: t("फिर जोड़ें", "Reconnect"),
  stripTurnOn: t("चालू करें", "Turn on"),
  stripManage: t("देखें", "View"),
  copyAddress: t("पता कॉपी करें", "Copy address"),
  copied: t("कॉपी हो गया", "Copied"),
  notConnected: t("जुड़ा नहीं है", "Not connected"),
  allowed: t("अनुमति है", "Allowed"),
  lastUsed: (when: string) => t(`आख़िरी उपयोग ${when}`, `last used ${when}`),
  notUsedYet: t("अभी उपयोग नहीं हुआ", "not used yet"),
  idle: t("30 दिन से उपयोग नहीं हुआ — ज़रूरत न हो तो बंद कर दें।", "Not used for 30 days — disconnect it if you no longer need it."),
  cardSwitchedOff: t("स्कूल ने बंद किया है", "Switched off by the school"),
  disconnected: t("बंद किया गया", "Disconnected"),
  disconnectedOn: (when: string) => t(`${when} को बंद किया गया`, `Disconnected on ${when}`),
  reconnect: t("फिर से जोड़ना होगा", "Reconnect required"),
  reconnectHelp: t("अनुमति समाप्त हो गई या रद्द हुई। AI ऐप में फिर से जोड़ें।", "The approval ended or was cancelled. Connect again from the AI app."),
  unavailable: t("इस खाते पर उपलब्ध नहीं", "Unavailable on this account"),
  unavailableHelp: t("अभी यह सिर्फ़ प्रशासकों के लिए है।", "For now this is for admins only."),
  ends: (when: string) => t(`${when} तक`, `until ${when}`),
  disconnect: t("बंद करें", "Disconnect"),
  addressLabel: t("कनेक्शन का पता", "Connection address"),
  howClaude: t(
    "Claude में: Customize → Connectors → Add custom connector → यह पता चिपकाएँ, फिर VPPS One में अनुमति दें।",
    "In Claude: Customize → Connectors → Add custom connector → paste this address, then approve in VPPS One.",
  ),
  // "Connect Claude": copies the address and opens Claude's Connectors page (owner, 4 Nov).
  // Claude documents no link that pre-fills the address, so the last steps are said, not skipped.
  connectClaude: t("Claude से जोड़ें", "Connect Claude"),
  claudeOpened: t("Claude नए टैब में खुला और पता कॉपी हो गया। वहाँ:", "Claude opened in a new tab and the address is copied. There:"),
  claudeOpenedNoCopy: t("Claude नए टैब में खुला। पता अपने-आप कॉपी नहीं हुआ — नीचे दिया पता कॉपी करें। वहाँ:", "Claude opened in a new tab. The address could not be copied for you — copy it below. There:"),
  claudeStep1: t("“Add custom connector” दबाएँ।", "Tap “Add custom connector”."),
  claudeStep2: t("नाम में “VPPS One” लिखें और पता चिपकाएँ (Ctrl+V, या दबाकर रखें → Paste)।", "Name it “VPPS One” and paste the address (Ctrl+V, or press and hold → Paste)."),
  claudeStep3: t("“Add”, फिर “Connect” दबाएँ, और VPPS One में “अनुमति दें” दबाएँ।", "Tap “Add”, then “Connect”, then tap “Allow” in VPPS One."),
  claudeOpenAgain: t("Claude फिर खोलें", "Open Claude again"),
  claudeOnce: t(
    "यह एक बार कंप्यूटर या फ़ोन के ब्राउज़र में करें; उसके बाद Claude ऐप में भी चलता है।",
    "Do this once on a computer or in your phone's browser; after that it works in the Claude app too.",
  ),
  howChatGpt: t(
    "ChatGPT: ऐसा workspace चाहिए जिसमें custom connectors की अनुमति हो। इसकी जाँच अभी चल रही है।",
    "ChatGPT: needs a workspace that allows custom connectors. This is still being verified.",
  ),
  honesty: t(
    "VPPS One यह नहीं देख सकता कि AI ऐप में यह अब भी जुड़ा है या नहीं — यहाँ सिर्फ़ वही दिखता है जो One ने अनुमति दी।",
    "VPPS One cannot see whether the AI app still has it — this shows only what One allowed.",
  ),
  // The admin page
  adminTitle: t("Claude / ChatGPT कनेक्टर", "Claude / ChatGPT connector"),
  // What the page is, and what it is not (D-501): the AI helper inside One is a different thing.
  whatTitle: t("यह क्या है", "What this is"),
  whatBody: t(
    "कनेक्टर से स्टाफ़ का अपना Claude या ChatGPT ऐप, उनके सवाल पर, One से कुछ गिनती पढ़ सकता है — आज की हाज़िरी, कौन छुट्टी पर है, दिन की व्यवस्था। यह One के अंदर का AI सहायक नहीं है: वह One की स्क्रीन पर मसौदे लिखता है और उसका अपना पेज है।",
    "The connector lets a staff member's own Claude or ChatGPT app read a few counts from One when they ask it something — today's attendance, who is away, the cover plan. It is not the AI helper inside One: that one writes drafts on One's screens and has its own page.",
  ),
  flowApp: t("आपका Claude / ChatGPT", "Your Claude / ChatGPT"),
  flowAsks: t("पूछता है", "asks"),
  flowOne: t("VPPS One · सिर्फ़ पढ़ना", "VPPS One · read only"),
  flowAnswers: t("सिर्फ़ गिनती लौटाता है", "answers with counts only"),
  helperLink: t("One के अंदर का AI सहायक देखें", "See the AI helper inside One"),
  helperLinkSub: t("मसौदे, फ़ोटो और आवाज़: किस AI ने क्या किया और कितना खर्च", "Drafts, photos and voice: what each AI did and cost"),
  canReadTitle: t("यह क्या पढ़ सकता है", "What it can read"),
  cannotTitle: t("यह कभी नहीं कर सकता", "What it can never do"),
  monthTitle: t("इस महीने", "This month"),
  monthAnswered: (n: number) => t(`${n} सवालों के जवाब दिए`, `${n} ${n === 1 ? "question" : "questions"} answered`),
  monthRefused: (n: number) => t(`${n} मना किए`, `${n} refused`),
  monthFailed: (n: number) => t(`${n} नहीं हो सके`, `${n} could not be answered`),
  monthNone: t("इस महीने अभी कोई सवाल नहीं।", "No questions yet this month."),
  monthUnread: t("इस महीने की गिनती नहीं पढ़ी जा सकी।", "This month's count could not be read."),
  freeOfCost: t(
    "One के लिए इसका कोई खर्च नहीं: सवाल का जवाब आपके अपने Claude या ChatGPT खाते में बनता है।",
    "It costs One nothing: the answer is written in your own Claude or ChatGPT account.",
  ),
  settingsCrumb: t("सेटिंग्स", "Settings"),
  switchTitle: t("स्कूल का स्विच", "School switch"),
  stateOn: t("चालू", "On"),
  stateOff: t("बंद", "Off"),
  switchOn: t("चालू — योग्य स्टाफ़ AI कनेक्शन उपयोग कर सकते हैं", "On — eligible staff can use the AI connection"),
  switchOff: t("बंद — हर टूल मना करेगा; कनेक्शन और रिकॉर्ड रहेंगे", "Off — every tool is refused; connections and records are kept"),
  switchUnknown: t("स्विच पढ़ा नहीं जा सका — बंद माना जा रहा है", "The switch could not be read — treated as off"),
  turnOn: t("चालू करें", "Turn on"),
  turnOff: t("बंद करें", "Turn off"),
  connectionsTitle: t("कनेक्शन", "Connections"),
  colStaff: t("स्टाफ़", "Staff"),
  colProvider: t("सेवा", "Provider"),
  colCreated: t("जोड़ा", "Connected"),
  colLastUsed: t("आख़िरी उपयोग", "Last used"),
  colExpires: t("समाप्ति", "Ends"),
  colStatus: t("स्थिति", "Status"),
  noConnections: t("अभी कोई कनेक्शन नहीं।", "No connections yet."),
  never: t("कभी नहीं", "never"),
  logNote: t(
    "हर टूल-कॉल की सिर्फ़ गिनती रखी जाती है (कौन, कौन-सा टूल, नतीजा, समय) — सवाल या जवाब कभी नहीं। 180 दिन रखी जाती है।",
    "Only a count of each tool call is kept (who, which tool, outcome, time) — never the question or the answer. Kept 180 days.",
  ),
  eligibleNote: t("अभी सिर्फ़ प्रशासक जोड़ सकते हैं (स्वामी का निर्णय: पहले प्रशासक, फिर अध्यापक)।", "For now only admins can connect (owner's decision: admins first, then teachers)."),
  done: t("हो गया", "Done"),
  failed: t("नहीं हो सका। फिर से कोशिश करें।", "That did not work. Try again."),
} as const;
