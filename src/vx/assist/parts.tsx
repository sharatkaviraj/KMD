"use client";

import type { CSSProperties, ReactNode } from "react";

import type { AssistProblem } from "@/modules/assist/domain/features";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { DRAFT_NOTE, PRIVACY_NOTE, PROBLEM_TEXT } from "./client";

const SAY = {
  working: p("Writing…", "लिख रहे हैं…"),
  use: p("Use this", "यही लें"),
  again: p("Try again", "फिर लिखें"),
  discard: p("Don’t use", "न लें"),
  close: p("Close", "बंद करें"),
};

/**
 * The AI helper's button (D-324): the sparkle, the accent colour and a verb
 * that says what will happen ("Tidy up", "Write it for me"). It is always a
 * second choice beside the screen's own controls, never the only way on.
 */
export function AssistButton({
  label,
  onClick,
  busy,
  disabled,
  style,
}: {
  label: Pair;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const { tx } = useVx();
  return (
    <button
      type="button"
      className="tap btn ghost"
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      // Pressing it must not blur a text box first: several boxes save on blur.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{ height: 36, gap: 6, color: "var(--accfg)", background: "var(--accs)", borderRadius: 18, padding: "0 14px", fontWeight: 700, opacity: disabled ? 0.55 : 1, ...style }}
    >
      <Ic n={busy ? "refresh" : "sparkle"} size={16} style={busy ? { animation: "xLoop 1s linear infinite" } : undefined} />
      {busy ? tx(SAY.working) : tx(label)}
    </button>
  );
}

/** A problem in one quiet line, never a red error page. */
export function AssistProblemLine({ problem, onClose }: { problem: AssistProblem; onClose?: () => void }) {
  const { tx } = useVx();
  return (
    <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 12px", borderRadius: 12, background: "var(--s2)", color: "var(--mut)", fontSize: 13 }}>
      <Ic n="info" size={16} style={{ marginTop: 1 }} />
      <span style={{ flex: 1, minWidth: 0 }}>{tx(PROBLEM_TEXT[problem])}</span>
      {onClose ? (
        <button type="button" className="tap" aria-label={tx(SAY.close)} onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--mut)", padding: 0 }}>
          <Ic n="x" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A suggestion waiting for a decision. The words sit on an accent rail with
 * the "written by AI" line under them; Use puts them where the person can
 * still change them, Try again asks once more, Don't use throws them away.
 */
export function AssistSuggestion({
  title,
  children,
  onUse,
  onAgain,
  onDiscard,
  busy,
  useLabel,
  privacy = true,
}: {
  title: Pair;
  children: ReactNode;
  onUse?: () => void;
  onAgain?: () => void;
  onDiscard: () => void;
  busy?: boolean;
  useLabel?: Pair;
  privacy?: boolean;
}) {
  const { tx } = useVx();
  return (
    <div className="fadein" role="region" aria-label={tx(title)} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--bd)", borderLeft: "4px solid var(--acc)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--accfg)", textTransform: "uppercase", letterSpacing: ".05em" }}>
        <Ic n="sparkle" size={14} />
        {tx(title)}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{children}</div>
      <span style={{ fontSize: 12, color: "var(--mut)" }}>
        {tx(DRAFT_NOTE)}
        {privacy ? ` ${tx(PRIVACY_NOTE)}` : ""}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {onUse ? (
          <button type="button" className="tap btn pri" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onUse} style={{ height: 38 }}>
            <Ic n="check" size={16} />
            {tx(useLabel ?? SAY.use)}
          </button>
        ) : null}
        {onAgain ? (
          <button type="button" className="tap btn sec" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onAgain} style={{ height: 38 }}>
            <Ic n={busy ? "refresh" : "sparkle"} size={16} style={busy ? { animation: "xLoop 1s linear infinite" } : undefined} />
            {tx(busy ? SAY.working : SAY.again)}
          </button>
        ) : null}
        <button type="button" className="tap btn ghost" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onDiscard} style={{ height: 38 }}>
          {tx(SAY.discard)}
        </button>
      </div>
    </div>
  );
}
