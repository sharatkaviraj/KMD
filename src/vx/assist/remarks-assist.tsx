"use client";

import { useCallback, useRef, useState } from "react";

import { decisionFor, type AssistProblem } from "@/modules/assist/domain/features";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { remarkText } from "@/vx/screens/exams/domain/messages";
import { p, type Pair } from "@/vx/text";

import { askAssist, DRAFT_NOTE, PRIVACY_NOTE, reportDecision } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine } from "./parts";

const SAY = {
  forClass: (n: number) => p(`Write AI remarks for ${n} ${n === 1 ? "child" : "children"} without one`, `${n} बच्चों के लिए AI से टिप्पणी लिखवाएँ`),
  progress: (done: number, of: number) => p(`Writing remarks… ${done} of ${of}`, `टिप्पणियाँ लिख रहे हैं… ${done} / ${of}`),
  ready: (n: number) => p(`${n} AI remarks are ready. Open each child, read it, tap it and save.`, `${n} AI टिप्पणियाँ तैयार। हर बच्चे को खोलें, पढ़ें, चुनें और सहेजें।`),
  one: p("Write one with AI", "AI से एक लिखवाएँ"),
  confirm: (n: number) =>
    p(
      `AI will draft a remark for ${n} ${n === 1 ? "child" : "children"}. Nothing is saved: you read each one and choose.`,
      `AI ${n} बच्चों के लिए टिप्पणी का मसौदा लिखेगा। कुछ भी सहेजा नहीं जाएगा: आप हर एक पढ़कर चुनेंगे।`,
    ),
  go: p("Write the drafts", "मसौदे लिखें"),
  cancel: p("Cancel", "रद्द करें"),
  from: p("Written by AI · from marks, attendance and subjects", "AI ने लिखी · अंक, हाज़िरी और विषयों से"),
};

/** A batch fits one Sonnet request comfortably and finishes in seconds. */
const BATCH = 10;

export type RemarkFacts = {
  id: string;
  percent: number | null;
  attendance: number | null;
  strongest?: string | null;
  weakest?: string | null;
};

/** Nothing to write from without marks or attendance; the AI is not asked to guess. */
export const hasRemarkFacts = (k: RemarkFacts) => k.percent !== null || k.attendance !== null;

/**
 * AI remark drafts for a class (D-324). Children are sent as C1, C2… with
 * their percentage, attendance and strongest/weakest subject — never a name.
 * The drafts stay on this screen as one more suggestion per child; the
 * teacher taps one into the box and saves it as she saves any remark.
 */
export function useAiRemarks({ exam, classLabel }: { exam: string; classLabel: string }) {
  const offered = useAssistOffers("remarks");
  const [drafts, setDrafts] = useState<Record<string, Pair>>({});
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [problem, setProblem] = useState<AssistProblem | null>(null);
  // Which request wrote each child's draft, so the first save can say whether it was kept.
  const source = useRef<Record<string, string | null>>({});
  const reported = useRef(new Set<string>());
  const picked = useRef(new Set<string>());

  const write = useCallback(
    async (targets: readonly RemarkFacts[]) => {
      const todo = targets.filter(hasRemarkFacts);
      if (todo.length === 0 || progress) return;
      setProblem(null);
      setProgress({ done: 0, of: todo.length });
      for (let start = 0; start < todo.length; start += BATCH) {
        const batch = todo.slice(start, start + BATCH);
        const refs = new Map(batch.map((k, i) => [`C${i + 1}`, k.id]));
        const result = await askAssist("remarks.class", {
          exam: exam.slice(0, 80),
          classLabel: classLabel.slice(0, 80),
          children: batch.map((k, i) => ({
            ref: `C${i + 1}`,
            percent: k.percent === null ? null : Math.round(k.percent),
            attendance: k.attendance === null ? null : Math.round(k.attendance),
            strongest: k.strongest ?? null,
            weakest: k.weakest ?? null,
          })),
        });
        if (!result.ok) {
          setProblem(result.problem);
          break;
        }
        const next: Record<string, Pair> = {};
        for (const r of result.value.remarks) {
          const id = refs.get(r.ref);
          if (!id) continue;
          next[id] = p(r.en, r.hi);
          source.current[id] = result.logId;
        }
        setDrafts((d) => ({ ...d, ...next }));
        setProgress({ done: Math.min(todo.length, start + batch.length), of: todo.length });
      }
      setProgress(null);
    },
    [exam, classLabel, progress],
  );

  /** The teacher tapped the AI remark into the box. */
  const pick = useCallback((id: string) => {
    picked.current.add(id);
  }, []);

  /**
   * After a save: was the AI remark used as written, changed, or not used
   * (another suggestion or her own words)? Counted once per request.
   */
  const saved = useCallback(
    (id: string, value: string) => {
      const draft = drafts[id];
      const logId = source.current[id];
      if (!draft || !logId || reported.current.has(logId)) return;
      reported.current.add(logId);
      reportDecision(logId, picked.current.has(id) ? decisionFor(remarkText(draft), value) : "discarded");
    },
    [drafts],
  );

  const clearProblem = useCallback(() => setProblem(null), []);

  return { offered, drafts, progress, problem, write, pick, saved, clearProblem };
}

