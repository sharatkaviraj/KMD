"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveAssistSettingsAction, saveBuiltinAiLimitAction, type SettingsResult } from "@/app/(app)/settings/actions";
import type { AiPageData } from "@/modules/assist/data/panel";
import { dollars } from "@/modules/assist/domain/cost";
import { assistFeatures, FEATURE_LABELS, featureTier, isAssistFeature, type AssistFeature } from "@/modules/assist/domain/features";
import { share } from "@/modules/assist/domain/overview";
import { cue } from "@/ui/feedback/cue";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { Input, Switch } from "@/vx/ui/controls";
import { useToast } from "@/vx/ui/overlays";

import { box, Head, Tile } from "./ai-bits";
import { TIER_WORDS, W } from "./words";

/** "Switches": the written drafts' switch, budget and limits (D-324), and the photo and voice daily limit. */
export function SwitchesView({ data }: { data: AiPageData }) {
  const { tx } = useVx();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const s = data.settings;
  const [enabled, setEnabled] = useState(s?.enabled ?? true);
  const [budget, setBudget] = useState(String(s?.monthlyBudgetUsd ?? 25));
  const [cap, setCap] = useState(String(s?.dailyCapPerStaff ?? 60));
  const [off, setOff] = useState<AssistFeature[]>(s?.disabledFeatures ?? []);
  const [limit, setLimit] = useState(data.builtin.dailyLimit === null ? "" : String(data.builtin.dailyLimit));
  const [justSaved, setJustSaved] = useState<"helper" | "limit" | null>(null);

  const usage = new Map(data.features.map((f) => [f.feature, f]));
  const dirty =
    s !== null &&
    (enabled !== s.enabled || Number(budget || 0) !== s.monthlyBudgetUsd || Number(cap || 0) !== s.dailyCapPerStaff || [...off].sort().join() !== [...s.disabledFeatures].sort().join());
  const limitDirty = limit !== (data.builtin.dailyLimit === null ? "" : String(data.builtin.dailyLimit));

  const finish = (which: "helper" | "limit", result: SettingsResult) => {
    cue(result.ok ? "success" : "error");
    toast.show({ text: tx(result.message), tone: result.ok ? "ok" : "bad" });
    if (result.ok) {
      setJustSaved(which);
      window.setTimeout(() => setJustSaved(null), 1800);
      router.refresh();
    }
  };
  const saveHelper = () =>
    start(async () => {
      finish("helper", await saveAssistSettingsAction({ enabled, monthlyBudgetUsd: Number(budget || 0), dailyCapPerStaff: Number(cap || 0), disabledFeatures: off.filter(isAssistFeature) }));
    });
  const saveLimit = () =>
    start(async () => {
      finish("limit", await saveBuiltinAiLimitAction(Number(limit || 0)));
    });

  const saveLabel = (which: "helper" | "limit", idle: typeof W.save) => (pending ? W.saving : justSaved === which ? W.saved2 : idle);
  const pvMode = data.builtin.mode === "live" ? { label: W.pvModeLive, bg: "var(--oks)", fg: "var(--ok)" } : data.builtin.mode === "test" ? { label: W.pvModeTest, bg: "var(--warns)", fg: "var(--warnfg)" } : { label: W.pvModeOff, bg: "var(--s3)", fg: "var(--mut)" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!s ? (
        <div className="card" style={{ ...box, color: "var(--warnfg)" }}>{tx(W.unreadSettings)}</div>
      ) : (
        <div className="card" style={box}>
          <Head title={W.writtenTitle} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: enabled ? "var(--oks)" : "var(--s2)", transition: "background .25s" }}>
            <Tile icon="sparkle" tone={enabled ? "ok" : "mut"} size={40} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(W.master)}</span>
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(W.masterSub)}</span>
            </span>
            <Switch on={enabled} onChange={setEnabled} label={tx(W.master)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label className="field">
              <span>{tx(W.budget)}</span>
              <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} />
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(W.budgetHint)}</span>
            </label>
            <label className="field">
              <span>{tx(W.cap)}</span>
              <Input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
            </label>
          </div>

          <span className="sech" style={{ paddingTop: 4 }}>{tx(W.features)}</span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {assistFeatures.map((f, i) => {
              const label = FEATURE_LABELS[f];
              const u = usage.get(f);
              const decided = u ? u.kept + u.edited + u.discarded : 0;
              return (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 60, padding: "8px 2px", borderTop: i ? "1px solid var(--bd)" : 0, opacity: enabled ? 1 : 0.55, transition: "opacity .2s" }}>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {tx(label)}{" "}
                      <span className="pill" style={{ height: 20, padding: "0 7px", fontSize: 10, background: "var(--s3)", color: "var(--mut)", verticalAlign: "middle" }}>{tx(TIER_WORDS[featureTier(f)])}</span>
                    </span>
                    <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(label.sub)}</span>
                    {u && u.uses ? (
                      <span className="num" style={{ fontSize: 12, color: "var(--fg)" }}>
                        {tx(W.usesN(u.uses))} · {dollars(u.costUsd)}
                        {decided ? ` · ${tx(W.keptPct(share(u.kept + u.edited, decided)))}` : ""}
                      </span>
                    ) : null}
                  </span>
                  <Switch on={enabled && !off.includes(f)} disabled={!enabled} onChange={(on) => setOff((cur) => (on ? cur.filter((x) => x !== f) : [...cur, f]))} label={tx(label)} />
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="tap btn pri" disabled={pending || !dirty} onClick={saveHelper} style={{ height: 48, minWidth: 170 }}>
              <Ic n={justSaved === "helper" ? "checkCircle" : "check"} size={18} className={pending ? "spin" : undefined} />
              {tx(saveLabel("helper", W.save))}
            </button>
            {dirty ? <span style={{ fontSize: 13, color: "var(--warnfg)", fontWeight: 600, animation: "xFade .2s both" }}>{tx(W.unsaved)}</span> : null}
          </div>
        </div>
      )}

      <div className="card" style={box}>
        <Head title={W.pvTitle} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "var(--s2)" }}>
          <Tile icon="camera" tone="info" size={40} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{tx(W.pvMode)}</span>
            <span style={{ fontSize: 12.5, color: "var(--mut)" }}>{tx(W.pvModeSub)}</span>
          </span>
          <span className="pill" style={{ height: 28, padding: "0 12px", fontSize: 12.5, fontWeight: 700, background: pvMode.bg, color: pvMode.fg }}>{tx(pvMode.label)}</span>
        </div>
        <label className="field" style={{ maxWidth: 360 }}>
          <span>{tx(W.pvLimit)}</span>
          <Input inputMode="numeric" value={limit} disabled={!data.builtin.mayChange} onChange={(e) => setLimit(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(data.builtin.mayChange ? W.pvLimitHint : W.pvLimitLocked)}</span>
        </label>
        {data.builtin.mayChange ? (
          <button type="button" className="tap btn sec" disabled={pending || !limitDirty || limit === ""} onClick={saveLimit} style={{ height: 46, alignSelf: "flex-start", minWidth: 150 }}>
            <Ic n={justSaved === "limit" ? "checkCircle" : "check"} size={18} />
            {tx(saveLabel("limit", W.saveLimit))}
          </button>
        ) : null}
      </div>

      <span style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--mut)", lineHeight: 1.5, padding: "0 4px" }}>
        <Ic n="lock" size={15} style={{ flex: "none", marginTop: 2 }} />
        {tx(W.privacy)}
      </span>
    </div>
  );
}
