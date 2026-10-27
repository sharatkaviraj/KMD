"use client";

import { useState } from "react";

import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import { useAssistTask } from "./client";
import { useAssistOffers } from "./context";
import { AssistButton, AssistProblemLine, AssistSuggestion } from "./parts";

const SAY = {
  child: p("Summary for a parent meeting", "अभिभावक बैठक के लिए सार"),
  childTitle: p("Before you meet the parents", "अभिभावकों से मिलने से पहले"),
  opener: p("You could begin with", "आप ऐसे शुरू कर सकते हैं"),
  week: p("This week’s notes in short", "इस हफ़्ते के नोट्स संक्षेप में"),
  weekTitle: p("This week in the class", "इस हफ़्ते कक्षा में"),
  themes: p("What came up", "क्या सामने आया"),
  attention: p("Needs a follow-up", "ध्यान देना है"),
  praise: p("Worth praising", "शाबाशी के लायक"),
  copy: p("Copy", "कॉपी करें"),
  copied: p("Copied", "कॉपी हो गया"),
  done: p("Got it", "ठीक है"),
  leftOut: p("Health and family notes are not sent to the AI.", "स्वास्थ्य और परिवार वाले नोट्स AI को नहीं भेजे जाते।"),
  noneThisWeek: p("No notes this week to sum up.", "इस हफ़्ते सार के लिए कोई नोट नहीं।"),
};

/** Notes the notes board already treats as sensitive never go to the AI. */
const SENSITIVE = new Set(["health", "family"]);

export type SummaryNote = { body: string; tags: readonly string[]; createdAt: string; studentId?: string | null; studentName?: string | null };

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

function shareable(notes: readonly SummaryNote[]): SummaryNote[] {
  return notes.filter((n) => n.body.trim() && !n.tags.some((t) => SENSITIVE.has(t)));
}

/**
 * On a child's page (D-328): the teachers' notes about this child turned into
 * a few points and an opening line for a parent meeting. The child's name is
 * masked; health and family notes are left out. Nothing is saved.
 */
export function ChildSummary({ childName, notes, facts }: { childName: string; notes: readonly SummaryNote[]; facts: readonly string[] }) {
  const { tx, language } = useVx();
  const toast = useToast();
  const offer = useAssistOffers("summary");
  const summary = useAssistTask("child.summary");
  const [copied, setCopied] = useState(false);
  const usable = shareable(notes)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);
  if (!offer || usable.length === 0) return null;

  const run = () =>
    void summary.run({
      childName: childName.slice(0, 120),
      language,
      notes: usable.map((n) => ({ when: shortDate(n.createdAt).slice(0, 20), tags: n.tags.slice(0, 6).map((t) => t.slice(0, 30)), text: n.body.trim().slice(0, 2000) })),
      facts: facts.slice(0, 6).map((f) => f.slice(0, 80)),
    });
  const ready = summary.state.kind === "ready" ? summary.state.value : null;
  const text = ready ? [...ready.points.map((x) => `• ${x}`), ready.opener ? `\n${ready.opener}` : ""].join("\n").trim() : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.child} onClick={run} busy={summary.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {summary.state.kind === "problem" ? <AssistProblemLine problem={summary.state.problem} onClose={summary.reset} /> : null}
      {ready ? (
        <AssistSuggestion
          title={SAY.childTitle}
          busy={summary.state.kind === "working"}
          useLabel={copied ? SAY.copied : SAY.copy}
          onUse={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              toast.show({ text: tx(SAY.copied) });
            }, () => undefined);
            summary.decide("kept");
          }}
          onAgain={run}
          onDiscard={() => summary.decide("discarded")}
        >
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {ready.points.map((pt, i) => <li key={i}>{pt}</li>)}
          </ul>
          {ready.opener ? (
            <span>
              <b>{tx(SAY.opener)}:</b> “{ready.opener}”
            </span>
          ) : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.leftOut)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}

/**
 * On a class's notes (D-328): the last week's notes in a few lines — what
 * came up, who needs a follow-up, who deserves praise. Children travel as
 * C1, C2 and every name in the notes is masked; health and family notes are
 * left out. Tapping a child opens them, if the screen allows it.
 */
export function ClassDigest({
  classLabel,
  notes,
  today,
  onOpen,
}: {
  classLabel: string;
  notes: readonly SummaryNote[];
  today: string;
  onOpen?: (studentId: string) => void;
}) {
  const { tx, language } = useVx();
  const offer = useAssistOffers("summary");
  const digest = useAssistTask("class.digest");
  if (!offer) return null;

  const since = new Date(new Date(`${today}T00:00:00+05:30`).getTime() - 6 * 86_400_000).toISOString();
  const week = shareable(notes)
    .filter((n) => n.studentId && n.createdAt >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60);
  const ids = [...new Set(week.map((n) => n.studentId as string))];
  const refOf = new Map(ids.map((id, i) => [id, `C${i + 1}`]));
  const idOf = new Map(ids.map((id, i) => [`C${i + 1}`, id]));
  const nameOf = new Map(week.map((n) => [n.studentId as string, n.studentName ?? ""]));
  const ready = digest.state.kind === "ready" ? digest.state.value : null;

  const run = () =>
    void digest.run({
      classLabel: classLabel.slice(0, 80),
      language,
      notes: week.map((n) => ({ ref: refOf.get(n.studentId as string) as string, when: shortDate(n.createdAt).slice(0, 20), tags: n.tags.slice(0, 6).map((t) => t.slice(0, 30)), text: n.body.trim().slice(0, 2000) })),
      names: [...new Set(week.map((n) => (n.studentName ?? "").slice(0, 120)).filter(Boolean))].slice(0, 60),
    });

  const person = (ref: string, line: string) => {
    const id = idOf.get(ref);
    const name = id ? nameOf.get(id) || ref : ref;
    return (
      <li key={ref}>
        {id && onOpen ? (
          <button type="button" className="tap" onClick={() => onOpen(id)} style={{ border: 0, padding: 0, background: "transparent", color: "var(--acc)", fontWeight: 700, textDecoration: "underline" }}>
            {name}
          </button>
        ) : (
          <b>{name}</b>
        )}
        {" — "}
        {line}
      </li>
    );
  };

  if (week.length === 0 && !ready) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!ready ? <AssistButton label={SAY.week} onClick={run} busy={digest.state.kind === "working"} style={{ alignSelf: "flex-start" }} /> : null}
      {digest.state.kind === "problem" ? <AssistProblemLine problem={digest.state.problem} onClose={digest.reset} /> : null}
      {ready ? (
        <AssistSuggestion title={SAY.weekTitle} busy={digest.state.kind === "working"} useLabel={SAY.done} onUse={() => digest.decide("kept")} onAgain={run} onDiscard={() => digest.decide("discarded")}>
          {ready.themes.length ? (
            <>
              <b style={{ fontSize: 13 }}>{tx(SAY.themes)}</b>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{ready.themes.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          ) : null}
          {ready.attention.length ? (
            <>
              <b style={{ fontSize: 13 }}>{tx(SAY.attention)}</b>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{ready.attention.map((r) => person(r.ref, r.line))}</ul>
            </>
          ) : null}
          {ready.praise.length ? (
            <>
              <b style={{ fontSize: 13 }}>{tx(SAY.praise)}</b>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{ready.praise.map((r) => person(r.ref, r.line))}</ul>
            </>
          ) : null}
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(SAY.leftOut)}</span>
        </AssistSuggestion>
      ) : null}
    </div>
  );
}
