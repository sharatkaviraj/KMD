"use client";

import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  write: p("Write a summary of these results", "इन परिणामों का सारांश लिखें"),
  title: p("Results summary", "परिणाम सारांश"),
  next: p("Next steps for the class teachers", "कक्षा अध्यापकों के लिए अगले कदम"),
  onlyCounts: p("Only the class’s figures are sent — no child’s name.", "केवल कक्षा के आँकड़े भेजे जाते हैं — किसी बच्चे का नाम नहीं।"),
};

export type ResultsFacts = {
  exam: string;
  classLabel: string;
  children: number;
  counted: number;
  passedAll: number;
  belowCount: number;
  passPct: number;
  previousExam: string | null;
  subjects: { name: Pair; avgPct: number | null; sat: number }[];
};

/**
 * On a class's result analysis (D-324): a plain paragraph, in Hindi and
 * English, of what the figures on the page already say, for the principal,
 * a staff meeting or a PTM notice. The figures are counts and averages; no
 * child's name leaves the school. Nothing is saved — Copy or Share is the
 * way out (D-330).
 */
export function ResultsAssist({ facts }: { facts: ResultsFacts }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("results");
  const summary = useAssistTask("results.summary");
  if (!offer || facts.counted === 0) return null;

  const run = () =>
    void summary.run({
      exam: facts.exam.slice(0, 80),
      classLabel: facts.classLabel.slice(0, 80),
      children: facts.children,
      counted: facts.counted,
      passedAll: facts.passedAll,
      belowCount: facts.belowCount,
      passPct: facts.passPct,
      previousExam: facts.previousExam,
      subjects: facts.subjects.slice(0, 20).map((s) => ({ name: s.name.en.slice(0, 60), avgPct: s.avgPct === null ? null : Math.round(s.avgPct), sat: s.sat })),
    });
  const ready = summary.state.kind === "ready" ? summary.state.value : null;
  const text = ready ? (language === "en" ? ready.en : language === "hi" ? ready.hi : [ready.hi, ready.en].filter(Boolean).join("\n\n")) : "";
  const full = ready ? [text, ...ready.focus.map((f) => `• ${f}`)].filter(Boolean).join("\n") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.write} onClick={run} busy={summary.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {summary.state.kind === "problem" ? <AssistProblemLine problem={summary.state.problem} onClose={summary.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          privacy={false}
          readOnly
          busy={summary.state.kind === "working"}
          takeaway={{ text: full, title: `${facts.classLabel} · ${facts.exam}`, onTaken: summary.keep }}
          onUse={() => summary.decide("kept")}
          onAgain={run}
          onDiscard={() => summary.decide("discarded")}
        >
          <span>{text}</span>
          {ready.focus.length ? (
            <>
              <b style={{ fontSize: "0.93em" }}>{tx(SAY.next)}</b>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {ready.focus.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          ) : null}
          <span className="as-note">{tx(SAY.onlyCounts)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
