"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { checkAiKeysAction } from "@/app/(app)/settings/actions";
import type { AiPageData } from "@/modules/assist/data/panel";
import { dollars } from "@/modules/assist/domain/cost";
import { isFreeProvider, modelName, type AiProvider } from "@/modules/assist/domain/overview";
import { cue } from "@/ui/feedback/cue";
import { shortDayP, timeP } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { CountUp } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";

import { box, Dot, Head, inr, PayTag, pv, Tile } from "./ai-bits";
import { FreeModelsCard } from "./ai-free";
import { problemWords, providerName, W } from "./words";

/** The photo and voice keys, in the order the router prefers them. */
const KEYS: readonly AiProvider[] = ["anthropic", "openai", "gemini-free", "gemini-paid"];

const when = (at: string): Pair => {
  const t = timeP(at);
  const d = shortDayP(at);
  return p(`${d.en}, ${t.en}`, `${d.hi}, ${t.hi}`);
};

/** "Cost": this month's money, the budget, what each model cost per job, the free models' last check, and how the keys are. */
export function CostView({ data }: { data: AiPageData }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [checking, start] = useTransition();
  const o = data.overview;
  const rate = data.inrPerUsd;
  const helperUsd = o?.helperCostUsd ?? data.features.reduce((sum, f) => sum + f.costUsd, 0);
  const budgetUsd = data.settings?.monthlyBudgetUsd ?? 0;
  const used = budgetUsd > 0 ? Math.min(100, Math.round((helperUsd / budgetUsd) * 100)) : 0;
  const meter = used >= 90 ? "var(--bad)" : used >= 70 ? "var(--warn)" : "var(--ok)";
  const total = o?.costInr ?? helperUsd * rate;
  const models = [...(o?.models ?? [])].filter((m) => m.answered || m.tries).sort((a, b) => b.costInr - a.costInr || b.answered - a.answered);
  const most = Math.max(0.0001, ...models.map((m) => m.costInr));

  const check = () =>
    start(async () => {
      cue("tap");
      const result = await checkAiKeysAction();
      cue(result.ok ? "success" : "error");
      toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="card" style={box}>
        <span style={{ fontSize: 13, color: "var(--mut)", fontWeight: 600 }}>{tx(W.totalSpend)}</span>
        <b style={{ fontSize: 38, lineHeight: 1, letterSpacing: "-.02em" }}><CountUp value={total} format={inr} /></b>
        <span className="num" style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 13, color: "var(--mut)" }}>
          <span>{tx(W.written)} {inr(helperUsd * rate)}</span>
          <span>·</span>
          <span>{tx(W.photoVoice)} {inr(o?.builtinCostInr ?? 0)}</span>
        </span>
        <div className="g3" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, marginTop: 4 }}>
          <div className="aip-stat" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(W.budgetTitle)}</span>
            <span className="num" style={{ fontSize: 14 }}>{tx(W.budgetLine(dollars(helperUsd), dollars(budgetUsd)))}</span>
            <div style={{ height: 10, borderRadius: 6, background: "var(--s3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.max(used, helperUsd > 0 ? 2 : 0)}%`, background: meter, transformOrigin: "left", animation: "xGrowX .8s var(--ease) both" }} />
            </div>
            <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.45 }}>{tx(W.budgetLeft(used))}</span>
          </div>
          <div className="aip-stat" style={{ gap: 6, animationDelay: "60ms" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tx(W.pvSpend)}</span>
            <b className="num">{inr(o?.builtinCostInr ?? 0)}</b>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.pvSpendSub(data.builtin.dailyLimit))}</span>
          </div>
          <div className="aip-stat" style={{ gap: 6, background: "var(--oks)", animationDelay: "120ms" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)" }}>{tx(W.saved)}</span>
            <b className="num" style={{ color: "var(--ok)" }}>{inr(o?.savedInr ?? 0)}</b>
            <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.savedSub)}</span>
          </div>
        </div>
      </div>

      <div className="card" style={box}>
        <Head title={W.byModel} sub={W.byModelSub} />
        {models.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {models.map((m, i) => {
              const free = isFreeProvider(m.provider);
              return (
                <li key={`${m.provider}-${m.model}`} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px", borderRadius: 14, background: "var(--s2)", animation: `xIn .3s var(--ease) ${Math.min(i, 10) * 35}ms both` }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Dot provider={m.provider} size={12} />
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span className="clip" style={{ fontSize: 14.5, fontWeight: 700 }}>{modelName(m.model)}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--mut)" }}>
                        {providerName(m.provider)} <PayTag provider={m.provider} />
                      </span>
                    </span>
                    <span className="num" style={{ textAlign: "right" }}>
                      <b style={{ display: "block", fontSize: 16, color: free ? "var(--ok)" : "var(--fg)" }}>{free && !m.costInr ? tx(W.freeCost) : inr(m.costInr)}</b>
                      {(m.answered || m.heard) && m.costInr ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{inr(m.costInr / (m.answered || m.heard))} {tx(W.perJob)}</span> : null}
                    </span>
                  </span>
                  <div style={{ height: 6, borderRadius: 4, background: "var(--s3)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${free ? 100 : Math.max(2, (m.costInr / most) * 100)}%`, background: free ? "var(--oks)" : pv(m.provider), transformOrigin: "left", animation: `xGrowX .7s var(--ease) ${i * 35}ms both` }} />
                  </div>
                  <span className="num" style={{ fontSize: 12, color: "var(--mut)" }}>
                    {tx(m.heard ? W.heard(m.heard) : W.answered(m.answered))} · {tx(W.triesN(m.tries))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <span style={{ fontSize: 13.5, color: "var(--mut)" }}>{tx(o ? W.nothing : W.unread)}</span>
        )}
      </div>

      <FreeModelsCard data={data} />

      <div className="card" style={box}>
        <Head
          title={W.keys}
          sub={W.keysSub}
          action={
            data.builtin.mayCheck ? (
              <button type="button" className="tap btn sec" disabled={checking} onClick={check} style={{ height: 44 }}>
                <Ic n="refresh" size={17} className={checking ? "spin" : undefined} />
                {tx(checking ? W.checking : W.checkKeys)}
              </button>
            ) : undefined
          }
        />
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
          {KEYS.map((key, i) => {
            const row = data.builtin.keys.find((k) => k.provider === key);
            const missing = data.builtin.missing.includes(key);
            const blocked = row?.blockedUntil ?? null;
            const state = missing ? { label: W.keyNotSet, bg: "var(--s3)", fg: "var(--mut)" } : !row ? { label: W.keyNone, bg: "var(--s3)", fg: "var(--mut)" } : row.state === "ok" ? { label: W.keyOk, bg: "var(--oks)", fg: "var(--ok)" } : row.state === "quota" ? { label: W.keyQuota, bg: "var(--warns)", fg: "var(--warnfg)" } : { label: W.keyFailing, bg: "var(--bads)", fg: "var(--bad)" };
            return (
              <li key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--bd)" : 0, opacity: checking ? 0.6 : 1, transition: "opacity .2s" }}>
                <Tile icon="key" tone={row?.state === "ok" ? "ok" : row?.state === "quota" ? "warn" : row ? "bad" : "mut"} size={36} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700 }}>
                    {providerName(key)}
                    <span className="pill" style={{ height: 22, padding: "0 8px", fontSize: 11, background: state.bg, color: state.fg }}>{tx(state.label)}</span>
                  </span>
                  {row ? (
                    <span className="num" style={{ fontSize: 12, color: "var(--mut)", overflowWrap: "anywhere" }}>
                      {[row.model ? modelName(row.model) : null, row.problem ? tx(problemWords(row.problem)) : null, blocked ? tx(W.skippedUntil(when(blocked))) : null, tx(when(row.checkedAt))].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
        {data.builtin.lastCheckAt ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.lastCheck(when(data.builtin.lastCheckAt)))}</span> : null}
        {data.builtin.mayCheck ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.checkKeysSub)}</span> : null}
      </div>

      <span style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--mut)", lineHeight: 1.5, padding: "0 4px" }}>
        <span>{tx(W.estimate)}</span>
        <span>{tx(W.rate(data.inrPerUsd))}</span>
      </span>
    </div>
  );
}
