"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { checkFreeModelsAction } from "@/app/(app)/settings/actions";
import type { AiPageData } from "@/modules/assist/data/panel";
import type { FreeCheckRow } from "@/modules/assist/domain/free-check";
import { modelName } from "@/modules/assist/domain/overview";
import type { FreeCheckResult } from "@/modules/assist/domain/routes";
import { cue } from "@/ui/feedback/cue";
import { shortDayP, timeP } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import { box, Dot, Head, Tile } from "./ai-bits";
import { problemWords, TIER_WORDS, W } from "./words";

/*
 * Settings → AI in One → Cost → Free models (D-567). APInex's free models as
 * the last check found them: which ones One uses for which kind of job, and
 * how each did on the two made-up jobs. An admin runs the check from here;
 * it takes up to a minute, so the card shows the work while it goes.
 */

/** Rows shown before "Show all". */
const FIRST = 6;

const when = (at: string): Pair => {
  const t = timeP(at);
  const d = shortDayP(at);
  return p(`${d.en}, ${t.en}`, `${d.hi}, ${t.hi}`);
};

function Result({ label, result }: { label: Pair; result: FreeCheckResult | null }) {
  const { tx } = useVx();
  const tone = !result ? { bg: "var(--s3)", fg: "var(--mut)" } : result.ok ? { bg: "var(--oks)", fg: "var(--ok)" } : { bg: "var(--bads)", fg: "var(--bad)" };
  const detail = !result ? tx(W.notChecked) : result.ok ? tx(W.seconds(Math.round(result.ms / 100) / 10)) : tx(problemWords(result.problem));
  return (
    <span className="pill num" style={{ height: "auto", minHeight: 28, padding: "4px 10px", gap: 6, fontSize: 12.5, whiteSpace: "normal", background: tone.bg, color: tone.fg }}>
      <Ic n={!result ? "minus" : result.ok ? "check" : "x"} size={14} />
      <b style={{ fontWeight: 700 }}>{tx(label)}</b>
      <span>{detail}</span>
    </span>
  );
}

function Row({ row, index }: { row: FreeCheckRow; index: number }) {
  const { tx } = useVx();
  return (
    <li className="aip-free-row" style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}>
      <span style={{ flex: "1 1 200px", minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <Dot provider="apinex-free" size={12} />
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="clip" style={{ fontSize: 14.5, fontWeight: 700 }}>{modelName(row.model)}</span>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, fontSize: 12, color: "var(--mut)" }}>
            {row.jobs.length ? (
              <>
                <span>{tx(W.inUseFor)}</span>
                {row.jobs.map((job) => (
                  <span key={job} className="pill" style={{ height: 20, padding: "0 8px", fontSize: 11, fontWeight: 700, background: "var(--accs)", color: "var(--accfg)" }}>
                    {tx(TIER_WORDS[job])}
                  </span>
                ))}
              </>
            ) : (
              <span>{tx(W.notUsed)}</span>
            )}
          </span>
        </span>
      </span>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Result label={W.probeNotice} result={row.writing} />
        <Result label={W.probePlan} result={row.quick} />
      </span>
    </li>
  );
}

/** Seconds since the check started, so the wait is visibly moving. */
function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      window.clearInterval(id);
      setSeconds(0);
    };
  }, [running]);
  return seconds;
}

export function FreeModelsCard({ data }: { data: AiPageData }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [checking, start] = useTransition();
  const [all, setAll] = useState(false);
  const elapsed = useElapsed(checking);
  const f = data.freeModels;
  const checkedModels = f.rows.filter((r) => r.writing || r.quick);
  const good = checkedModels.filter((r) => r.writing?.ok || r.quick?.ok).length;
  const rows = all ? f.rows : f.rows.slice(0, FIRST);

  const check = () =>
    start(async () => {
      cue("tap");
      // A check that outlives the server's minute ends without an answer, and the card says so.
      const result = await checkFreeModelsAction().catch(() => null);
      cue(result?.ok ? "success" : "error");
      toast.show({ text: tx(result?.message ?? W.freeCheckLost), tone: result?.ok ? "ok" : "bad" });
      router.refresh();
    });

  return (
    <div className="card" style={box} aria-busy={checking}>
      <Head
        title={W.freeTitle}
        sub={W.freeSub}
        action={
          f.mayCheck ? (
            <button type="button" className="tap btn pri" disabled={checking} onClick={check} style={{ height: 48, minWidth: 190 }}>
              <Ic n={checking ? "refresh" : "zap"} size={18} className={checking ? "spin" : undefined} />
              {tx(checking ? W.freeChecking : W.freeCheck)}
            </button>
          ) : undefined
        }
      />

      {checking ? (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 14, background: "var(--s2)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600 }}>
            <span className="aip-walker" aria-hidden="true" />
            <span style={{ flex: 1 }}>{tx(W.freeCheckingLong)}</span>
            <span className="num" style={{ color: "var(--mut)" }}>{tx(W.seconds(elapsed))}</span>
          </span>
          <div style={{ height: 10, borderRadius: 6, background: "var(--s3)", overflow: "hidden" }}>
            <span className="aip-fill" />
          </div>
        </div>
      ) : null}

      {!f.available ? (
        <span style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>
          <Tile icon="key" tone="mut" size={36} />
          <span style={{ flex: 1 }}>{tx(W.freeNoKey)}</span>
        </span>
      ) : f.blocked ? (
        <span style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, lineHeight: 1.5, padding: "10px 12px", borderRadius: 14, background: "var(--warns)", color: "var(--warnfg)" }}>
          <Ic n="shield" size={18} />
          <span style={{ flex: 1 }}>{tx(W.freeBlocked)}</span>
        </span>
      ) : !f.checkedAt ? (
        <span style={{ fontSize: 13.5, color: "var(--mut)", lineHeight: 1.5 }}>{tx(W.freeNever)}</span>
      ) : (
        <>
          <span className="num" style={{ fontSize: 13, color: "var(--mut)" }}>{tx(W.freeSummary(good, checkedModels.length, f.listed))}</span>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8, opacity: checking ? 0.55 : 1, transition: "opacity .2s" }}>
            {rows.map((row, i) => (
              <Row key={row.model} row={row} index={i} />
            ))}
          </ul>
          {f.rows.length > FIRST ? (
            <button
              type="button"
              className="tap btn sec"
              onClick={() => {
                cue("select");
                setAll((v) => !v);
              }}
              aria-expanded={all}
              style={{ height: 44, alignSelf: "flex-start" }}
            >
              <Ic n={all ? "chevUp" : "chevDown"} size={17} />
              {tx(all ? W.showFewer : W.showAll(f.rows.length))}
            </button>
          ) : null}
        </>
      )}

      {f.checkedAt ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.lastCheck(when(f.checkedAt)))}</span> : null}
      {f.mayCheck ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.freeCheckSub)}</span> : null}
    </div>
  );
}
