import type { StaffPermission } from "@/platform/auth/permissions";

/**
 * The AI helper (D-324): Claude drafts, a person decides.
 *
 * PLAN §9 allows AI as "suggestions with review only" and §1 says no ordinary
 * task may need it. So every feature here produces a draft that lands in a
 * field the person can still edit, nothing is saved or sent by the helper,
 * and every screen works the same with the helper switched off — the button
 * is simply not there.
 *
 * A feature is what the admin switches on or off and what the usage page
 * counts. Each one names the permissions that already let somebody do the
 * job by hand: the helper never widens what a person may do, it only offers
 * to write the first draft of it.
 */
export const assistFeatures = [
  "note",
  "remarks",
  "cover",
  "message",
  "form",
  "columns",
  "results",
  "ask",
  "translate",
  "summary",
  "calls",
  "brief",
] as const;

export type AssistFeature = (typeof assistFeatures)[number];

export function isAssistFeature(value: unknown): value is AssistFeature {
  return typeof value === "string" && (assistFeatures as readonly string[]).includes(value);
}

/** Any one of these is enough, as with `canAny`. */
export const FEATURE_PERMISSIONS: Record<AssistFeature, readonly StaffPermission[]> = {
  note: ["notes:write"],
  remarks: ["marks:write", "assessments:manage"],
  cover: ["substitutions:view"],
  message: ["messages:send"],
  // The admission form is behind `fees:manage`, as its nav item is.
  form: ["fees:manage"],
  columns: ["fees:manage"],
  results: ["reports:view"],
  ask: ["dashboard:view"],
  translate: ["dashboard:view"],
  summary: ["notes:view"],
  // The fee desk's dues calls, and the attendance calls a coordinator or the office makes.
  calls: ["fees:view", "attendance:mark_on_behalf"],
  // The weekly brief sits on Today for the people who run the school's day.
  brief: ["attendance:correct"],
};

/**
 * Two tiers, chosen by the task and never by the person (nobody at a school
 * desk should be asked to pick a model). Quick is Claude Haiku 5.5: short
 * rewrites, translation, matching and questions, at a few hundredths of a
 * cent each. Careful is Claude Sonnet 5.5: reading a photograph and writing
 * remarks or a results summary that a parent or the principal will read.
 */
export type AssistTier = "quick" | "careful";

export const ASSIST_MODELS: Record<AssistTier, string> = {
  quick: "claude-haiku-5-5",
  careful: "claude-sonnet-5-5",
};

/** The words the admin's settings page and usage table use. */
export const FEATURE_LABELS: Record<AssistFeature, { en: string; hi: string; sub: { en: string; hi: string } }> = {
  note: {
    en: "Note helper",
    hi: "नोट सहायक",
    sub: { en: "Tidies a typed or spoken note and suggests its type", hi: "लिखे या बोले नोट को साफ़ करता है और प्रकार सुझाता है" },
  },
  remarks: {
    en: "Report-card remarks",
    hi: "रिपोर्ट कार्ड टिप्पणी",
    sub: { en: "Drafts a remark per child from marks and attendance", hi: "अंक व हाज़िरी से हर बच्चे की टिप्पणी का मसौदा" },
  },
  cover: {
    en: "Cover-period plan",
    hi: "सब्स्टिट्यूट पीरियड योजना",
    sub: { en: "A ready activity for a period you are covering", hi: "दूसरे की कक्षा के पीरियड के लिए तैयार गतिविधि" },
  },
  message: {
    en: "Notice & reply writer",
    hi: "सूचना व जवाब लेखक",
    sub: { en: "Writes a notice from a few words, polishes it, drafts replies", hi: "कुछ शब्दों से सूचना लिखता है, सुधारता है, जवाब सुझाता है" },
  },
  form: {
    en: "Read a paper form",
    hi: "कागज़ी फ़ॉर्म पढ़ें",
    sub: { en: "Fills the admission form from a photo, for you to check", hi: "फ़ोटो से दाख़िला फ़ॉर्म भरता है, आप जाँचें" },
  },
  columns: {
    en: "Spreadsheet column matching",
    hi: "शीट कॉलम मिलान",
    sub: { en: "Matches an uploaded sheet's headings to student fields", hi: "अपलोड शीट के शीर्षक विद्यार्थी फ़ील्ड से मिलाता है" },
  },
  results: {
    en: "Results summary",
    hi: "परिणाम सारांश",
    sub: { en: "A plain paragraph on a class's results", hi: "कक्षा के परिणाम पर सरल अनुच्छेद" },
  },
  ask: {
    en: "Ask & how-to",
    hi: "पूछें व कैसे करें",
    sub: { en: "Answers “how do I…” and opens the right page", hi: "“कैसे करूँ…” का जवाब देकर सही पेज खोलता है" },
  },
  translate: {
    en: "Translate",
    hi: "अनुवाद",
    sub: { en: "Hindi ↔ English wherever you write", hi: "जहाँ भी लिखें, हिंदी ↔ अंग्रेज़ी" },
  },
  summary: {
    en: "Notes in short",
    hi: "नोट्स संक्षेप में",
    sub: { en: "A child’s notes before a parent meeting; a class’s week of notes", hi: "अभिभावक बैठक से पहले बच्चे के नोट्स; कक्षा के हफ़्ते भर के नोट्स" },
  },
  calls: {
    en: "Call scripts",
    hi: "कॉल में क्या कहें",
    sub: { en: "What to say when calling about dues or absence; the app fills the figures", hi: "बकाया या अनुपस्थिति पर कॉल में क्या कहें; आँकड़े ऐप भरता है" },
  },
  brief: {
    en: "Weekly brief",
    hi: "हफ़्ते का सार",
    sub: { en: "This week in plain words on Today; every figure is the app’s", hi: "‘आज’ पर इस हफ़्ते का सार; हर आँकड़ा ऐप का" },
  },
};

export function featureTier(feature: AssistFeature): AssistTier {
  return feature === "remarks" || feature === "form" || feature === "results" || feature === "brief" ? "careful" : "quick";
}

/**
 * Why a draft was not made. The screens turn each into one sentence; none of
 * them is an error page, because the person can always write it themselves.
 */
export const assistProblems = [
  "off",
  "denied",
  "daily_cap",
  "budget",
  "invalid",
  "refused",
  "busy",
  "failed",
] as const;

export type AssistProblem = (typeof assistProblems)[number];

export type AssistOutcome<T> =
  | { ok: true; value: T; logId: string | null }
  | { ok: false; problem: AssistProblem };

/** What the person did with a draft — the only measure of whether a feature is worth its cost. */
export const assistDecisions = ["kept", "edited", "discarded"] as const;
export type AssistDecision = (typeof assistDecisions)[number];

export function isAssistDecision(value: unknown): value is AssistDecision {
  return typeof value === "string" && (assistDecisions as readonly string[]).includes(value);
}

/**
 * Kept, or kept after changes: compares what was offered with what is in the
 * field when the person saves. Whitespace does not count as an edit.
 */
export function decisionFor(offered: string, final: string): AssistDecision {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (!norm(final)) return "discarded";
  return norm(offered) === norm(final) ? "kept" : "edited";
}
