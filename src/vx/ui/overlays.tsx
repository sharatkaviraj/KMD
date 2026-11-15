"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cue, feedbackReady, primeFeedback, type CueKind } from "@/ui/feedback/cue";
import { readFeedbackPrefs } from "@/ui/feedback/prefs";
import { speakLine } from "@/ui/feedback/speak";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { useHelpGlow } from "@/vx/ui/help-glow";
import { ListenButton } from "@/vx/ui/listen";
import { p } from "@/vx/text";

const SAY = {
  close: p("Close", "बंद करें"),
  gotIt: p("Got it", "समझ गए"),
  cancel: p("Cancel", "रहने दें"),
  undo: p("Undo", "वापस लें"),
  help: (title: string) => p(`Help: ${title}`, `मदद: ${title}`),
};

/*
 * Sheets, dialogs and toasts. They render into `#vx-layer`, which the shell
 * mounts beside the page (see the note in vx.css). On a phone a sheet is a
 * bottom sheet with a grab handle; from 900px it is a centred dialog. Both
 * play their closing animation before they unmount.
 */

const noSubscribe = () => () => {};

const SHEET_MARK = "__vxSheet";
let sheetHistorySeq = 0;

/** Consume the overlay's history entry before a caller replaces the URL. */
export function dismissSheetHistoryForNavigation(): Promise<void> {
  const marker = (window.history.state as Record<string, unknown> | null)?.[SHEET_MARK];
  if (!marker) return Promise.resolve();
  return new Promise((resolve) => {
    const onPop = (event: PopStateEvent) => {
      if ((event.state as Record<string, unknown> | null)?.[SHEET_MARK] === marker) return;
      window.removeEventListener("popstate", onPop);
      resolve();
    };
    window.addEventListener("popstate", onPop);
    // The sheet's own popstate handler clears ownership and closes it, so
    // its cleanup cannot pop again after router.replace has committed.
    window.history.back();
  });
}

function useLayer(): HTMLElement | null {
  return useSyncExternalStore(
    noSubscribe,
    () => document.getElementById("vx-layer"),
    () => null,
  );
}

