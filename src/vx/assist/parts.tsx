"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import type { AssistProblem } from "@/modules/assist/domain/features";
import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { useToast } from "@/vx/ui/overlays";

import { canShare, copyText, DRAFT_NOTE, PRIVACY_NOTE, PROBLEM_TEXT, shareText, useOnline } from "./client";
import "./assist.css";

const SAY = {
  working: p("Writing…", "लिख रहे हैं…"),
  use: p("Use this", "यही लें"),
  again: p("Try again", "फिर लिखें"),
  discard: p("Don’t use", "न लें"),
  done: p("Got it", "ठीक है"),
  notUseful: p("Not useful", "काम का नहीं"),
  close: p("Close", "बंद करें"),
  copy: p("Copy", "कॉपी करें"),
  copied: p("Copied", "कॉपी हो गया"),
  notCopied: p("Could not copy. Press and hold the text to copy it.", "कॉपी नहीं हुआ। टेक्स्ट को दबाकर रखें और कॉपी करें।"),
  share: p("Share", "शेयर करें"),
  offline: p("Needs the internet", "इंटरनेट चाहिए"),
};

/** A media query, false wherever it cannot be asked (the server, an old WebView, a test). */
const matches = (query: string) => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
const phone = () => matches("(max-width: 899px)");
const touch = () => matches("(pointer: coarse)");
const noSubscribe = () => () => {};
const reducedMotion = () => matches("(prefers-reduced-motion: reduce)");

/**
 * On a touch screen the keyboard covers half the page; close it first so
 * the suggestion that is about to appear under the box can be seen.
 */
function closeKeyboard() {
  if (!touch()) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
}

/**
 * The AI helper's button (D-324, D-330): the sparkle, the accent colour and
 * a verb that says what will happen ("Tidy up", "Write it for me"). It is
 * always a second choice beside the screen's own controls, never the only
 * way on. On a phone it is a full-width 48px row whose words wrap; with no
 * signal it says it needs the internet instead of failing after a tap.
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
  const online = useOnline();
  return (
    <button
      type="button"
      className="tap btn ghost as-btn"
      disabled={disabled || busy || !online}
      aria-busy={busy ? "true" : undefined}
      // A mouse press must not blur a text box first: several boxes save on blur.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        closeKeyboard();
        onClick();
      }}
      style={style}
    >
      <Ic n={!online ? "wifiOff" : busy ? "refresh" : "sparkle"} size={16} className={busy ? "as-spin" : undefined} />
      {busy ? tx(SAY.working) : !online ? `${tx(label)} · ${tx(SAY.offline)}` : tx(label)}
    </button>
  );
}

/** A problem in one quiet line, never a red error page. */
export function AssistProblemLine({ problem, onClose }: { problem: AssistProblem; onClose?: () => void }) {
  const { tx } = useVx();
  return (
    <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 12, background: "var(--s2)", color: "var(--mut)", fontSize: 14, lineHeight: 1.45 }}>
      <Ic n={problem === "offline" ? "wifiOff" : "info"} size={16} style={{ marginTop: 2 }} />
      <span style={{ flex: 1, minWidth: 0 }}>{tx(PROBLEM_TEXT[problem])}</span>
      {onClose ? (
        <button type="button" className="tap" aria-label={tx(SAY.close)} onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--mut)", padding: 0, minWidth: 32, minHeight: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Ic n="x" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * What a read-only suggestion offers to take away: copied, and on a phone
 * also shared. `onTaken` counts it as kept without closing the card — a
 * call script is read while the call goes on.
 */
export type Takeaway = { text: string; title?: string; onTaken?: () => void };

/**
 * A suggestion waiting for a decision. The words sit on an accent rail with
 * the "written by AI" line under them; Use puts them where the person can
 * still change them, Try again asks once more, Don't use throws them away.
 * A read-only suggestion (a summary, a script) passes `takeaway` and gets
 * Copy and, where the phone has one, Share.
 *
 * On a phone the card scrolls itself into view — clear of the bottom bar —
 * because it usually appears below the box the person was typing in.
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
  takeaway,
  readOnly,
}: {
  title: Pair;
  children: ReactNode;
  onUse?: () => void;
  onAgain?: () => void;
  onDiscard: () => void;
  busy?: boolean;
  useLabel?: Pair;
  privacy?: boolean;
  takeaway?: Takeaway;
  /** Something to read, not to put in a box: "Got it" and "Not useful" instead of "Use this" and "Don't use". */
  readOnly?: boolean;
}) {
  const { tx } = useVx();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const sharable = useSyncExternalStore(noSubscribe, () => canShare() && phone(), () => false);

  useEffect(() => {
    if (phone()) ref.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, []);

  const copy = async () => {
    if (!takeaway) return;
    const ok = await copyText(takeaway.text);
    setCopied(ok);
    toast.show({ text: tx(ok ? SAY.copied : SAY.notCopied), tone: ok ? "ok" : "bad" });
    if (ok) takeaway.onTaken?.();
  };
  const share = async () => {
    if (!takeaway) return;
    if (await shareText(takeaway.text, takeaway.title)) takeaway.onTaken?.();
  };

  return (
    <div ref={ref} className="fadein as-card" role="region" aria-label={tx(title)} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--bd)", borderLeft: "4px solid var(--acc)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--accfg)", textTransform: "uppercase", letterSpacing: ".05em" }}>
        <Ic n="sparkle" size={14} />
        {tx(title)}
      </span>
      <div className="as-read" style={{ display: "flex", flexDirection: "column", gap: 6, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</div>
      <span className="as-note">
        {tx(DRAFT_NOTE)}
        {privacy ? ` ${tx(PRIVACY_NOTE)}` : ""}
      </span>
      <div className="as-actions">
        {onUse ? (
          <button type="button" className="tap btn pri as-use" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onUse}>
            <Ic n="check" size={16} />
            {tx(useLabel ?? (readOnly ? SAY.done : SAY.use))}
          </button>
        ) : null}
        {takeaway ? (
          <button type="button" className={`tap btn ${onUse ? "sec" : "pri as-use"}`} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void copy()}>
            <Ic n={copied ? "check" : "copy"} size={16} />
            {tx(copied ? SAY.copied : SAY.copy)}
          </button>
        ) : null}
        {takeaway && sharable ? (
          <button type="button" className="tap btn sec" disabled={busy} onClick={() => void share()}>
            <Ic n="send" size={16} />
            {tx(SAY.share)}
          </button>
        ) : null}
        {onAgain ? (
          <button type="button" className="tap btn sec" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onAgain}>
            <Ic n={busy ? "refresh" : "sparkle"} size={16} className={busy ? "as-spin" : undefined} />
            {tx(busy ? SAY.working : SAY.again)}
          </button>
        ) : null}
        <button type="button" className="tap btn ghost" disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onDiscard}>
          {tx(readOnly ? SAY.notUseful : SAY.discard)}
        </button>
      </div>
    </div>
  );
}
