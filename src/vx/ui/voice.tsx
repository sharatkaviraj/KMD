"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Ic } from "@/vx/icons";
import { useVx } from "@/vx/i18n";
import { p, type Pair } from "@/vx/text";

import { appendSpoken, speechSessionText } from "./speech-text";

export { appendSpoken } from "./speech-text";

const SAY = {
  unsupported: p("Speaking is not available in this browser. Use the mic on your keyboard.", "इस ब्राउज़र में बोलकर लिखना नहीं चलता। कीबोर्ड का माइक दबाएँ।"),
  allowMic: p("Allow the microphone to speak a note.", "बोलकर लिखने के लिए माइक की अनुमति दें।"),
  notHeard: p("Could not hear that. Try again or type.", "सुनाई नहीं दिया। फिर से बोलें या लिखें।"),
  placeholder: p("Type or speak the note…", "नोट लिखें या बोलें…"),
  note: p("Note", "नोट"),
  speak: p("Speak the note", "नोट बोलें"),
  stop: p("Stop listening", "सुनना बंद करें"),
  listeningHi: p("Listening… speak in Hindi", "सुन रहे हैं… हिंदी में बोलें"),
  listeningEn: p("Listening… speak in English", "सुन रहे हैं… अंग्रेज़ी में बोलें"),
  speakIn: p("Speak in", "बोलने की भाषा"),
  tip: p("Tip: use the mic on your phone keyboard to speak.", "सुझाव: बोलने के लिए फ़ोन के कीबोर्ड का माइक दबाएँ।"),
};

/*
 * Speak a note (PLAN A.11). The Web Speech API, `hi-IN` or `en-IN`, which
 * Chrome on Android supports. Where it is missing the widget says so and the
 * teacher uses the microphone on the phone keyboard instead — the text box is
 * always there. Only the words are stored, never audio.
 */

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

/** Chrome ends a session after a silence even in continuous mode; keep going this long without speech. */
const IDLE_LIMIT_MS = 45_000;
/** Recognizer errors that mean "nothing heard yet", not a failure. */
const QUIET = new Set(["no-speech", "aborted"]);

/**
 * Speak into a text box. `onText` receives each finished stretch of speech
 * exactly once, with Android's repeated phrases merged away
 * (`speechSessionText`); `interim` is the stretch still being heard, for a
 * live preview. Listening continues across Chrome's silence cut-offs until
 * the person taps stop, or nothing is said for 45 seconds.
 */
export function useSpeech(onText: (finalText: string) => void) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => Boolean(recognitionCtor()),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [errorP, setError] = useState<Pair | null>(null);
  /** The English line, for callers that still wrap it in `p()`; prefer `errorP`. */
  const error = errorP?.en ?? null;
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const commitNow = useRef<(() => void) | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  });

  useEffect(() => () => {
    wanted.current = false;
    rec.current?.abort();
  }, []);

  const start = (lang: "hi-IN" | "en-IN") => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError(SAY.unsupported);
      return;
    }
    rec.current?.abort();
    setError(null);
    setInterim("");
    wanted.current = true;
    let lastHeard = Date.now();

    const session = () => {
      const r = new Ctor();
      // The text of this session, rebuilt from every result on every event.
      let heard = { final: "", interim: "" };
      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        // A stretch Chrome never marked final is still what the person said.
        const text = [heard.final, heard.interim].filter(Boolean).join(" ").trim();
        setInterim("");
        if (text) cb.current(text);
      };
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      commitNow.current = commit;
      r.onresult = (e) => {
        // After stop() handed this session's text over, late results would repeat it.
        if (committed) return;
        const segments = Array.from({ length: e.results.length }, (_, i) => ({
          text: e.results[i][0]?.transcript ?? "",
          isFinal: e.results[i].isFinal,
        }));
        heard = speechSessionText(segments);
        lastHeard = Date.now();
        setInterim([heard.final, heard.interim].filter(Boolean).join(" "));
      };
      r.onerror = (e) => {
        if (QUIET.has(e.error)) return;
        wanted.current = false;
        setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? SAY.allowMic : SAY.notHeard);
      };
      r.onend = () => {
        commit();
        if (rec.current !== r) return;
        if (wanted.current && Date.now() - lastHeard < IDLE_LIMIT_MS) {
          try {
            session();
            return;
          } catch {
            // Fall through: the browser refused a new session.
          }
        }
        wanted.current = false;
        rec.current = null;
        setListening(false);
      };
      rec.current = r;
      r.start();
    };

    try {
      session();
      setListening(true);
    } catch {
      wanted.current = false;
      setError(SAY.notHeard);
    }
  };

  /**
   * Stop and hand over what was heard, now. Screens read `interim` and clear
   * their own copy right after calling this; results Chrome sends after the
   * stop are ignored, so they cannot come back as a repeat next time.
   */
  const stop = () => {
    wanted.current = false;
    commitNow.current?.();
    commitNow.current = null;
    rec.current?.stop();
    setListening(false);
  };

  return { supported, listening, interim, error, errorP, start, stop };
}