export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
  icon,
  label,
  dismissable = true,
  backCloses = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: IconName;
  label?: string;
  dismissable?: boolean;
  /**
   * The phone's Back button closes the sheet instead of leaving the page
   * (smoke 20 Oct: Back on the attendance save sheet jumped to Today). Opt-in
   * per sheet: a sheet whose state also lives in the URL (`useUrlState`) must
   * be checked in a browser before it turns this on. The approach is the fee
   * kit's (src/ui/primitives/sheet.tsx): a marker history entry while open.
   */
  backCloses?: boolean;
  /** An extra class on the panel, for a sheet with a place of its own (the "+" sheet sits on the bar, D-643). */
  className?: string;
}) {
  const layer = useLayer();
  const { tx } = useVx();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // Follow `open` during render rather than in an effect: opening mounts at
  // once, closing first plays the closing animation.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (open) restore.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (!closing) return undefined;
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
      if (restore.current instanceof HTMLElement) restore.current.focus();
    }, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
    return () => window.clearTimeout(t);
  }, [closing]);

  // The latest onClose, read by the key handler. Callers pass an inline
  // `() => setSheet(null)`, a new function on every render. With onClose in
  // the effect's deps every keystroke in a field inside the sheet re-ran the
  // effect, which moved focus to the first control 40 ms later: in the
  // attendance change sheet that was the WhatsApp switch, so the rest of the
  // note was lost and a space turned the parent message on (smoke 20 Oct).
  // tests/vx-sheet-focus.test.tsx holds it; tests/vx-ui-effect-deps.test.ts
  // keeps callback props out of every vx effect's deps.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Back closes the sheet: push a marker entry on open; a popstate that
  // leaves it closes the sheet. Closing any other way pops our own entry, so
  // history stays balanced and Back is never dead for a press.
  const pushed = useRef(false);
  useEffect(() => {
    if (!open || !backCloses) return undefined;
    sheetHistorySeq += 1;
    const id = sheetHistorySeq;
    window.history.pushState({ ...(window.history.state ?? {}), [SHEET_MARK]: id }, "");
    pushed.current = true;
    const onPop = (e: PopStateEvent) => {
      if ((e.state as Record<string, unknown> | null)?.[SHEET_MARK] === id) return;
      pushed.current = false;
      closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, [open, backCloses]);

  // Focus moves into the sheet once, when it opens, and never while focus is
  // already inside it.
  useEffect(() => {
    if (!mounted || closing) return undefined;
    const t = window.setTimeout(() => {
      const box = panel.current;
      if (!box || box.contains(document.activeElement)) return;
      const first = box.querySelector<HTMLElement>("[autofocus]:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]):not([data-close]), a[href]");
      (first ?? box.querySelector<HTMLElement>("button[data-close]") ?? box).focus();
    }, 40);
    return () => window.clearTimeout(t);
  }, [mounted, closing]);

  useEffect(() => {
    if (!mounted || closing) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) closeRef.current();
      if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex='-1'])")).filter((item) => !item.matches(":disabled") && !item.hidden);
        if (items.length === 0) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (!items.includes(document.activeElement as HTMLElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [mounted, closing, dismissable]);

  // Drag the handle or the title down to close, as on a native bottom sheet
  // (phones only: from 900px the sheet is a centred dialog with no handle).
  // The panel follows the finger; a long or quick pull closes, anything else
  // springs back. Inline `animation: none` first, because the opening
  // animation's fill would otherwise pin `transform` and hide the drag.
  const drag = useRef<{ y: number; lastY: number; lastT: number; v: number; dy: number } | null>(null);
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = panel.current;
    const target = event.target as Element;
    if (!box || !dismissable || closing || event.button !== 0) return;
    if (!target.closest("[data-drag-zone]") || target.closest("button,a,input,select,textarea")) return;
    if (window.matchMedia?.("(min-width: 900px)").matches) return;
    drag.current = { y: event.clientY, lastY: event.clientY, lastT: event.timeStamp, v: 0, dy: 0 };
    box.setPointerCapture?.(event.pointerId);
    box.style.animation = "none";
    box.style.transition = "none";
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = panel.current;
    if (!d || !box) return;
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.v = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    // Upward pulls resist instead of lifting the sheet off the bottom edge.
    const raw = event.clientY - d.y;
    d.dy = raw > 0 ? raw : raw / 6;
    box.style.transform = `translateY(${d.dy}px)`;
  };
  const onDragEnd = () => {
    const d = drag.current;
    const box = panel.current;
    drag.current = null;
    if (!d || !box) return;
    if (d.dy > 110 || (d.dy > 24 && d.v > 0.55)) {
      box.style.transition = "transform .2s var(--ease)";
      box.style.transform = "translateY(100%)";
      closeRef.current();
    } else {
      box.style.transition = "transform .3s var(--spring)";
      box.style.transform = "translateY(0)";
    }
  };

  if (!mounted || !layer) return null;

  return createPortal(
    <>
      <button type="button" aria-label={tx(SAY.close)} data-close className={`scrim ${closing ? "closing" : "open"}`} onClick={dismissable ? onClose : undefined} tabIndex={-1} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        className={`sheet${wide ? " wide" : ""}${className ? ` ${className}` : ""} ${closing ? "closing" : "open"}`}
        style={{ outline: "none" }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        <div className="grab" aria-hidden="true" data-drag-zone="" style={{ touchAction: "none", boxSizing: "content-box", paddingBlock: 6, marginTop: 2, marginBottom: -6, backgroundClip: "content-box" }} />
        {title ? (
          <div data-drag-zone="" style={{ flex: "none", display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 20px 10px", touchAction: "none" }}>
            {icon ? (
              <span style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={icon} size={20} />
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <h2 id={titleId} className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{title}</h2>
              {sub ? <span style={{ fontSize: 13, color: "var(--mut)" }}>{sub}</span> : null}
            </div>
            {dismissable ? (
              <button type="button" data-close className="tap btn ghost" aria-label={tx(SAY.close)} onClick={onClose} style={{ width: 40, height: 40, padding: 0, flex: "none" }}>
                <Ic n="x" size={20} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="scroll" style={{ flex: 1, minHeight: 0, padding: title ? "4px 20px 12px" : "20px" }}>{children}</div>
        {footer ? (
          <div style={{ flex: "none", display: "flex", gap: 8, padding: "12px 20px 20px", borderTop: "1px solid var(--bd)", background: "var(--card)" }}>{footer}</div>
        ) : null}
      </div>
    </>,
    layer,
  );
}

type ToastInput = {
  text: ReactNode;
  tone?: "ok" | "bad" | "info";
  undo?: () => void | Promise<void>;
  undoLabel?: string;
  action?: { label: string; onClick: () => void };
  ms?: number;
  /**
   * The feel and sound with it (D-497, `@/ui/feedback/cue`). By default the
   * tone decides: ok → success, bad → error, info → a light tap. Pass "done"
   * for a finished job (register saved, payment posted), or false for none.
   */
  cue?: CueKind | false;
};

type ToastItem = ToastInput & { id: number };

/** The cue a toast carries when the caller does not name one. */
export function toastCue(t: Pick<ToastInput, "tone" | "cue">): CueKind | null {
  if (t.cue === false) return null;
  if (t.cue) return t.cue;
  return t.tone === "bad" ? "error" : t.tone === "info" ? "tap" : "success";
}

const ToastContext = createContext<{ show: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const layer = useLayer();
  const { tx } = useVx();

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  // Cues wait for the person's first touch (D-497); the shell's provider starts listening for it.
  useEffect(() => primeFeedback(), []);

  const show = useCallback((t: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    setItems((all) => [...all.slice(-1), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.ms ?? (t.undo ? 6000 : 4500));
    const kind = toastCue(t);
    if (kind) cue(kind);
    // Read aloud, when the person switched it on: the words, never a sound on page load.
    if (typeof t.text === "string" && readFeedbackPrefs().speak && feedbackReady()) speakLine(t.text);
  }, [dismiss]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {layer
        ? createPortal(
            <div className="toastwrap" aria-live="polite" role="status">
              {items.slice(-1).map((t) => (
                <div key={t.id} className={`toast${t.tone === "bad" ? " bad" : ""}`}>
                  <span className="toast-ic" aria-hidden="true">
                    <Ic n={t.tone === "bad" ? "alert" : t.tone === "info" ? "info" : "checkCircle"} size={18} style={{ color: t.tone === "bad" ? "#F27E7E" : "var(--tacc)" }} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>{t.text}</span>
                  {t.undo ? (
                    <button
                      type="button"
                      onClick={async () => {
                        dismiss(t.id);
                        cue("undo");
                        await t.undo?.();
                      }}
                    >
                      {t.undoLabel ?? tx(SAY.undo)}
                    </button>
                  ) : null}
                  {t.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        dismiss(t.id);
                        t.action?.onClick();
                      }}
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>,
            layer,
          )
        : null}
    </ToastContext.Provider>
  );
}

/** `toast.show({ text, undo })`. Outside the shell it is a no-op rather than a crash. */
export function useToast() {
  return useContext(ToastContext) ?? { show: () => undefined };
}

/** "?" on every screen: three picture steps (RULES G). */
export function HelpButton({ title, steps, style }: { title: string; steps: { icon: IconName; title: string; body: string }[]; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const { tx } = useVx();
  const help = useHelpGlow();
  return (
    <>
      <button type="button" className={`tap icon-btn${help.glow ? " vx-help-new" : ""}`} aria-label={tx(SAY.help(title))} onClick={() => { help.opened(); setOpen(true); }} style={style}>
        <Ic n="help" size={20} />
      </button>
      <Sheet open={open} onClose={() => { setOpen(false); setReading(null); }} title={title} icon="help" footer={<button type="button" className="tap btn pri" style={{ flex: 1 }} onClick={() => { setOpen(false); setReading(null); }}>{tx(SAY.gotIt)}</button>}>
        {/* Listen (D-497): the steps read aloud, the one being read lit up. */}
        <ListenButton lines={[title, ...steps.map((s, i) => `${i + 1}. ${s.title}. ${s.body}`)]} onLine={(i) => setReading(i === null || i === 0 ? null : i - 1)} style={{ marginBottom: 12 }} />
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((s, i) => (
            <li key={s.title} className={`fadein vx-step${reading === i ? " reading" : ""}`} style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 80}ms` }}>
              <span style={{ flex: "none", width: 56, height: 56, borderRadius: 16, background: "var(--accs)", color: "var(--accfg)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                <Ic n={s.icon} size={26} />
                <span className="num" style={{ position: "absolute", top: -6, left: -6, width: 22, height: 22, borderRadius: 11, background: "var(--pri)", color: "var(--prifg)", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <strong>{s.title}</strong>
                <span style={{ color: "var(--mut)", fontSize: 14 }}>{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Sheet>
    </>
  );
}

/** A confirm dialog: says what will happen before it happens (RULES G). */
export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  icon?: IconName;
  children?: ReactNode;
}) {
  const { tx } = useVx();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>{tx(SAY.cancel)}</button>
          <button type="button" className={`tap btn ${danger ? "danger" : "pri"}`} style={{ flex: 1 }} disabled={busy} onClick={onConfirm}>
            {busy ? <Ic n="refresh" size={16} className="spin" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {body ? <p style={{ margin: 0, color: "var(--mut)" }}>{body}</p> : null}
      {children}
    </Sheet>
  );
}
