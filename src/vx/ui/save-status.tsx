"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

/**
 * One saving vocabulary (review U01): the line a save shows while it waits,
 * once the server has answered, and when it could not be saved. Its icons and
 * words are the ones "Decide several" settled first (N01/N02) — a spinning
 * refresh while saving, a green tick once confirmed, a red alert on failure.
 *
 * The rules it keeps, so a screen does not have to:
 *  - **Never "Saved" before the server answers.** There is no optimistic
 *    state: `saved` is set by the caller from the server's reply, and `held`
 *    (kept on this device, still undoable) and `saving` read as not done.
 *  - **Stable layout.** The line reserves its own height, so it appearing or
 *    changing does not push the page about. Pass `reserve={false}` where it
 *    replaces a line of the same height.
 *  - **Restrained motion.** A short fade; nothing under `prefers-reduced-motion`.
 *  - **It does not take focus.** It is a polite `status` region (a failure an
 *    `alert`); pressing its own Undo or Try again keeps focus on the line
 *    instead of dropping it to the page when the button goes.
 *  - **A TEST session says so**, in the session switcher's TEST colours.
 */

export type SaveState =
  | { kind: "idle" }
  /** Kept on this device and still undoable; nothing has reached the server. */
  | { kind: "held" }
  /** Sent; waiting for the answer. `slow` after a few seconds, so nobody presses twice. */
  | { kind: "saving"; slow?: boolean }
  /** The server confirmed it. */
  | { kind: "saved"; detail?: Pair }
  /** It did not save, or nobody can tell: what happened, and what to do next. */
  | { kind: "failed"; message?: Pair; next?: Pair }
  /** Confirmed, and the thing it was about has left the list. */
  | { kind: "removed"; detail?: Pair };

export type SaveKind = SaveState["kind"];

export const SAVE_IDLE: SaveState = { kind: "idle" };

export const SAVE_WORDS = {
  held: p("Will send in a moment", "कुछ ही पल में भेजा जाएगा"),
  saving: p("Saving…", "सहेजा जा रहा है…"),
  sending: p("Sending…", "भेजा जा रहा है…"),
  slow: p("Still saving — please wait. Pressing again will not save it twice.", "अभी सहेजा जा रहा है — थोड़ा रुकें। दोबारा दबाने से दो बार नहीं सहेजा जाएगा।"),
  saved: p("Saved", "सहेजा गया"),
  failed: p("Could not save", "सहेजा नहीं जा सका"),
  removed: p("Saved and taken off the list", "सहेजा गया और सूची से हटाया गया"),
  retry: p("Try again", "फिर कोशिश करें"),
  undo: p("Undo", "वापस लें"),
  test: p("TEST session", "TEST सत्र"),
};

export type SaveWords = Partial<typeof SAVE_WORDS>;

/** The batch rows' marks (N01/N02), shared so one save never looks like two. */
const MARK: Record<Exclude<SaveKind, "idle">, { icon: IconName; color: string; spin?: boolean }> = {
  held: { icon: "clock", color: "var(--mut)" },
  saving: { icon: "refresh", color: "var(--mut)", spin: true },
  saved: { icon: "check", color: "var(--ok)" },
  failed: { icon: "alert", color: "var(--bad)" },
  removed: { icon: "check", color: "var(--ok)" },
};

/** Just the mark, for a row that draws its own words (the batch list). */
export function SaveMark({ kind, size = 18 }: { kind: SaveKind; size?: number }) {
  if (kind === "idle") return null;
  const mark = MARK[kind];
  return <Ic n={mark.icon} size={size} className={mark.spin ? "spin" : undefined} style={{ color: mark.color, flex: "none" }} />;
}

/** How long a save runs before it says it is still going (smoke run: ~10 s with only a spinner). */
export const SLOW_SAVE_MS = 3000;

