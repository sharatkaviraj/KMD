"use client";

import { looksLikeQuestion } from "@/modules/assist/domain/text";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistProblemLine } from "./parts";

const SAY = {
  ask: (q: string) => p(`Ask: “${q}”`, `पूछें: “${q}”`),
  askSub: p("AI answers how to do it and opens the right page", "AI बताएगा कैसे करें और सही पेज खोलेगा"),
  thinking: p("Finding the answer…", "जवाब ढूँढ रहे हैं…"),
  open: p("Open", "खोलें"),
  searchFor: (term: string) => p(`Search for “${term}”`, `“${term}” खोजें`),
  hint: p("You can also ask a question, like “how do I mark attendance for another class?”", "आप सवाल भी पूछ सकते हैं, जैसे “दूसरी कक्षा की हाज़िरी कैसे लगाऊँ?”"),
  note: p("Answered by AI. It cannot see the school’s records — check figures on the page itself.", "जवाब AI का है। यह स्कूल का रिकॉर्ड नहीं देखता — आँकड़े पेज पर ही देखें।"),
};

type Page = { href: string; label: Pair; icon: IconName };

/**
 * The search box's AI row (D-324). Names, SR numbers and receipts are still
 * found by the ordinary search; a question gets one more row, "Ask", which
 * answers in a few lines and links only pages this person can open. It never
 * states a figure: it cannot see the school's records, and says so.
 */
export function AskRow({ question, pages, onGo, onSearch }: { question: string; pages: readonly Page[]; onGo: (href: string) => void; onSearch: (term: string) => void }) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("ask");
  const ask = useAssistTask("ask.answer");
  if (!offer || !looksLikeQuestion(question)) return null;

  const ready = ask.state.kind === "ready" ? ask.state.value : null;
  const byHref = new Map(pages.map((pg) => [pg.href, pg]));
  const run = () =>
    void ask.run({
      question: question.trim().slice(0, 300),
      role: "staff member",
      language,
      pages: pages.slice(0, 60).map((pg) => ({ href: pg.href, label: [pg.label.en, pg.label.hi].filter(Boolean).join(" / ").slice(0, 80) })),
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 4px" }}>
      {!ready ? (
        <button type="button" className="tap vxp-item" onClick={run} disabled={ask.state.kind === "working"} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left" }}>
          <span className="vxp-ic" style={{ background: "var(--accs)", color: "var(--accfg)" }} aria-hidden="true">
            <Ic n={ask.state.kind === "working" ? "refresh" : "sparkle"} style={ask.state.kind === "working" ? { animation: "xLoop 1s linear infinite" } : undefined} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span className="clip" style={{ fontSize: 14, fontWeight: 600 }}>{ask.state.kind === "working" ? tx(SAY.thinking) : tx(SAY.ask(question.trim().slice(0, 60)))}</span>
            <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.askSub)}</span>
          </span>
        </button>
      ) : null}
      {ask.state.kind === "problem" ? <AssistProblemLine problem={ask.state.problem} onClose={ask.reset} /> : null}
      {ready ? (
        <div className="fadein" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--bd)", borderLeft: "4px solid var(--acc)" }}>
          {ready.answer ? <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{ready.answer}</span> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ready.links.map((href) => {
              const page = byHref.get(href);
              if (!page) return null;
              return (
                <button key={href} type="button" className="tap btn pri" onClick={() => { ask.decide("kept"); onGo(href); }} style={{ height: 38 }}>
                  <Ic n={page.icon} size={16} />
                  {tx(SAY.open)} {tx(page.label)}
                </button>
              );
            })}
            {ready.search ? (
              <button type="button" className="tap btn sec" onClick={() => { ask.decide("kept"); onSearch(ready.search ?? ""); }} style={{ height: 38 }}>
                <Ic n="search" size={16} />
                {tx(SAY.searchFor(ready.search))}
              </button>
            ) : null}
          </div>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.note)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Under the search box before anything is typed: that a question works too. */
export function AskHint() {
  const { tx } = useVx();
  const offer = useAssistOffers("ask");
  if (!offer) return null;
  return (
    <p style={{ display: "flex", alignItems: "flex-start", gap: 6, margin: "8px 4px 0", fontSize: 13, color: "var(--mut)", lineHeight: 1.5 }}>
      <Ic n="sparkle" size={14} style={{ marginTop: 3, color: "var(--accfg)" }} />
      {tx(SAY.hint)}
    </p>
  );
}
