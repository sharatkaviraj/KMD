"use client";

import { useEffect, useId, useRef, useState } from "react";

import Link from "@/ui/link";
import { useVx } from "@/vx/i18n";
import { Ic } from "@/vx/icons";
import { p, type Pair } from "@/vx/text";
import type { QuickTone, TodayProps } from "@/vx/screens/admin/today";

/*
 * The desk's "+ New" menu on Today. Only a desk shows it (a phone has its
 * quick tiles), so Today loads it as a chunk of its own, like the money
 * section: the home page's chunk counts against every route's first-load
 * budget (D-510, D-528).
 */

const NW = {
  newMenu: p("New", "नया"),
  /** What each "+ New" item opens, under its name (Desktop.dc.html `newItems`). */
  sub: {
    collect: p("Opens the Payment Desk", "फ़ीस काउंटर खुलता है"),
    mark: p("Any class, today", "कोई भी कक्षा, आज"),
    notice: p("WhatsApp to parents or staff", "अभिभावकों या स्टाफ़ को WhatsApp"),
    admit: p("New admission", "नया प्रवेश"),
    cover: p("Cover an absent teacher", "अनुपस्थित शिक्षक की व्यवस्था"),
    note: p("A note on a child", "किसी बच्चे पर नोट"),
  } as Partial<Record<string, Pair>>,
};

export function NewMenu({ actions, looks }: { actions: TodayProps["actions"]; looks: Record<QuickTone, { bg: string; fg: string }> }) {
  const { tx } = useVx();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} style={{ position: "relative" }}>
      <button type="button" className="tap btn pri" aria-expanded={open} aria-controls={menuId} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <Ic n="plus" style={{ transform: `rotate(${open ? 45 : 0}deg)`, transition: "transform .3s var(--spring)" }} />
        {tx(NW.newMenu)}
      </button>
      {open ? (
        <div id={menuId} role="menu" style={{ position: "absolute", right: 0, top: 48, width: 260, zIndex: 30, padding: 6, borderRadius: 16, background: "var(--card)", border: "1px solid var(--bd)", boxShadow: "var(--shh)", transformOrigin: "top right", animation: "xMenu .22s var(--ease) both" }}>
          {actions.map((a, i) => {
            const look = looks[a.tone ?? "acc"];
            const sub = NW.sub[a.key];
            return (
              <Link
                key={a.key}
                href={a.href}
                role="menuitem"
                className="tap ghost"
                onClick={() => setOpen(false)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, color: "var(--fg)", animation: `xRise .3s var(--ease) ${i * 35}ms both` }}
              >
                <span aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: 10, background: look.bg, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={a.icon} />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{tx(a.label)}</span>
                  {sub ? <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(sub)}</span> : null}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
