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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Ic, type IconName } from "@/vx/icons";

/*
 * Sheets, dialogs and toasts. They render into `#vx-layer`, which the shell
 * mounts beside the page (see the note in vx.css). On a phone a sheet is a
 * bottom sheet with a grab handle; from 900px it is a centred dialog. Both
 * play their closing animation before they unmount.
 */

const noSubscribe = () => () => {};

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
}) {
  const layer = useLayer();
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
    }, 230);
    return () => window.clearTimeout(t);
  }, [closing]);

  useEffect(() => {
    if (!mounted || closing) return undefined;
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button:not([data-close])");
      (first ?? panel.current)?.focus();
    }, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
      if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex='-1'])"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
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
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [mounted, closing, dismissable, onClose]);

  if (!mounted || !layer) return null;

  return createPortal(
    <>
      <button type="button" aria-label="Close" data-close className={`scrim ${closing ? "closing" : "open"}`} onClick={dismissable ? onClose : undefined} tabIndex={-1} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        tabIndex={-1}
        className={`sheet${wide ? " wide" : ""} ${closing ? "closing" : "open"}`}
        style={{ outline: "none" }}
      >
        <div className="grab" aria-hidden="true" />
        {title ? (
          <div style={{ flex: "none", display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 20px 10px" }}>
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
              <button type="button" data-close className="tap btn ghost" aria-label="Close" onClick={onClose} style={{ width: 40, height: 40, padding: 0, flex: "none" }}>
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
};

type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<{ show: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const layer = useLayer();

  const dismiss = useCallback((id: number) => setItems((all) => all.filter((t) => t.id !== id)), []);

  const show = useCallback((t: ToastInput) => {
    seq.current += 1;
    const id = seq.current;
    setItems((all) => [...all.slice(-1), { ...t, id }]);
    window.setTimeout(() => dismiss(id), t.ms ?? (t.undo ? 6000 : 4500));
  }, [dismiss]);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {layer
        ? createPortal(
            <div className="toastwrap" aria-live="polite" role="status">
              {items.slice(-1).map((t) => (
                <div key={t.id} className="toast">
                  <Ic n={t.tone === "bad" ? "alert" : t.tone === "info" ? "info" : "checkCircle"} size={18} style={{ color: t.tone === "bad" ? "#F27E7E" : "var(--tacc)" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500 }}>{t.text}</span>
                  {t.undo ? (
                    <button
                      type="button"
                      onClick={async () => {
                        dismiss(t.id);
                        await t.undo?.();
                      }}
                    >
                      {t.undoLabel ?? "Undo"}
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
  return (
    <>
      <button type="button" className="tap icon-btn" aria-label={`Help: ${title}`} onClick={() => setOpen(true)} style={style}>
        <Ic n="help" size={20} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} icon="help" footer={<button type="button" className="tap btn pri" style={{ flex: 1 }} onClick={() => setOpen(false)}>Got it</button>}>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {steps.map((s, i) => (
            <li key={s.title} className="fadein" style={{ display: "flex", gap: 14, alignItems: "flex-start", animationDelay: `${i * 80}ms` }}>
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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      icon={icon}
      footer={
        <>
          <button type="button" className="tap btn sec" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
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
