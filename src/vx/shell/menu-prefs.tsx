"use client";

import Link from "@/ui/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { LANGUAGE_CHOICES, type Pair } from "@/vx/text";
import { FeedbackSwitches } from "@/vx/ui/feedback-switches";
import { LanguageChoices } from "@/vx/ui/language";
import { Sheet } from "@/vx/ui/overlays";

/*
 * The phone Menu's own controls (F13-Menu): the Dark mode and Hindi labels
 * switches in the profile card, and the four pinned tiles with Edit. Theme
 * and language moved here (and to Settings / the teacher's More) when the
 * sidebar footer went back to the design's (UI-90).
 */

const noSubscribe = () => () => {};

/** The design's 52×32 switch track, drawn inside a row that is itself the switch. */
function Track({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" style={{ flex: "none", width: 52, height: 32, borderRadius: 16, padding: 3, background: on ? "var(--acc)" : "var(--bds)", transition: "background-color .25s", display: "flex" }}>
      <span style={{ width: 26, height: 26, borderRadius: 13, background: "#FFFFFF", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transform: `translateX(${on ? 20 : 0}px)`, transition: "transform .32s var(--spring)" }} />
    </span>
  );
}

const rowStyle = { width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left" } as const;

/**
 * Dark mode, the reader's language, and Sounds / Vibration / Read aloud
 * (D-497) — the rows under the person's name.
 * The language row opens all three choices (English, हिंदी, both): the old
 * "Hindi labels" switch wrote only "both" or "en", so a Hindi-only reader
 * who touched it lost "hi" (smoke 20 Oct, dev.groups[10]).
 */
export function MenuToggles() {
  const { tx, language } = useVx();
  const { resolvedTheme, setTheme } = useTheme();
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = ready && resolvedTheme === "dark";
  const [langOpen, setLangOpen] = useState(false);
  const current = LANGUAGE_CHOICES.find((c) => c.value === language) ?? LANGUAGE_CHOICES[0];
  return (
    <>
      <button type="button" role="switch" aria-checked={dark} className="tap" onClick={() => setTheme(dark ? "light" : "dark")} style={rowStyle}>
        <Ic n="moon" />
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{tx({ en: "Dark mode", hi: "डार्क मोड" })}</span>
        <Track on={dark} />
      </button>
      <button type="button" aria-haspopup="dialog" className="tap" onClick={() => setLangOpen(true)} style={rowStyle}>
        <Ic n="globe" />
        <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{tx({ en: "Language", hi: "भाषा" })}</span>
          <span lang={current.lang} style={{ fontSize: 12, color: "var(--mut)" }}>{current.name}</span>
        </span>
        <Ic n="chevRight" />
      </button>
      <FeedbackSwitches
        row={(r) => (
          <button key={r.key} type="button" role="switch" aria-checked={r.on} className="tap" onClick={r.flip} style={rowStyle}>
            <Ic n={r.icon} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{tx(r.title)}</span>
              <span style={{ fontSize: 12, color: "var(--mut)" }}>{tx(r.sub)}</span>
            </span>
            <Track on={r.on} />
          </button>
        )}
      />
      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={tx({ en: "Language", hi: "भाषा" })} icon="globe">
        <LanguageChoices onDone={() => setLangOpen(false)} />
      </Sheet>
    </>
  );
}

export type PinTile = { key: string; label: Pair; icon: IconName; href: string };

const PINS_KEY = "vx.menu.pins";
const PINS_EVENT = "vx:menu-pins";

function readPins(): string {
  try {
    return window.localStorage.getItem(PINS_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribePins(cb: () => void) {
  window.addEventListener(PINS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PINS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The pins chosen on this phone (a per-device convenience), or null when none were chosen. */
export function usePins(): string[] | null {
  const raw = useSyncExternalStore(subscribePins, readPins, () => "");
  return useMemo(() => {
    if (!raw) return null;
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 4) : null;
    } catch {
      return null;
    }
  }, [raw]);
}

function savePins(keys: string[]) {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(keys.slice(0, 4)));
    window.dispatchEvent(new Event(PINS_EVENT));
  } catch {
    // Private mode: the pins stay as they were.
  }
}

/** "Pinned" with Edit, and the four big tiles (F13). */
export function PinnedRow({ pinned, all }: { pinned: PinTile[]; all: PinTile[] }) {
  const { tx } = useVx();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const open = () => {
    setDraft(pinned.map((x) => x.key));
    setEditing(true);
  };
  const flip = (key: string) => setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : d.length >= 4 ? d : [...d, key]));
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <h2 className="sech">{tx({ en: "Pinned", hi: "पिन किए" })}</h2>
        <button type="button" className="tap" onClick={open} style={{ height: 36, padding: "0 0 0 12px", border: 0, background: "transparent", color: "var(--acc)", fontSize: 13, fontWeight: 600 }}>
          {tx({ en: "Edit", hi: "बदलें" })}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {pinned.map((p) => (
          <Link key={p.key} href={p.href} className="tap" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "var(--fg)", fontSize: 12, fontWeight: 600, textAlign: "center", lineHeight: 1.25 }}>
            <span style={{ width: 56, height: 56, borderRadius: 18, background: "var(--nav)", color: "#81DAE4", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Ic n={p.icon} size={24} />
            </span>
            {tx(p.label)}
          </Link>
        ))}
      </div>
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title={tx({ en: "Pinned tiles", hi: "पिन की गई टाइलें" })}
        sub={tx({ en: `Pick up to four · ${draft.length} of 4`, hi: `चार तक चुनें · 4 में से ${draft.length}` })}
        footer={
          <button type="button" className="tap btn pri" style={{ flex: 1, height: 52 }} onClick={() => { savePins(draft); setEditing(false); }}>
            {tx({ en: "Save pins", hi: "पिन सहेजें" })}
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {all.map((x) => {
            const on = draft.includes(x.key);
            return (
              <button key={x.key} type="button" role="checkbox" aria-checked={on} className="tap" onClick={() => flip(x.key)} disabled={!on && draft.length >= 4} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, padding: "6px 4px", border: 0, borderTop: "1px solid var(--bd)", background: "transparent", color: "var(--fg)", textAlign: "left", opacity: !on && draft.length >= 4 ? 0.5 : 1 }}>
                <span style={{ flex: "none", width: 36, height: 36, borderRadius: 11, background: "var(--s2)", color: "var(--pri)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={x.icon} />
                </span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{tx(x.label)}</span>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, border: on ? 0 : "1.5px solid var(--bds)", background: on ? "var(--pri)" : "var(--card)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {on ? <Ic n="check" size={14} stroke={3} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