export type AiRemarks = ReturnType<typeof useAiRemarks>;

/** "Write AI remarks for 18 children without one", and its progress. */
export function AiRemarksBar({ ai, missing }: { ai: AiRemarks; missing: readonly RemarkFacts[] }) {
  const { tx } = useVx();
  // One tap used to start drafting for the whole class (teacher replay, 6 Nov
  // 2026). The first tap now says what will happen; the second starts it.
  const [asking, setAsking] = useState(false);
  if (!ai.offered) return null;
  const todo = missing.filter((k) => hasRemarkFacts(k) && !ai.drafts[k.id]);
  const ready = missing.filter((k) => ai.drafts[k.id]).length;
  if (todo.length === 0 && ready === 0 && !ai.problem && !ai.progress) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ai.progress ? (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--accs)", color: "var(--accfg)", fontWeight: 600 }}>
          <Ic n="refresh" size={16} className="as-spin" />
          {tx(SAY.progress(ai.progress.done, ai.progress.of))}
        </div>
      ) : todo.length > 0 && asking ? (
        <div role="group" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--accs)", color: "var(--accfg)" }}>
          <span style={{ flex: "1 1 220px", fontWeight: 600 }}>{tx(SAY.confirm(todo.length))}</span>
          <button type="button" className="tap btn pri" style={{ minHeight: 44 }} onClick={() => { setAsking(false); void ai.write(todo); }}>
            {tx(SAY.go)}
          </button>
          <button type="button" className="tap btn ghost" style={{ minHeight: 44 }} onClick={() => setAsking(false)}>
            {tx(SAY.cancel)}
          </button>
        </div>
      ) : todo.length > 0 ? (
        <AssistButton label={SAY.forClass(todo.length)} onClick={() => setAsking(true)} style={{ alignSelf: "flex-start" }} />
      ) : null}
      {!ai.progress && ready > 0 ? <span className="as-note">{tx(SAY.ready(ready))}</span> : null}
      {ai.problem ? <AssistProblemLine problem={ai.problem} onClose={ai.clearProblem} /> : null}
    </div>
  );
}

/**
 * The AI remark for one child, drawn like the other suggestions (a card to
 * tap) with the "written by AI" line; or a button to write just this one.
 */
export function AiRemarkCard({
  ai,
  child,
  current,
  onPick,
}: {
  ai: AiRemarks;
  child: RemarkFacts;
  current: string;
  onPick: (value: string) => void;
}) {
  const { tx, sub } = useVx();
  if (!ai.offered) return null;
  const draft = ai.drafts[child.id];
  if (!draft) {
    if (!hasRemarkFacts(child)) return null;
    return <AssistButton label={SAY.one} onClick={() => void ai.write([child])} busy={Boolean(ai.progress)} style={{ alignSelf: "flex-start" }} />;
  }
  const value = remarkText(draft);
  const on = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      className="tap card tc-in"
      onClick={() => {
        ai.pick(child.id);
        onPick(value);
      }}
      style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px", textAlign: "left", color: "var(--fg)", border: on ? "2px solid var(--acc)" : "1px dashed var(--acc)", background: on ? "var(--accs)" : "var(--card)" }}
    >
      <span style={{ width: 26, height: 26, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: on ? "var(--acc)" : "var(--accs)", color: on ? "var(--onsolid)" : "var(--accfg)" }}>
        <Ic n={on ? "check" : "sparkle"} size={15} stroke={on ? 3 : 2} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="tc-tb" style={{ fontWeight: 600 }}>{tx(draft)}</span>
        {sub(draft) ? <span className="tc-ts" style={{ color: "var(--mut)" }}>{sub(draft)}</span> : null}
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--acc)", textTransform: "uppercase", letterSpacing: ".05em" }}>{tx(SAY.from)}</span>
        <span className="as-note">{tx(DRAFT_NOTE)} {tx(PRIVACY_NOTE)}</span>
      </span>
    </button>
  );
}
