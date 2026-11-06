import { p, type Pair } from "@/vx/text";

/*
 * What one card on a teacher's "Enter marks" list says. A green "Done" is
 * drawn only when the paper is sent with every child accounted for; a paper
 * sent with blanks — or with no children at all — says so and names what is
 * missing ("3 of 14 sent · 11 blank"). "Done ✓ · All 14 sent" over a paper
 * with 11 blanks, and "All 0 sent", were the smoke run's group 12.
 */

export type PickFacts = {
  status: "done" | "in_progress" | "not_started" | "empty";
  entered: number;
  total: number;
  /** Saved marks the paper cannot hold (a .5 on a whole-mark paper). */
  invalid?: number;
  submittedToName?: string | null;
};

export type PickTone = "ok" | "warn" | "acc" | "mut";

export type PickState = { tone: PickTone; pill: Pair; line: Pair; action: Pair; sent: boolean };

export function pickState(c: PickFacts): PickState {
  const blank = Math.max(0, c.total - c.entered);
  const fix = c.invalid ?? 0;
  if (c.status === "done") {
    const view = p("View", "देखें");
    if (c.total === 0) {
      return { tone: "warn", sent: true, action: view, pill: p("Sent · no children", "भेजा · कोई बच्चा नहीं"), line: p("No children are on this paper. Tell the exam office.", "इस पेपर पर कोई बच्चा नहीं है। परीक्षा प्रभारी को बताएँ।") };
    }
    if (blank > 0) {
      return {
        tone: "warn",
        sent: true,
        action: view,
        pill: p(`Sent · ${blank} blank`, `भेजा · ${blank} खाली`),
        line: p(`${c.entered} of ${c.total} sent · ${blank} blank — tell the exam office`, `${c.total} में से ${c.entered} भेजे · ${blank} खाली — परीक्षा प्रभारी को बताएँ`),
      };
    }
    if (fix > 0) {
      return {
        tone: "warn",
        sent: true,
        action: view,
        pill: p(`Sent · ${fix} to fix`, `भेजा · ${fix} ठीक करने हैं`),
        line: p(`${c.total} of ${c.total} sent · ${fix} ${fix === 1 ? "mark needs" : "marks need"} fixing — tell the exam office`, `${c.total} में से ${c.total} भेजे · ${fix} अंक ठीक करने हैं — परीक्षा प्रभारी को बताएँ`),
      };
    }
    const to = c.submittedToName;
    return {
      tone: "ok",
      sent: true,
      action: view,
      pill: p("Done ✓", "पूरा ✓"),
      line: to
        ? p(`${c.total} of ${c.total} sent to ${to}`, `${c.total} में से ${c.total} ${to} को भेजे`)
        : p(`${c.total} of ${c.total} sent`, `${c.total} में से ${c.total} भेजे`),
    };
  }
  if (c.total === 0) {
    // "0 of 0 entered · Start" read as a paper that just needs filling in; it
    // has nobody on it (6 Nov school day).
    return { tone: "warn", sent: false, action: p("View", "देखें"), pill: p("No children", "कोई बच्चा नहीं"), line: p("No children are on this paper yet. Tell the exam office.", "इस पेपर पर अभी कोई बच्चा नहीं है। परीक्षा प्रभारी को बताएँ।") };
  }
  const entered = p(`${c.entered} of ${c.total} entered`, `${c.total} में से ${c.entered} भरे`);
  const line = fix > 0 ? p(`${entered.en} · ${fix} to fix`, `${entered.hi} · ${fix} ठीक करने हैं`) : entered;
  if (c.status === "in_progress") return { tone: "acc", sent: false, action: p("Continue", "जारी रखें"), pill: p("In progress", "चल रहा है"), line };
  return { tone: "mut", sent: false, action: p("Start", "शुरू करें"), pill: p("Not started", "शुरू नहीं"), line };
}

/** "results on Sat 17 Oct (PTM)" while it is ahead; "results were on …" once it has passed. */
export function resultsLine(label: string, past: boolean): Pair {
  return past ? p(`results were on ${label}`, `परिणाम ${label} को थे`) : p(`results on ${label}`, `परिणाम ${label} को`);
}
