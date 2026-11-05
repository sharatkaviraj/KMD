"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";

import type { ReadyDraftView } from "@/modules/assist/domain/drafts";
import type { AssistDecision } from "@/modules/assist/domain/features";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p } from "@/vx/text";

import { reportDecision } from "./client";
import { useAssistOffers } from "./context";
import { AssistSuggestion } from "./parts";

const SAY = {
  title: p("Ready for you", "आपके लिए तैयार"),
  sub: p("The AI helper prepared these before you asked. Read one and decide.", "AI सहायक ने ये पहले से तैयार रखे हैं। पढ़ें और तय करें।"),
  open: p("Open", "खोलें"),
  plan: p("A plan for the period", "पीरियड की योजना"),
  digest: p("This week’s notes in short", "हफ़्ते के नोट्स संक्षेप में"),
  themes: p("What came up", "क्या-क्या आया"),
  attention: p("Follow up with", "इनसे बात करें"),
  praise: p("Worth praising", "तारीफ़ के लायक"),
  tip: p("Tip", "सुझाव"),
  goToDuty: p("Open the duty", "ड्यूटी खोलें"),
  fromNotes: (n: number) => p(`From ${n} notes this week`, `इस हफ़्ते के ${n} नोट्स से`),
};

/* ---------------------------------------------------------- one shared list */

type Store = { drafts: ReadyDraftView[]; loaded: boolean };
let store: Store = { drafts: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const SERVER: Store = { drafts: [], loaded: false };

/** Read once per page load and shared by every card that shows a prepared draft. */
function load() {
  loading ??= fetch("/api/assist/drafts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { drafts: [] }))
    .then((body: { drafts?: ReadyDraftView[] }) => {
      store = { drafts: Array.isArray(body.drafts) ? body.drafts : [], loaded: true };
      emit();
    })
    .catch(() => {
      store = { drafts: [], loaded: true };
      emit();
    });
}

/** Used, changed or put aside: off the list at once, recorded in the background. */
export function decideReadyDraft(draft: ReadyDraftView, decision: AssistDecision) {
  store = { ...store, drafts: store.drafts.filter((d) => d.id !== draft.id) };
  emit();
  void fetch("/api/assist/drafts", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: draft.id, decision }),
    keepalive: true,
  }).catch(() => (draft.logId ? reportDecision(draft.logId, decision) : undefined));
}

/**
 * The drafts the app prepared for this person (D-418). Nothing is fetched for
 * someone who is offered neither cover plans nor summaries.
 */
export function useReadyDrafts(): Store {
  const cover = useAssistOffers("cover");
  const summary = useAssistOffers("summary");
  const wanted = cover || summary;
  useEffect(() => {
    if (wanted) load();
  }, [wanted]);
  return useSyncExternalStore(subscribe, () => store, () => SERVER);
}

/* ------------------------------------------------------------- the views */

export function CoverPlanBody({ plan }: { plan: Extract<ReadyDraftView, { kind: "cover_plan" }>["payload"] }) {
  const { tx } = useVx();
  return (
    <>
      {plan.title ? <b>{plan.title}</b> : null}
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {plan.steps.map((s, i) => (
          <li key={i}>
            <span className="num" style={{ fontWeight: 700 }}>{s.minutes} min</span> · {s.text}
          </li>
        ))}
      </ol>
      {plan.tip ? (
        <span style={{ fontSize: "0.93em", color: "var(--mut)" }}>
          <b>{tx(SAY.tip)}:</b> {plan.tip}
        </span>
      ) : null}
    </>
  );
}

export function coverPlanText(plan: Extract<ReadyDraftView, { kind: "cover_plan" }>["payload"], tipWord: string): string {
  return [plan.title, ...plan.steps.map((s, i) => `${i + 1}. ${s.minutes} min · ${s.text}`), plan.tip ? `${tipWord}: ${plan.tip}` : ""].filter(Boolean).join("\n");
}

