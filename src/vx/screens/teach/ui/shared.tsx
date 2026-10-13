"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { saveLanguageAction } from "@/app/(app)/preferences/actions";
import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";

import { requestLeaveVx } from "../actions";
import { addDays, LEAVE_REASONS, type LeaveSpan } from "../domain/teach";
import { dShort } from "./fmt";

import "./teach.css";
import "./tch.css";

/**
 * A piece of screen state that lives in the URL, so every design state can
 * be opened by link (`?sheet=leave`, `?view=history`) without a server round
 * trip: the address bar follows the state, the state does not follow the
 * address bar.
 */
export function useUrlState<T extends string>(key: string, initial: T | null): [T | null, (next: T | null) => void] {
  const [value, setValue] = useState<T | null>(initial);
  const set = (next: T | null) => {
    setValue(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next) url.searchParams.set(key, next);
    else url.searchParams.delete(key);
    window.history.replaceState(window.history.state, "", url.toString());
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
}: {
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

/** EN | हि as the design's 84px switch; writes the reader's stored language like the sidebar's (UI-6). */
export function LangSeg() {
  const { language } = useVx();
  const router = useRouter();
  const [pending, start] = useTransition();
  const hi = language === "hi";
  const set = (lang: "both" | "hi") =>
    start(async () => {
      const fd = new FormData();
      fd.set("language", lang);
      await saveLanguageAction({ status: "idle", message: null }, fd);
      router.refresh();
    });
  return (
    <div className="seg tc-lang" role="group" aria-label="Language" style={{ opacity: pending ? 0.6 : 1 }}>
      <span className="thumb" aria-hidden="true" style={{ width: "calc((100% - 6px) / 2)", transform: `translateX(${hi ? "100%" : "0%"})` }} />
      <button type="button" className={`tap${hi ? "" : " on"}`} aria-pressed={!hi} onClick={() => set("both")}>EN</button>
      <button type="button" className={`tap${hi ? " on" : ""}`} aria-pressed={hi} lang="hi" onClick={() => set("hi")}>हि</button>
    </div>
  );
}

/** The phone bar's "?". */
export function HelpIcon({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="tap btn ghost tc-x" aria-label={label} onClick={onClick} style={{ color: "var(--fg)" }}>
      <Ic n="help" size={24} />
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

type LeaveWhen = "today" | "tomorrow" | "pick";

const REASON_ICON: Record<string, IconName> = { unwell: "activity", family: "users", personal: "briefcase", other: "edit" };

/**
 * Apply for leave (design TchHome `leave`, TchMore `leave`): Today and a full
 * day are preset; the request goes to the office as asked, never approved
 * here. `stillToday` is what is left of the teacher's day, when the screen
 * knows it, for the line that says the office will arrange cover.
 */
export function LeaveSheet({ open, onClose, today, stillToday }: { open: boolean; onClose: () => void; today: string; stillToday?: Pair | null }) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const [when, setWhen] = useState<LeaveWhen>("today");
  const [picked, setPicked] = useState<string[]>([]);
  const [span, setSpan] = useState<LeaveSpan>("full");
  const [reason, setReason] = useState<string>("unwell");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Pair | null>(null);
  const [pending, start] = useTransition();

  const tomorrow = addDays(today, 1);
  const choices = Array.from({ length: 9 }, (_, i) => addDays(today, i + 1)).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).slice(0, 5);
  const days = when === "today" ? [today] : when === "tomorrow" ? [tomorrow] : picked;
  const bad = days.length === 0;
  const reasonPair = LEAVE_REASONS.find((r) => r.key === reason)?.text ?? LEAVE_REASONS[0].text;
  const whenText: Pair =
    when === "today" ? p(`Today · ${dShort(today)}`, `आज · ${dShort(today)}`) : when === "tomorrow" ? p(`Tomorrow · ${dShort(tomorrow)}`, `कल · ${dShort(tomorrow)}`) : picked.length ? p(picked.map(dShort).join(", ")) : p("Pick days", "दिन चुनें");
  const spanText: Pair = span === "first_half" ? p("first half", "पहला आधा") : span === "second_half" ? p("second half", "दूसरा आधा") : p("full day", "पूरा दिन");
  const summary = bad ? tx(p("Pick at least one day", "कम से कम एक दिन चुनें")) : `${tx(whenText)} · ${tx(days.length === 1 ? spanText : p("full day", "पूरा दिन"))} · ${tx(reasonPair)}`;
  const cover: Pair =
    when === "today"
      ? stillToday ?? p("The office will give your classes today to other teachers.", "आज की आपकी कक्षाएँ ऑफ़िस दूसरे शिक्षकों को देगा।")
      : when === "tomorrow"
        ? p(`${dShort(tomorrow)}: the office will arrange cover for your classes.`, `${dShort(tomorrow)}: ऑफ़िस आपकी कक्षाओं का इंतज़ाम करेगा।`)
        : p(`The office will arrange cover for ${picked.length || "the"} ${picked.length === 1 ? "day" : "days"}.`, `ऑफ़िस ${picked.length || ""} दिनों का इंतज़ाम करेगा।`);

  const send = () => {
    if (bad) {
      toast.show({ text: tx(p("Pick at least one day first", "पहले कम से कम एक दिन चुनें")), tone: "bad" });
      return;
    }
    start(async () => {
      setError(null);
      const res = await requestLeaveVx({ days, span: days.length === 1 ? span : "full", reason: reasonPair.en, note });
      if (res.ok) {
        setSent(true);
        toast.show({ text: tx(p("Leave request sent to the office", "छुट्टी का अनुरोध ऑफ़िस को भेजा गया")) });
      } else setError(res.error);
    });
  };

  const close = () => {
    onClose();
    setSent(false);
  };

  const seg = <T extends string>(value: T, set: (v: T) => void, opts: [T, Pair][], label: string) => {
    const idx = Math.max(0, opts.findIndex((o) => o[0] === value));
    return (
      <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}>
        <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${opts.length})`, transform: `translateX(${idx * 100}%)` }} />
        {opts.map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} className={`tap${v === value ? " on" : ""}`} onClick={() => set(v)} style={{ height: 42, fontSize: 14 }}>
            {tx(t)}
          </button>
        ))}
      </div>
    );
  };
  const head = (t: Pair) => (
    <span className="sech">
      {tx(t)}
      {sub(t) ? ` · ${sub(t)}` : ""}
    </span>
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(p("Apply for leave", "छुट्टी का आवेदन"))}
      sub={sent ? tx(p("Request sent · waiting for the office", "अनुरोध भेजा · ऑफ़िस के जवाब का इंतज़ार")) : tx(p("Today · full day is ready — change it if needed", "आज · पूरा दिन चुना है — ज़रूरत हो तो बदलें"))}
      footer={
        sent ? (
          <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} onClick={close}>
            {tx(p("Done", "ठीक है"))}
          </button>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="tc-s">{tx(p("You are asking for", "आप माँग रहे हैं"))}</span>
              <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{summary}</span>
            </span>
            <button type="button" className="tap btn pri tc-bb" style={{ padding: "0 20px", opacity: bad ? 0.5 : 1 }} disabled={pending} onClick={send}>
              {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="send" size={18} />}
              {tx(p("Send to office", "ऑफ़िस को भेजें"))}
            </button>
          </div>
        )
      }
    >
      {sent ? (
        <div className="tc-sb" style={{ alignItems: "center", textAlign: "center", paddingTop: 14 }}>
          <DrawnTick size={96} />
          <span className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{tx(p("Sent to the office", "ऑफ़िस को भेजा गया"))}</span>
          <span className="tc-p" style={{ fontWeight: 700 }}>{summary}</span>
          <span style={{ color: "var(--mut)" }}>{tx(p("The office will reply here. They will arrange cover for your classes.", "ऑफ़िस यहीं जवाब देगा और आपकी कक्षाओं का इंतज़ाम करेगा।"))}</span>
        </div>
      ) : (
        <div className="tc-sb">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("When", "कब"))}
            {seg<LeaveWhen>(when, setWhen, [["today", p("Today", "आज")], ["tomorrow", p("Tomorrow", "कल")], ["pick", p("Pick days", "दिन चुनें")]], "When")}
          </div>
          {when === "pick" ? (
            <div className="tc-in" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {choices.map((d) => {
                const on = picked.includes(d);
                return (
                  <button key={d} type="button" className={`tap chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => setPicked((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))} style={{ height: 44, padding: "0 14px", fontSize: 14 }}>
                    {dShort(d)}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("How long", "कितनी देर"))}
            {seg<LeaveSpan>(span, setSpan, [["full", p("Full day", "पूरा दिन")], ["first_half", p("First half", "पहला आधा")], ["second_half", p("Second half", "दूसरा आधा")]], "How long")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("Reason", "कारण"))}
            <div className="tc-g2" role="radiogroup" aria-label="Reason">
              {LEAVE_REASONS.map((r) => {
                const on = reason === r.key;
                return (
                  <button key={r.key} type="button" role="radio" aria-checked={on} className="tap tc-opt" onClick={() => setReason(r.key)} style={{ border: on ? "2px solid var(--acc)" : "1px solid var(--bd)", background: on ? "var(--accs)" : "var(--card)" }}>
                    <span className="tc-ib" style={{ width: 36, height: 36, borderRadius: 11, background: on ? "var(--acc)" : "var(--s2)", color: on ? "var(--onsolid)" : "var(--mut)" }}>
                      <Ic n={REASON_ICON[r.key] ?? "edit"} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 600 }}>{tx(r.text)}</span>
                      {sub(r.text) ? <span className="tc-s">{sub(r.text)}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field">
            <span>{tx(p("Note for the office (optional)", "ऑफ़िस के लिए नोट (वैकल्पिक)"))}</span>
            <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={tx(p("For example: fever since last night", "जैसे: कल रात से बुखार"))} style={{ minHeight: 72 }} />
          </label>
          <div className="tc-note" style={{ background: "var(--s2)" }}>
            <Ic n="users" style={{ marginTop: 2, color: "var(--acc)" }} />
            <span>{tx(cover)}</span>
          </div>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</span> : null}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- help */

export type HelpStep = { title: Pair; body: Pair } & ({ pic: ReactNode; icon?: never } | { icon: IconName; pic?: never });

/**
 * "?" help as three picture steps (RULES G): a small drawing of the thing to
 * tap, then the step in words with its Hindi under it. Opened by state so
 * `?sheet=help` works. "Call the office" when the school's number is set.
 */
export function HelpSheet({ open, onClose, title, sub: subtitle, steps, phone }: { open: boolean; onClose: () => void; title: Pair; sub?: Pair; steps: HelpStep[]; phone?: string }) {
  const { tx, sub } = useVx();
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
            {tx(p("Got it", "समझ गया"))}
          </button>
        </>
      }
    >
      <ol className="tc-sb" style={{ listStyle: "none", margin: 0, padding: "4px 0 0" }}>
        {steps.map((s, i) => (
          <li key={s.title.en} className="tc-in" style={{ display: "flex", gap: 14, alignItems: "stretch", animationDelay: `${i * 90}ms` }}>
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

/** The help pictures: a few skeleton lines and the one control the step is about. */
export function HelpPic({ kind }: { kind: "mark" | "seen" | "take" | "tap" | "save" | "change" | "pick" | "type" | "send" | "news" | "link" | "leave" }) {
  const box = (bg: string, children: ReactNode) => (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 10, background: bg }}>{children}</div>
  );
  const pill = (bg: string, fg: string, text: string) => <span className="pill" style={{ alignSelf: "flex-start", background: bg, color: fg }}>{text}</span>;
  switch (kind) {
    case "mark":
      return (
        <div style={{ width: "100%", height: "100%", padding: 10, display: "flex", flexDirection: "column", gap: 6, borderRadius: 10, background: "var(--pri)", color: "var(--prifg)" }}>
          <span className="tc-sk" style={{ width: "60%", background: "currentColor", opacity: 0.5 }} />
          <span className="tc-ib" style={{ marginTop: "auto", height: 26, borderRadius: 9, background: "var(--prifg)", color: "var(--pri)", fontSize: 11, fontWeight: 700, animation: "xPulse 2.4s ease infinite" }}>Mark</span>
        </div>
      );
    case "seen":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "80%" }} /><span className="tc-sk" style={{ width: "55%" }} />{pill("var(--oks)", "var(--ok)", "Seen ✓")}</>);
    case "take":
      return box(
        "var(--warns)",
        <>
          <span className="tc-sk" style={{ width: "70%", background: "var(--warnm)" }} />
          <span style={{ display: "flex", gap: 5 }}>
            <span className="tc-ib" style={{ flex: 1, height: 24, borderRadius: 8, background: "var(--pri)", color: "var(--prifg)", fontSize: 10, fontWeight: 700 }}>Take</span>
            <span className="tc-ib" style={{ flex: 1, height: 24, borderRadius: 8, background: "var(--card)", fontSize: 10, fontWeight: 700 }}>Can’t</span>
          </span>
        </>,
      );
    case "tap":
      return box(
        "transparent",
        <>
          <span className="tc-ib" style={{ justifyContent: "space-between", height: 24, padding: "0 8px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 10, fontWeight: 700 }}>Aadhya<span style={{ color: "var(--ok)" }}>P</span></span>
          <span className="tc-ib" style={{ justifyContent: "space-between", height: 24, padding: "0 8px", borderRadius: 8, background: "var(--bads)", border: "1.5px solid var(--bad)", fontSize: 10, fontWeight: 700 }}>Om<span style={{ color: "var(--bad)" }}>A</span></span>
        </>,
      );
    case "save":
      return box("transparent", <><span className="tc-sk" style={{ width: "70%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--pri)", color: "var(--prifg)", fontSize: 11, fontWeight: 700 }}>Save</span></>);
    case "change":
      return box("var(--card)", <>{pill("var(--oks)", "var(--ok)", "Saved ✓")}<span className="tc-ib" style={{ height: 24, borderRadius: 8, border: "1px solid var(--bds)", fontSize: 10, fontWeight: 700 }}>Change</span></>);
    case "pick":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "50%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, border: "2px solid var(--pri)", fontSize: 11, fontWeight: 700 }}>Class 7 · Science</span></>);
    case "type":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "60%" }} /><span className="tc-ib num" style={{ height: 26, width: 46, borderRadius: 8, border: "2px solid var(--acc)", fontSize: 13, fontWeight: 700 }}>58</span></>);
    case "send":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "70%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--ok)", color: "var(--onsolid)", fontSize: 11, fontWeight: 700 }}>Send ✓</span></>);
    case "news":
      return box("var(--card)", <>{pill("var(--accs)", "var(--accfg)", "New")}<span className="tc-sk" style={{ width: "85%" }} /><span className="tc-sk" style={{ width: "60%" }} /></>);
    case "link":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "60%" }} /><span className="tc-ib" style={{ height: 24, borderRadius: 8, background: "var(--accs)", color: "var(--accfg)", fontSize: 10, fontWeight: 700 }}>Share link</span></>);
    case "leave":
      return box("var(--card)", <><span className="tc-sk" style={{ width: "55%" }} /><span className="tc-ib" style={{ height: 26, borderRadius: 9, background: "var(--warns)", color: "var(--warnfg)", fontSize: 11, fontWeight: 700 }}>Apply leave</span></>);
  }
}
