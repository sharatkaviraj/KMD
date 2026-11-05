"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { CoverOutcome } from "@/modules/substitutions/data/cover-reports";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import { coverReportsSeenVx, reportCoverVx } from "../actions";
import { CardTitle } from "./shared";
import { dShortP } from "./fmt";

export const OUTCOME_TEXT: Record<CoverOutcome, Pair> = {
  settled: p("Class was settled", "कक्षा शांत रही"),
  work_done: p("Work got done", "काम पूरा हुआ"),
  problem: p("There was a problem", "कुछ दिक्कत हुई"),
};

const OUTCOME_ICON = { settled: "check", work_done: "book", problem: "alert" } as const;

/**
 * After a covered period (D-419): one tap for how it went and, if they like,
 * one sentence, for the teacher who was away. It is saved on the duty, not
 * as a note about any child; a child who needs a note still gets one from Notes.
 */
export function CoverReportForm({ dutyId, forName, existing }: { dutyId: string; forName: string; existing: { outcome: CoverOutcome; body: string | null } | null }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [outcome, setOutcome] = useState<CoverOutcome | null>(existing?.outcome ?? null);
  const [body, setBody] = useState(existing?.body ?? "");
  const [saved, setSaved] = useState(Boolean(existing));
  const [pending, start] = useTransition();

  const save = () =>
    outcome &&
    start(async () => {
      const res = await reportCoverVx({ dutyId, outcome, body });
      if (!res.ok) {
        toast.show({ text: tx(res.error), tone: "bad" });
        return;
      }
      setSaved(true);
      toast.show({ text: tx(p(`Sent to ${forName}`, `${forName} को भेज दिया`)), tone: "ok" });
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, borderRadius: 16, background: "var(--s2)" }}>
      <span style={{ fontWeight: 700 }}>{tx(p("How did the period go?", "पीरियड कैसा रहा?"))}</span>
      <span className="tc-s">{tx(p(`${forName} will see this when they are back.`, `${forName} लौटकर यह देखेंगे।`))}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(OUTCOME_TEXT) as CoverOutcome[]).map((o) => (
          <button key={o} type="button" className={`tap chip${outcome === o ? " on" : ""}`} aria-pressed={outcome === o} disabled={pending} onClick={() => { setOutcome(o); setSaved(false); }} style={{ height: 44, padding: "0 14px", fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Ic n={OUTCOME_ICON[o]} size={16} />
            {tx(OUTCOME_TEXT[o])}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{tx(p("Anything they should know (optional)", "उन्हें कुछ बताना हो (वैकल्पिक)"))}</span>
        <textarea className="inp" rows={2} maxLength={600} value={body} disabled={pending} onChange={(e) => { setBody(e.target.value); setSaved(false); }} placeholder={tx(p("For example: finished exercise 4.2; two children had no notebook", "जैसे: अभ्यास 4.2 पूरा हुआ; दो बच्चों के पास कॉपी नहीं थी"))} style={{ minHeight: 64, resize: "vertical" }} />
      </label>
      <button type="button" className="tap btn pri" disabled={!outcome || pending || saved} onClick={save} style={{ alignSelf: "flex-start", minHeight: 46 }}>
        <Ic n={saved ? "check" : "send"} size={16} />
        {tx(saved ? p("Sent", "भेज दिया") : p("Send", "भेजें"))}
      </button>
    </div>
  );
}

export type AwayReport = { dutyId: string; day: string; number: number; classLabels: string; outcome: CoverOutcome; body: string | null; by: string };

/**
 * Back from leave (D-419): what the teachers who took her periods said, so
 * nobody has to ask in the staff room. Marking them read clears the card.
 */
export function AwayReportsCard({ reports, today }: { reports: readonly AwayReport[]; today: string }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!reports.length) return null;

  const done = () =>
    start(async () => {
      const res = await coverReportsSeenVx(reports.map((r) => r.dutyId));
      if (!res.ok) {
        toast.show({ text: tx(res.error), tone: "bad" });
        return;
      }
      router.refresh();
    });

  return (
    <div className="card tc-card" style={{ order: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="tc-ib" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--infos)", color: "var(--info)" }}><Ic n="swap" size={20} /></span>
        <CardTitle t={p("While you were away", "आपकी ग़ैरहाज़िरी में")} />
      </span>
      {reports.map((r) => (
        <div key={r.dutyId} style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
          <span className="tc-p" style={{ fontWeight: 700 }}>
            {r.day === today ? tx(p("Today", "आज")) : tx(dShortP(r.day))} · P{r.number} · {r.classLabels}
          </span>
          <span className="tc-s" style={{ display: "flex", alignItems: "center", gap: 6, color: r.outcome === "problem" ? "var(--warnfg)" : "var(--ok)", fontWeight: 600 }}>
            <Ic n={OUTCOME_ICON[r.outcome]} size={14} />
            {tx(OUTCOME_TEXT[r.outcome])} · {r.by}
          </span>
          {r.body ? <span className="tc-p">“{r.body}”</span> : null}
        </div>
      ))}
      <button type="button" className="tap btn sec" disabled={pending} onClick={done} style={{ alignSelf: "flex-start", minHeight: 44 }}>
        <Ic n="check" size={16} />
        {tx(p("Mark as read", "पढ़ लिया"))}
      </button>
    </div>
  );
}
