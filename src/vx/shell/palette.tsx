"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import type { Pair } from "@/vx/text";
import { Sheet } from "@/vx/ui/overlays";

import { searchEverythingAction, type SearchHit } from "./search-actions";

export type PaletteItem = { href: string; label: Pair; icon: IconName; group: string };

/**
 * Search everything (Ctrl K, D07-Search / F04-Search): pages from this
 * person's menu, students and receipts. Arrow keys move, Enter opens.
 */
export function SearchPalette({ items }: { items: PaletteItem[] }) {
  const { tx } = useVx();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, start] = useTransition();
  const [cursor, setCursor] = useState(0);
  // Results for a one-letter query are never shown, whatever came back last.
  const shownHits = q.trim().length < 2 ? [] : hits;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("vx:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("vx:search", onOpen);
    };
  }, []);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = window.setTimeout(() => {
      start(async () => {
        const res = await searchEverythingAction(q).catch(() => []);
        setHits(res);
        setCursor(0);
      });
    }, 220);
  }, [q]);

  const pages = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term ? items.filter((i) => `${i.label.en} ${i.label.hi ?? ""} ${i.group}`.toLowerCase().includes(term)) : items.slice(0, 8);
    return list.slice(0, 8);
  }, [items, q]);

  const rows: { key: string; icon: IconName; title: string; sub: string; href: string; group: string }[] = [
    ...shownHits.filter((h) => h.kind === "student").map((h) => ({ key: `s${h.id}`, icon: "user" as IconName, title: h.title, sub: h.sub, href: h.href, group: "Students" })),
    ...shownHits.filter((h) => h.kind === "receipt").map((h) => ({ key: `r${h.id}`, icon: "receipt" as IconName, title: h.title, sub: h.sub, href: h.href, group: "Receipts" })),
    ...pages.map((p) => ({ key: `p${p.href}`, icon: p.icon, title: tx(p.label), sub: p.group, href: p.href, group: "Pages" })),
  ];

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <Sheet open={open} onClose={() => setOpen(false)} label="Search" wide>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ position: "relative", height: 52, borderRadius: 14, border: "1px solid var(--bds)", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", color: "var(--mut)" }}>
          <Ic n={pending ? "refresh" : "search"} className={pending ? "spin" : undefined} size={20} />
          <span className="sr">Search students, receipts, pages</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(rows.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter" && rows[cursor]) {
                e.preventDefault();
                go(rows[cursor].href);
              }
            }}
            placeholder="Search students, receipts, pages"
            aria-activedescendant={rows[cursor] ? `vxp-${rows[cursor].key}` : undefined}
            style={{ flex: 1, minWidth: 0, height: "100%", border: 0, background: "transparent", outline: "none", fontSize: 17, color: "var(--fg)" }}
          />
          <span className="k only-d">Esc</span>
        </label>
        <ul role="listbox" aria-label="Results" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {rows.map((r, i) => (
            <li key={r.key} id={`vxp-${r.key}`} role="option" aria-selected={i === cursor}>
              {i === 0 || rows[i - 1].group !== r.group ? <div className="sech" style={{ padding: "10px 4px 6px" }}>{r.group}</div> : null}
              <button
                type="button"
                className={`tap row${i === cursor ? " sel" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.href)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "8px 10px", border: 0, borderRadius: 12, background: i === cursor ? "var(--accs)" : "transparent", color: "var(--fg)", textAlign: "left" }}
              >
                <span style={{ width: 36, height: 36, borderRadius: 10, background: "var(--s2)", color: "var(--mut)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  <Ic n={r.icon} size={18} />
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span className="clip" style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{r.sub}</span>
                </span>
                <Ic n="chevRight" size={16} style={{ color: "var(--mut)" }} />
              </button>
            </li>
          ))}
          {rows.length === 0 ? <li style={{ padding: 20, textAlign: "center", color: "var(--mut)" }}>{pending ? "Searching…" : "Nothing found. Try a name, SR number or receipt number."}</li> : null}
        </ul>
      </div>
    </Sheet>
  );
}

/** A search field look-alike for top bars that opens the palette. */
export function SearchTrigger({ compact }: { compact?: boolean }) {
  const open = () => window.dispatchEvent(new Event("vx:search"));
  if (compact) {
    return (
      <button type="button" className="tap icon-btn" aria-label="Search" onClick={open} style={{ width: 44, height: 44, borderRadius: 22 }}>
        <Ic n="search" size={22} />
      </button>
    );
  }
  return (
    <button type="button" className="tap" onClick={open} style={{ height: 40, width: 320, maxWidth: "36vw", borderRadius: 12, border: "1px solid var(--bd)", background: "var(--card)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", color: "var(--mut)", fontSize: 14 }}>
      <Ic n="search" />
      <span style={{ flex: 1, textAlign: "left" }} className="clip">Search students, receipts, pages</span>
      <span className="k">Ctrl K</span>
    </button>
  );
}
