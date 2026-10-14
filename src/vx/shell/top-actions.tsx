"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { QUICK_ACTIONS } from "@/vx/nav";

/*
 * The right side of the design's desktop top bar (Desktop.dc.html): the
 * search field that opens Ctrl K, and "New" with the quick actions. Small on
 * purpose — the palette itself loads lazily (UI-14), this only asks it to open.
 */

export const TONE: Record<(typeof QUICK_ACTIONS)[number]["tone"], { bg: string; fg: string }> = {
  pri: { bg: "var(--pri)", fg: "var(--prifg)" },
  acc: { bg: "var(--accs)", fg: "var(--accfg)" },
  info: { bg: "var(--infos)", fg: "var(--info)" },
  ok: { bg: "var(--oks)", fg: "var(--ok)" },
  warn: { bg: "var(--warns)", fg: "var(--warnfg)" },
  plain: { bg: "var(--s3)", fg: "var(--fg)" },
};

export function openSearch() {
  window.dispatchEvent(new Event("vx:search"));
}

/** A search field look-alike that opens the palette (Ctrl K). */
export function SearchTrigger({ compact }: { compact?: boolean }) {
  const { tx } = useVx();
  const label = tx({ en: "Search students, receipts, pages", hi: "विद्यार्थी, रसीदें, पेज खोजें" });
  if (compact) {
    return (
      <button type="button" className="tap icon-btn" aria-label={label} onClick={openSearch} style={{ width: 44, height: 44, borderRadius: 22 }}>
        <Ic n="search" size={22} />
      </button>
    );
  }
  return (
    <button type="button" className="tap" aria-label={label} onClick={openSearch} style={{ height: 40, width: 320, maxWidth: "34vw", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 12px", color: "var(--mut)", fontSize: 14 }}>
      <Ic n="search" />
      <span style={{ flex: 1, textAlign: "left" }} className="clip">{label}</span>
      <span className="k">Ctrl K</span>
    </button>
  );
}

/** "New" and its menu of the quick actions this reader may open. */
export function NewMenu({ keys }: { keys: readonly string[] }) {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const items = QUICK_ACTIONS.filter((a) => keys.includes(a.key));

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="tap btn pri" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <Ic n="plus" style={{ transform: open ? "rotate(45deg)" : "none", transition: "transform .3s var(--spring)" }} />
        {tx({ en: "New", hi: "नया" })}
      </button>
      {open ? (
        <div role="menu" style={{ position: "absolute", right: 0, top: 48, width: 260, zIndex: 30, padding: 6, borderRadius: 16, background: "var(--card)", border: "1px solid var(--bd)", boxShadow: "var(--shh)", transformOrigin: "top right", animation: "vxNewPop .22s var(--ease) both" }}>
          {items.map((m, i) => (
            <Link
              key={m.key}
              href={m.href}
              role="menuitem"
              className="tap ghost"
              onClick={() => setOpen(false)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, textAlign: "left", color: "var(--fg)", animation: `xRise .3s var(--ease) ${i * 35}ms both` }}
            >
              <span style={{ flex: "none", width: 34, height: 34, borderRadius: 10, background: TONE[m.tone].bg, color: TONE[m.tone].fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Ic n={m.icon} />
              </span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(m.label)}</span>
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(m.sub)}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
