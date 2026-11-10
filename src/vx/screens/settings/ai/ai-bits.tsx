"use client";

import type { CSSProperties, ReactNode } from "react";

import { isFreeProvider, modelName, type AiProvider } from "@/modules/assist/domain/overview";
import { rupees } from "@/vx/format";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";

import { providerName, W } from "./words";

/*
 * Small pieces the AI page's four views share (D-501): provider colours,
 * money for tiny amounts, the model chip and the icon tile.
 */

/** Each provider's colour: greens for the free ones, warm and cool for the paid. Both themes. */
export const AI_CSS = `
:is(.vx,.vxt) .aip{--pv-nvidia-free:#3B8A1E;--pv-apinex-free:#0E7C86;--pv-openrouter-free:#17876A;--pv-gemini-free:#5DA67B;--pv-anthropic:#C2602F;--pv-openai:#475867;--pv-gemini-paid:#2D5FC4;--pv-none:#9AAAB6}
.dark :is(.vx,.vxt) .aip,:is(.vx,.vxt).dark .aip{--pv-nvidia-free:#8FD46C;--pv-apinex-free:#6CD3DB;--pv-openrouter-free:#5FD1AE;--pv-gemini-free:#A8DDBC;--pv-anthropic:#F0A17A;--pv-openai:#B4C1CD;--pv-gemini-paid:#8FB0F5;--pv-none:#6E7F8C}
:is(.vx,.vxt) .aip-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:5px;border-radius:16px;background:var(--s2);border:1px solid var(--bd);position:sticky;top:72px;z-index:5}
:is(.vx,.vxt) .aip-tab{display:flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:6px 8px;border:0;border-radius:12px;background:transparent;color:var(--mut);font-weight:600;font-size:14px;line-height:1.2;text-align:center;transition:background .2s var(--ease),color .2s var(--ease),box-shadow .2s var(--ease)}
:is(.vx,.vxt) .aip-tab[aria-selected=true]{background:var(--card);color:var(--fg);box-shadow:var(--sh)}
:is(.vx,.vxt) .aip-tab[aria-selected=true] svg{color:var(--acc)}
:is(.vx,.vxt) .aip-view{animation:xIn .32s var(--ease) both}
:is(.vx,.vxt) .aip-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
:is(.vx,.vxt) .aip-stat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border-radius:14px;background:var(--s2);min-width:0;animation:xPopIn .5s var(--ease) both}
:is(.vx,.vxt) .aip-stat b{font-size:26px;line-height:1.1;font-weight:800;letter-spacing:-.02em}
:is(.vx,.vxt) .aip-bar{display:flex;height:16px;border-radius:9px;overflow:hidden;background:var(--s3)}
:is(.vx,.vxt) .aip-bar>span{display:block;height:100%;transform-origin:left;animation:xGrowX .7s var(--ease) both}
:is(.vx,.vxt) .aip-bar>span+span{box-shadow:inset 2px 0 0 var(--card)}
:is(.vx,.vxt) .aip-days{display:flex;align-items:flex-end;gap:3px;height:132px;padding-top:6px}
:is(.vx,.vxt) .aip-day{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column-reverse;align-items:stretch;gap:1px;border:0;padding:0;background:transparent;border-radius:6px 6px 2px 2px;cursor:pointer;position:relative}
:is(.vx,.vxt) .aip-day>i{display:block;border-radius:3px;transform-origin:bottom;animation:xGrowY .6s var(--ease) both}
:is(.vx,.vxt) .aip-day.sel{outline:2px solid var(--acc);outline-offset:2px}
:is(.vx,.vxt) .aip-day.today::after{content:"";position:absolute;left:50%;bottom:-8px;width:5px;height:5px;margin-left:-2.5px;border-radius:9px;background:var(--acc)}
:is(.vx,.vxt) .aip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
:is(.vx,.vxt) .aip-job{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;border:1px solid var(--bd);background:var(--card);color:var(--fg);text-align:left;width:100%;transition:transform .15s var(--ease),box-shadow .15s var(--ease)}
:is(.vx,.vxt) .aip-job:hover{box-shadow:var(--shh)}
:is(.vx,.vxt) .aip-road{display:flex;flex-wrap:wrap;align-items:stretch;row-gap:12px;padding:6px 2px 10px}
:is(.vx,.vxt) .aip-arrow{flex:none;display:flex;align-items:center;justify-content:center;width:34px;color:var(--sub);pointer-events:none}
:is(.vx,.vxt) .aip-st{position:relative;flex:1 0 150px;max-width:220px;display:flex;flex-direction:column;gap:6px;padding:12px 12px 12px 14px;border-radius:14px;border:1px solid var(--bd);background:var(--card);color:var(--fg);text-align:left;transition:transform .25s var(--ease),box-shadow .25s var(--ease),opacity .25s var(--ease)}
:is(.vx,.vxt) .aip-st::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:4px;border-radius:0 4px 4px 0;background:var(--pv)}
:is(.vx,.vxt) .aip-st.locked{background:repeating-linear-gradient(135deg,var(--s2) 0 8px,var(--card) 8px 16px);color:var(--mut)}
:is(.vx,.vxt) .aip-st.now{transform:scale(1.04);box-shadow:0 0 0 3px var(--acc),var(--shh);opacity:1}
:is(.vx,.vxt) .aip-st.past{opacity:.5}
:is(.vx,.vxt) .aip-models{display:flex;flex-direction:column;gap:1px;font-size:12px;color:var(--mut)}
:is(.vx,.vxt) .aip-no{flex:none;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:10px;background:var(--s3);color:var(--fg);font-size:11px;font-weight:800}
:is(.vx,.vxt) .aip-st.now .aip-no{background:var(--acc);color:#fff}
:is(.vx,.vxt) .aip-ring{position:absolute;inset:-3px;border-radius:16px;border:2px solid var(--pv);pointer-events:none;animation:aipGlow 2.2s ease-out infinite}
@keyframes aipGlow{from{transform:scale(1);opacity:.7}to{transform:scale(1.07);opacity:0}}
:is(.vx,.vxt) .aip-fill{display:block;height:100%;border-radius:6px;background:var(--pv-apinex-free);animation:aipFill 50s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes aipFill{from{width:3%}to{width:94%}}
:is(.vx,.vxt) .aip-free-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 12px;border-radius:14px;background:var(--s2);animation:xIn .3s var(--ease) both}
@media (prefers-reduced-motion:reduce){:is(.vx,.vxt) .aip-ring{animation:none;opacity:.6}:is(.vx,.vxt) .aip-fill{animation:none;width:50%}}
:is(.vx,.vxt) .aip-walker{display:inline-block;width:10px;height:10px;border-radius:9px;background:var(--acc);animation:xPulse 1s ease-in-out infinite}
:is(.vx,.vxt) .aip-trail{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
:is(.vx,.vxt) .aip-feed>li{animation:xIn .32s var(--ease) both}
@container vx (max-width:899px){
:is(.vx,.vxt) .aip-tabs{position:static;gap:4px;padding:4px}
:is(.vx,.vxt) .aip-tab{flex-direction:column;gap:3px;min-height:58px;font-size:12px;padding:6px 4px}
:is(.vx,.vxt) .aip-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
:is(.vx,.vxt) .aip-stat b{font-size:22px}
:is(.vx,.vxt) .aip-road{flex-direction:column;overflow:visible;padding:4px 0}
:is(.vx,.vxt) .aip-arrow{width:auto;height:26px}
:is(.vx,.vxt) .aip-arrow svg{transform:rotate(90deg)}
:is(.vx,.vxt) .aip-st{flex:none;max-width:none;gap:4px;padding:10px 12px 10px 14px}
:is(.vx,.vxt) .aip-models{flex-direction:row;flex-wrap:wrap;column-gap:10px}
:is(.vx,.vxt) .aip-days{gap:2px;height:112px}
}
`;

