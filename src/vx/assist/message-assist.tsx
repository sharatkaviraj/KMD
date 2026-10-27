"use client";

import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { Input } from "@/vx/ui/controls";
import { p, type Pair } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  heading: p("Let AI write it", "AI से लिखवाएँ"),
  about: p("What is the notice about? A few words are enough", "सूचना किस बारे में है? कुछ शब्द काफ़ी हैं"),
  aboutHint: p("For example: school closed Monday for Holi, opens Tuesday", "जैसे: होली पर सोमवार छुट्टी, मंगलवार से स्कूल"),
  write: p("Write it for me", "मेरे लिए लिखें"),
  polish: p("Polish what I wrote", "मेरा लिखा सुधारें"),
  fillEn: p("Write the English from the Hindi", "हिंदी से अंग्रेज़ी बनाएँ"),
  fillHi: p("Write the Hindi from the English", "अंग्रेज़ी से हिंदी बनाएँ"),
  notice: p("Suggested notice", "सुझाई गई सूचना"),
  reply: p("Suggest a reply", "जवाब सुझाएँ"),
  replyTitle: p("Suggested reply", "सुझाया गया जवाब"),
  title: p("Title", "शीर्षक"),
};

type Notice = { title: string; hi: string; en: string };

/**
 * On the notice composer (D-324): a few words become a notice in Hindi and
 * English; or what was written is polished, or the missing language is
 * filled in. Use copies the words into the boxes, where the preview, the
 * family count and Queue work exactly as before. Nothing is queued by AI.
 */
export function MessageAssist({
  audience,
  kindLabel,
  current,
  language,
  onApply,
}: {
  audience: "parents" | "staff";
  kindLabel: Pair;
  current: Notice;
  language: "both" | "hi" | "en";
  onApply: (next: Notice) => void;
}) {
  const { tx } = useVx();
  const offerMessage = useAssistOffers("message");
  const offerTranslate = useAssistOffers("translate");
  const write = useAssistTask("message.write");
  const polish = useAssistTask("message.polish");
  const translate = useAssistTask("text.translate");
  const [brief, setBrief] = useState("");
  const [last, setLast] = useState<"write" | "polish" | "translate" | null>(null);

  if (!offerMessage && !offerTranslate) return null;

  const busy = [write, polish, translate].some((t) => t.state.kind === "working");
  const written = Boolean(current.hi.trim() || current.en.trim());
  const fill: "en" | "hi" | null = language === "both" ? (current.hi.trim() && !current.en.trim() ? "en" : current.en.trim() && !current.hi.trim() ? "hi" : null) : null;
  const resetAll = () => [write, polish, translate].forEach((t) => t.reset());

  const runWrite = () => {
    resetAll();
    setLast("write");
    void write.run({ brief: brief.trim(), audience, kind: kindLabel.en });
  };
  const runPolish = () => {
    resetAll();
    setLast("polish");
    void polish.run({ title: current.title, hi: current.hi, en: current.en, audience });
  };
  const runFill = () => {
    if (!fill) return;
    resetAll();
    setLast("translate");
    void translate.run({ text: fill === "en" ? current.hi.trim() : current.en.trim(), to: fill, names: [] });
  };

  const draft: Notice | null = write.state.kind === "ready" ? write.state.value : polish.state.kind === "ready" ? polish.state.value : null;
  const translated = translate.state.kind === "ready" ? translate.state.value.text : null;
  const active = last === "write" ? write : last === "polish" ? polish : last === "translate" ? translate : null;
  const problem = active?.state.kind === "problem" ? active.state.problem : null;

  const keep = (next: Notice) => ({
    title: next.title || current.title,
    hi: language === "en" ? current.hi : next.hi || current.hi,
    en: language === "hi" ? current.en : next.en || current.en,
  });

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", background: "var(--s2)", border: "1px dashed var(--bds)" }}>
      <span className="sech" style={{ display: "flex", alignItems: "center", gap: 6 }}>{tx(SAY.heading)}</span>
      {offerMessage && !draft ? (
        <>
          <label className="field">
            <span>{tx(SAY.about)}</span>
            <Input value={brief} maxLength={600} onChange={(e) => setBrief(e.target.value)} placeholder={tx(SAY.aboutHint)} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <AssistButton label={SAY.write} onClick={runWrite} busy={busy && last === "write"} disabled={brief.trim().length < 4 || busy} />
            {written ? <AssistButton label={SAY.polish} onClick={runPolish} busy={busy && last === "polish"} disabled={busy} /> : null}
            {fill && offerTranslate ? <AssistButton label={fill === "en" ? SAY.fillEn : SAY.fillHi} onClick={runFill} busy={busy && last === "translate"} disabled={busy} /> : null}
          </div>
        </>
      ) : null}
      {!offerMessage && fill && offerTranslate && !translated ? (
        <AssistButton label={fill === "en" ? SAY.fillEn : SAY.fillHi} onClick={runFill} busy={busy && last === "translate"} disabled={busy} style={{ alignSelf: "flex-start" }} />
      ) : null}
      {problem && active ? <AssistProblemLine problem={problem} onClose={active.reset} /> : null}
      {draft && active ? (
        <AssistSuggestion
          title={SAY.notice}
          busy={busy}
          privacy={false}
          onUse={() => {
            onApply(keep(draft));
            active.decide("kept");
          }}
          onAgain={last === "write" ? runWrite : runPolish}
          onDiscard={() => active.decide("discarded")}
        >
          {draft.title ? <b>{draft.title}</b> : null}
          {language !== "en" && draft.hi ? <span lang="hi">{draft.hi}</span> : null}
          {language !== "hi" && draft.en ? <span>{draft.en}</span> : null}
        </AssistSuggestion>
      ) : null}
      {translated && fill ? (
        <AssistSuggestion
          title={fill === "en" ? SAY.fillEn : SAY.fillHi}
          busy={busy}
          privacy={false}
          onUse={() => {
            onApply({ ...current, [fill]: translated });
            translate.decide("kept");
          }}
          onAgain={runFill}
          onDiscard={() => translate.decide("discarded")}
        >
          <span lang={fill}>{translated}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}

/**
 * Beside the reply box (D-324): a short, polite answer to what the parent
 * wrote, Hindi first. Use puts it in the box; the office still reads it and
 * queues it themselves.
 */
export function ReplyAssist({
  incoming,
  regarding,
  notice,
  names,
  onApply,
}: {
  incoming: string;
  regarding: string | null;
  notice: string | null;
  names: string[];
  onApply: (text: string) => void;
}) {
  const offer = useAssistOffers("message");
  const reply = useAssistTask("message.reply");
  if (!offer) return null;
  const ready = reply.state.kind === "ready" ? reply.state.value : null;
  const run = () => void reply.run({ incoming: incoming.slice(0, 1000), regarding, notice: notice ? notice.slice(0, 400) : null, names });
  const text = ready ? [ready.hi, ready.en].filter(Boolean).join("\n") : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.reply} onClick={run} busy={reply.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {reply.state.kind === "problem" ? <AssistProblemLine problem={reply.state.problem} onClose={reply.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.replyTitle}
          busy={reply.state.kind === "working"}
          onUse={() => {
            onApply(text);
            reply.decide("kept");
          }}
          onAgain={run}
          onDiscard={() => reply.decide("discarded")}
        >
          {ready.hi ? <span lang="hi">{ready.hi}</span> : null}
          {ready.en ? <span>{ready.en}</span> : null}
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
