"use client";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  plan: p("Suggest what to do in this period", "इस पीरियड में क्या कराएँ — सुझाव"),
  title: p("A plan for the period", "पीरियड की योजना"),
  tip: p("Tip", "सुझाव"),
};

/** "09:40" → minutes since midnight; `null` for anything else. */
function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * On a cover duty (D-324): a calm, ready activity for a class the teacher
 * did not prepare for, using only the board and notebooks. Nothing is
 * saved; it is something to read on the way to the classroom.
 */
export function CoverAssist({ classLabels, subject, starts, ends }: { classLabels: string; subject: string | null; starts: string; ends: string }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("cover");
  const plan = useAssistTask("cover.plan");
  if (!offer) return null;

  const from = minutesOf(starts);
  const to = minutesOf(ends);
  const minutes = from !== null && to !== null && to > from ? Math.min(120, Math.max(10, to - from)) : 40;
  const run = () => void plan.run({ classLabel: classLabels.slice(0, 80), subject: subject ? subject.slice(0, 80) : null, minutes, language });
  const ready = plan.state.kind === "ready" ? plan.state.value : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.plan} onClick={run} busy={plan.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {plan.state.kind === "problem" ? <AssistProblemLine problem={plan.state.problem} onClose={plan.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          busy={plan.state.kind === "working"}
          privacy={false}
          readOnly
          takeaway={{
            text: [ready.title, ...ready.steps.map((s, i) => `${i + 1}. ${s.minutes} min · ${s.text}`), ready.tip ? `${tx(SAY.tip)}: ${ready.tip}` : ""].filter(Boolean).join("\n"),
            title: classLabels,
            onTaken: plan.keep,
          }}
          onUse={() => plan.decide("kept")}
          onAgain={run}
          onDiscard={() => plan.decide("discarded")}
        >
          {ready.title ? <b>{ready.title}</b> : null}
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            {ready.steps.map((s, i) => (
              <li key={i}>
                <span className="num" style={{ fontWeight: 700 }}>{s.minutes} min</span> · {s.text}
              </li>
            ))}
          </ol>
          {ready.tip ? (
            <span style={{ fontSize: "0.93em", color: "var(--mut)" }}>
              <b>{tx(SAY.tip)}:</b> {ready.tip}
            </span>
          ) : null}
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
