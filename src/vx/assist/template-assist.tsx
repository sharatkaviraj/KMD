"use client";

import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Input } from "@/vx/ui/controls";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  about: p("What should the template say? A few words are enough", "टेम्पलेट में क्या कहना है? कुछ शब्द काफ़ी हैं"),
  hint: p("For example: fee due reminder with amount and date", "जैसे: राशि और तारीख़ के साथ फीस बकाया याद दिलाना"),
  write: p("Draft it for me", "मेरे लिए मसौदा लिखें"),
  title: p("Suggested template", "सुझाया गया टेम्पलेट"),
};

/**
 * On the new-template sheet (D-328): a few words become a template in Hindi
 * and English, written to WhatsApp's rules for its category and using only
 * the fields the app can fill. Use copies it into the sheet; sending it for
 * Meta's approval is still the person's own press.
 */
export function TemplateAssist({ category, onApply }: { category: "utility" | "marketing"; onApply: (next: { name: string; hi: string; en: string }) => void }) {
  const { tx } = useVx();
  const offer = useAssistOffers("message");
  const draft = useAssistTask("template.draft");
  const [brief, setBrief] = useState("");
  if (!offer) return null;
  const ready = draft.state.kind === "ready" ? draft.state.value : null;
  const run = () => void draft.run({ brief: brief.trim().slice(0, 400), category });

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: "var(--s2)", border: "1px dashed var(--bds)" }}>
      {!ready ? (
        <>
          <label className="field">
            <span>{tx(SAY.about)}</span>
            <Input value={brief} maxLength={400} onChange={(e) => setBrief(e.target.value)} placeholder={tx(SAY.hint)} />
          </label>
          <AssistButton label={SAY.write} onClick={run} busy={draft.state.kind === "working"} disabled={brief.trim().length < 4} style={{ alignSelf: "flex-start" }} />
        </>
      ) : null}
      {draft.state.kind === "problem" ? <AssistProblemLine problem={draft.state.problem} onClose={draft.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.title}
          privacy={false}
          busy={draft.state.kind === "working"}
          onUse={() => {
            onApply(ready);
            draft.decide("kept");
          }}
          onAgain={run}
          onDiscard={() => draft.decide("discarded")}
        >
          <b>{ready.name}</b>
          {ready.hi ? <span lang="hi">{ready.hi}</span> : null}
          {ready.en ? <span>{ready.en}</span> : null}
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
