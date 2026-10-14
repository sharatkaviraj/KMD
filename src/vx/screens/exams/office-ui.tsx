"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { useVx } from "@/vx/i18n";
import { Ic, type IconName } from "@/vx/icons";
import { LangButton } from "@/vx/shell/sidebar";
import { p } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { Sheet } from "@/vx/ui/overlays";

import "./office.css";

/*
 * Pieces the exam office's three screens (ExamHome, ExamPlan, ExamResults)
 * share, drawn as the design draws them. The kit's TopBar has no desktop
 * back slot, no language switch and no phone school mark, and its help sheet
 * draws one tone for every step, so these screens carry their own.
 */

export function OfficeTop({
  crumb,
  title,
  pill,
  mTitle,
  mSub,
  back,
  mBack,
  logo,
  lang,
  help,
  actions,
}: {
  crumb: ReactNode;
  title: ReactNode;
  /** A pill beside the desktop title ("Draft", "Published"). */
  pill?: ReactNode;
  mTitle?: ReactNode;
  mSub?: ReactNode;
  /** Desktop back arrow. */
  back?: string;
  /** Phone back arrow; defaults to `back`. */
  mBack?: string;
  /** The school mark on the phone bar of a role's home. */
  logo?: boolean;
  /** Draw the EN · हि switch. */
  lang?: boolean;
  /** The help sheet's title and steps; the "?" opens it. */
  help: HelpContent;
  actions?: ReactNode;
}) {
  const phoneBack = mBack ?? back;
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {back ? (
          <BackLink href={back} className="tap btn ghost" style={{ width: 40, padding: 0 }}>
            <Ic n="chevLeft" size={18} />
          </BackLink>
        ) : null}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{crumb}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h1 className="serif clip" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
            {pill}
          </span>
        </div>
        {lang ? <LangButton tone="page" /> : null}
        <button type="button" className="tap btn ghost" aria-label={`Help: ${help.title}`} onClick={() => setHelpOpen(true)} style={{ width: 40, padding: 0 }}>
          <Ic n="help" size={18} />
        </button>
        {actions}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--bd)" }}>
        {phoneBack ? (
          <BackLink href={phoneBack} className="tap icon-btn" style={{ width: 44, height: 44, borderRadius: 22 }}>
            <Ic n="chevLeft" size={24} />
          </BackLink>
        ) : logo ? (
          <span className="serif" aria-hidden="true" style={{ flex: "none", width: 38, height: 38, margin: "0 4px", borderRadius: 12, background: "var(--nav)", color: "var(--navfg)", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
            VP
          </span>
        ) : (
          <span style={{ width: 8 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingLeft: 2 }}>
          <span className="clip" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle ?? title}</span>
          {mSub ? <span className="clip" style={{ fontSize: 12, color: "var(--mut)" }}>{mSub}</span> : null}
        </span>
        {lang ? <LangButton tone="page" /> : null}
        <button type="button" className="tap icon-btn" aria-label={`Help: ${help.title}`} onClick={() => setHelpOpen(true)} style={{ width: 44, height: 44, borderRadius: 22 }}>
          <Ic n="help" size={22} />
        </button>
      </header>
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} help={help} />
    </>
  );
}

export type HelpContent = { title: string; steps: { icon: IconName; title: string; body: string }[] };

const HELP_TONES = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
] as const;

/** "?": three picture steps, each in its own tone (RULES G). */
export function HelpSheet({ open, onClose, help }: { open: boolean; onClose: () => void; help: HelpContent }) {
  const { tx } = useVx();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={help.title}
      sub={tx(p("3 quick steps · मदद", "3 आसान कदम · मदद"))}
      footer={
        <button type="button" className="tap btn pri" style={{ flex: 1, height: 52, fontSize: 15 }} onClick={onClose}>
          {tx(p("Got it", "समझ गया"))}
        </button>
      }
    >
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {help.steps.map((s, i) => {
          const [bg, fg] = HELP_TONES[i % HELP_TONES.length];
          return (
            <li key={s.title} className="fadein" style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 0", animationDelay: `${i * 40}ms` }}>
              <span style={{ flex: "none", position: "relative", width: 64, height: 64, borderRadius: 20, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={s.icon} size={28} />
                <span className="num" style={{ position: "absolute", top: -6, left: -6, width: 24, height: 24, borderRadius: 12, background: "var(--pri)", color: "var(--prifg)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              </span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <strong style={{ fontSize: 15 }}>{s.title}</strong>
                <span style={{ fontSize: 12, color: "var(--mut)", lineHeight: 1.5 }}>{s.body}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}

/** The design's ring: r 42 in a 100 box, drawn from the top. */
export function DRing({ value, size, stroke = 9, tone, children }: { value: number; size: number; stroke?: number; tone: string; children?: ReactNode }) {
  const len = Math.max(0.5, (263.9 * Math.min(100, Math.max(0, value))) / 100);
  return (
    <div style={{ position: "relative", flex: "none", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ strokeWidth: stroke }}>
        <circle cx={50} cy={50} r={42} fill="none" stroke="var(--s3)" />
        <circle
          cx={50}
          cy={50}
          r={42}
          fill="none"
          strokeLinecap="round"
          stroke={tone}
          strokeDasharray={`${len.toFixed(1)} 263.9`}
          style={{ ["--len" as string]: len.toFixed(1), transform: "rotate(-90deg)", transformOrigin: "50% 50%", animation: "xDraw .9s var(--ease) both", transition: "stroke-dasharray .6s var(--ease)" } as CSSProperties}
        />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>{children}</span>
    </div>
  );
}

/** A person's avatar tones, picked from the name as the design picks them. */
const AV_TONES = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
] as const;

function hash01(x: string): number {
  let h = 2166136261;
  for (let i = 0; i < x.length; i += 1) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function toneAvatar(name: string): { bg: string; fg: string; ini: string } {
  const [bg, fg] = AV_TONES[Math.floor(hash01(name) * AV_TONES.length)];
  return { bg, fg, ini: name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, "").slice(0, 2).toUpperCase() };
}