function DigestBody({ draft }: { draft: Extract<ReadyDraftView, { kind: "class_digest" }> }) {
  const { tx } = useVx();
  const d = draft.payload;
  const who = (ref: string) => draft.names?.[ref] ?? ref;
  const list = (rows: { ref: string; line: string; studentId: string | null }[]) => (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {rows.map((r) => (
        <li key={r.ref}>
          {r.studentId ? (
            <Link href={`/teach/class?student=${r.studentId}`} style={{ fontWeight: 700, color: "var(--acc)" }}>{who(r.ref)}</Link>
          ) : (
            <b>{who(r.ref)}</b>
          )}{" "}
          — {r.line}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <span style={{ fontSize: "0.93em", color: "var(--mut)" }}>{tx(SAY.fromNotes(d.notes))}</span>
      {d.themes.length ? (
        <>
          <b>{tx(SAY.themes)}</b>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>{d.themes.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </>
      ) : null}
      {d.attention.length ? (<><b>{tx(SAY.attention)}</b>{list(d.attention)}</>) : null}
      {d.praise.length ? (<><b>{tx(SAY.praise)}</b>{list(d.praise)}</>) : null}
    </>
  );
}

/**
 * "Ready for you" (D-418): one card at the top of Today listing what the AI
 * helper prepared — the plan for a cover duty, the class's week of notes.
 * Tapping a row opens it in the same suggestion card every AI draft uses.
 * With nothing waiting, or the helper off, the card is not there at all.
 */
export function ReadyForYou({ order = 0, wrap }: { order?: number; wrap?: CSSProperties }) {
  const { tx, language } = useVx();
  const { drafts } = useReadyDrafts();
  const [open, setOpen] = useState<string | null>(null);
  if (!drafts.length) return null;
  const pick = (title: { en: string; hi: string }) => (language === "en" ? title.en : title.hi);

  const card = (
    <div className="card rise" style={{ order, padding: 18, display: "flex", flexDirection: "column", gap: 10, borderLeft: "4px solid var(--acc)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Ic n="sparkle" size={20} />
        </span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{tx(SAY.title)}</span>
          <span style={{ fontSize: 13, color: "var(--mut)" }}>{tx(SAY.sub)}</span>
        </span>
      </span>
      {drafts.map((d) =>
        open === d.id ? (
          <AssistSuggestion
            key={d.id}
            title={d.kind === "cover_plan" ? SAY.plan : SAY.digest}
            privacy={d.kind === "class_digest"}
            readOnly
            takeaway={d.kind === "cover_plan" ? { text: coverPlanText(d.payload, tx(SAY.tip)), title: pick(d.title) } : undefined}
            onUse={() => decideReadyDraft(d, "kept")}
            onDiscard={() => decideReadyDraft(d, "discarded")}
          >
            {d.kind === "cover_plan" ? <CoverPlanBody plan={d.payload} /> : <DigestBody draft={d} />}
            {d.kind === "cover_plan" && d.href ? (
              <Link href={d.href} style={{ fontWeight: 600, color: "var(--acc)", alignSelf: "flex-start" }}>{tx(SAY.goToDuty)} →</Link>
            ) : null}
          </AssistSuggestion>
        ) : (
          <button
            key={d.id}
            type="button"
            className="tap row"
            onClick={() => setOpen(d.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 52, padding: "8px 4px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left", font: "inherit" }}
          >
            <Ic n={d.kind === "cover_plan" ? "swap" : "note"} size={18} style={{ color: "var(--accfg)", flex: "none" }} />
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{pick(d.title)}</span>
            <span style={{ fontSize: 13, color: "var(--acc)", fontWeight: 600 }}>{tx(SAY.open)}</span>
            <Ic n="chevRight" size={16} style={{ color: "var(--mut)" }} />
          </button>
        ),
      )}
    </div>
  );
  return wrap ? <div style={wrap}>{card}</div> : card;
}
