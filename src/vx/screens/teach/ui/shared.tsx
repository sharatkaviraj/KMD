"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useState, type CSSProperties, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { useHelpGlow } from "@/vx/ui/help-glow";
import { LanguageControl } from "@/vx/ui/language";
import { ListenButton } from "@/vx/ui/listen";
import { Sheet } from "@/vx/ui/overlays";

import "./teach.css";
import "./tch.css";

/**
 * A piece of screen state that lives in the URL, so every design state can
 * be opened by link (`?sheet=leave`, `?view=history`) without a server round
 * trip. Both ways: the address bar follows the state, and the state follows
 * the address bar — a `<Link>` to the same screen without `?view=` closes the
 * month view ("Mark now" did nothing, 20 Oct smoke run), and the phone's Back
 * button closes a sheet instead of leaving the screen. Opening pushes a
 * history entry; closing one this hook opened goes back over it.
 */
export function useUrlState<T extends string>(key: string, initial: T | null): [T | null, (next: T | null) => void] {
  const fromUrl = (useSearchParams()?.get(key) ?? null) as T | null;
  const [value, setValue] = useState<T | null>(initial ?? fromUrl);
  const [seen, setSeen] = useState<T | null>(fromUrl);
  if (fromUrl !== seen) {
    setSeen(fromUrl);
    setValue(fromUrl);
  }
  const set = (next: T | null) => {
    setValue(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const had = url.searchParams.get(key);
    if (had === next) return;
    // Our own marker only: a state carrying Next's `__NA` would skip the
    // router, and `useSearchParams` would never hear of the change.
    const ours = (window.history.state as { vxUrlState?: string } | null)?.vxUrlState === key;
    if (!next && ours) {
      window.history.back();
      return;
    }
    if (next) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    if (next && had === null) window.history.pushState({ vxUrlState: key }, "", url.toString());
    else window.history.replaceState(ours ? { vxUrlState: key } : {}, "", url.toString());
  };
  return [value, set];
}

/** An English label with its Hindi line, as a block. */
export function L({ t, style }: { t: Pair; style?: React.CSSProperties }) {
  return (
    <span style={style}>
      <Bi en={t.en} hi={t.hi} />
    </span>
  );
}

/* ----------------------------------------------------------- the top bar */

/**
 * The teacher screens' top bar, as each module draws it: on a desk the crumb
 * and a serif title with the language switch and the screen's buttons; on a
 * phone an avatar (Today) or Back, a bold title with a line under it, the
 * language switch and "?". The kit's `TopBar` has no slot for Today's avatar.
 */
export function TchTop({
  crumb,
  title,
  actions,
  mTitle,
  mSub,
  mBack,
  mLead,
  mAction,
  dLead,
}: {
  /** Desktop: a control before the title (Back on a sub-view). */
  dLead?: ReactNode;
  crumb?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  mTitle?: ReactNode;
  mSub?: ReactNode;
  mBack?: string;
  mLead?: ReactNode;
  mAction?: ReactNode;
}) {
  return (
    <>
      <header className="only-d glass vx-top" style={{ flex: "none", height: 64, display: "flex", alignItems: "center", gap: 10, padding: "0 28px", borderBottom: "1px solid var(--bd)" }}>
        {dLead}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {crumb ? <span className="tc-s tc-el">{crumb}</span> : null}
          <h1 className="serif tc-el" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{title}</h1>
        </div>
        {actions}
      </header>
      <header className="only-m glass vx-top" style={{ flex: "none", minHeight: 58, display: "flex", alignItems: "center", gap: 6, padding: mLead ? "6px 8px 6px 12px" : "6px 8px 6px 4px", borderBottom: "1px solid var(--bd)" }}>
        {mLead ??
          (mBack ? (
            <BackLink href={mBack} className="tap btn ghost tc-x" style={{ color: "var(--fg)" }}>
              <Ic n="chevLeft" size={24} />
            </BackLink>
          ) : (
            <span style={{ width: 8 }} />
          ))}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", paddingLeft: mLead ? 4 : 0 }}>
          <span className="tc-el" style={{ fontSize: 17, fontWeight: 700 }}>{mTitle ?? title}</span>
          {mSub ? <span className="tc-s tc-el">{mSub}</span> : null}
        </span>
        {mAction}
      </header>
    </>
  );
}

/**
 * The language control on the teacher screens' top bar: English, हिंदी or
 * both (`@/vx/ui/language`). It used to be an EN | हि switch that wrote only
 * "en" or "hi", so trying it lost the "both" setting for good (smoke 20 Oct).
 */
export function LangSeg({ pill }: { pill?: boolean } = {}) {
  return <LanguageControl pill={pill} />;
}

/** The phone bar's "?". */
export function HelpIcon({ onClick, label }: { onClick: () => void; label: string }) {
  const help = useHelpGlow();
  return (
    // The word beside the "?" — an icon alone said nothing to a teacher who reads only what is printed (UX review 6 Nov 2026).
    // On a new screen it ripples softly until opened once (D-497).
    <button type="button" className={`tap btn ghost${help.glow ? " vx-help-new" : ""}`} onClick={() => { help.opened(); onClick(); }} style={{ color: "var(--fg)", gap: 4, paddingInline: 8, minWidth: 44 }}>
      <Ic n="help" size={22} />
      <span style={{ fontWeight: 700, fontSize: 14 }}>{label}</span>
    </button>
  );
}

/**
 * The desk bar's "? Help": one button, one word, one place — after the
 * language switch — on every teacher screen (teacher 20, 6 Nov 2026: Help was
 * a word on one screen, a bare "?" on the next and missing on Attendance).
 */
export function DeskHelp({ onClick, label }: { onClick: () => void; label: string }) {
  const help = useHelpGlow();
  return (
    <button type="button" className={`tap btn sec${help.glow ? " vx-help-new" : ""}`} onClick={() => { help.opened(); onClick(); }}>
      <Ic n="help" />
      {label}
    </button>
  );
}

/* ------------------------------------------------------------ small parts */

/** The drawn tick in a soft circle (xDraw), as the design's saved states draw it. */
export function DrawnTick({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" style={{ flex: "none", animation: "xPopIn .5s var(--spring) both" }}>
      <circle cx="48" cy="48" r="44" style={{ fill: "var(--oks)" }} />
      <circle cx="48" cy="48" r="44" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 4, ["--len" as string]: "276.5", strokeDasharray: "276.5", animation: "xDraw .8s .1s var(--ease) both" }} />
      <path d="M30 49l12 12 24-26" style={{ fill: "none", stroke: "var(--ok)", strokeWidth: 6, strokeLinecap: "round", strokeLinejoin: "round", ["--len" as string]: "60", strokeDasharray: "60", animation: "xDraw .45s .6s var(--ease) both" }} />
    </svg>
  );
}

