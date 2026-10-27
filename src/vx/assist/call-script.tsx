"use client";

import { factRuns, fillFacts } from "@/modules/assist/domain/facts";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  ask: p("What to say on this call", "इस कॉल में क्या कहें"),
  title: p("What you could say", "आप ऐसे कह सकते हैं"),
  figures: p("Figures in bold are the app’s own. Only the kind of call goes to the AI — no name, number or amount.", "मोटे अक्षरों वाले आँकड़े ऐप के अपने हैं। AI को केवल कॉल का प्रकार जाता है — कोई नाम, नंबर या राशि नहीं।"),
};

/** One fact the app can put into the script: its slot name, a label for the AI, and the value shown to the caller. */
export type CallFact = { key: string; label: string; value: string | null | undefined };

/**
 * Beside a call (D-328): what to say when phoning a parent about dues or
 * absence. The AI sees only which facts exist ("amount", "due date") and the
 * kind of situation; it writes `<<amount>>`, and this screen fills in the
 * family's own figures, which never leave the browser. Nothing is saved: the
 * caller still logs the call as before.
 *
 * On a phone (D-330) the script is the size of body text and stays open
 * after Copy, because it is read while the call goes on.
 */
export function CallScript({ topic, facts, situation }: { topic: "dues" | "absence"; facts: readonly CallFact[]; situation: readonly string[] }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("calls");
  const script = useAssistTask("call.script");
  if (!offer) return null;

  const present = facts.filter((f): f is CallFact & { value: string } => Boolean(f.value?.trim()));
  const values = Object.fromEntries(present.map((f) => [f.key, f.value.trim()]));
  const run = () =>
    void script.run({
      topic,
      language,
      slots: present.slice(0, 12).map((f) => ({ key: f.key, label: f.label.slice(0, 60) })),
      situation: situation.slice(0, 6).map((s) => s.slice(0, 120)),
    });
  const ready = script.state.kind === "ready" ? script.state.value : null;
  const lines = ready ? [ready.opening, ...ready.points, ready.close].filter(Boolean) : [];
  const show = (line: string) =>
    factRuns(line, values).map((run, i) => (run.fact ? <b key={i}>{run.text}</b> : <span key={i}>{run.text}</span>));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.ask} onClick={run} busy={script.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {script.state.kind === "problem" ? <AssistProblemLine problem={script.state.problem} onClose={script.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          privacy={false}
          readOnly
          busy={script.state.kind === "working"}
          takeaway={{ text: lines.map((l) => fillFacts(l, values)).join("\n"), onTaken: script.keep }}
          onUse={() => script.decide("kept")}
          onAgain={run}
          onDiscard={() => script.decide("discarded")}
        >
          {lines.map((line, i) => (
            <span key={i} style={i > 0 && i < lines.length - (ready.close ? 1 : 0) ? { paddingLeft: 12, borderLeft: "2px solid var(--bd)" } : undefined}>
              {show(line)}
            </span>
          ))}
          <span className="as-note">{tx(SAY.figures)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
