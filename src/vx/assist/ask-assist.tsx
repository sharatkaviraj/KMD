"use client";

import { looksLikeQuestion } from "@/modules/assist/domain/text";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { PROBLEM_TEXT, useAssistTask, useOnline } from "./client";
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
  const online = useOnline();
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
        <button type="button" className="tap as-ask" onClick={run} disabled={ask.state.kind === "working" || !online} style={{ opacity: online ? 1 : 0.6 }}>
          <span className="vxp-ic" style={{ background: "var(--card)", color: "var(--accfg)", flex: "none" }} aria-hidden="true">
            <Ic n={!online ? "wifiOff" : ask.state.kind === "working" ? "refresh" : "sparkle"} className={ask.state.kind === "working" ? "as-spin" : undefined} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            {/* The whole question, wrapped: on a phone a clipped question cannot be checked before asking. */}
            <span style={{ fontSize: 15, fontWeight: 600, overflowWrap: "anywhere" }}>{ask.state.kind === "working" ? tx(SAY.thinking) : tx(SAY.ask(question.trim().slice(0, 120)))}</span>
            <span className="as-note">{tx(online ? SAY.askSub : PROBLEM_TEXT.offline)}</span>
          </span>
        </button>
      ) : null}
      {ask.state.kind === "problem" ? <AssistProblemLine problem={ask.state.problem} onClose={ask.reset} /> : null}
      {ready ? (
        <div className="fadein as-card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--bd)", borderLeft: "4px solid var(--acc)" }}>
          {ready.answer ? <span className="as-read" style={{ whiteSpace: "pre-wrap" }}>{ready.answer}</span> : null}
          <div className="as-actions">
            {ready.links.map((href) => {
              const page = byHref.get(href);
              if (!page) return null;
              return (
                <button key={href} type="button" className="tap btn pri as-use" onClick={() => { ask.decide("kept"); onGo(href); }}>
                  <Ic n={page.icon} size={16} />
                  {tx(SAY.open)} {tx(page.label)}
                </button>
              );
            })}
            {ready.search ? (
              <button type="button" className="tap btn sec as-use" onClick={() => { ask.decide("kept"); onSearch(ready.search ?? ""); }}>
                <Ic n="search" size={16} />
                {tx(SAY.searchFor(ready.search))}
              </button>
            ) : null}
          </div>
          <span className="as-note">{tx(SAY.note)}</span>
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