/** A provider's colour, as a CSS value. */
export function pv(provider: AiProvider | null): string {
  return `var(--pv-${provider ?? "none"})`;
}

/** Money for amounts that are often a few paise: "₹0", "<₹0.01", "₹0.37", "₹1,240". */
export function inr(value: number): string {
  const v = Number(value) || 0;
  if (v <= 0) return rupees(0);
  if (v < 0.01) return `<${rupees(0.01)}`;
  if (v < 100) return rupees(Math.round(v * 100) / 100);
  return rupees(Math.round(v));
}

export function Dot({ provider, size = 10 }: { provider: AiProvider | null; size?: number }) {
  return <span aria-hidden="true" style={{ flex: "none", display: "inline-block", width: size, height: size, borderRadius: 99, background: pv(provider) }} />;
}

/** Free or paid, as a small tag. */
export function PayTag({ provider }: { provider: AiProvider | null }) {
  const { tx } = useVx();
  if (!provider) return null;
  const free = isFreeProvider(provider);
  return (
    <span className="pill" style={{ height: 20, padding: "0 7px", fontSize: 10.5, fontWeight: 700, background: free ? "var(--oks)" : "var(--s3)", color: free ? "var(--ok)" : "var(--mut)" }}>
      {tx(free ? W.freeTag : W.paidTag)}
    </span>
  );
}

