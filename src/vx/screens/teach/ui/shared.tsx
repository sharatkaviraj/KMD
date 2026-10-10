"use client";

import { useState, useTransition, type ReactNode } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { Bi, useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";
import { Chip, ChipRow, Field, Seg, Textarea } from "@/vx/ui/controls";
import { Sheet, useToast } from "@/vx/ui/overlays";
import { SuccessTick } from "@/vx/ui/primitives";
import { shortDay } from "@/vx/format";

import { requestLeaveVx } from "../actions";
import { addDays, LEAVE_REASONS, type LeaveSpan } from "../domain/teach";

import "./teach.css";

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

/* --------------------------------------------------------------- leave */

/**
 * Apply for leave (design TchHome `leave`, TchMore `leave`). Today, full day
 * is preset; the request goes to the admin as asked, never approved here.
 */
export function LeaveSheet({ open, onClose, today }: { open: boolean; onClose: () => void; today: string }) {
  const { tx } = useVx();
  const toast = useToast();
  const [days, setDays] = useState<string[]>([today]);
  const [span, setSpan] = useState<LeaveSpan>("full");
  const [reason, setReason] = useState<string>("unwell");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<Pair | null>(null);
  const [pending, start] = useTransition();

  const next = Array.from({ length: 10 }, (_, i) => addDays(today, i)).filter((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0).slice(0, 7);
  const toggle = (d: string) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  const send = () =>
    start(async () => {
      setError(null);
      const reasonText = LEAVE_REASONS.find((r) => r.key === reason)?.text.en ?? "";
      const res = await requestLeaveVx({ days, span: days.length === 1 ? span : "full", reason: reasonText, note });
      if (res.ok) {
        setSent(true);
        toast.show({ text: tx(p("Leave request sent to the admin", "छुट्टी का अनुरोध भेजा गया")) });
      } else setError(res.error);
    });

  const close = () => {
    onClose();
    setSent(false);
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      icon="calMinus"
      title={tx(p("Apply for leave", "छुट्टी के लिए आवेदन"))}
      sub={tx(p("Goes to the admin. You will see the answer here.", "एडमिन के पास जाएगा। जवाब यहीं दिखेगा।"))}
      footer={
        sent ? (
          <button type="button" className="tap btn pri big" style={{ flex: 1 }} onClick={close}>
            {tx(p("Done", "ठीक है"))}
          </button>
        ) : (
          <>
            <button type="button" className="tap btn sec big" style={{ flex: 1 }} onClick={close}>
              {tx(p("Cancel", "रद्द करें"))}
            </button>
            <button type="button" className="tap btn pri big" style={{ flex: 2 }} disabled={pending || days.length === 0} onClick={send}>
              {pending ? <Ic n="refresh" size={18} className="spin" /> : <Ic n="send" size={18} />}
              {tx(p("Send request", "अनुरोध भेजें"))}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "12px 0", textAlign: "center" }}>
          <SuccessTick />
          <strong style={{ fontSize: 18 }}>{tx(p("Request sent", "अनुरोध भेजा गया"))}</strong>
          <span style={{ color: "var(--mut)" }}>
            {days.map((d) => shortDay(d)).join(", ")} · {tx(p("The admin will answer soon.", "एडमिन जल्द जवाब देंगे।"))}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field label={<Bi en="Which days?" hi="कौन से दिन?" />}>
            <ChipRow label="Days">
              {next.map((d) => (
                <Chip key={d} on={days.includes(d)} onClick={() => toggle(d)}>
                  {d === today ? tx(p("Today", "आज")) : shortDay(d)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          {days.length === 1 ? (
            <Field label={<Bi en="How long?" hi="कितनी देर?" />}>
              <Seg<LeaveSpan>
                label="How long"
                value={span}
                onChange={setSpan}
                options={[
                  { value: "full", label: tx(p("Full day", "पूरा दिन")) },
                  { value: "first_half", label: tx(p("First half", "पहला आधा")) },
                  { value: "second_half", label: tx(p("Second half", "दूसरा आधा")) },
                ]}
              />
            </Field>
          ) : null}
          <Field label={<Bi en="Why?" hi="क्यों?" />}>
            <ChipRow label="Reason">
              {LEAVE_REASONS.map((r) => (
                <Chip key={r.key} on={reason === r.key} onClick={() => setReason(r.key)}>
                  {tx(r.text)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
          <Field label={<Bi en="Note for the office (optional)" hi="ऑफ़िस के लिए नोट (वैकल्पिक)" />} hint={tx(p("Who can take your class, work you left…", "आपकी कक्षा कौन लेगा, छोड़ा गया काम…"))}>
            <Textarea rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error ? <span role="alert" style={{ color: "var(--bad)", fontWeight: 600 }}>{tx(error)}</span> : null}
        </div>
      )}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- help */

export type HelpStep = { icon: IconName; title: Pair; body: Pair };

/** "?" help as three picture steps (RULES G), opened by state so `?sheet=help` works. */
export function HelpSheet({ open, onClose, title, steps }: { open: boolean; onClose: () => void; title: Pair; steps: HelpStep[] }) {
  const { tx, sub } = useVx();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={tx(title)}
      icon="help"
      footer={
        <button type="button" className="tap btn pri big" style={{ flex: 1 }} onClick={onClose}>
          {tx(p("Got it", "समझ गया"))}
        </button>
      }
    >
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map((s, i) => (
          <li key={s.title.en} className="fadein" style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 80}ms` }}>
            <span style={{ flex: "none", width: 56, height: 56, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <Ic n={s.icon} size={26} />
              <span className="num" style={{ position: "absolute", top: -6, left: -6, width: 22, height: 22, borderRadius: 11, background: "var(--pri)", color: "var(--prifg)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <strong>{tx(s.title)}</strong>
              {sub(s.title) ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{sub(s.title)}</span> : null}
              <span style={{ color: "var(--mut)", fontSize: 14 }}>{tx(s.body)}</span>
            </span>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}

export function HelpIcon({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="tap icon-btn" aria-label={label} onClick={onClick} style={{ width: 44, height: 44 }}>
      <Ic n="help" size={22} />
    </button>
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