const C = 163.4;

/** A marks-link progress ring: 26-radius, 7 stroke, the count in the middle. */
export function LinkRing({ entered, total, size = 64, tone, mid, delay = 0, font = 13 }: { entered: number; total: number; size?: number; tone: string; mid: string; delay?: number; font?: number }) {
  const frac = total > 0 ? Math.min(1, entered / total) : 0;
  return (
    <span style={{ position: "relative", flex: "none", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: "var(--s3)", strokeWidth: 7 }} />
        <circle cx="32" cy="32" r="26" style={{ fill: "none", stroke: tone, strokeWidth: 7, strokeLinecap: "round", strokeDasharray: `${(C * frac).toFixed(1)} ${C}`, ["--len" as string]: String(C), animation: `xDraw 1s ${delay}ms var(--ease) both` }} />
      </svg>
      <span className="num tc-ib" style={{ position: "absolute", inset: 0, fontWeight: 700, fontSize: font }}>{mid}</span>
    </span>
  );
}

/** Section title with Hindi under it and an optional action. */
export function Head({ t, action, icon }: { t: Pair; action?: ReactNode; icon?: IconName }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
        {icon ? (
          <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--accs)", color: "var(--accfg)", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Ic n={icon} size={18} />
          </span>
        ) : null}
        <Bi en={t.en} hi={t.hi} />
      </h2>
      {action}
    </div>
  );
}

/** A section title with the other language under it. */
export function CardTitle({ t, style }: { t: Pair; style?: CSSProperties }) {
  const { tx, sub } = useVx();
  return (
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", ...style }}>
      <span className="tc-t">{tx(t)}</span>
      {sub(t) ? <span className="tc-hi">{sub(t)}</span> : null}
    </span>
  );
}

/* --------------------------------------------------------------- leave */

/**
 * Code-split (in ./leave-sheet). A screen that never renders the sheet —
 * attendance, marks, tasks — no longer downloads it. The teacher home and More
 * screens render it on every visit (open={sheet === "leave"}), so they still
 * fetch the chunk at first render, just as a separate file. Server rendering
 * stays on, so a `?sheet=leave` link still renders the open sheet in the HTML.
 */
export const LeaveSheet = dynamic(() => import("./leave-sheet").then((mod) => mod.LeaveSheet));

/* ---------------------------------------------------------------- help */

export type HelpStep = { title: Pair; body: Pair } & ({ pic: ReactNode; icon?: never } | { icon: IconName; pic?: never });