/** "Claude Haiku 5.5" with its provider's dot. */
export function ModelChip({ provider, model, failed, note }: { provider: AiProvider | null; model: string | null; failed?: boolean; note?: string }) {
  return (
    <span
      className="pill num"
      title={providerName(provider)}
      style={{ height: "auto", minHeight: 24, padding: "3px 9px", columnGap: 6, rowGap: 0, flexWrap: "wrap", fontSize: 12, whiteSpace: "normal", background: failed ? "var(--bads)" : "var(--s2)", color: failed ? "var(--bad)" : "var(--fg)" }}
    >
      <Dot provider={provider} size={8} />
      {/* Only the name is struck through: the reason beside it is meant to be read. */}
      <span style={failed ? { textDecoration: "line-through", textDecorationColor: "color-mix(in srgb, var(--bad) 55%, transparent)" } : undefined}>
        {model ? modelName(model) : providerName(provider)}
      </span>
      {note ? <span style={{ fontWeight: 600 }}>· {note}</span> : null}
    </span>
  );
}

type Tone = "acc" | "info" | "ok" | "warn" | "mut" | "bad";
const TONE: Record<Tone, { bg: string; fg: string }> = {
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  mut: { bg: "var(--s3)", fg: "var(--fg)" },
  bad: { bg: "var(--bads)", fg: "var(--bad)" },
};

export function Tile({ icon, tone = "acc", size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const t = TONE[tone];
  return (
    <span aria-hidden="true" style={{ flex: "none", width: size, height: size, borderRadius: Math.round(size * 0.3), background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Ic n={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

export const box: CSSProperties = { padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 };

export function Head({ title, sub, action }: { title: Pair; sub?: Pair; action?: ReactNode }) {
  const { tx } = useVx();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 220px" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{tx(title)}</span>
        {sub ? <span style={{ fontSize: 13, color: "var(--mut)", lineHeight: 1.45 }}>{tx(sub)}</span> : null}
      </span>
      {action}
    </div>
  );
}

/** A thin bar of slices, each grown from the left. */
export function SliceBar({ slices, height = 16, delay = 0 }: { slices: { key: string; value: number; color: string; title?: string }[]; height?: number; delay?: number }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="aip-bar" style={{ height }} role="img" aria-label={slices.filter((s) => s.value > 0).map((s) => `${s.title ?? s.key} ${s.value}`).join(", ")}>
      {total > 0
        ? slices
            .filter((s) => s.value > 0)
            .map((s, i) => <span key={s.key} title={s.title} style={{ width: `${(s.value / total) * 100}%`, background: s.color, animationDelay: `${delay + i * 70}ms` }} />)
        : null}
    </div>
  );
}
