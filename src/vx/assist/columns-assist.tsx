"use client";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  match: (n: number) => p(`Match the other ${n} with AI`, `बाकी ${n} AI से मिलाएँ`),
  title: p("Suggested matches", "सुझाए मिलान"),
  apply: p("Use these matches", "ये मिलान लें"),
  none: p("AI found no sure match for the other columns. Pick them yourself or leave them out.", "बाकी कॉलम का पक्का मिलान AI को नहीं मिला। खुद चुनें या छोड़ दें।"),
  headingsOnly: p("Only the column headings are sent, never the students’ details.", "केवल कॉलम के शीर्षक भेजे जाते हैं, विद्यार्थियों की जानकारी कभी नहीं।"),
};

type Field = { key: string; label: string; description: string };

/**
 * On the import's column step (D-324): headings the exact and alias matches
 * missed ("Pita ka naam", "Mob. No.") are matched by AI. Only the headings
 * go out. The matches arrive as a list to accept; accepted ones show as
 * "Picked" in the table, where every one can still be changed.
 */
export function ColumnsAssist({
  headers,
  fields,
  map,
  onApply,
}: {
  headers: readonly string[];
  fields: readonly Field[];
  map: Record<string, string>;
  onApply: (matches: { header: string; field: string }[]) => void;
}) {
  const { tx } = useVx();
  const offer = useAssistOffers("columns");
  const match = useAssistTask("columns.match");
  if (!offer) return null;

  const mappedHeaders = new Set(Object.values(map));
  const loose = headers.filter((h) => !mappedHeaders.has(h));
  const taken = Object.keys(map);
  const label = new Map(fields.map((f) => [f.key, f.label]));
  const ready = match.state.kind === "ready" ? match.state.value.matches.filter((m): m is { header: string; field: string } => Boolean(m.field)) : null;

  if (loose.length === 0 && !ready) return null;
  const run = () =>
    void match.run({
      headers: loose.slice(0, 80).map((h) => h.slice(0, 120)),
      fields: fields.filter((f) => !taken.includes(f.key)).slice(0, 80).map((f) => ({ key: f.key, label: f.label.slice(0, 120), description: f.description.slice(0, 300) })),
      taken,
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.match(loose.length)} onClick={run} busy={match.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {match.state.kind === "problem" ? <AssistProblemLine problem={match.state.problem} onClose={match.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          privacy={false}
          useLabel={SAY.apply}
          onUse={
            ready.length
              ? () => {
                  onApply(ready);
                  match.decide("kept");
                }
              : undefined
          }
          onDiscard={() => match.decide("discarded")}
        >
          {ready.length ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              {ready.map((m) => (
                <li key={m.header}>
                  <b>{m.header}</b> → {label.get(m.field) ?? m.field}
                </li>
              ))}
            </ul>
          ) : (
            <span>{tx(SAY.none)}</span>
          )}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.headingsOnly)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