/**
 * "?" help as three picture steps (RULES G): a small drawing of the thing to
 * tap, then the step in words with its Hindi under it. Opened by state so
 * `?sheet=help` works. "Call the office" when the school's number is set.
 */
export function HelpSheet({ open, onClose, title, sub: subtitle, steps, phone }: { open: boolean; onClose: () => void; title: Pair; sub?: Pair; steps: HelpStep[]; phone?: string }) {
  const { tx, sub } = useVx();
  // The step being read aloud by Listen (D-497), lit up so eyes can follow the voice.
  const [reading, setReading] = useState<number | null>(null);
  if (!open && reading !== null) setReading(null);
  const tel = phone ? phone.replace(/[^\d+]/g, "") : "";
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(title)}
      sub={subtitle ? `${tx(subtitle)}${sub(subtitle) ? ` · ${sub(subtitle)}` : ""}` : undefined}
      footer={
        <>
          {tel ? (
            <a href={`tel:${tel}`} className="tap btn sec tc-bb" style={{ flex: 1 }}>
              <Ic n="phone" />
              {tx(p("Call the office", "ऑफ़िस को फ़ोन करें"))}
            </a>
          ) : null}
          <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} onClick={onClose}>
            {tx(p("Got it", "ठीक है"))}
          </button>
        </>
      }
    >
      <ListenButton
        lines={[tx(title), ...steps.map((s, i) => `${i + 1}. ${tx(s.title)}. ${tx(s.body)}`)]}
        onLine={(i) => setReading(i === null || i === 0 ? null : i - 1)}
        className="tap btn sec tc-bb"
        style={{ marginBottom: 12 }}
      />
      <ol className="tc-sb" style={{ listStyle: "none", margin: 0, padding: "4px 0 0" }}>
        {steps.map((s, i) => (
          <li key={s.title.en} className={`tc-in vx-step${reading === i ? " reading" : ""}`} style={{ display: "flex", gap: 14, alignItems: "stretch", animationDelay: `${i * 90}ms` }}>
            <div className="tc-pic" style={{ flex: "none", width: 128 }}>
              {s.icon ? (
                <span className="tc-ib" style={{ width: 52, height: 52, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)" }}><Ic n={s.icon} size={26} /></span>
              ) : (
                s.pic
              )}
            </div>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, justifyContent: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="tc-av num" style={{ width: 26, height: 26, background: "var(--accs)", color: "var(--accfg)", fontSize: 13 }}>{i + 1}</span>
                <span className="tc-p" style={{ fontWeight: 700 }}>{tx(s.title)}</span>
              </span>
              <span style={{ color: "var(--mut)" }}>{tx(s.body)}</span>
              {sub(s.title) ? <span className="tc-s">{sub(s.title)}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

/**
 * The help pictures: a few skeleton lines and the one control the step is
 * about, labelled with the words on the real button in the reader's language.
 * They were English-only and used other words ("Seen ✓" for "I have read it",
 * "Apply leave" for "Ask for leave"), so the picture and its caption
 * disagreed (teacher day, 6 Nov 2026, teachers 17 and 19).
 */
export function HelpPic({ kind }: { kind: "mark" | "seen" | "take" | "tap" | "save" | "change" | "pick" | "type" | "send" | "news" | "link" | "leave" }) {
  const { tx } = useVx();
  const w = (en: string, hi: string) => tx(p(en, hi));
  const box = (bg: string, children: ReactNode) => (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, background: bg }}>{children}</div>
  );
  const pill = (bg: string, fg: string, text: string) => <span className="pill" style={{ alignSelf: "flex-start", background: bg, color: fg }}>{text}</span>;
  switch (kind) {
    case "mark":
      return (
        <div style={{ width: "100%", height: "100%", padding: 10, display: "flex", flexDirection: "column", gap: 6, borderRadius: 10, background: "var(--pri)", color: "var(--prifg)" }}>
          <span className="tc-sk" style={{ width: "60%", background: "currentColor", opacity: 0.5 }} />
          <span className="tc-ib" style={{ marginTop: "auto", height: 26, borderRadius: 9, background: "var(--prifg)", color: "var(--pri)", fontSize: 11, fontWeight: 700, animation: "xPulse 2.4s ease infinite" }}>{w("Mark attendance", "हाज़िरी लगाएँ")}</span>
        </div>
      );
    case "seen":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "80%" }} /><span className="tc-sk" style={{ width: "55%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--pri)", color: "var(--prifg)", fontSize: 11, fontWeight: 700, animation: "xPulse 2.4s ease infinite" }}>{w("I have read it", "पढ़ लिया")}</span></>);
    case "take":
      return box(
        "var(--warns)",
        <>
          <span className="tc-sk" style={{ width: "70%", background: "var(--warnm)" }} />
          <span style={{ display: "flex", gap: 5 }}>
            <span className="tc-ib" style={{ flex: 1, height: 24, borderRadius: 8, background: "var(--pri)", color: "var(--prifg)", fontSize: 10, fontWeight: 700 }}>{w("I’ll take it", "हाँ, ले लेंगे")}</span>
            <span className="tc-ib" style={{ flex: 1, height: 24, borderRadius: 8, background: "var(--card)", fontSize: 10, fontWeight: 700 }}>{w("I can’t", "नहीं ले पाएँगे")}</span>
          </span>
        </>,
      );
    case "tap":
      return box(
        "transparent",
        <>
          <span className="tc-ib" style={{ justifyContent: "space-between", height: 24, padding: "0 8px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 10, fontWeight: 700 }}>{w("Aadhya", "आध्या")}<span style={{ color: "var(--ok)" }}>{w("P", "उ")}</span></span>
          <span className="tc-ib" style={{ justifyContent: "space-between", height: 24, padding: "0 8px", borderRadius: 8, background: "var(--bads)", border: "1.5px solid var(--bad)", fontSize: 10, fontWeight: 700 }}>{w("Om", "ओम")}<span style={{ color: "var(--bad)" }}>{w("A", "अ")}</span></span>
        </>,
      );
    case "save":
      return box("transparent", <><span className="tc-sk" style={{ width: "70%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--pri)", color: "var(--prifg)", fontSize: 11, fontWeight: 700 }}>{w("Save attendance", "हाज़िरी सेव करें")}</span></>);
    case "change":
      return box("var(--card)", <>{pill("var(--oks)", "var(--ok)", w("Saved ✓", "सेव हो गई ✓"))}<span className="tc-ib" style={{ height: 24, borderRadius: 8, border: "1px solid var(--bds)", fontSize: 10, fontWeight: 700 }}>{w("Change", "बदलें")}</span></>);
    case "pick":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "50%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, border: "2px solid var(--pri)", fontSize: 11, fontWeight: 700 }}>{w("Class 7 · Science", "कक्षा 7 · विज्ञान")}</span></>);
    case "type":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "60%" }} /><span className="tc-ib num" style={{ height: 26, width: 46, borderRadius: 8, border: "2px solid var(--acc)", fontSize: 13, fontWeight: 700 }}>58</span></>);
    case "send":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "70%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--ok)", color: "var(--onsolid)", fontSize: 11, fontWeight: 700 }}>{w("Send ✓", "भेजें ✓")}</span></>);
    case "news":
      return box("var(--card)", <>{pill("var(--accs)", "var(--accfg)", w("New", "नया"))}<span className="tc-sk" style={{ width: "85%" }} /><span className="tc-sk" style={{ width: "60%" }} /></>);
    case "link":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "60%" }} /><span className="tc-ib" style={{ height: 24, borderRadius: 8, background: "var(--accs)", color: "var(--accfg)", fontSize: 10, fontWeight: 700 }}>{w("Share on WhatsApp", "व्हाट्सऐप पर भेजें")}</span></>);
    case "leave":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "55%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--warns)", color: "var(--warnfg)", fontSize: 11, fontWeight: 700 }}>{w("Ask for leave", "छुट्टी माँगें")}</span></>);
  }
}

