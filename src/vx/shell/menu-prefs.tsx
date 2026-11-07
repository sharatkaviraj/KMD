"use client";

import Link from "@/ui/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

import { cue } from "@/ui/feedback/cue";
import { Ic, type IconName } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { LANGUAGE_CHOICES, p, type Pair } from "@/vx/text";
import { FeedbackSwitches } from "@/vx/ui/feedback-switches";
import { LanguageChoices } from "@/vx/ui/language";
import { Sheet, useToast } from "@/vx/ui/overlays";

/*
 * The phone Menu's own controls (F13-Menu, D-519): the quick switches in the
 * Settings card (Dark mode, Language, Sounds, Vibration, Read aloud), and the
 * four shortcuts with Change. Theme and language moved here (and to Settings /
 * the teacher's More) when the sidebar footer went back to the design's
 * (UI-90). Styles are `vxm-*` in `src/app/(app)/menu/menu.css`.
 */

const noSubscribe = () => () => {};

const W = {
  on: p("On", "चालू"),
  off: p("Off", "बंद"),
  dark: p("Dark mode", "डार्क मोड"),
  language: p("Language", "भाषा"),
  note: p("Language is saved to your account. The other switches stay on this device.", "भाषा आपके खाते में सहेजी जाती है। बाकी स्विच सिर्फ़ इसी डिवाइस पर रहते हैं।"),
};

/** The words of a switch tile: its name, the other language under it for a reader of both, and what it is now. */
function QuickWords({ title, state }: { title: Pair; state: string }) {
  const { tx, sub } = useVx();
  const second = sub(title);
  return (
    <>
      <span className="vxm-q-l">{tx(title)}</span>
      {second ? <span className="vxm-q-l2" lang="hi">{second}</span> : null}
      {/* Keyed by the word, so a change pops in and the eye catches it. */}
      <span key={state} className="vxm-q-s" aria-hidden="true">{state}</span>
    </>
  );
}

/** A small on/off track in the tile's corner; the whole tile is the switch. */
function MiniTrack() {
  return (
    <span className="vxm-sw" aria-hidden="true">
      <i />
    </span>
  );
}

/**
 * The quick switches (D-519): one big tile each, the state written under its
 * name. Dark mode, the reader's language (all three choices, in a sheet: the
 * old "Hindi labels" switch wrote only "both" or "en", so a Hindi-only reader
 * who touched it lost "hi" — smoke 20 Oct, dev.groups[10]), and Sounds /
 * Vibration / Read aloud (D-497), each offered only where the device can.
 */
export function QuickSwitches() {
  const { tx, language } = useVx();
  const { resolvedTheme, setTheme } = useTheme();
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  const dark = ready && resolvedTheme === "dark";
  const [langOpen, setLangOpen] = useState(false);
  const current = LANGUAGE_CHOICES.find((c) => c.value === language) ?? LANGUAGE_CHOICES[0];
  return (
    <>
      <div className="vxm-qs">
        <button
          type="button"
          role="switch"
          aria-checked={dark}
          aria-label={tx(W.dark)}
          className={`tap vxm-q${dark ? " on" : ""}`}
          onClick={() => {
            cue("select");
            setTheme(dark ? "light" : "dark");
          }}
        >
          <span className="vxm-q-top">
            <span className="vxm-q-ic"><Ic n="moon" size={18} /></span>
            <MiniTrack />
          </span>
          <QuickWords title={W.dark} state={tx(dark ? W.on : W.off)} />
        </button>
        <button type="button" aria-haspopup="dialog" className="tap vxm-q" onClick={() => setLangOpen(true)}>
          <span className="vxm-q-top">
            <span className="vxm-q-ic"><Ic n="globe" size={18} /></span>
            <Ic n="chevRight" size={18} style={{ color: "var(--mut)" }} />
          </span>
          <span className="vxm-q-l">{tx(W.language)}</span>
          <span className="vxm-q-s" lang={current.lang}>{current.name}</span>
        </button>
        <FeedbackSwitches
          row={(r) => (
            <button key={r.key} type="button" role="switch" aria-checked={r.on} aria-label={tx(r.title)} className={`tap vxm-q${r.on ? " on" : ""}`} onClick={r.flip}>
              <span className="vxm-q-top">
                <span className="vxm-q-ic"><Ic n={r.icon} size={18} /></span>
                <MiniTrack />
              </span>
              <QuickWords title={r.title} state={tx(r.on ? W.on : W.off)} />
            </button>
          )}
        />
      </div>
      <p className="vxm-note">{tx(W.note)}</p>
      <Sheet open={langOpen} onClose={() => setLangOpen(false)} title={tx(W.language)} icon="globe">
        <LanguageChoices onDone={() => setLangOpen(false)} />
      </Sheet>
    </>
  );
}

