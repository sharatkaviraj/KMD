"use client";

import type { CSSProperties } from "react";

import { factRuns } from "@/modules/assist/domain/facts";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  ask: p("Today and this week in plain words", "आज और इस हफ़्ते का सार"),
  title: p("In plain words", "सरल शब्दों में"),
  next: p("Next", "आगे क्या करें"),
  done: p("Got it", "ठीक है"),
  figures: p("Figures in bold are taken from this page; the AI writes only the words around them.", "मोटे अक्षरों वाले आँकड़े इसी पेज से हैं; AI केवल उनके आस-पास के शब्द लिखता है।"),
};

export type BriefFact = { key: string; label: string; value: string | null | undefined };

/**
 * On Today (D-328): the day and the week in a few sentences. The figures
 * are school-wide — no child or family is named — and every one is written
 * by the app into the AI's `<<slot>>`, so the brief cannot misquote a number.
 */
export function TodayBrief({ facts, style }: { facts: readonly BriefFact[]; style?: CSSProperties }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("brief");
  const brief = useAssistTask("brief.today");
  const present = facts.filter((f): f is BriefFact & { value: string } => Boolean(f.value?.trim()));
  if (!offer || present.length < 2) return null;

  const values = Object.fromEntries(present.map((f) => [f.key, f.value.trim()]));
  const run = () => void brief.run({ language, facts: present.slice(0, 20).map((f) => ({ key: f.key, label: f.label.slice(0, 80), value: f.value.trim().slice(0, 120) })) });
  const ready = brief.state.kind === "ready" ? brief.state.value : null;
  const show = (line: string) => factRuns(line, values).map((r, i) => (r.fact ? <b key={i}>{r.text}</b> : <span key={i}>{r.text}</span>));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      {!ready ? <AssistButton label={SAY.ask} onClick={run} busy={brief.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {brief.state.kind === "problem" ? <AssistProblemLine problem={brief.state.problem} onClose={brief.reset} /> : null}
      {ready ? (
        <AssistSuggestion title={SAY.title} privacy={false} busy={brief.state.kind === "working"} useLabel={SAY.done} onUse={() => brief.decide("kept")} onAgain={run} onDiscard={() => brief.decide("discarded")}>
          <b style={{ fontWeight: 600 }}>{show(ready.headline)}</b>
          {ready.points.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{ready.points.map((x, i) => <li key={i}>{show(x)}</li>)}</ul> : null}
          {ready.actions.length ? (
            <>
              <b style={{ fontSize: 13 }}>{tx(SAY.next)}</b>
              <ol style={{ margin: 0, paddingLeft: 18 }}>{ready.actions.map((x, i) => <li key={i}>{show(x)}</li>)}</ol>
            </>
          ) : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.figures)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