/** Animated bars while listening (xWave). */
export function Waveform({ active = true, bars = 18 }: { active?: boolean; bars?: number }) {
  return (
    <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 3, height: 36 }}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 36,
            borderRadius: 2,
            background: "var(--acc)",
            transformOrigin: "center",
            transform: active ? undefined : "scaleY(.25)",
            animation: active ? `xWave .9s ease-in-out ${(i % 6) * 0.11}s infinite` : "none",
            opacity: 0.55 + ((i * 37) % 45) / 100,
          }}
        />
      ))}
    </span>
  );
}

/**
 * A text box with a big microphone. Spoken words are appended to the text.
 */
export function VoiceNote({
  value,
  onChange,
  placeholder,
  lang = "hi-IN",
  onLangChange,
  rows = 5,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  lang?: "hi-IN" | "en-IN";
  onLangChange?: (l: "hi-IN" | "en-IN") => void;
  rows?: number;
  name?: string;
}) {
  const { tx } = useVx();
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  });
  const speech = useSpeech((text) => {
    const next = appendSpoken(valueRef.current, text);
    valueRef.current = next;
    onChange(next);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ position: "relative" }}>
        <textarea
          className="inp"
          name={name}
          rows={rows}
          value={speech.listening && speech.interim ? appendSpoken(value, speech.interim) : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? tx(SAY.placeholder)}
          aria-label={tx(SAY.note)}
          style={{ paddingRight: 64 }}
        />
        <button
          type="button"
          className="tap"
          aria-label={tx(speech.listening ? SAY.stop : SAY.speak)}
          aria-pressed={speech.listening}
          onClick={() => (speech.listening ? speech.stop() : speech.start(lang))}
          style={{ position: "absolute", right: 10, bottom: 10, width: 48, height: 48, borderRadius: 24, border: 0, background: speech.listening ? "var(--bad)" : "var(--pri)", color: "var(--prifg)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {speech.listening ? (
            <>
              <span aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: 24, background: "var(--bad)", animation: "xRipple 1.6s ease-out infinite" }} />
              <span style={{ position: "relative", width: 16, height: 16, borderRadius: 4, background: "var(--onsolid)" }} />
            </>
          ) : (
            <Ic n="mic" size={22} />
          )}
        </button>
      </div>
      {speech.listening ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--accfg)", fontSize: 13, fontWeight: 600 }}>
          <Waveform />
          {tx(lang === "hi-IN" ? SAY.listeningHi : SAY.listeningEn)}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--mut)" }}>
        {onLangChange ? (
          <>
            <span>{tx(SAY.speakIn)}</span>
            {(["hi-IN", "en-IN"] as const).map((l) => (
              <button key={l} type="button" className={`tap chip${lang === l ? " on" : ""}`} aria-pressed={lang === l} onClick={() => onLangChange(l)} style={{ height: 30 }}>
                {l === "hi-IN" ? "हिंदी" : "English"}
              </button>
            ))}
          </>
        ) : null}
        {speech.errorP ? <span role="alert" style={{ color: "var(--warnfg)" }}>{tx(speech.errorP)}</span> : !speech.supported ? <span>{tx(SAY.tip)}</span> : null}
      </div>
    </div>
  );
}