export type PinTile = { key: string; label: Pair; icon: IconName; href: string; hint?: Pair };

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

function savePins(keys: string[]): boolean {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(keys.slice(0, 4)));
    window.dispatchEvent(new Event(PINS_EVENT));
    return true;
  } catch {
    // Private mode: the pins stay as they were.
    return false;
  }
}

const S = {
  title: p("Your shortcuts", "आपके शॉर्टकट"),
  change: p("Change", "बदलें"),
  sheet: p("Choose your shortcuts", "अपने शॉर्टकट चुनें"),
  save: p("Save shortcuts", "शॉर्टकट सहेजें"),
  saved: p("Shortcuts saved", "शॉर्टकट सहेज दिए"),
  notSaved: p("This browser could not keep them. Try again.", "यह ब्राउज़र इन्हें सहेज नहीं पाया। फिर कोशिश करें।"),
};

/** "Your shortcuts" with Change, and the four big tiles (F13's Pinned). */
export function Shortcuts({ pinned, all }: { pinned: PinTile[]; all: PinTile[] }) {
  const { tx, sub } = useVx();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const open = () => {
    setDraft(pinned.map((x) => x.key));
    setEditing(true);
  };
  const flip = (key: string) => {
    cue("select");
    setDraft((d) => (d.includes(key) ? d.filter((k) => k !== key) : d.length >= 4 ? d : [...d, key]));
  };
  const second = sub(S.title);
  return (
    <>
      <div className="vxm-sec-h">
        <h2>
          {tx(S.title)}
          {second ? <small lang="hi">{second}</small> : null}
        </h2>
        <button type="button" className="tap vxm-change" onClick={open} aria-haspopup="dialog">
          <Ic n="edit" size={16} /> {tx(S.change)}
        </button>
      </div>
      <div className="vxm-pins">
        {pinned.map((x) => (
          <Link key={x.key} href={x.href} className="tap vxm-pin">
            <span aria-hidden="true">
              <Ic n={x.icon} size={26} />
            </span>
            {tx(x.label)}
          </Link>
        ))}
      </div>
      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title={tx(S.sheet)}
        sub={tx({ en: `Pick up to four · ${draft.length} of 4 chosen`, hi: `चार तक चुनें · 4 में से ${draft.length} चुने` })}
        icon="star"
        footer={
          <button
            type="button"
            className="tap btn pri"
            style={{ flex: 1, height: 52 }}
            onClick={() => {
              const ok = savePins(draft);
              setEditing(false);
              toast.show(ok ? { text: tx(S.saved), tone: "ok" } : { text: tx(S.notSaved), tone: "bad" });
            }}
          >
            <Ic n="check" size={18} /> {tx(S.save)}
          </button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {all.map((x) => {
            const on = draft.includes(x.key);
            const full = !on && draft.length >= 4;
            return (
              <button key={x.key} type="button" role="checkbox" aria-checked={on} className="tap vxm-pick" onClick={() => flip(x.key)} disabled={full}>
                <span aria-hidden="true" style={{ flex: "none", width: 40, height: 40, borderRadius: 12, background: "var(--s2)", color: "var(--pri)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Ic n={x.icon} />
                </span>
                <span className="vxm-pick-t">
                  <b>{tx(x.label)}</b>
                  {x.hint ? <span>{tx(x.hint)}</span> : null}
                </span>
                <span className="vxm-box" aria-hidden="true">{on ? <Ic n="check" size={15} stroke={3} /> : null}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
