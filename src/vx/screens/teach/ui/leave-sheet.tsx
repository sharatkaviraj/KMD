"use client";

/**
 * "Ask for leave" — the sheet behind `?sheet=leave` on the teacher's home and
 * More screens. Split out of `./shared` (see the `LeaveSheet` re-export there):
 * while it lived in `shared`, every screen importing `shared` — attendance
 * included — shipped it in its first download, though only home and More ever
 * render it (the eager-JS budget in scripts/performance-bundles.mjs).
 * Moved verbatim; behaviour is unchanged.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { m } from "@/messages";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Textarea } from "@/vx/ui/controls";
import { Sheet } from "@/vx/ui/overlays";

import { previewLeaveVx, requestLeaveVx } from "../actions";
import { leaveSpanFor, type LeaveDayPeriods } from "@/vx/screens/timetable/domain/timetable";
import { addDays, LEAVE_REASONS, leaveSubmissionFor, type LeaveSpan, type LeaveSubmission } from "../domain/teach";
import { periodClassList } from "../domain/today";
import { dShortP } from "./fmt";
import { DrawnTick } from "./shared";

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
  // The id this request is sent under, kept across tries of the same request
  // so a send whose answer was lost files once when she taps it again.
  const submission = useRef<LeaveSubmission | null>(null);

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
    const input = { days, span: leaveSpanFor(days.length, span), reason: reasonPair.en, note };
    const current = leaveSubmissionFor(submission.current, input, () => crypto.randomUUID());
    submission.current = current;
    start(async () => {
      setError(null);
      try {
        const res = await requestLeaveVx({ ...input, requestId: current.id });
        if (res.ok) {
          submission.current = null;
          // No toast: it sat on top of "what happens next" (smoke 20 Oct). The sheet itself says it went.
          setSent({ summary: text, covered });
          router.refresh();
        } else setError(res.error);
      } catch {
        // No answer — it may or may not have gone. The id is kept, so
        // sending again files it once either way.
        setError(m.leaveNotSentRetry);
      }
    });
  };

  const close = () => {
    onClose();
    submission.current = null;
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
