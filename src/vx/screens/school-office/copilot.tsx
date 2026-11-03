"use client";
import { useEffect, useRef, useState } from "react";
import { markCopilotRowAction } from "@/app/(app)/school-office/returns/actions";
import { copilotAfterMark, copilotKey, copilotProgress, copilotResume, copilotRowText, copilotStep, type CopilotMark, type CopilotRow } from "@/modules/government-records/domain/copilot";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { Btn, Pill, Ring } from "@/vx/ui/primitives";
import { C, enteredOf, positionOf } from "./copilot-text";
import "./office.css";
import "./returns.css";

/*
 * Manual entry assistant. One prepared student at a time, every value one tap
 * from the clipboard, "Mark entered → next" remembered on the server so the
 * job resumes on any device. It never touches the portal: the person types
 * there, and "entered" is their own record, never the portal's acceptance.
 */

function inField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function PortalCopilot({ batchId, title, headers, rows, marks: initial, canMark }: { batchId: string; title: string; headers: string[]; rows: CopilotRow[]; marks: Record<string, CopilotMark>; canMark: boolean }) {
  const { tx } = useVx();
  const keys = rows.map((row) => row.key);
  const [marks, setMarks] = useState(initial);
  const [index, setIndex] = useState(() => copilotResume(keys, initial));
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [copied, setCopied] = useState<number | "row" | null>(null), [copyFailed, setCopyFailed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [listOpen, setListOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<HTMLButtonElement | null>(null);
  const row = rows[index];
  const progress = copilotProgress(keys, marks);
  const mark = row ? marks[row.key] : undefined;

  function go(to: number) {
    if (to === index) return;
    setDirection(to > index ? "next" : "prev"); setIndex(to);
    setNoteOpen(false); setFailed(false); setCopied(null); setCopyFailed(false);
  }
  async function copy(text: string, which: number | "row") {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false); setCopied(which);
      timer.current = setTimeout(() => setCopied(null), 1400);
    } catch { setCopied(null); setCopyFailed(true); }
  }
  async function record(state: CopilotMark["state"]) {
    if (!row || busy || !canMark) return;
    setBusy(true); setFailed(false);
    try {
      const result = await markCopilotRowAction({ batchId, rowKey: row.key, state, ...(state === "mismatch" ? { note: note.trim() } : {}) });
      if (!result.ok) { setFailed(true); return; }
      const next = { ...marks, [row.key]: result.mark };
      setMarks(next); setNoteOpen(false);
      if (state === "entered") go(copilotAfterMark(index, keys, next));
    } catch { setFailed(true); } finally { setBusy(false); }
  }

  // Keyboard: J/K or arrows to move, 1–9 to copy a field. Ignored while typing a note.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const action = copilotKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, inField: inField(event.target) }, row?.values.length ?? 0);
      if (!action || !row) return;
      event.preventDefault();
      if (action.kind === "copy") void copy(row.values[action.index], action.index);
      else go(copilotStep(index, rows.length, action.kind === "next" ? 1 : -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { current.current?.scrollIntoView?.({ block: "nearest" }); }, [index]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!row) return <div className="office-note">{tx(C.empty)}</div>;
  const pct = progress.total ? Math.round((progress.entered / progress.total) * 100) : 0;

  return <div className="cp">
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div className="card cp-top">
        <Ring value={progress.entered} max={progress.total} size={72} stroke={8} tone="var(--ok)">{pct}%</Ring>
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <strong className="num" style={{ fontSize: 22 }} aria-label={tx(enteredOf(progress.entered, progress.total))}>{progress.entered} / {progress.total}</strong>
          <span className="rb-meta">{title}</span>
          {progress.mismatch ? <span><Pill tone="warn">{progress.mismatch} {tx(C.mismatch)}</Pill></span> : null}
        </div>
      </div>
      <div className="office-note cp-note" role="note">{tx(C.honesty)} {tx(C.enteredMeaning)}</div>
      {!canMark ? <div className="office-note cp-note">{tx(C.readOnly)}</div> : null}
      {progress.remaining === 0 ? <div className="office-note" role="status">{tx(C.allDone)}</div> : null}

      <article className="card cp-card" aria-label={tx(positionOf(index + 1, rows.length))}>
        {/* The stage clips the slide, so a row arriving from the side never widens the page. */}
        <div className="cp-stage"><div key={row.key} className={direction === "prev" ? "cp-slide-prev" : "cp-slide-next"}>
          <div className="cp-who">
            <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
              <span className="rb-meta">{tx(positionOf(index + 1, rows.length))} · {row.classLabel}</span>
              <h2 className="serif">{row.name}</h2>
            </div>
            {mark ? <Pill tone={mark.state === "entered" ? "ok" : "warn"} icon={mark.state === "entered" ? "check" : "alert"}>{tx(mark.state === "entered" ? C.entered : C.mismatch)}</Pill> : <Pill>{tx(C.notYet)}</Pill>}
          </div>
          {mark?.state === "mismatch" && mark.note ? <div className="office-note" style={{ margin: "0 18px 12px", overflowWrap: "anywhere" }}>{mark.note}</div> : null}
          <ol className="cp-fields">
            {headers.map((header, i) => {
              const value = row.values[i] ?? "";
              return <li key={header} className="cp-field">
                <span className="cp-n" aria-hidden="true">{i < 9 ? i + 1 : ""}</span>
                <span className="cp-kv"><span className="cp-k">{header}</span><span className={`cp-v${value ? "" : " blank"}`}>{value || tx(C.blank)}</span></span>
                <button type="button" className={`tap btn sec cp-copy${copied === i ? " done" : ""}`} disabled={!value} aria-label={`${tx(C.copy)} ${header}`} onClick={() => void copy(value, i)}>
                  <Ic n={copied === i ? "check" : "copy"} size={16} />{tx(copied === i ? C.copied : C.copy)}
                </button>
              </li>;
            })}
          </ol>
        </div></div>
        <div className="cp-bar">
          {copyFailed ? <div className="office-note" role="alert">{tx(C.copyFailed)}</div> : null}
          {failed ? <div className="office-note" role="alert">{tx(C.saveFailed)}</div> : null}
          {noteOpen ? <div className="cp-mismatch">
            <label className="field"><span>{tx(C.mismatchNote)}</span><textarea className="inp" value={note} maxLength={500} autoFocus onChange={(event) => setNote(event.target.value)} /></label>
            <div className="rb-row"><Btn variant="pri" disabled={busy || !note.trim()} onClick={() => void record("mismatch")}>{tx(C.saveMismatch)}</Btn><Btn variant="ghost" onClick={() => setNoteOpen(false)}>{tx(C.cancel)}</Btn></div>
          </div> : null}
          <div className="rb-row">
            <Btn icon="chevLeft" ariaLabel={tx(C.prev)} disabled={index === 0} onClick={() => go(copilotStep(index, rows.length, -1))} />
            <Btn variant="pri" className="grow" icon="check" disabled={busy || !canMark} onClick={() => void record("entered")}>{tx(C.markEntered)}</Btn>
            <Btn icon="chevRight" ariaLabel={tx(C.next)} disabled={index === rows.length - 1} onClick={() => go(copilotStep(index, rows.length, 1))} />
          </div>
          <div className="rb-row">
            <button type="button" className={`tap btn sec${copied === "row" ? " cp-copy done" : ""}`} style={{ minHeight: 44 }} onClick={() => void copy(copilotRowText(row.values), "row")}><Ic n={copied === "row" ? "check" : "copy"} size={16} />{tx(copied === "row" ? C.copied : C.copyRow)}</button>
            <Btn icon="flag" disabled={busy || !canMark} onClick={() => { setNote(mark?.note ?? ""); setNoteOpen(true); }}>{tx(C.mismatch)}</Btn>
            <span className="cp-keys">{tx(C.shortcuts)}</span>
          </div>
        </div>
      </article>
    </div>

    <aside className={`card cp-side${listOpen ? " open" : ""}`} aria-label={tx(C.students)}>
      <button type="button" className="cp-toggle" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
        <span>{tx(C.students)} · {tx(enteredOf(progress.entered, progress.total))}</span><Ic n="chevDown" size={18} />
      </button>
      <div className="cp-list">
        <h3>{tx(C.students)} · {tx(enteredOf(progress.entered, progress.total))}</h3>
        {rows.map((item, i) => {
          const state = marks[item.key]?.state;
          return <button key={item.key} ref={i === index ? current : undefined} type="button" className="cp-item" aria-current={i === index ? "true" : undefined} onClick={() => { go(i); setListOpen(false); }}>
            <span className="cp-i">{i + 1}</span>
            <span className="cp-nm">{item.name}</span>
            {state ? <span className={`cp-tick ${state}`} aria-label={tx(state === "entered" ? C.entered : C.mismatch)}><Ic n={state === "entered" ? "check" : "alert"} size={12} stroke={2.6} /></span> : null}
          </button>;
        })}
      </div>
    </aside>
  </div>;
}