/** True once `active` has lasted `ms`; false again as soon as it stops. */
export function useSlowSave(active: boolean, ms = SLOW_SAVE_MS): boolean {
  const [slow, setSlow] = useState(false);
  const [was, setWas] = useState(active);
  // A new save starts fresh: adjusted during render, not in an effect.
  if (was !== active) {
    setWas(active);
    setSlow(false);
  }
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => setSlow(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && slow;
}

export function SaveStatus({
  state,
  onRetry,
  onUndo,
  test,
  words,
  live = true,
  reserve = 20,
  className,
  style,
}: {
  state: SaveState;
  /** Shown with a failure. It must send the same thing again, with what the person entered kept. */
  onRetry?: () => void;
  /** Shown while held. */
  onUndo?: () => void;
  /** A TEST session: the line says so. */
  test?: boolean;
  /** Words for this screen, e.g. `{ saving: SAVE_WORDS.sending }`. */
  words?: SaveWords;
  /** False where another copy of the line is the one announced (a list row beside its detail). */
  live?: boolean;
  /** The height kept for the line when it is empty, or false. */
  reserve?: number | false;
  className?: string;
  style?: CSSProperties;
}) {
  const { tx } = useVx();
  const box = useRef<HTMLSpanElement>(null);
  const w = { ...SAVE_WORDS, ...words };
  const kind = state.kind;
  const acts = Boolean(onRetry || onUndo);

  // Felt and heard when the answer comes (D-497): a change to saved or
  // failed, never the state the line was first drawn in. `live` only, so a
  // list row beside its detail does not cue twice.
  const seen = useRef(kind);
  useEffect(() => {
    if (seen.current === kind) return;
    seen.current = kind;
    if (!live) return;
    if (kind === "saved" || kind === "removed") cue("success");
    else if (kind === "failed") cue("error");
  }, [kind, live]);

  let line: string | null = null;
  let next: string | null = null;
  switch (state.kind) {
    case "held":
      line = tx(w.held);
      break;
    case "saving":
      line = tx(state.slow ? w.slow : w.saving);
      break;
    case "saved":
      line = state.detail ? `${tx(w.saved)} · ${tx(state.detail)}` : tx(w.saved);
      break;
    case "failed":
      line = state.message ? `${tx(w.failed)} · ${tx(state.message)}` : tx(w.failed);
      next = state.next ? tx(state.next) : null;
      break;
    case "removed":
      line = state.detail ? `${tx(w.removed)} · ${tx(state.detail)}` : tx(w.removed);
      break;
  }

  const body =
    kind === "idle" ? null : (
      <span key={kind} className="vx-save-body">
        {/* One unit, so a long reason wraps beside its mark instead of leaving the mark alone on a line. */}
        <span className="vx-save-head">
          {test ? <span className="vx-save-test">{tx(w.test)}</span> : null}
          <SaveMark kind={kind} size={16} />
          <span className="vx-save-text">{line}</span>
        </span>
        {/* The pressed button is replaced by the next state's words: focus stays on the line, not the page. */}
        {kind === "held" && onUndo ? (
          <button type="button" className="tap vx-save-act" onClick={() => { box.current?.focus({ preventScroll: true }); cue("undo"); onUndo(); }}>
            {tx(w.undo)}
          </button>
        ) : null}
        {kind === "failed" && onRetry ? (
          <button type="button" className="tap vx-save-act" onClick={() => { box.current?.focus({ preventScroll: true }); onRetry(); }}>
            <Ic n="refresh" size={15} />
            {tx(w.retry)}
          </button>
        ) : null}
        {next ? <span className="vx-save-next">{next}</span> : null}
      </span>
    );

  return (
    <span
      ref={box}
      tabIndex={acts ? -1 : undefined}
      className={`vx-save${className ? ` ${className}` : ""}`}
      data-kind={kind}
      style={{ minHeight: reserve === false ? undefined : reserve, ...style }}
    >
      {/* The polite region is always there, so a change in it is announced. */}
      <span role={live ? "status" : undefined} aria-live={live ? "polite" : undefined} className="vx-save-live">
        {kind === "failed" ? null : body}
      </span>
      {kind === "failed" ? <span role={live ? "alert" : undefined} className="vx-save-live">{body}</span> : null}
    </span>
  );
}