/**
 * "Withdraw this request?" with Yes and Keep it — the second step of
 * withdrawing a leave request, on Today and on More. One tap used to remove
 * the request with no way back (20-teacher school day, 6 Nov 2026).
 */
export function WithdrawConfirm({ pending, onYes, onNo }: { pending: boolean; onYes: () => void; onNo: () => void }) {
  const { tx } = useVx();
  return (
    <span role="group" aria-label={tx(p("Withdraw this request?", "यह अनुरोध वापस लें?"))} style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{tx(p("Withdraw this request? The office will no longer see it.", "यह अनुरोध वापस लें? ऑफ़िस को यह फिर नहीं दिखेगा।"))}</span>
      <span style={{ display: "flex", gap: 8 }}>
        <button type="button" className="tap btn" disabled={pending} onClick={onYes} style={{ minHeight: 44, background: "var(--bads)", color: "var(--bad)" }}>
          {pending ? tx(p("Withdrawing…", "वापस लिया जा रहा है…")) : tx(p("Yes, withdraw", "हाँ, वापस लें"))}
        </button>
        <button type="button" className="tap btn ghost" disabled={pending} onClick={onNo} style={{ minHeight: 44 }}>
          {tx(p("Keep it", "रहने दें"))}
        </button>
      </span>
    </span>
  );
}
