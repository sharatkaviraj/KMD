"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition, type CSSProperties, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { BackLink } from "@/vx/ui/back-link";
import { Textarea } from "@/vx/ui/controls";
import { LanguageControl } from "@/vx/ui/language";
import { Sheet } from "@/vx/ui/overlays";

import { previewLeaveVx, requestLeaveVx } from "../actions";
import { leaveSpanFor, type LeaveDayPeriods } from "@/vx/screens/timetable/domain/timetable";
import { addDays, LEAVE_REASONS, type LeaveSpan } from "../domain/teach";
import { periodClassList } from "../domain/today";
import { dShortP } from "./fmt";

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

type PreviewDay = LeaveDayPeriods & { closed?: boolean };
type LeavePreviewState = { key: string; status: "loading" | "ready" | "failed"; span: LeaveSpan; days: PreviewDay[] };

/**
 * The periods a leave would cover, from the server's one resolver (B11) —
 * the same one the approval follows. Reads only; refetched when the days or
 * the span change.
 */
function useLeavePreview(days: readonly string[], span: LeaveSpan): LeavePreviewState | null {
  const daysKey = [...days].sort().join(",");
  const key = `${daysKey}|${span}`;
  const [state, setState] = useState<LeavePreviewState | null>(null);
  useEffect(() => {
    if (!daysKey) return;
    let live = true;
    const done = (next: Omit<LeavePreviewState, "key">) => {
      if (live) setState({ key: `${daysKey}|${span}`, ...next });
    };
    previewLeaveVx({ days: daysKey.split(","), span }).then(
      (res) => done(res.ok ? { status: "ready", span: res.span, days: res.days } : { status: "failed", span, days: [] }),
      () => done({ status: "failed", span, days: [] }),
    );
    return () => {
      live = false;
    };
  }, [daysKey, span]);
  if (!daysKey) return null;
  return state?.key === key ? state : { key, status: "loading", span, days: [] };
}

const SPAN_NAME: Record<LeaveSpan, Pair> = { full: p("Full day", "पूरा दिन"), first_half: p("First half", "पहली पाली"), second_half: p("Second half", "दूसरी पाली") };

/** How many of her periods the preview found, for the success line's promise of cover. */
function previewTotal(preview: LeavePreviewState | null): number {
  return preview?.status === "ready" ? preview.days.reduce((n, d) => n + d.periods.length, 0) : 0;
}

/** "Tue 20 Oct · First half – P2 Class 10 · P3 Class 7", one line a day. */
function LeavePreview({ preview, asked }: { preview: LeavePreviewState | null; asked: LeaveSpan }) {
  const { tx } = useVx();
  if (!preview) return null;
  const total = previewTotal(preview);
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }} aria-live="polite">
      {preview.status === "loading" ? <span style={{ fontSize: 13 }}>{tx(p("Checking your periods…", "आपके पीरियड देखे जा रहे हैं…"))}</span> : null}
      {preview.status === "failed" ? <span style={{ fontSize: 13 }}>{tx(p("Could not check your periods. The office will still arrange cover.", "आपके पीरियड देखे नहीं जा सके। ऑफ़िस फिर भी इंतज़ाम करेगा।"))}</span> : null}
      {preview.status === "ready"
        ? preview.days.map((d) => {
            const day = dShortP(d.day);
            const span = SPAN_NAME[preview.span];
            const list = periodClassList(d.periods);
            return (
              <span key={d.day} style={{ fontSize: 13 }}>
                {d.closed
                  ? tx(p(`${day.en} · school is closed — no leave needed`, `${day.hi} · स्कूल बंद है — छुट्टी की ज़रूरत नहीं`))
                  : d.periods.length
                    ? tx(p(`${day.en} · ${span.en} – ${list.en}`, `${day.hi} · ${span.hi} – ${list.hi}`))
                    : tx(p(`${day.en} · ${span.en} – no classes of yours`, `${day.hi} · ${span.hi} – आपकी कोई कक्षा नहीं`))}
              </span>
            );
          })
        : null}
      {preview.status === "ready" && total > 0 ? <span style={{ fontSize: 13, fontWeight: 700 }}>{tx(p(`The office will arrange cover for these ${total} period${total === 1 ? "" : "s"}.`, `ऑफ़िस इन ${total} पीरियड का इंतज़ाम करेगा।`))}</span> : null}
      {asked !== preview.span ? <span style={{ fontSize: 13 }}>{tx(p("A half day is asked one day at a time, so these days go as full days.", "आधा दिन एक-एक दिन के लिए माँगा जाता है, इसलिए ये पूरे दिन जाएँगे।"))}</span> : null}
    </span>
  );
}

