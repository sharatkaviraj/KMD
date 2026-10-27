"use client";

import { useState } from "react";

import { translateTarget } from "@/modules/assist/domain/text";

import { useVx } from "@/vx/i18n";
import { NOTE_TAGS, TAG_TEXT, type NoteTag } from "@/vx/screens/notes/domain/notes";
import { p } from "@/vx/text";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  tidy: p("Tidy up", "साफ़ लिखें"),
  toEnglish: p("In English", "अंग्रेज़ी में"),
  toHindi: p("In Hindi", "हिंदी में"),
  tidied: p("Clearer wording", "साफ़ शब्दों में"),
  translated: p("Translation", "अनुवाद"),
  tags: p("Suggested tags", "सुझाए टैग"),
};

/**
 * Beside the note box (D-324): "Tidy up" turns a rushed or spoken note into
 * clear sentences and suggests its tags; "In English"/"In Hindi" translates
 * it. The child's name is masked before it leaves the school. Nothing is
 * saved — Use puts the words in the box, where the teacher saves as always.
 */
export function NoteAssist({
  body,
  childName,
  onApply,
}: {
  body: string;
  childName: string | null;
  onApply: (body: string, tags: NoteTag[] | null) => void;
}) {
  const { tx } = useVx();
  const offerNote = useAssistOffers("note");
  const offerTranslate = useAssistOffers("translate");
  const tidy = useAssistTask("note.polish");
  const translate = useAssistTask("text.translate");
  const [last, setLast] = useState<"tidy" | "translate" | null>(null);

  if (!offerNote && !offerTranslate) return null;
  const enough = body.trim().length >= 8;
  const target = translateTarget(body);
  const busy = tidy.state.kind === "working" || translate.state.kind === "working";

  const runTidy = () => {
    translate.reset();
    setLast("tidy");
    void tidy.run({ text: body.trim(), tags: NOTE_TAGS.map((code) => ({ code, label: TAG_TEXT[code].en })), childName });
  };
  const runTranslate = () => {
    tidy.reset();
    setLast("translate");
    void translate.run({ text: body.trim(), to: target, names: childName ? [childName] : [] });
  };

  const tidyReady = tidy.state.kind === "ready" ? tidy.state.value : null;
  const translated = translate.state.kind === "ready" ? translate.state.value : null;
  const problem = last === "tidy" && tidy.state.kind === "problem" ? tidy.state.problem : last === "translate" && translate.state.kind === "problem" ? translate.state.problem : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!tidyReady && !translated ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {offerNote ? <AssistButton label={SAY.tidy} onClick={runTidy} busy={busy && last === "tidy"} disabled={!enough || busy} /> : null}
          {offerTranslate ? <AssistButton label={target === "en" ? SAY.toEnglish : SAY.toHindi} onClick={runTranslate} busy={busy && last === "translate"} disabled={!enough || busy} /> : null}
        </div>
      ) : null}
      {problem ? <AssistProblemLine problem={problem} onClose={() => (last === "tidy" ? tidy.reset() : translate.reset())} /> : null}
      {tidyReady ? (
        <AssistSuggestion
          title={SAY.tidied}
          busy={busy}
          onUse={() => {
            onApply(tidyReady.text, tidyReady.tags.filter((t): t is NoteTag => (NOTE_TAGS as readonly string[]).includes(t)));
            tidy.decide("kept");
          }}
          onAgain={runTidy}
          onDiscard={() => tidy.decide("discarded")}
        >
          <span>{tidyReady.text}</span>
          {tidyReady.tags.length ? (
            <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}>
              {tx(SAY.tags)}:
              {tidyReady.tags.map((t) => (
                <span key={t} className="pill" style={{ height: 24, padding: "0 8px", fontSize: 12, background: "var(--s3)", color: "var(--fg)" }}>
                  {(NOTE_TAGS as readonly string[]).includes(t) ? tx(TAG_TEXT[t as NoteTag]) : t}
                </span>
              ))}
            </span>
          ) : null}
        </AssistSuggestion>
      ) : null}
      {translated ? (
        <AssistSuggestion
          title={SAY.translated}
          busy={busy}
          onUse={() => {
            onApply(translated.text, null);
            translate.decide("kept");
          }}
          onAgain={runTranslate}
          onDiscard={() => translate.decide("discarded")}
        >
          <span>{translated.text}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