/**
 * Apply for leave — the one leave form, from Today and from More (smoke
 * 20 Oct: two forms with different words and controls). Nothing is chosen
 * for her: no day, and no reason until she taps one ("Unwell" was preset and
 * one tap told the office she was ill). Closed days are shown and cannot be
 * picked. The request goes to the office as asked, never approved here; the
 * periods it would cover come from the one leave resolver (B11).
 */
export function LeaveSheet({ open, onClose, today, closedDays = [] }: { open: boolean; onClose: () => void; today: string; closedDays?: readonly { day: string; tag: Pair }[] }) {
  const { tx, sub } = useVx();
  const router = useRouter();
  const [when, setWhen] = useState<LeaveWhen | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [span, setSpan] = useState<LeaveSpan>("full");
  const [reason, setReason] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<{ summary: string; covered: boolean } | null>(null);
  const [error, setError] = useState<Pair | null>(null);
  const [pending, start] = useTransition();

  const closedTagOf = (d: string) => closedDays.find((c) => c.day === d)?.tag ?? null;
  const tomorrow = addDays(today, 1);
  const choices = Array.from({ length: 10 }, (_, i) => addDays(today, i)).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).slice(0, 7);
  const days = when === "today" ? [today] : when === "tomorrow" ? [tomorrow] : when === "pick" ? picked : [];
  const noDay = days.length === 0;
  const reasonPair = LEAVE_REASONS.find((r) => r.key === reason)?.text ?? null;
  const ready = !noDay && reasonPair !== null;
  const todayD = dShortP(today);
  const tomorrowD = dShortP(tomorrow);
  const whenText: Pair =
    when === "today"
      ? p(`Today · ${todayD.en}`, `आज · ${todayD.hi}`)
      : when === "tomorrow"
        ? p(`Tomorrow · ${tomorrowD.en}`, `कल · ${tomorrowD.hi}`)
        : p(picked.map((d) => dShortP(d).en).join(", "), picked.map((d) => dShortP(d).hi).join(", "));
  const spanText: Pair = days.length > 1 ? p(`${days.length} full days`, `${days.length} पूरे दिन`) : SPAN_NAME[span];
  const summary = noDay ? tx(p("Pick the day first", "पहले दिन चुनें")) : [tx(whenText), tx(spanText), reasonPair ? tx(reasonPair) : null].filter(Boolean).join(" · ");
  const preview = useLeavePreview(days, span);
  // The sheet's line says what to do next, not "Choose the day first" after the day is chosen.
  const step = sent ? p("Request sent · waiting for the office", "अनुरोध भेजा · ऑफ़िस के जवाब का इंतज़ार") : noDay ? p("Choose the day first", "पहले दिन चुनें") : !reasonPair ? p("Now pick a reason", "अब कारण चुनें") : p("Check and send", "देखकर भेजें");

  const send = () => {
    if (noDay || !reasonPair) return setTries((n) => n + 1);
    const covered = previewTotal(preview) > 0;
    const text = summary;
    start(async () => {
      setError(null);
      const res = await requestLeaveVx({ days, span: leaveSpanFor(days.length, span), reason: reasonPair.en, note });
      if (res.ok) {
        // No toast: it sat on top of "what happens next" (smoke 20 Oct). The sheet itself says it went.
        setSent({ summary: text, covered });
        router.refresh();
      } else setError(res.error);
    });
  };

  const close = () => {
    onClose();
    setSent(null);
    setWhen(null);
    setPicked([]);
    setReason(null);
    setTries(0);
    setNote("");
    setSpan("full");
    setError(null);
  };

  /** A choice with its other-language line under it, for a reader of both. */
  const label = (t: Pair, extra?: Pair | null) => (
    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
      <span>{tx(t)}</span>
      {extra ? <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{tx(extra)}</span> : sub(t) ? <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>{sub(t)}</span> : null}
    </span>
  );
  const seg = <T extends string>(value: T | null, set: (v: T) => void, opts: [T, Pair, Pair | null, boolean][], aria: string) => {
    const idx = opts.findIndex((o) => o[0] === value);
    return (
      <div className="seg" role="radiogroup" aria-label={aria} style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}>
        {idx >= 0 ? <span className="thumb" aria-hidden="true" style={{ width: `calc((100% - 6px) / ${opts.length})`, transform: `translateX(${idx * 100}%)` }} /> : null}
        {opts.map(([v, t, extra, off]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} disabled={off} className={`tap${v === value ? " on" : ""}`} onClick={() => set(v)} style={{ minHeight: 46, fontSize: 14, opacity: off ? 0.5 : 1 }}>
            {label(t, extra)}
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
  const todayTag = closedTagOf(today);
  const tomorrowTag = closedTagOf(tomorrow);
  const noteLabel = p("Note for the office (optional)", "ऑफ़िस के लिए नोट (ज़रूरी नहीं)");

  return (
    <Sheet
      open={open}
      onClose={close}
      title={tx(p("Apply for leave", "छुट्टी का आवेदन"))}
      sub={tx(step)}
      footer={
        sent ? (
          <button type="button" className="tap btn pri tc-bb" style={{ flex: 1 }} onClick={close}>
            {tx(p("Done", "ठीक है"))}
          </button>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="tc-s">{tx(p("Your request", "आपका आवेदन"))}</span>
              <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{summary}</span>
            </span>
            <button type="button" className="tap btn pri tc-bb" aria-disabled={!ready} style={{ padding: "0 20px", opacity: ready ? 1 : 0.5 }} disabled={pending} onClick={send}>
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
          <span className="tc-p" style={{ fontWeight: 700 }}>{sent.summary}</span>
          <span style={{ color: "var(--mut)" }}>
            {sent.covered
              ? tx(p("The office will answer on Today and in My leave. They will arrange cover for your periods.", "ऑफ़िस का जवाब “आज” और “मेरी छुट्टी” में दिखेगा। आपके पीरियड का इंतज़ाम ऑफ़िस करेगा।"))
              : tx(p("The office will answer on Today and in My leave.", "ऑफ़िस का जवाब “आज” और “मेरी छुट्टी” में दिखेगा।"))}
          </span>
        </div>
      ) : (
        <div className="tc-sb">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("When", "कब"))}
            {seg<LeaveWhen>(
              when,
              setWhen,
              [
                ["today", p("Today", "आज"), todayTag, Boolean(todayTag)],
                ["tomorrow", p("Tomorrow", "कल"), tomorrowTag, Boolean(tomorrowTag)],
                ["pick", p("Pick days", "दिन चुनें"), null, false],
              ],
              tx(p("When", "कब")),
            )}
            {todayTag ? <span className="tc-s">{tx(p(`School is closed today (${todayTag.en}). No leave is needed today.`, `आज स्कूल बंद है (${todayTag.hi ?? todayTag.en})। आज छुट्टी की ज़रूरत नहीं।`))}</span> : null}
          </div>
          {when === "pick" ? (
            <div className="tc-in" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {choices.map((d) => {
                const on = picked.includes(d);
                const tag = closedTagOf(d);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`tap chip${on ? " on" : ""}`}
                    aria-pressed={on}
                    disabled={Boolean(tag)}
                    onClick={() => setPicked((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
                    style={{ minHeight: 46, padding: "0 14px", fontSize: 14, flexDirection: "column", justifyContent: "center", gap: 0, lineHeight: 1.2, opacity: tag ? 0.55 : 1 }}
                  >
                    <span>
                      {d === today ? `${tx(p("Today", "आज"))} · ` : ""}
                      {tx(dShortP(d))}
                    </span>
                    {tag ? <span style={{ fontSize: 11, fontWeight: 500 }}>{tx(tag)}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("How long", "कितनी देर"))}
            {seg<LeaveSpan>(
              span,
              setSpan,
              [
                ["full", SPAN_NAME.full, null, false],
                ["first_half", SPAN_NAME.first_half, null, false],
                ["second_half", SPAN_NAME.second_half, null, false],
              ],
              tx(p("How long", "कितनी देर")),
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {head(p("Reason", "कारण"))}
            <div key={tries} className="tc-g2" role="radiogroup" aria-label={tx(p("Reason", "कारण"))} style={{ animation: tries && !reason ? "xShake .4s ease" : "none" }}>
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
            {tries && noDay ? (
              <span className="fadein" style={{ fontSize: 13, fontWeight: 700, color: "var(--bad)" }}>{tx(p("Pick the day first", "पहले दिन चुनें"))}</span>
            ) : tries && !reason ? (
              <span className="fadein" style={{ fontSize: 13, fontWeight: 700, color: "var(--bad)" }}>{tx(p("Pick a reason", "कारण चुनें"))}</span>
            ) : null}
          </div>
          <label className="field">
            <span>
              {tx(noteLabel)}
              {sub(noteLabel) ? ` · ${sub(noteLabel)}` : ""}
            </span>
            <Textarea value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={tx(p("For example: fever since last night", "जैसे: कल रात से बुखार"))} style={{ minHeight: 72 }} />
          </label>
          <div className="tc-note" style={{ background: "var(--s2)" }}>
            <Ic n="users" style={{ marginTop: 2, color: "var(--acc)" }} />
            {preview ? <LeavePreview preview={preview} asked={span} /> : <span style={{ fontSize: 13 }}>{tx(p("Pick a day to see which of your periods need cover.", "दिन चुनें — दिखेगा कि किन पीरियड का इंतज़ाम करना होगा।"))}</span>}
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
            {tx(p("Got it", "ठीक है"))}
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
